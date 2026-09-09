import { STEP7_DOCUMENT_ID } from './step7Baseline'
import { MATHPIX_PROVIDER, MISTRAL_PROVIDER } from './mathOcrTypes'

export const OCR_COMPARE_STEP = '7.6-1'
export const OCR_COMPARE_MAX_PAGES = 3
export const OCR_COMPARE_KIND = 'mathpix_mistral_same_page_compare'

export const OCR_COMPARE_CRITERIA = [
  { id: 'korean_accuracy', label: '한글 인식 정확도' },
  { id: 'english_accuracy', label: '영문 인식 정확도' },
  { id: 'digit_accuracy', label: '숫자 인식 정확도' },
  { id: 'formula_accuracy', label: '수식 정확도' },
  { id: 'frac_radical_exp_accuracy', label: '분수/근호/지수 정확도' },
  { id: 'special_math_symbols', label: '특수 수학기호 정확도' },
  { id: 'problem_number', label: '문제번호 인식' },
  { id: 'mcq_choices', label: '객관식 선택지 인식' },
  { id: 'table', label: '표 인식' },
  { id: 'figure_graph_preservation', label: '도형/그래프 보존' },
  { id: 'page_layout', label: '페이지 레이아웃 보존' },
  { id: 'problem_split_feasibility', label: '문제별 분리 가능성' },
  { id: 'processing_speed', label: '처리 속도' },
  { id: 'api_stability', label: 'API 오류/안정성' },
  { id: 'hyper_db_structurability', label: 'HYPER 문제은행 DB 구조화 적합성' },
] as const

export type OcrCompareCriterionId = (typeof OCR_COMPARE_CRITERIA)[number]['id']
export type RubricVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT_RUN'
export type CompareProviderName = typeof MATHPIX_PROVIDER | typeof MISTRAL_PROVIDER

export type ComparePageSpec = {
  page_number: number
  role: string
  source_rel: string
  output_rel: string
}

/** Representative STEP 7 pages only. Never the full 192-page book. */
export const OCR_COMPARE_PAGES: readonly ComparePageSpec[] = [
  {
    page_number: 8,
    role: 'korean_exponents',
    source_rel: 'workers/ocr/data/pages_hi/p008.png',
    output_rel: 'ocr-tests/original/page-008.png',
  },
  {
    page_number: 12,
    role: 'mcq_table',
    source_rel: 'workers/ocr/data/pages_hi/p012.png',
    output_rel: 'ocr-tests/original/page-012.png',
  },
  {
    page_number: 20,
    role: 'figure_quadratic_radical_fraction',
    source_rel: 'workers/ocr/data/pages_hi/p020.png',
    output_rel: 'ocr-tests/original/page-020.png',
  },
]

export const MATHPIX_COMPARE_PROFILE = 'v3-text+latex+line_data'
export const MISTRAL_COMPARE_PROFILE = 'ocr-latest+blocks+tables+images'

export type RubricCell = {
  verdict: RubricVerdict
  evidence: string
}

export type ProviderPageCapture = {
  provider: CompareProviderName
  raw_ocr: string
  math_recognition: {
    latex: string[]
    markdown_math: string[]
  }
  layout: {
    blocks: unknown[]
    images: unknown[]
    tables_detected: boolean
    line_data: unknown[]
    dimensions: unknown
  }
  seconds: number | null
  http_status: number | null
  error: string | null
  from_cache: boolean
}

export type PageComparison = {
  page_number: number
  role: string
  original: {
    pdf_page: number
    image_rel: string
    source_rel: string
    image_sha256: string | null
    ready: boolean
  }
  mathpix: ProviderPageCapture
  mistral: ProviderPageCapture
  rubric: Record<OcrCompareCriterionId, { mathpix: RubricCell; mistral: RubricCell }>
}

export function padPage(pageNumber: number): string {
  return String(pageNumber).padStart(3, '0')
}

export function compareCacheFileName(provider: CompareProviderName, imageSha256: string, profile: string): string {
  return `${provider}-${imageSha256.slice(0, 16)}-${profile.replace(/[^a-z0-9+_-]/gi, '_')}.json`
}

export function blankProviderCapture(provider: CompareProviderName, error = 'NOT_RUN'): ProviderPageCapture {
  return {
    provider,
    raw_ocr: '',
    math_recognition: { latex: [], markdown_math: [] },
    layout: { blocks: [], images: [], tables_detected: false, line_data: [], dimensions: null },
    seconds: null,
    http_status: null,
    error,
    from_cache: false,
  }
}

export function blankRubric(): Record<OcrCompareCriterionId, { mathpix: RubricCell; mistral: RubricCell }> {
  const empty: RubricCell = { verdict: 'NOT_RUN', evidence: 'No live OCR result in this STEP' }
  return Object.fromEntries(
    OCR_COMPARE_CRITERIA.map((row) => [row.id, { mathpix: { ...empty }, mistral: { ...empty } }]),
  ) as Record<OcrCompareCriterionId, { mathpix: RubricCell; mistral: RubricCell }>
}

export function rubricFromCapture(capture: ProviderPageCapture): Record<OcrCompareCriterionId, RubricCell> {
  if (!capture.raw_ocr && (capture.error === 'NOT_RUN' || capture.error === 'INPUT_MISSING')) {
    const evidence =
      capture.error === 'INPUT_MISSING'
        ? 'Same-page image is not available locally'
        : 'Provider was not called'
    return Object.fromEntries(
      OCR_COMPARE_CRITERIA.map((row) => [row.id, { verdict: 'NOT_RUN' as const, evidence }]),
    ) as Record<OcrCompareCriterionId, RubricCell>
  }
  if (capture.error) {
    return Object.fromEntries(
      OCR_COMPARE_CRITERIA.map((row) => [
        row.id,
        { verdict: 'FAIL' as const, evidence: `API/provider error: ${capture.error}` },
      ]),
    ) as Record<OcrCompareCriterionId, RubricCell>
  }
  return Object.fromEntries(
    OCR_COMPARE_CRITERIA.map((row) => [
      row.id,
      { verdict: 'NOT_RUN' as const, evidence: 'Human PASS/PARTIAL/FAIL is filled after a live dual-provider run' },
    ]),
  ) as Record<OcrCompareCriterionId, RubricCell>
}

export function buildPageComparison(spec: ComparePageSpec, input: {
  imageSha256: string | null
  ready: boolean
  mathpix?: ProviderPageCapture
  mistral?: ProviderPageCapture
}): PageComparison {
  const mathpix = input.mathpix ?? blankProviderCapture(MATHPIX_PROVIDER, input.ready ? 'NOT_RUN' : 'INPUT_MISSING')
  const mistral = input.mistral ?? blankProviderCapture(MISTRAL_PROVIDER, input.ready ? 'NOT_RUN' : 'INPUT_MISSING')
  const mathpixRubric = rubricFromCapture(mathpix)
  const mistralRubric = rubricFromCapture(mistral)
  return {
    page_number: spec.page_number,
    role: spec.role,
    original: {
      pdf_page: spec.page_number,
      image_rel: spec.output_rel,
      source_rel: spec.source_rel,
      image_sha256: input.imageSha256,
      ready: input.ready,
    },
    mathpix,
    mistral,
    rubric: Object.fromEntries(
      OCR_COMPARE_CRITERIA.map((row) => [
        row.id,
        { mathpix: mathpixRubric[row.id], mistral: mistralRubric[row.id] },
      ]),
    ) as PageComparison['rubric'],
  }
}

export function assertComparePageLimit(pages: readonly ComparePageSpec[]): void {
  if (pages.length === 0 || pages.length > OCR_COMPARE_MAX_PAGES) {
    throw new Error(`HQB_OCR_COMPARE_LIMIT: this STEP allows 1–${OCR_COMPARE_MAX_PAGES} pages only`)
  }
  const unique = new Set(pages.map((page) => page.page_number))
  if (unique.size !== pages.length) {
    throw new Error('HQB_OCR_COMPARE_LIMIT: duplicate page numbers are not allowed')
  }
}

export function compareManifest() {
  assertComparePageLimit(OCR_COMPARE_PAGES)
  return {
    step: OCR_COMPARE_STEP,
    kind: OCR_COMPARE_KIND,
    document_id: STEP7_DOCUMENT_ID,
    source_title: '쎈수학 공통수학1',
    original_pdf_rel: 'workers/ocr/data/ssen-common-math1.pdf',
    original_pdf_policy: 'read_only_never_overwrite',
    max_pages: OCR_COMPARE_MAX_PAGES,
    pages: OCR_COMPARE_PAGES,
    providers: [MATHPIX_PROVIDER, MISTRAL_PROVIDER],
    same_input_rule: 'Both providers must receive the identical page PNG (same sha256). Never send the full 192-page PDF.',
    cache_rule: 'Reuse ocr-tests/{provider}/ cache keyed by image sha256 + request profile. Do not re-bill a cached page.',
    evaluation: OCR_COMPARE_CRITERIA,
  }
}
