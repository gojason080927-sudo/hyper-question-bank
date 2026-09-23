/**
 * Generic book ingest spec. Reuses 쎈2 OCR helpers without opening those locks.
 * SSEN / 쎈2 documents stay forbidden here.
 */
import { MEANINGFUL_TEXT_CHARS } from '../pdf/constants'
import { meaningfulCharCount } from '../pdf/classifyPdf'
import { extractMistralLatex, type MistralOcrLike } from '../ocr/normalizeMistral'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { classifyBookPageV2, countAnchorsFromText } from '../recognition/bookClassify'
import {
  MATH2_DOCUMENT_ID,
  MATH2_OCR_BATCH_USD_PER_PAGE,
  MATH2_OCR_COST_CAP_USD,
  MATH2_OCR_MODEL,
  MATH2_OCR_PROFILE,
  MATH2_OCR_PROVIDER,
  MATH2_OCR_USD_PER_PAGE,
  estimateMath2BatchUsd,
  estimateMath2OcrUsd,
  type Math2PageQa,
} from './math2Ocr'

export type BookIngestSpec = {
  slug: string
  sourceId: string
  title: string
  pageCount: number
  pdfHash: string
  cacheDir: string
  reportDir: string
  pdfPaths: string[]
}

export const GANYEOM2_SPEC: BookIngestSpec = {
  slug: 'ganyeom2',
  sourceId: 'a11b1a72-9c90-47ec-8685-0be157daa350',
  title: '개념원리 공통수학2',
  pageCount: 304,
  pdfHash: '0dcaf5fdaa809d3378373e40780b9e4d96ba5e0a2de0f43df8302bb53f5bdaea',
  cacheDir: '.ocr-temp/ganyeom2-ocr',
  reportDir: 'ocr-tests/taxonomy/ganyeom2-ocr',
  pdfPaths: ['/tmp/ganyeom2-original.pdf', '.ocr-temp/ganyeom2-original.pdf'],
}

export const RPM2_SPEC: BookIngestSpec = {
  slug: 'rpm2',
  sourceId: 'c0d5d885-f721-4bbf-8879-b4b779e1cad2',
  title: 'RPM 공통수학2',
  pageCount: 168,
  pdfHash: 'de37b0fb39e30248be92373794581034ce884407d06982a16da8c774faa41063',
  cacheDir: '.ocr-temp/rpm2-ocr',
  reportDir: 'ocr-tests/taxonomy/rpm2-ocr',
  pdfPaths: ['/tmp/rpm2-original.pdf', '.ocr-temp/rpm2-original.pdf'],
}

export const GOJAENG2_SPEC: BookIngestSpec = {
  slug: 'gojaeng2',
  sourceId: '9eee97e2-4252-4348-a842-4d60eb8590f0',
  title: '고쟁이 공통수학 2',
  pageCount: 199,
  pdfHash: '0dc512cca1689c23ebc03a8b7a52d8514bac413acbe0327c5703aba46fa68232',
  cacheDir: '.ocr-temp/gojaeng2-ocr',
  reportDir: 'ocr-tests/taxonomy/gojaeng2-ocr',
  pdfPaths: ['/tmp/gojaeng2-original.pdf', '.ocr-temp/gojaeng2-original.pdf'],
}

export const ILDEUNG2_SPEC: BookIngestSpec = {
  slug: 'ildeung2',
  sourceId: '16bcc252-1afd-461b-ab1e-882bac8e26ab',
  title: '공통수학 2 일등급 만들기',
  pageCount: 150,
  pdfHash: '5884e260078a23bcef51df32260159dbefdf994a068dad86a4a6c45524f1361d',
  cacheDir: '.ocr-temp/ildeung2-ocr',
  reportDir: 'ocr-tests/taxonomy/ildeung2-ocr',
  pdfPaths: ['/tmp/ildeung2-original.pdf', '.ocr-temp/ildeung2-original.pdf'],
}

export const LIGHTSSEN2_SPEC: BookIngestSpec = {
  slug: 'lightssen2',
  sourceId: '52a169f0-0e38-491d-9c5a-437c48e5cd89',
  title: '공통수학 2 라이트 쎈',
  pageCount: 192,
  pdfHash: '079cf596c52a82d68489e804b6e6f29d55173d6247ea7011195f7c82d1585c74',
  cacheDir: '.ocr-temp/lightssen2-ocr',
  reportDir: 'ocr-tests/taxonomy/lightssen2-ocr',
  pdfPaths: ['/tmp/lightssen2-original.pdf', '.ocr-temp/lightssen2-original.pdf'],
}

export const TYPELEVEL2_SPEC: BookIngestSpec = {
  slug: 'typelevel2',
  sourceId: 'cc6c347d-db2d-4363-b97e-68026951804c',
  title: '공통수학 2 유형만렙',
  pageCount: 196,
  pdfHash: 'e9e06cd6056de75335ecd1a42b8ecd585281732ce130d7b418ebe3965aced44f',
  cacheDir: '.ocr-temp/typelevel2-ocr',
  reportDir: 'ocr-tests/taxonomy/typelevel2-ocr',
  pdfPaths: ['/tmp/typelevel2-original.pdf', '.ocr-temp/typelevel2-original.pdf'],
}

export const BOOK_SPECS: BookIngestSpec[] = [GANYEOM2_SPEC, RPM2_SPEC, GOJAENG2_SPEC, ILDEUNG2_SPEC, LIGHTSSEN2_SPEC, TYPELEVEL2_SPEC]

export function specFromBookArg(argv: string[], fallback = GANYEOM2_SPEC): BookIngestSpec {
  const flag = argv.find((arg) => arg.startsWith('--book='))
  const slug = flag?.slice('--book='.length) ?? fallback.slug
  const spec = BOOK_SPECS.find((row) => row.slug === slug)
  if (!spec) throw new Error(`BOOK_UNKNOWN_BOOK: ${slug}`)
  return spec
}

export const BOOK_INGEST_FORBIDDEN_IDS = [SSEN_SOURCE_DOCUMENT_ID, MATH2_DOCUMENT_ID] as const

export type BookOcrPlan = {
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
  batchUsd: number
  realtimeUsd: number
  capUsd: number
  underCap: boolean
  persistProblems: false
}

export function assertBookIngestSource(spec: BookIngestSpec, sourceId: string): void {
  if ((BOOK_INGEST_FORBIDDEN_IDS as readonly string[]).includes(sourceId)) {
    throw new Error('BOOK_INGEST_FORBIDDEN: refusing SSEN / 쎈2 document')
  }
  if ((BOOK_INGEST_FORBIDDEN_IDS as readonly string[]).includes(spec.sourceId)) {
    throw new Error('BOOK_INGEST_FORBIDDEN: spec points at a locked document')
  }
  if (sourceId !== spec.sourceId) {
    throw new Error(`BOOK_INGEST_SOURCE_LOCK: expected ${spec.sourceId}, got ${sourceId}`)
  }
}

export function assertBookPageRange(spec: BookIngestSpec, pages: number[]): void {
  if (pages.length === 0) throw new Error('BOOK_OCR_EMPTY_RANGE')
  const seen = new Set<number>()
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > spec.pageCount) {
      throw new Error(`BOOK_OCR_PAGE_RANGE: ${page} is outside 1–${spec.pageCount}`)
    }
    if (seen.has(page)) throw new Error(`BOOK_OCR_DUPLICATE_PAGE: ${page}`)
    seen.add(page)
  }
}

export function planBookOcr(
  spec: BookIngestSpec,
  input: { cachedPages?: number[]; pdfHash?: string } = {},
): BookOcrPlan {
  assertBookIngestSource(spec, spec.sourceId)
  const cached = new Set((input.cachedPages ?? []).filter((page) => page >= 1 && page <= spec.pageCount))
  const missPages = Array.from({ length: spec.pageCount }, (_, i) => i + 1).filter((page) => !cached.has(page))
  const batchUsd = estimateMath2BatchUsd(missPages.length)
  const realtimeUsd = estimateMath2OcrUsd(missPages.length)
  return {
    sourceId: spec.sourceId,
    title: spec.title,
    pageCount: spec.pageCount,
    pdfHash: input.pdfHash ?? spec.pdfHash,
    model: MATH2_OCR_MODEL,
    provider: MATH2_OCR_PROVIDER,
    cachedPages: [...cached].sort((a, b) => a - b),
    missPages,
    estimatedNewCalls: missPages.length,
    estimatedUsd: batchUsd,
    batchUsd,
    realtimeUsd,
    capUsd: MATH2_OCR_COST_CAP_USD,
    underCap: batchUsd <= MATH2_OCR_COST_CAP_USD + 1e-9,
    persistProblems: false,
  }
}

export function analyzeBookPage(
  spec: BookIngestSpec,
  input: { page: number; markdown: string; raw?: MistralOcrLike | null; cached?: boolean; error?: string | null },
): Math2PageQa {
  const markdown = input.markdown ?? ''
  const meaningful = meaningfulCharCount(markdown)
  const anchors = countAnchorsFromText(markdown)
  const rawPage =
    (input.raw?.pages ?? []).find((row) => (row.index ?? input.page - 1) === input.page - 1) ?? input.raw?.pages?.[0]
  const kind = classifyBookPageV2({
    page_number: input.page,
    total_pages: spec.pageCount,
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

export function summarizeBookQa(spec: BookIngestSpec, pages: Math2PageQa[]) {
  const seen = new Set<number>()
  const duplicate_pages: number[] = []
  for (const row of pages) {
    if (seen.has(row.page)) duplicate_pages.push(row.page)
    seen.add(row.page)
  }
  const missing_pages = Array.from({ length: spec.pageCount }, (_, i) => i + 1).filter((page) => !seen.has(page))
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

export function formatBookOcrMarkdown(input: {
  spec: BookIngestSpec
  plan: BookOcrPlan
  qa: ReturnType<typeof summarizeBookQa>
  samples: Math2PageQa[]
  spentUsd: number
  modelUsed: string
}): string {
  const sampleLines = input.samples.map(
    (row) =>
      `- p${row.page} ${row.page_kind} chars=${row.meaningful_chars} latex=${row.latex_count} choices=${row.circled_choices} anchors=${row.four_digit_anchors} table=${row.table_html} img=${row.image_count} cached=${row.cached}\n  ${row.preview}`,
  )
  return [
    `# ${input.spec.title} OCR QA`,
    ``,
    `- document_id: ${input.plan.sourceId}`,
    `- provider/model: ${input.plan.provider} / ${input.modelUsed}`,
    `- pages: ${input.plan.pageCount}`,
    `- success/fail/cache/new: ${input.qa.success}/${input.qa.failed}/${input.qa.cached}/${input.qa.called}`,
    `- substantial text pages: ${input.qa.substantial_text}`,
    `- missing/duplicate: ${input.qa.missing_pages.join(',') || 'none'} / ${input.qa.duplicate_pages.join(',') || 'none'}`,
    `- actual usd: ${input.spentUsd.toFixed(4)} (cap ${input.plan.capUsd.toFixed(2)}, batch unit $${MATH2_OCR_BATCH_USD_PER_PAGE})`,
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
  ].join('\n')
}

export { MATH2_OCR_MODEL, MATH2_OCR_PROFILE, MATH2_OCR_PROVIDER, MATH2_OCR_USD_PER_PAGE }
