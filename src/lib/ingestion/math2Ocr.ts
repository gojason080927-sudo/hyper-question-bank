/**
 * 쎈 공통수학 2 page OCR only.
 * Reuses the existing Production source + Storage PDF.
 * Does not run SSEN ingest:book --mode=complete.
 * Does not create problems / regions / problem_sources.
 */
import { MEANINGFUL_TEXT_CHARS } from '../pdf/constants'
import { meaningfulCharCount } from '../pdf/classifyPdf'
import { extractMistralLatex, extractMistralMarkdown, type MistralOcrLike } from '../ocr/normalizeMistral'
import { MISTRAL_MODEL, MISTRAL_PROVIDER } from '../ocr/mathOcrTypes'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { classifyBookPageV2, countAnchorsFromText } from '../recognition/bookClassify'

export const MATH2_DOCUMENT_ID = '7c40102b-b4dc-4ff1-a512-6a2912c27b4e'
export const MATH2_TITLE = '쎈 공통수학 2'
export const MATH2_PAGE_COUNT = 200
export const MATH2_PDF_SHA256 = '136f744b573b2d194c3d9cc7d67cba19b6b4ddd9d517d9e0d14912c52e67c83f'
export const MATH2_OCR_PROVIDER = MISTRAL_PROVIDER
export const MATH2_OCR_MODEL = MISTRAL_MODEL
export const MATH2_OCR_PROFILE = 'ocr-latest+blocks+tables'
export const MATH2_OCR_USD_PER_PAGE = 0.004
export const MATH2_OCR_COST_CAP_USD = 1.0
export const MATH2_OCR_BATCH_SIZE = 20
export const MATH2_REPORT_DIR = 'ocr-tests/taxonomy/math2-ocr'
export const MATH2_CACHE_DIR = '.ocr-temp/math2-ocr'
export const FORBIDDEN_SOURCE_IDS = [SSEN_SOURCE_DOCUMENT_ID] as const

export type Math2OcrPlan = {
  sourceId: string
  title: string
  pageCount: number
  pdfHash: string
  model: string
  provider: string
  cachedPages: number[]
  missPages: number[]
  estimatedNewCalls: number
  estimatedUsd: number
  capUsd: number
  underCap: boolean
  persistProblems: false
}

export type Math2PageQa = {
  page: number
  ok: boolean
  cached: boolean
  meaningful_chars: number
  has_substantial_text: boolean
  latex_count: number
  table_html: boolean
  image_count: number
  four_digit_anchors: number
  section_anchors: number
  circled_choices: number
  page_kind: string
  preview: string
  error: string | null
}

export function assertMath2Document(sourceId: string): void {
  if (FORBIDDEN_SOURCE_IDS.includes(sourceId as (typeof FORBIDDEN_SOURCE_IDS)[number])) {
    throw new Error('MATH2_OCR_FORBIDDEN: refusing 쎈 공통수학1 / SSEN document')
  }
  if (sourceId !== MATH2_DOCUMENT_ID) {
    throw new Error(`MATH2_OCR_SOURCE_LOCK: expected ${MATH2_DOCUMENT_ID}, got ${sourceId}`)
  }
}

export function assertPageRange(pages: number[]): void {
  if (pages.length === 0) throw new Error('MATH2_OCR_EMPTY_RANGE')
  const seen = new Set<number>()
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > MATH2_PAGE_COUNT) {
      throw new Error(`MATH2_OCR_PAGE_RANGE: ${page} is outside 1–${MATH2_PAGE_COUNT}`)
    }
    if (seen.has(page)) throw new Error(`MATH2_OCR_DUPLICATE_PAGE: ${page}`)
    seen.add(page)
  }
}

export function estimateMath2OcrUsd(newCalls: number): number {
  return Number((Math.max(0, newCalls) * MATH2_OCR_USD_PER_PAGE).toFixed(4))
}

export function paidCapAllows(spentUsd: number, nextCalls: number): { ok: boolean; nextUsd: number; totalUsd: number } {
  const nextUsd = estimateMath2OcrUsd(nextCalls)
  const totalUsd = Number((spentUsd + nextUsd).toFixed(4))
  return { ok: totalUsd <= MATH2_OCR_COST_CAP_USD + 1e-9, nextUsd, totalUsd }
}

export function cacheKey(pdfHash: string, page: number, model = MATH2_OCR_MODEL): string {
  return `${pdfHash}:p${String(page).padStart(3, '0')}:${model}:${MATH2_OCR_PROFILE}`
}

export function cacheFileName(pdfHash: string, page: number): string {
  return `${pdfHash.slice(0, 16)}/p${String(page).padStart(3, '0')}.json`
}

export function planMath2Ocr(input: { cachedPages?: number[]; pageCount?: number; pdfHash?: string }): Math2OcrPlan {
  const pageCount = input.pageCount ?? MATH2_PAGE_COUNT
  if (pageCount !== MATH2_PAGE_COUNT) {
    throw new Error(`MATH2_OCR_PAGE_COUNT: refusing to cap or expand away from ${MATH2_PAGE_COUNT}`)
  }
  const cached = new Set((input.cachedPages ?? []).filter((page) => page >= 1 && page <= pageCount))
  const missPages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((page) => !cached.has(page))
  const estimatedUsd = estimateMath2OcrUsd(missPages.length)
  return {
    sourceId: MATH2_DOCUMENT_ID,
    title: MATH2_TITLE,
    pageCount,
    pdfHash: input.pdfHash ?? MATH2_PDF_SHA256,
    model: MATH2_OCR_MODEL,
    provider: MATH2_OCR_PROVIDER,
    cachedPages: [...cached].sort((a, b) => a - b),
    missPages,
    estimatedNewCalls: missPages.length,
    estimatedUsd,
    capUsd: MATH2_OCR_COST_CAP_USD,
    underCap: estimatedUsd <= MATH2_OCR_COST_CAP_USD + 1e-9,
    persistProblems: false,
  }
}

export function batchesOf<T>(items: T[], size = MATH2_OCR_BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function toApiPages(bookPages: number[]): number[] {
  return bookPages.map((page) => page - 1)
}

export function fromApiPageIndex(index: number): number {
  return index + 1
}

export function stripImageBase64(raw: MistralOcrLike): MistralOcrLike {
  return {
    ...raw,
    pages: (raw.pages ?? []).map((page) => ({
      ...page,
      images: (page.images ?? []).map((image) => {
        const { image_base64: _drop, ...rest } = image
        return rest
      }),
    })),
  }
}

export function pageMarkdownFromRaw(raw: MistralOcrLike, apiIndex: number): string {
  const page = (raw.pages ?? []).find((row) => (row.index ?? apiIndex) === apiIndex) ?? raw.pages?.[0]
  return page?.markdown ?? extractMistralMarkdown(raw)
}

export function analyzeMath2Page(input: {
  page: number
  markdown: string
  raw?: MistralOcrLike | null
  cached?: boolean
  error?: string | null
}): Math2PageQa {
  const markdown = input.markdown ?? ''
  const meaningful = meaningfulCharCount(markdown)
  const anchors = countAnchorsFromText(markdown)
  const rawPage = (input.raw?.pages ?? []).find((row) => (row.index ?? input.page - 1) === input.page - 1) ?? input.raw?.pages?.[0]
  const kind = classifyBookPageV2({
    page_number: input.page,
    total_pages: MATH2_PAGE_COUNT,
    ink_ratio: null,
    ocr_failed: Boolean(input.error),
    has_ocr: !input.error && markdown.length > 0,
    cache_text: markdown,
    four_digit_count: anchors.four_digit,
    section_count: anchors.section,
    block_count: Array.isArray(rawPage?.blocks) ? rawPage.blocks.length : 0,
    image_count: rawPage?.images?.length ?? 0,
  })
  return {
    page: input.page,
    ok: !input.error && meaningful > 0,
    cached: Boolean(input.cached),
    meaningful_chars: meaningful,
    has_substantial_text: meaningful >= MEANINGFUL_TEXT_CHARS,
    latex_count: extractMistralLatex(markdown).length,
    table_html: /<table[\s>]|\n\|.+\|/i.test(markdown),
    image_count: rawPage?.images?.length ?? 0,
    four_digit_anchors: anchors.four_digit,
    section_anchors: anchors.section,
    circled_choices: (markdown.match(/[①-⑤]/g) ?? []).length,
    page_kind: kind.page_kind,
    preview: markdown.replace(/\s+/g, ' ').trim().slice(0, 180),
    error: input.error ?? null,
  }
}

export function summarizeMath2Qa(pages: Math2PageQa[]): {
  pages: number
  success: number
  failed: number
  cached: number
  called: number
  substantial_text: number
  missing_pages: number[]
  duplicate_pages: number[]
  kinds: Record<string, number>
} {
  const seen = new Set<number>()
  const duplicate_pages: number[] = []
  for (const row of pages) {
    if (seen.has(row.page)) duplicate_pages.push(row.page)
    seen.add(row.page)
  }
  const missing_pages = Array.from({ length: MATH2_PAGE_COUNT }, (_, i) => i + 1).filter((page) => !seen.has(page))
  const kinds: Record<string, number> = {}
  for (const row of pages) kinds[row.page_kind] = (kinds[row.page_kind] ?? 0) + 1
  return {
    pages: pages.length,
    success: pages.filter((row) => row.ok).length,
    failed: pages.filter((row) => !row.ok).length,
    cached: pages.filter((row) => row.cached).length,
    called: pages.filter((row) => !row.cached).length,
    substantial_text: pages.filter((row) => row.has_substantial_text).length,
    missing_pages,
    duplicate_pages,
    kinds,
  }
}

export function pickQaSamples(pages: Math2PageQa[]): number[] {
  const by = (fn: (row: Math2PageQa) => number) =>
    [...pages].sort((a, b) => fn(b) - fn(a))[0]?.page ?? null
  const picked = [
    1,
    6,
    by((row) => row.four_digit_anchors),
    by((row) => row.circled_choices),
    by((row) => row.latex_count),
    by((row) => (row.table_html ? 1 : 0) * 100 + row.image_count),
    192,
    200,
  ].filter((page): page is number => page != null)
  return [...new Set(picked)].sort((a, b) => a - b)
}

export function nextSegmentationApproach(qa: ReturnType<typeof summarizeMath2Qa>): {
  reuse: string[]
  do_not_reuse: string[]
  recommended: string
} {
  return {
    reuse: [
      'Mistral markdown + blocks cache, keyed by PDF hash + page + model',
      'classifyBookPageV2 for COVER/TOC/THEORY/PROBLEM/ANSWER',
      'countAnchorsFromText / extractWorkbookProblemAnchor (4-digit 쎈 번호, 유형 구간)',
      'layoutSegment.segmentPageFromLayout once page blocks exist',
      'bookCompletePipeline generic outline adapter after TOC text is real',
    ],
    do_not_reuse: [
      'ingest:book --mode=complete (SSEN hyper-complete only)',
      'ssenToc / SSEN_LAST_PAGE=192 / SSEN_SECTIONS',
      'step832 persist-to-SSEN draft upsert',
      'FullQaReviewPanel 1,242·192 copy',
    ],
    recommended:
      qa.substantial_text < MATH2_PAGE_COUNT * 0.8
        ? 'OCR quality is too thin for auto-split. Repair failed pages before any problem persist.'
        : 'Next: dry-run page-kind + 4-digit/유형 anchors on this OCR only. Persist problems only after a separate apply review. Do not call ingest:book --mode=complete.',
  }
}

export function formatMath2QaMarkdown(input: {
  plan: Math2OcrPlan
  qa: ReturnType<typeof summarizeMath2Qa>
  samples: Math2PageQa[]
  spentUsd: number
  modelUsed: string
  next: ReturnType<typeof nextSegmentationApproach>
}): string {
  const sampleLines = input.samples.map(
    (row) =>
      `- p${row.page} ${row.page_kind} chars=${row.meaningful_chars} latex=${row.latex_count} choices=${row.circled_choices} anchors=${row.four_digit_anchors} table=${row.table_html} img=${row.image_count} cached=${row.cached}\n  ${row.preview}`,
  )
  return [
    `# 쎈 공통수학 2 OCR QA`,
    ``,
    `- document_id: ${input.plan.sourceId}`,
    `- provider/model: ${input.plan.provider} / ${input.modelUsed}`,
    `- pages: ${input.plan.pageCount} (not 192)`,
    `- success/fail/cache/new: ${input.qa.success}/${input.qa.failed}/${input.qa.cached}/${input.qa.called}`,
    `- substantial text pages: ${input.qa.substantial_text}`,
    `- missing/duplicate: ${input.qa.missing_pages.join(',') || 'none'} / ${input.qa.duplicate_pages.join(',') || 'none'}`,
    `- actual usd: ${input.spentUsd.toFixed(4)} (cap ${input.plan.capUsd.toFixed(2)})`,
    `- persist problems: false`,
    ``,
    `## kinds`,
    Object.entries(input.qa.kinds)
      .map(([kind, n]) => `- ${kind}: ${n}`)
      .join('\n'),
    ``,
    `## samples`,
    ...sampleLines,
    ``,
    `## next segmentation`,
    `- recommended: ${input.next.recommended}`,
    `- reuse: ${input.next.reuse.join('; ')}`,
    `- do not reuse: ${input.next.do_not_reuse.join('; ')}`,
    ``,
  ].join('\n')
}
