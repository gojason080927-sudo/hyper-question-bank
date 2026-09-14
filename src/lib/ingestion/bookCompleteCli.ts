/**
 * ingest:book CLI — one command for the next textbook.
 * Default dry-run. `--apply` enables Production writes. Source lock prevents duplicate runs.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SSEN_SECTIONS, SSEN_SOURCE_DOCUMENT_ID, SSEN_TITLE } from '../outline/ssenToc'
import { STEP832_PDF_SHA256 } from './fullBookIngest832'
import {
  bookStatusPath,
  formatBookCompleteMarkdown,
  genericOutlineAdapter,
  parseIngestBookFlags,
  planBookComplete,
  sourceLockPath,
  type OutlineAdapter,
} from './bookCompletePipeline'
import { runCloseout } from './ssenBookCloseoutCli'

function sha256Bytes(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

function ssenPageAdapter(): OutlineAdapter {
  return {
    id: 'ssen-page-toc',
    parseToc() {
      return SSEN_SECTIONS.map((section) => ({
        code: section.code,
        title: section.title,
        startPage: section.pdfStart,
        level: 'SECTION' as const,
      }))
    },
    assignUnit(input, toc) {
      const hit = [...toc].reverse().find((node) => node.startPage <= input.page)
      return hit ? { section: hit.code } : null
    },
  }
}

function acquireLock(root: string, sourceId: string): { ok: boolean; path: string } {
  const file = path.join(root, sourceLockPath(sourceId))
  mkdirSync(path.dirname(file), { recursive: true })
  if (existsSync(file)) return { ok: false, path: file }
  writeFileSync(file, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(), sourceId }, null, 2))
  return { ok: true, path: file }
}

function releaseLock(lockFile: string) {
  try {
    if (existsSync(lockFile)) unlinkSync(lockFile)
  } catch {
    /* ignore */
  }
}

export async function runIngestBook(root = process.cwd()) {
  const flags = parseIngestBookFlags(process.argv.slice(2))
  if (!flags.sourceId) {
    console.error('usage: npm run ingest:book -- --source-id=<id> --mode=complete [--apply] [--cost-cap=1] [--resume]')
    process.exit(1)
  }
  const lock = acquireLock(root, flags.sourceId === 'ssen' ? SSEN_SOURCE_DOCUMENT_ID : flags.sourceId)
  if (!lock.ok) {
    console.error(`source lock exists: ${lock.path}`)
    process.exit(1)
  }
  try {
    const isSsen = flags.sourceId === SSEN_SOURCE_DOCUMENT_ID || flags.sourceId === 'ssen'
    const pdfCandidates = [
      path.join(root, '.ocr-temp/ssen-original.pdf'),
      path.join(root, 'ocr-tests/taxonomy/ssen-common-math-1.pdf'),
    ]
    const pdfPath = pdfCandidates.find((file) => existsSync(file)) ?? null
    const pdfHash = pdfPath ? sha256Bytes(readFileSync(pdfPath)) : isSsen ? STEP832_PDF_SHA256 : 'missing'
    const prevStatusPath = path.join(root, bookStatusPath(isSsen ? SSEN_SOURCE_DOCUMENT_ID : flags.sourceId))
    const previous = existsSync(prevStatusPath) ? (JSON.parse(readFileSync(prevStatusPath, 'utf8')) as { pdf_hash?: string }) : null
    const adapter = isSsen ? ssenPageAdapter() : genericOutlineAdapter()
    const plan = planBookComplete({
      sourceId: isSsen ? SSEN_SOURCE_DOCUMENT_ID : flags.sourceId,
      title: isSsen ? SSEN_TITLE : flags.sourceId,
      pdfHash,
      previousPdfHash: previous?.pdf_hash ?? (isSsen ? STEP832_PDF_SHA256 : null),
      pageCount: isSsen ? 192 : 0,
      pageHashes: [],
      cachedOcrKeys: [],
      costCapUsd: flags.costCapUsd,
      apply: flags.apply,
      lockHeld: true,
      ocrPolicy: flags.ocrPolicy,
      adapter,
    })
    const outDir = path.join(root, path.dirname(plan.reports.json))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(path.join(root, plan.reports.json), JSON.stringify(plan, null, 2), 'utf8')
    writeFileSync(path.join(root, plan.reports.markdown), formatBookCompleteMarkdown(plan), 'utf8')
    console.log(`ingest:book source=${plan.sourceId} dry_run=${plan.dry_run} ocr=${plan.ocr_new_calls} writes=${plan.writes} identical=${plan.identical_pdf}`)

    if (isSsen && flags.mode === 'complete') {
      await runCloseout(root)
    }
  } finally {
    releaseLock(lock.path)
  }
}

const isMain = process.argv[1]?.includes('bookCompleteCli')
if (isMain) {
  await runIngestBook(process.cwd())
}
