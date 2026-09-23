/**
 * Cache-only generic book split. Never calls OCR or Production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import { cacheFileName } from './math2Ocr'
import { specFromBookArg, type BookIngestSpec } from './bookIngestSpec'
import { formatBookSegmentMarkdown, refuseBookPersist, runBookSegment, type Math2PageInput } from './bookSegment'

type CachedPage = { page: number; markdown: string; raw?: MistralOcrLike }

function specFromArgv(argv: string[]): BookIngestSpec {
  return specFromBookArg(argv)
}

function loadPages(root: string, spec: BookIngestSpec): Math2PageInput[] {
  const pages: Math2PageInput[] = []
  for (let page = 1; page <= spec.pageCount; page += 1) {
    const file = path.join(root, spec.cacheDir, cacheFileName(spec.pdfHash, page))
    if (!existsSync(file)) throw new Error(`BOOK_SEGMENT_CACHE_MISS: ${file}`)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CachedPage
    pages.push({ page, markdown: raw.markdown ?? '', raw: raw.raw ?? null })
  }
  return pages
}

export function runBookSegmentCli(root = process.cwd(), argv = process.argv.slice(2)) {
  refuseBookPersist(argv)
  const spec = specFromArgv(argv)
  const pages = loadPages(root, spec)
  const report = runBookSegment(spec, pages)
  const dest = path.join(root, spec.reportDir)
  mkdirSync(dest, { recursive: true })
  const { rows: _rows, ...summary } = report
  writeFileSync(
    path.join(dest, 'segment-dry-run.json'),
    JSON.stringify({ ...summary, samples: summary.samples.map(({ stem: _stem, ...sample }) => sample) }, null, 2),
    'utf8',
  )
  writeFileSync(path.join(dest, 'segment-dry-run.md'), formatBookSegmentMarkdown(report), 'utf8')
  console.log(
    JSON.stringify(
      {
        phase: 'segment-dry-run',
        persist_problems: false,
        sourceId: report.sourceId,
        candidates: report.candidates,
        auto_safe: report.auto_safe,
        needs_review: report.needs_review,
        blocked: report.blocked,
        issues: report.issues,
      },
      null,
      2,
    ),
  )
  return report
}

const isMain = process.argv[1]?.includes('bookSegmentCli')
if (isMain) {
  runBookSegmentCli(process.cwd(), process.argv.slice(2))
}
