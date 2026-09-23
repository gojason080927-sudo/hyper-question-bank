/**
 * Cache-only 쎈2 problem split. Never calls OCR or Production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import { MATH2_CACHE_DIR, MATH2_PAGE_COUNT, MATH2_PDF_SHA256, MATH2_REPORT_DIR, cacheFileName } from './math2Ocr'
import { formatMath2SegmentMarkdown, refusePersist, runMath2Segment, type Math2PageInput } from './math2Segment'

type CachedPage = {
  page: number
  markdown: string
  raw?: MistralOcrLike
}

function loadPages(root: string): Math2PageInput[] {
  const pages: Math2PageInput[] = []
  for (let page = 1; page <= MATH2_PAGE_COUNT; page += 1) {
    const file = path.join(root, MATH2_CACHE_DIR, cacheFileName(MATH2_PDF_SHA256, page))
    if (!existsSync(file)) throw new Error(`MATH2_SEGMENT_CACHE_MISS: ${file}`)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CachedPage
    pages.push({ page, markdown: raw.markdown ?? '', raw: raw.raw ?? null })
  }
  return pages
}

export function runMath2SegmentCli(root = process.cwd(), argv = process.argv.slice(2)) {
  refusePersist(argv)
  const pages = loadPages(root)
  const report = runMath2Segment(pages)
  const dest = path.join(root, MATH2_REPORT_DIR)
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, 'segment-dry-run.json'), JSON.stringify(report, null, 2), 'utf8')
  writeFileSync(path.join(dest, 'segment-dry-run.md'), formatMath2SegmentMarkdown(report), 'utf8')
  console.log(
    JSON.stringify(
      {
        phase: 'segment-dry-run',
        persist_problems: false,
        candidates: report.candidates,
        auto_safe: report.auto_safe,
        needs_review: report.needs_review,
        blocked: report.blocked,
        duplicate_suspects: report.duplicate_suspects,
        missing_suspects: report.missing_suspects,
        reverse_or_jump: report.reverse_or_jump,
        cross_page: report.cross_page,
        issues: report.issues,
      },
      null,
      2,
    ),
  )
  return report
}

const isMain = process.argv[1]?.includes('math2SegmentCli')
if (isMain) {
  runMath2SegmentCli(process.cwd(), process.argv.slice(2))
}
