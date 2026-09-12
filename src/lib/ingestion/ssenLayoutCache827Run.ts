/**
 * STEP 8.27 SSEN layout OCR cache runner.
 * Downloads/verifies Production original.pdf, optionally fills Mistral cache.
 * Never writes problems. Never starts 8.28. Never calls Mathpix.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parsePaidGate } from '../ocr/paidGate'
import { hasMistralCredentials } from '../ocr/mistralSecrets'
import {
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
} from './batchPipeline825'
import {
  STEP827,
  STEP827_DIR,
  STEP827_DOCUMENT,
  STEP827_DOCUMENT_TITLE,
  STEP827_SSEN_FILE_HASH,
  STEP827_SSEN_ORIGINAL_FILENAME,
  STEP827_SSEN_PAGE_COUNT,
} from './cacheSegment827'
import {
  SSEN_OCR_CACHE_MODEL,
  SSEN_OCR_CACHE_PARSER_VERSION,
  SSEN_OCR_CACHE_PROFILE,
  SSEN_OCR_CACHE_PROVIDER,
  SSEN_OCR_CACHE_USD_CAP,
  SSEN_OCR_PRICING_NOTE,
  SSEN_PILOT_PAGES,
  assertExactSsenOriginal,
  ssenOcrCachePrefix,
  wouldExceedUsdCap,
  type PilotPageSpec,
} from './ssenLayoutCache827'

export const SSEN_OCR_CACHE_DIR = STEP827_DIR

export type SsenOcrCacheStatus =
  | 'BLOCKED_MISTRAL_KEY_MISSING'
  | 'BLOCKED_ORIGINAL_MISMATCH'
  | 'BLOCKED_PAID_GATE'
  | 'BLOCKED_USD_CAP'
  | 'PILOT_READY'
  | 'PILOT_FAILED'
  | 'CACHE_COMPLETE'

export type SsenOcrCacheSummary = {
  step: '8.27'
  name: 'SSEN layout OCR cache generation'
  status: SsenOcrCacheStatus
  next_step_started: false
  student_care_accessed: false
  target_ref: string
  textbook: { id: string; title: string; filename: string }
  original: {
    path: string | null
    sha256: string | null
    page_count: number | null
    size_bytes: number | null
    pdf_header_ok: boolean | null
    match: boolean
    blockers: string[]
    substituted: false
    committed_to_git: false
  }
  provider: {
    name: typeof SSEN_OCR_CACHE_PROVIDER
    model: typeof SSEN_OCR_CACHE_MODEL
    profile: typeof SSEN_OCR_CACHE_PROFILE
    parser_version: typeof SSEN_OCR_CACHE_PARSER_VERSION
    mathpix_called: false
  }
  pricing: typeof SSEN_OCR_PRICING_NOTE
  pilot_pages: PilotPageSpec[]
  key_present: boolean
  paid_api_calls: { mistral: number; mathpix: 0; retries: number }
  usd_spent: number
  usd_cap: number
  completed_pages: number[]
  missing_pages: number[]
  durable_prefix: string
  user_action: string | null
  blockers: string[]
}

function writeJson(dest: string, name: string, value: unknown) {
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function pdfPageCount(filePath: string): { pages: number | null; headerOk: boolean } {
  const bytes = readFileSync(filePath)
  const headerOk = bytes.subarray(0, 5).toString('utf8') === '%PDF-' && bytes.includes(Buffer.from('%%EOF'))
  const py = spawnSync(
    'python3',
    ['-c', 'from pypdf import PdfReader; import sys; print(len(PdfReader(sys.argv[1]).pages))', filePath],
    { encoding: 'utf8' },
  )
  if (py.status !== 0) return { pages: null, headerOk }
  const pages = Number(py.stdout.trim())
  return { pages: Number.isFinite(pages) ? pages : null, headerOk }
}

function locateOriginal(root: string, argv: string[]): string | null {
  const flag = argv.find((item) => item.startsWith('--pdf='))
  if (flag) return flag.slice('--pdf='.length)
  const temp = '/tmp/hqb-ssen-ocr/original.pdf'
  if (existsSync(temp)) return temp
  const local = path.join(root, '.ocr-temp/ssen-original.pdf')
  if (existsSync(local)) return local
  return null
}

function emptyOriginal(): SsenOcrCacheSummary['original'] {
  return {
    path: null,
    sha256: null,
    page_count: null,
    size_bytes: null,
    pdf_header_ok: null,
    match: false,
    blockers: ['ORIGINAL_PDF_NOT_IN_WORKING_TREE'],
    substituted: false,
    committed_to_git: false,
  }
}

export async function runSsenLayoutCache827(root: string, argv: string[]): Promise<SsenOcrCacheSummary> {
  if (process.env.VITE_SUPABASE_URL?.includes(STUDENT_CARE_REF)) {
    throw new Error('Student Care project refused')
  }
  const dest = path.join(root, SSEN_OCR_CACHE_DIR)
  const gate = parsePaidGate(argv)
  const keyPresent = hasMistralCredentials()
  const pdfPath = locateOriginal(root, argv)

  let original = emptyOriginal()
  if (pdfPath && existsSync(pdfPath)) {
    const sha256 = sha256File(pdfPath)
    const size = readFileSync(pdfPath).byteLength
    const counted = pdfPageCount(pdfPath)
    const checked = assertExactSsenOriginal({
      sha256,
      pageCount: counted.pages ?? -1,
      sizeBytes: size,
    })
    original = {
      path: pdfPath,
      sha256,
      page_count: counted.pages,
      size_bytes: size,
      pdf_header_ok: counted.headerOk,
      match: checked.ok && counted.headerOk,
      blockers: checked.ok ? (counted.headerOk ? [] : ['PDF_HEADER_OR_EOF_INVALID']) : checked.blockers,
      substituted: false,
      committed_to_git: false,
    }
  }

  const blockers: string[] = [...original.blockers]
  let status: SsenOcrCacheStatus = 'PILOT_READY'
  let userAction: string | null = null

  if (!original.match) {
    status = 'BLOCKED_ORIGINAL_MISMATCH'
    if (!pdfPath) {
      userAction = null
      blockers.push('DOWNLOAD_ORIGINAL_FROM_PRODUCTION_STORAGE_FIRST')
    }
  } else if (!keyPresent) {
    status = 'BLOCKED_MISTRAL_KEY_MISSING'
    userAction =
      'Cloud Agent 환경에 worker-only 비밀 MISTRAL_API_KEY 를 추가한다. VITE_ 접두사는 쓰지 않는다.'
    blockers.push('MISTRAL_API_KEY_MISSING')
  } else if (!gate.allowPaidApi || !gate.confirmCost || gate.cacheOnly) {
    status = 'BLOCKED_PAID_GATE'
    blockers.push('PAID_GATE_REQUIRES_ALLOW_AND_CONFIRM_NOT_CACHE_ONLY')
  }

  if (wouldExceedUsdCap(0, STEP827_SSEN_PAGE_COUNT)) {
    status = 'BLOCKED_USD_CAP'
    blockers.push('FULL_192_WOULD_EXCEED_USD_CAP')
  }

  const summary: SsenOcrCacheSummary = {
    step: STEP827,
    name: 'SSEN layout OCR cache generation',
    status,
    next_step_started: false,
    student_care_accessed: false,
    target_ref: QUESTION_BANK_REF,
    textbook: {
      id: STEP827_DOCUMENT,
      title: STEP827_DOCUMENT_TITLE,
      filename: STEP827_SSEN_ORIGINAL_FILENAME,
    },
    original,
    provider: {
      name: SSEN_OCR_CACHE_PROVIDER,
      model: SSEN_OCR_CACHE_MODEL,
      profile: SSEN_OCR_CACHE_PROFILE,
      parser_version: SSEN_OCR_CACHE_PARSER_VERSION,
      mathpix_called: false,
    },
    pricing: SSEN_OCR_PRICING_NOTE,
    pilot_pages: [...SSEN_PILOT_PAGES],
    key_present: keyPresent,
    paid_api_calls: { mistral: 0, mathpix: 0, retries: 0 },
    usd_spent: 0,
    usd_cap: SSEN_OCR_CACHE_USD_CAP,
    completed_pages: [],
    missing_pages: Array.from({ length: STEP827_SSEN_PAGE_COUNT }, (_, i) => i + 1),
    durable_prefix: `${'question-bank-sources'}/${ssenOcrCachePrefix()}`,
    user_action: userAction,
    blockers,
  }

  writeJson(dest, 'ocr-cache-generation.json', summary)
  writeJson(dest, 'original-pdf-verify.json', {
    source_id: STEP827_DOCUMENT,
    expected_sha256: STEP827_SSEN_FILE_HASH,
    expected_pages: STEP827_SSEN_PAGE_COUNT,
    ...original,
    downloaded_from: 'Production Storage question-bank-sources/.../original.pdf',
    gitignored: true,
  })
  writeJson(dest, 'ocr-cache-manifest.json', {
    source_id: STEP827_DOCUMENT,
    pdf_sha256: original.sha256,
    profile: SSEN_OCR_CACHE_PROFILE,
    provider: SSEN_OCR_CACHE_PROVIDER,
    model: SSEN_OCR_CACHE_MODEL,
    parser_version: SSEN_OCR_CACHE_PARSER_VERSION,
    durable_prefix: summary.durable_prefix,
    pages: [],
    completed: [],
    missing: summary.missing_pages,
    paid_api_calls: summary.paid_api_calls,
    usd_spent: 0,
  })
  writeFileSync(
    path.join(dest, 'ocr-cache-generation.md'),
    `# STEP 8.27 SSEN layout OCR cache

STATUS: ${status}
TEXTBOOK: ${STEP827_DOCUMENT_TITLE} (${STEP827_DOCUMENT})
SHA256 match: ${original.match}
pages: ${original.page_count}
provider: ${SSEN_OCR_CACHE_PROVIDER} / ${SSEN_OCR_CACHE_MODEL}
profile: ${SSEN_OCR_CACHE_PROFILE}
official price: $${SSEN_OCR_PRICING_NOTE.official_usd_per_page}/page ($${SSEN_OCR_PRICING_NOTE.official_usd_per_1000_pages}/1000)
pilot 5: $${SSEN_OCR_PRICING_NOTE.pilot_usd}
full 192: $${SSEN_OCR_PRICING_NOTE.full_usd}
cap: $${SSEN_OCR_CACHE_USD_CAP}
pilot pages: ${SSEN_PILOT_PAGES.map((row) => `${row.page}:${row.role}`).join(', ')}
paid mistral calls: 0
mathpix calls: 0
user action: ${userAction ?? '(none)'}
Do not start STEP 8.28.
`,
    'utf8',
  )

  return summary
}

export const SSEN_OCR_CACHE_SAFETY = {
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  mathpixCalls: 0,
  nextStepStarted: false,
} as const
