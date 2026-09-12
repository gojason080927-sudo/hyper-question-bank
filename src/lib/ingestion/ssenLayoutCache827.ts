/**
 * STEP 8.27 layout OCR cache generation helpers.
 * Still STEP 8.27. Does not start 8.28. Does not persist problems.
 * Paid Mistral is allowed only for this cache-fill, with a $1 cap.
 */
import { compareCacheFileName } from '../ocr/ocrCompare'
import { MISTRAL_OFFICIAL_OCR_PRICING, mistralOcrUsdForPages } from '../ocr/costModel'
import { MISTRAL_MODEL, MISTRAL_PROVIDER } from '../ocr/mathOcrTypes'
import { coerceMistralBlock, type MistralPixelBlock } from '../ocr/normalizeMistral'
import { extractWorkbookProblemAnchor } from '../recognition/structure'
import { LAYOUT_CACHE_PROFILE, SECOND_DOCUMENT, SECOND_PDF_SHA256, STEP827_DOCUMENT, STEP827_SSEN_FILE_HASH, STEP827_SSEN_PAGE_COUNT } from './cacheSegment827'

export const SSEN_OCR_CACHE_PARSER_VERSION = 'hqb-ssen-layout-cache-v1'
export const SSEN_OCR_CACHE_USD_CAP = 1
export const SSEN_OCR_CACHE_PROVIDER = MISTRAL_PROVIDER
export const SSEN_OCR_CACHE_MODEL = MISTRAL_MODEL
export const SSEN_OCR_CACHE_PROFILE = LAYOUT_CACHE_PROFILE
export const SSEN_OCR_CACHE_BUCKET = 'question-bank-sources'
export const SSEN_OCR_CACHE_VERSION = 'v1'
export const FORBIDDEN_SECOND_HASH = SECOND_PDF_SHA256
export const FORBIDDEN_SECOND_SOURCE = SECOND_DOCUMENT

export type PilotRole = 'BODY_FORMULA' | 'MCQ' | 'TABLE_BOX' | 'FIGURE_GRAPH' | 'MULTI_COLUMN_COMPLEX'

export type PilotPageSpec = {
  page: number
  role: PilotRole
  reason: string
  expect_problem_anchor: boolean
  expect_choices: boolean
  expect_table_or_box: boolean
  expect_figure: boolean
}

/**
 * Five representative SSEN pages. 1-based PDF page numbers.
 * Not cover / TOC / answer-only. Evidence: local render of Production original.pdf
 * plus existing STEP 7.6 compare roles for 8/12/20.
 */
export const SSEN_PILOT_PAGES: readonly PilotPageSpec[] = [
  {
    page: 8,
    role: 'BODY_FORMULA',
    reason: '기본 다잡기: 다항식 연산 본문·공식, SSEN NOTE 사이드바. STEP 7.6 korean_exponents.',
    expect_problem_anchor: false,
    expect_choices: false,
    expect_table_or_box: false,
    expect_figure: false,
  },
  {
    page: 28,
    role: 'MCQ',
    reason: '유형 뽀개기 2단: 0159–0165, 객관식 ①–⑤가 본문과 분리됨.',
    expect_problem_anchor: true,
    expect_choices: true,
    expect_table_or_box: false,
    expect_figure: false,
  },
  {
    page: 12,
    role: 'TABLE_BOX',
    reason: '0045 표 + 객관식. STEP 7.6 mcq_table. 표 역할을 이 페이지에 할당.',
    expect_problem_anchor: true,
    expect_choices: true,
    expect_table_or_box: true,
    expect_figure: false,
  },
  {
    page: 20,
    role: 'FIGURE_GRAPH',
    reason: '0097 반원·직사각형 도형과 조건 박스. STEP 7.6 figure_quadratic.',
    expect_problem_anchor: true,
    expect_choices: true,
    expect_table_or_box: true,
    expect_figure: true,
  },
  {
    page: 108,
    role: 'MULTI_COLUMN_COMPLEX',
    reason: '2단 + 원기둥/오각기둥/직각삼각형 도형 + 연립 박스. STEP 8.24 BLOCKED ids 0735/0736 포함.',
    expect_problem_anchor: true,
    expect_choices: true,
    expect_table_or_box: false,
    expect_figure: true,
  },
] as const

export function ssenOcrCachePrefix(pdfSha256: string = STEP827_SSEN_FILE_HASH): string {
  return `ocr-cache/${STEP827_DOCUMENT}/${pdfSha256}/${SSEN_OCR_CACHE_VERSION}`
}

export function layoutCacheFileName(pagePngSha256: string): string {
  return compareCacheFileName(SSEN_OCR_CACHE_PROVIDER, pagePngSha256, SSEN_OCR_CACHE_PROFILE)
}

export function cacheKeyParts(input: {
  sourceId: string
  pdfSha256: string
  page: number
  provider: string
  model: string
  profile: string
  parserVersion: string
  pagePngSha256: string
}): string {
  return [
    input.sourceId,
    input.pdfSha256,
    `p${String(input.page).padStart(3, '0')}`,
    input.provider,
    input.model,
    input.profile,
    input.parserVersion,
    input.pagePngSha256,
  ].join('|')
}

export function estimateMistralUsd(pageCount: number): number {
  return mistralOcrUsdForPages(pageCount)
}

export function wouldExceedUsdCap(alreadyUsd: number, nextPages: number, cap = SSEN_OCR_CACHE_USD_CAP): boolean {
  return alreadyUsd + estimateMistralUsd(nextPages) > cap + 1e-9
}

export function assertExactSsenOriginal(input: { sha256: string; pageCount: number; sizeBytes: number }): {
  ok: boolean
  blockers: string[]
} {
  const blockers: string[] = []
  if (input.sha256 === FORBIDDEN_SECOND_HASH) blockers.push('SECOND_BOOK_HASH_FORBIDDEN')
  if (input.sha256 !== STEP827_SSEN_FILE_HASH) blockers.push('SSEN_SHA256_MISMATCH')
  if (input.pageCount !== STEP827_SSEN_PAGE_COUNT) blockers.push('SSEN_PAGE_COUNT_MISMATCH')
  if (input.sizeBytes <= 0) blockers.push('EMPTY_OR_CORRUPT_PDF')
  return { ok: blockers.length === 0, blockers }
}

export function remainingPages(completed: Iterable<number>, total = STEP827_SSEN_PAGE_COUNT): number[] {
  const done = new Set(completed)
  const out: number[] = []
  for (let page = 1; page <= total; page += 1) {
    if (!done.has(page)) out.push(page)
  }
  return out
}

export function pagesToProcess(input: {
  phase: 'pilot' | 'remainder'
  completed: Iterable<number>
}): number[] {
  const done = new Set(input.completed)
  if (input.phase === 'pilot') {
    return SSEN_PILOT_PAGES.map((row) => row.page).filter((page) => !done.has(page))
  }
  return remainingPages(done)
}

export type PageQualityIssue = {
  code: string
  detail: string
}

export type PageQualityInput = {
  page: number
  ocrPageIndex: number | null
  pageWidth: number
  pageHeight: number
  blocks: MistralPixelBlock[]
  images: Array<{ id?: string; bbox: number[] | null }>
  markdown: string
  hasTable: boolean
  pngSha256: string
  expectedPngSha256: string
  jsonParseable: boolean
}

export function bboxInsidePage(block: MistralPixelBlock, width: number, height: number, slack = 2): boolean {
  return (
    block.top_left_x >= -slack &&
    block.top_left_y >= -slack &&
    block.bottom_right_x <= width + slack &&
    block.bottom_right_y <= height + slack &&
    block.bottom_right_x >= block.top_left_x &&
    block.bottom_right_y >= block.top_left_y
  )
}

function readingOrderShuffled(blocks: MistralPixelBlock[]): boolean {
  const text = blocks.filter((block) => (block.content ?? '').trim().length > 0)
  if (text.length < 4) return false
  let inversions = 0
  for (let i = 1; i < text.length; i += 1) {
    const prev = text[i - 1]
    const cur = text[i]
    const sameColumn = Math.abs(prev.top_left_x - cur.top_left_x) < 80
    if (sameColumn && cur.top_left_y + 24 < prev.top_left_y) inversions += 1
  }
  return inversions > text.length * 0.45
}

export function evaluatePageQuality(page: PageQualityInput, spec?: PilotPageSpec): PageQualityIssue[] {
  const issues: PageQualityIssue[] = []
  if (!page.jsonParseable) issues.push({ code: 'CORRUPT_JSON', detail: `page ${page.page}` })
  if (page.pngSha256 !== page.expectedPngSha256) {
    issues.push({ code: 'PAGE_PNG_SHA256_MISMATCH', detail: `page ${page.page}` })
  }
  if (page.ocrPageIndex != null && page.ocrPageIndex !== page.page - 1 && page.ocrPageIndex !== page.page) {
    issues.push({
      code: 'PAGE_INDEX_MISMATCH',
      detail: `pdf=${page.page} ocr_index=${page.ocrPageIndex}`,
    })
  }
  if (page.pageWidth <= 0 || page.pageHeight <= 0) {
    issues.push({ code: 'MISSING_DIMENSIONS', detail: `page ${page.page}` })
  }
  if (page.blocks.length === 0 && !(page.markdown ?? '').trim()) {
    issues.push({ code: 'EMPTY_OCR', detail: `page ${page.page}` })
  }
  const outOfBounds = page.blocks.filter((block) => !bboxInsidePage(block, page.pageWidth, page.pageHeight))
  if (outOfBounds.length > 0) {
    issues.push({ code: 'BBOX_OUT_OF_PAGE', detail: `page ${page.page} count=${outOfBounds.length}` })
  }
  if (readingOrderShuffled(page.blocks)) {
    issues.push({ code: 'READING_ORDER_SHUFFLED', detail: `page ${page.page}` })
  }
  const blob = `${page.markdown}\n${page.blocks.map((block) => block.content ?? '').join('\n')}`
  const hasAnchor = page.blocks.some((block) => Boolean(extractWorkbookProblemAnchor(block.content ?? '').number)) ||
    Boolean(extractWorkbookProblemAnchor(blob).number)
  const hasChoice = /[①-⑤]|\(\s*[1-5]\s*\)/.test(blob)
  const hasTable = page.hasTable || page.blocks.some((block) => block.type === 'table' || Boolean(block.table_id)) || /<table[\s>]|\n\|.+\|/.test(blob)
  const hasFigure =
    page.images.some((image) => image.bbox != null) || page.blocks.some((block) => block.type === 'image' || Boolean(block.image_id))
  if (spec?.expect_problem_anchor && !hasAnchor) {
    issues.push({ code: 'PROBLEM_NUMBER_NOT_SEPARABLE', detail: `page ${page.page}` })
  }
  if (spec?.expect_choices && !hasChoice) {
    issues.push({ code: 'CHOICES_NOT_SEPARABLE', detail: `page ${page.page}` })
  }
  if (spec?.expect_table_or_box && !hasTable && !/가\)|나\)|조건/.test(blob)) {
    issues.push({ code: 'TABLE_OR_BOX_MISSING', detail: `page ${page.page}` })
  }
  if (spec?.expect_figure && !hasFigure && !/그림/.test(blob)) {
    issues.push({ code: 'FIGURE_REGION_MISSING', detail: `page ${page.page}` })
  }
  return issues
}

export function evaluatePilotGate(input: {
  pages: Array<{ spec: PilotPageSpec; quality: PageQualityIssue[] }>
  paidCalls: number
  usd: number
  cacheLoadable: boolean
}): { pass: boolean; blockers: string[] } {
  const blockers: string[] = []
  if (input.pages.length !== 5) blockers.push('PILOT_PAGE_COUNT')
  for (const row of input.pages) {
    if (row.quality.length > 0) blockers.push(`PILOT_QUALITY_PAGE_${row.spec.page}`)
  }
  if (input.paidCalls > 5) blockers.push('PILOT_PAID_CALLS_EXCEEDED')
  if (input.usd > SSEN_OCR_CACHE_USD_CAP) blockers.push('USD_CAP')
  if (!input.cacheLoadable) blockers.push('CACHE_NOT_LOADABLE_FOR_8_27')
  return { pass: blockers.length === 0, blockers }
}

export function stripImageBase64(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImageBase64)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'image_base64' || key === 'imageBase64') continue
    out[key] = stripImageBase64(child)
  }
  return out
}

export function compatibleLayoutCacheRecord(input: {
  page: number
  sourceId: string
  pdfSha256: string
  pagePngSha256: string
  provider: string
  model: string | null
  profile: string
  parserVersion: string
  createdAt: string
  rawOcr: string
  seconds: number | null
  httpStatus: number | null
  rawResponse: unknown
  blocks: MistralPixelBlock[]
  images: Array<{ id?: string; bbox: number[] | null }>
  dimensions: { dpi?: number; width?: number; height?: number } | null
  hasTable: boolean
}): Record<string, unknown> {
  return {
    cache_key: cacheKeyParts({
      sourceId: input.sourceId,
      pdfSha256: input.pdfSha256,
      page: input.page,
      provider: input.provider,
      model: input.model ?? SSEN_OCR_CACHE_MODEL,
      profile: input.profile,
      parserVersion: input.parserVersion,
      pagePngSha256: input.pagePngSha256,
    }),
    source_id: input.sourceId,
    pdf_sha256: input.pdfSha256,
    page: input.page,
    provider: input.provider,
    model: input.model,
    profile: input.profile,
    parser_version: input.parserVersion,
    page_png_sha256: input.pagePngSha256,
    created_at: input.createdAt,
    raw_ocr: input.rawOcr,
    seconds: input.seconds,
    http_status: input.httpStatus,
    layout: {
      blocks: input.blocks,
      images: input.images,
      tables_detected: input.hasTable,
      dimensions: input.dimensions,
    },
    raw_response: stripImageBase64(input.rawResponse),
  }
}

export function findDuplicatePages(pages: number[]): number[] {
  const seen = new Set<number>()
  const dup = new Set<number>()
  for (const page of pages) {
    if (seen.has(page)) dup.add(page)
    seen.add(page)
  }
  return [...dup].sort((a, b) => a - b)
}

export function findMissingPages(pages: number[], expected = STEP827_SSEN_PAGE_COUNT): number[] {
  const have = new Set(pages)
  const missing: number[] = []
  for (let page = 1; page <= expected; page += 1) {
    if (!have.has(page)) missing.push(page)
  }
  return missing
}

export function uniqueCacheKeys(keys: string[]): boolean {
  return new Set(keys).size === keys.length
}

export const SSEN_OCR_PRICING_NOTE = {
  provider: SSEN_OCR_CACHE_PROVIDER,
  model: SSEN_OCR_CACHE_MODEL,
  official_usd_per_1000_pages: MISTRAL_OFFICIAL_OCR_PRICING.usd_per_1000_pages,
  official_usd_per_page: MISTRAL_OFFICIAL_OCR_PRICING.usd_per_page,
  billing_unit: MISTRAL_OFFICIAL_OCR_PRICING.billing_unit,
  sources: MISTRAL_OFFICIAL_OCR_PRICING.sources,
  pricing_date: MISTRAL_OFFICIAL_OCR_PRICING.pricing_date,
  pilot_pages: 5,
  pilot_usd: estimateMistralUsd(5),
  full_pages: STEP827_SSEN_PAGE_COUNT,
  full_usd: estimateMistralUsd(STEP827_SSEN_PAGE_COUNT),
  cap_usd: SSEN_OCR_CACHE_USD_CAP,
  under_cap: !wouldExceedUsdCap(0, STEP827_SSEN_PAGE_COUNT),
} as const

export function coercePageBlocks(blocks: unknown[]): MistralPixelBlock[] {
  return blocks.flatMap((block) => {
    const coerced = coerceMistralBlock(block)
    return coerced ? [coerced] : []
  })
}

export const SSEN_OCR_FORBIDDEN_SUBSTITUTES = [
  FORBIDDEN_SECOND_SOURCE,
  FORBIDDEN_SECOND_HASH,
  'second-common-math1.pdf',
  'ocr-tests/taxonomy/step8-22/pages/ssen',
  'ocr-tests/taxonomy/step8-18',
] as const
