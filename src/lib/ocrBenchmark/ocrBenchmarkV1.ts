import { createHash } from 'node:crypto'
import { CROP_PAD } from '../recognition/problemPipeline'
import { FROZEN_CROP_GATE } from '../cropRecovery/cropRecoveryV1'
import { MATHPIX_OFFICIAL_PRICING } from '../ocr/costModel'
import { MATHPIX_COMPARE_PROFILE, MISTRAL_COMPARE_PROFILE } from '../ocr/ocrCompare'
import { CROP_GATE_VERSION } from '../cropGate/cropGateV2'
import type { NormalizedBBox } from '../pdf/bbox'

export const STEP816 = '8.16'
export const STEP816_DIR = 'ocr-tests/taxonomy/step8-16'
export const STEP816_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const SAMPLE_TARGET = 60
export const REVIEW_TARGET = 45
export const UNSAFE_TARGET = 15
export const MAX_TRANSIENT_RETRIES = 2
export const FROZEN_DRAFTS = 728
export const FROZEN_TYPE_AUTO = 38
export const FROZEN_TYPE_THRESHOLD = 0.78
export const FROZEN_CROP_REVIEW_REMAINING = 360
export const FROZEN_CROP_UNSAFE = 150
export const FROZEN_SOURCE_DIFFICULTY_ITEM = 155
export const FROZEN_SOURCE_DIFFICULTY_STAGE = 155
export const BENCHMARK_MATHPIX_PROFILE = MATHPIX_COMPARE_PROFILE
export const BENCHMARK_MISTRAL_PROFILE = MISTRAL_COMPARE_PROFILE

export const REQUIRED_STRATA = [
  'STRUCTURE_INCOMPLETE',
  'CHOICE_INCOMPLETE',
  'FIGURE_NOT_AUTO',
  'TOP_EDGE',
  'MATH_CONFLICT',
  'NEIGHBOR_CONTEXT',
  'NUMBER_IDENTITY',
  'OTHER',
] as const

export type FailureStratum = (typeof REQUIRED_STRATA)[number]
export type SampleStatus = 'CROP_REVIEW' | 'CROP_UNSAFE'
export type DimScore = 'PASS' | 'REVIEW' | 'FAIL' | 'N/A'
export type Severity = 'CRITICAL' | 'MAJOR' | 'COSMETIC' | 'NONE'
export type RecoveryLabel = 'RECOVERED_SAFE' | 'STILL_REVIEW' | 'STILL_UNSAFE' | 'FAILED_API'
export type ProviderName = 'CURRENT' | 'MISTRAL' | 'MATHPIX' | 'HYBRID'
export type LimitationClass = 'OCR_SOLVABLE' | 'SEGMENTATION_LIMITED' | 'BOTH' | 'NEITHER'
export type RouteNeed = 'CURRENT_ONLY' | 'MISTRAL_ONLY' | 'MATHPIX_ONLY' | 'HYBRID_REQUIRED' | 'PAID_OCR_NOT_HELPFUL'
export type AdoptDecision = 'ADOPT' | 'CONDITIONAL_ADOPT' | 'RESEARCH_ONLY' | 'REJECT'

export type BenchmarkSample = {
  sample_id: string
  source_document_id: string
  page_number: number
  canonical_problem_number: string
  current_status: SampleStatus
  review_unsafe_reason: string
  reject_reasons: string[]
  stratum: FailureStratum
  bbox: NormalizedBBox
  has_choices: boolean
  choice_count: number
  has_figure: boolean
  math_density: 'low' | 'medium' | 'high'
  layout_kind: string
  two_column: boolean
  publisher_difficulty: string | null
  already_draft: boolean
}

export type DimensionScores = {
  IDENTITY: DimScore
  BOUNDARY: DimScore
  STEM: DimScore
  CHOICES: DimScore
  MATH: DimScore
  FIGURE: DimScore
  STRUCTURE: DimScore
}

export type ProviderScore = {
  sample_id: string
  provider: ProviderName
  dimensions: DimensionScores
  severity: Severity
  recovery: RecoveryLabel
  false_safe: boolean
  api_failed: boolean
  notes: string[]
}

export const MISTRAL_OFFICIAL_PRICING = {
  pricing_date: '2026-09-09',
  currency: 'USD',
  usd_per_1000_pages: 4,
  usd_per_page: 0.004,
  model: 'mistral-ocr-latest',
  marked: 'ESTIMATED' as const,
  sources: [
    'https://mistral.ai/pricing/api/',
    'https://docs.mistral.ai/models/ocr-4-1',
    'https://mistral.ai/news/ocr-4/',
  ],
} as const

export function cropGateThresholdsUnchanged(): boolean {
  return (
    FROZEN_CROP_GATE.version === CROP_GATE_VERSION &&
    FROZEN_CROP_GATE.crop_pad === CROP_PAD &&
    CROP_PAD === 0.022 &&
    FROZEN_CROP_GATE.neighbor_iou_max === 0.12 &&
    FROZEN_CROP_GATE.top_cut_hard === 0.5 &&
    FROZEN_CROP_GATE.bottom_cut_hard === 0.5
  )
}

export function identityKey(page: number, number: string): string {
  return `${page}|${number}`
}

export function freezeHash(samples: Array<{ sample_id: string }>): string {
  return createHash('sha256')
    .update(samples.map((row) => row.sample_id).join('\n'))
    .digest('hex')
}

export function assignStratum(input: {
  status: SampleStatus
  reject_reasons: string[]
  recovery_class?: string
  hard_blockers?: string[]
}): FailureStratum {
  const reasons = [...input.reject_reasons, ...(input.hard_blockers ?? [])]
  const has = (token: string) => reasons.some((row) => row.includes(token))
  if (has('MATH_CONFLICT')) return 'MATH_CONFLICT'
  if (has('FIGURE_NOT_AUTO') || has('FIGURE_EDGE') || has('FIGURE_BOUNDARY') || has('FIGURE_CROP')) return 'FIGURE_NOT_AUTO'
  if (has('CHOICE_INCOMPLETE') || has('CHOICES_INCOMPLETE')) return 'CHOICE_INCOMPLETE'
  if (has('STRUCTURE_INCOMPLETE')) return 'STRUCTURE_INCOMPLETE'
  if (has('NUMBER_UNCERTAIN') || has('IDENTITY_UNSTABLE') || input.recovery_class === 'D_RECOVERABLE_NUMBER_IDENTITY') {
    return 'NUMBER_IDENTITY'
  }
  if (has('TOP_EDGE') || has('TOP_CUT')) return 'TOP_EDGE'
  if (
    has('NEIGHBOR') ||
    has('BODY_INTRUSION') ||
    input.recovery_class === 'B_RECOVERABLE_NEIGHBOR_CONTEXT'
  ) {
    return 'NEIGHBOR_CONTEXT'
  }
  return 'OTHER'
}

export function mathDensityOf(text: string, mathCount: number): 'low' | 'medium' | 'high' {
  const hits = (text.match(/\\frac|\\sqrt|\^|_|\\le|\\ge|\\begin\{|[=≠≤≥]/g) ?? []).length + mathCount
  if (hits >= 6) return 'high'
  if (hits >= 2) return 'medium'
  return 'low'
}

function circledCount(text: string): number {
  return new Set((text.match(/[①②③④⑤]/g) ?? [])).size
}

function containsCanonicalNumber(text: string, canonical: string): boolean {
  const bare = canonical.replace(/^0+/, '') || '0'
  const padded = canonical.padStart(4, '0')
  return new RegExp(`(?:^|\\n|\\s|#)${padded}\\b`).test(text) || new RegExp(`(?:^|\\n)\\s*${bare}\\b`).test(text)
}

function neighborNumberIntrusion(text: string, canonical: string, pageNumbers: string[]): boolean {
  const self = canonical.replace(/^0+/, '') || '0'
  const others = pageNumbers
    .map((row) => row.replace(/^0+/, '') || '0')
    .filter((row) => row !== self)
  const head = text.slice(0, 80)
  return others.some((num) => new RegExp(`(?:^|\\n)\\s*0*${num}\\b`).test(head) && !containsCanonicalNumber(head, canonical))
}

export function scoreDimensions(input: {
  provider: ProviderName
  status: SampleStatus
  canonical: string
  page_numbers: string[]
  text: string
  choice_count_detected: number
  expected_choices: number
  has_figure: boolean
  figure_cut: boolean
  figure_detected: boolean
  hard_blockers: string[]
  neighbor_body: boolean
  math_conflict: boolean
  math_density: 'low' | 'medium' | 'high'
  latex: string[]
  api_failed?: boolean
}): DimensionScores {
  if (input.api_failed) {
    return {
      IDENTITY: 'FAIL',
      BOUNDARY: 'FAIL',
      STEM: 'FAIL',
      CHOICES: input.expected_choices > 0 ? 'FAIL' : 'N/A',
      MATH: input.math_density === 'low' ? 'N/A' : 'FAIL',
      FIGURE: input.has_figure ? 'FAIL' : 'N/A',
      STRUCTURE: 'FAIL',
    }
  }
  const identity = containsCanonicalNumber(input.text, input.canonical)
    ? neighborNumberIntrusion(input.text, input.canonical, input.page_numbers)
      ? 'FAIL'
      : 'PASS'
    : 'REVIEW'
  const boundaryHard =
    input.hard_blockers.length > 0 || input.neighbor_body || input.status === 'CROP_UNSAFE' || (input.has_figure && input.figure_cut)
  const boundary: DimScore = boundaryHard ? 'FAIL' : 'PASS'
  const stem =
    input.text.replace(/\s+/g, '').length < 8 ? 'FAIL' : identity === 'FAIL' ? 'FAIL' : input.text.length >= 24 ? 'PASS' : 'REVIEW'
  let choices: DimScore = 'N/A'
  if (input.expected_choices > 0) {
    if (input.choice_count_detected >= input.expected_choices) choices = 'PASS'
    else if (input.choice_count_detected === 0) choices = 'FAIL'
    else choices = 'REVIEW'
  }
  let math: DimScore = 'N/A'
  if (input.math_density !== 'low' || input.latex.length > 0) {
    if (input.math_conflict) math = 'FAIL'
    else if (input.latex.length > 0 || /[=√\\^]/.test(input.text)) math = 'PASS'
    else math = 'REVIEW'
  }
  let figure: DimScore = 'N/A'
  if (input.has_figure) {
    figure = input.figure_cut ? 'FAIL' : 'REVIEW'
  }
  const structure =
    stem === 'FAIL' || choices === 'FAIL' || identity === 'FAIL' ? 'FAIL' : stem === 'PASS' && choices !== 'REVIEW' ? 'PASS' : 'REVIEW'
  return { IDENTITY: identity, BOUNDARY: boundary, STEM: stem, CHOICES: choices, MATH: math, FIGURE: figure, STRUCTURE: structure }
}

export function severityOf(dims: DimensionScores, hasFigure: boolean, expectedChoices: number): Severity {
  if (dims.IDENTITY === 'FAIL' || dims.BOUNDARY === 'FAIL' || dims.STEM === 'FAIL') return 'CRITICAL'
  if (expectedChoices > 0 && dims.CHOICES === 'FAIL') return 'CRITICAL'
  if (hasFigure && dims.FIGURE === 'FAIL') return 'CRITICAL'
  if (dims.MATH === 'FAIL') return 'CRITICAL'
  if (Object.values(dims).some((row) => row === 'REVIEW')) return 'MAJOR'
  return 'NONE'
}

export function recoveryOf(input: {
  status: SampleStatus
  dims: DimensionScores
  severity: Severity
  api_failed: boolean
}): RecoveryLabel {
  if (input.api_failed) return 'FAILED_API'
  const dims = input.dims
  const recovered =
    dims.IDENTITY === 'PASS' &&
    dims.BOUNDARY === 'PASS' &&
    dims.STEM === 'PASS' &&
    (dims.CHOICES === 'PASS' || dims.CHOICES === 'N/A') &&
    (dims.MATH === 'PASS' || dims.MATH === 'N/A') &&
    (dims.FIGURE === 'PASS' || dims.FIGURE === 'N/A') &&
    dims.STRUCTURE === 'PASS' &&
    input.severity !== 'CRITICAL'
  if (recovered) return 'RECOVERED_SAFE'
  return input.status === 'CROP_UNSAFE' ? 'STILL_UNSAFE' : 'STILL_REVIEW'
}

export function falseSafe(recovery: RecoveryLabel, severity: Severity, dims: DimensionScores): boolean {
  if (recovery !== 'RECOVERED_SAFE') return false
  return severity === 'CRITICAL' || dims.BOUNDARY === 'FAIL' || dims.IDENTITY === 'FAIL' || dims.FIGURE === 'FAIL'
}

export function scoreProvider(input: {
  sample_id: string
  provider: ProviderName
  status: SampleStatus
  canonical: string
  page_numbers: string[]
  text: string
  expected_choices: number
  has_figure: boolean
  figure_cut: boolean
  figure_detected: boolean
  hard_blockers: string[]
  neighbor_body: boolean
  math_conflict: boolean
  math_density: 'low' | 'medium' | 'high'
  latex: string[]
  api_failed?: boolean
}): ProviderScore {
  const choice_count_detected = circledCount(input.text)
  const dimensions = scoreDimensions({
    ...input,
    choice_count_detected,
  })
  const severity = severityOf(dimensions, input.has_figure, input.expected_choices)
  const recovery = recoveryOf({
    status: input.status,
    dims: dimensions,
    severity,
    api_failed: Boolean(input.api_failed),
  })
  return {
    sample_id: input.sample_id,
    provider: input.provider,
    dimensions,
    severity,
    recovery,
    false_safe: falseSafe(recovery, severity, dimensions),
    api_failed: Boolean(input.api_failed),
    notes: [],
  }
}

export function latexSignatures(latex: string[]): {
  exponents: string[]
  subscripts: string[]
  fractions: number
  roots: number
  inequalities: string[]
  matrices: number
} {
  const joined = latex.join('\n')
  const exponents = [...joined.matchAll(/([A-Za-z0-9])\s*(?:\^|\{?\^\{)(-?\d+)/g)].map((row) => `${row[1]}^${row[2]}`)
  const subscripts = [...joined.matchAll(/([A-Za-z0-9])_\{?([A-Za-z0-9]+)/g)].map((row) => `${row[1]}_${row[2]}`)
  return {
    exponents: [...new Set(exponents)],
    subscripts: [...new Set(subscripts)],
    fractions: (joined.match(/\\frac/g) ?? []).length,
    roots: (joined.match(/\\sqrt/g) ?? []).length,
    inequalities: [...new Set(joined.match(/\\le|\\ge|\\neq|[<>≤≥≠]/g) ?? [])],
    matrices: (joined.match(/\\begin\{(?:matrix|pmatrix|bmatrix)/g) ?? []).length,
  }
}

export function mathConflictBetween(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  const left = latexSignatures(a)
  const right = latexSignatures(b)
  const expL = new Set(left.exponents)
  const expR = new Set(right.exponents)
  const sharedBases = [...expL].some((token) => {
    const base = token.split('^')[0]
    return [...expR].some((other) => other.split('^')[0] === base && other !== token)
  })
  const ineqConflict =
    (left.inequalities.includes('<') && right.inequalities.includes('>')) ||
    (left.inequalities.includes('\\le') && right.inequalities.includes('\\ge'))
  return sharedBases || ineqConflict
}

export function limitationClass(input: {
  current: ProviderScore
  bestPaid: ProviderScore
}): LimitationClass {
  const ocrImproved =
    (input.bestPaid.dimensions.STEM === 'PASS' && input.current.dimensions.STEM !== 'PASS') ||
    (input.bestPaid.dimensions.CHOICES === 'PASS' && input.current.dimensions.CHOICES !== 'PASS' && input.current.dimensions.CHOICES !== 'N/A') ||
    (input.bestPaid.dimensions.MATH === 'PASS' && input.current.dimensions.MATH !== 'PASS' && input.current.dimensions.MATH !== 'N/A')
  const segLimited =
    input.bestPaid.dimensions.BOUNDARY === 'FAIL' ||
    input.bestPaid.dimensions.FIGURE === 'FAIL' ||
    input.bestPaid.recovery === 'STILL_UNSAFE'
  if (ocrImproved && segLimited) return 'BOTH'
  if (ocrImproved) return 'OCR_SOLVABLE'
  if (segLimited) return 'SEGMENTATION_LIMITED'
  return 'NEITHER'
}

export function routeNeed(input: {
  current: ProviderScore
  mistral: ProviderScore
  mathpix: ProviderScore
  hybrid: ProviderScore
}): RouteNeed {
  const recovered = (row: ProviderScore) => row.recovery === 'RECOVERED_SAFE' && !row.false_safe
  if (recovered(input.current)) return 'CURRENT_ONLY'
  if (recovered(input.hybrid) && !recovered(input.mistral) && !recovered(input.mathpix)) return 'HYBRID_REQUIRED'
  if (recovered(input.mistral) && !recovered(input.mathpix)) return 'MISTRAL_ONLY'
  if (recovered(input.mathpix) && !recovered(input.mistral)) return 'MATHPIX_ONLY'
  if (recovered(input.hybrid) || (recovered(input.mistral) && recovered(input.mathpix))) return 'HYBRID_REQUIRED'
  const mistralHelps =
    input.mistral.dimensions.CHOICES === 'PASS' && input.current.dimensions.CHOICES !== 'PASS' && input.current.dimensions.CHOICES !== 'N/A'
  const mathpixHelps =
    input.mathpix.dimensions.MATH === 'PASS' && input.current.dimensions.MATH !== 'PASS' && input.current.dimensions.MATH !== 'N/A'
  if (mistralHelps && mathpixHelps) return 'HYBRID_REQUIRED'
  if (mistralHelps) return 'MISTRAL_ONLY'
  if (mathpixHelps) return 'MATHPIX_ONLY'
  return 'PAID_OCR_NOT_HELPFUL'
}

export function pickStratifiedSample(input: {
  review: BenchmarkSample[]
  unsafe: BenchmarkSample[]
  reviewTarget?: number
  unsafeTarget?: number
  maxTotal?: number
}): BenchmarkSample[] {
  const reviewTarget = input.reviewTarget ?? REVIEW_TARGET
  const unsafeTarget = input.unsafeTarget ?? UNSAFE_TARGET
  const pick = (pool: BenchmarkSample[], target: number) => {
    const sorted = [...pool].sort((a, b) => a.sample_id.localeCompare(b.sample_id))
    const buckets = new Map<string, BenchmarkSample[]>()
    for (const row of sorted) {
      const list = buckets.get(row.stratum) ?? []
      list.push(row)
      buckets.set(row.stratum, list)
    }
    const out: BenchmarkSample[] = []
    const used = new Set<string>()
    for (const stratum of REQUIRED_STRATA) {
      const next = (buckets.get(stratum) ?? []).find((row) => !used.has(row.sample_id))
      if (!next || out.length >= target) continue
      out.push(next)
      used.add(next.sample_id)
    }
    const copies = [...buckets.values()].map((list) => list.filter((row) => !used.has(row.sample_id)))
    let guard = 0
    while (out.length < target && guard < 20_000) {
      guard += 1
      let added = false
      for (const list of copies) {
        const next = list.shift()
        if (!next) continue
        out.push(next)
        added = true
        if (out.length >= target) break
      }
      if (!added) break
    }
    return out.slice(0, target)
  }
  const selected = [...pick(input.review, reviewTarget), ...pick(input.unsafe, unsafeTarget)]
  const cap = input.maxTotal ?? SAMPLE_TARGET
  if (selected.length > cap) return selected.slice(0, cap)
  return selected
}

export function moneyUsd(usd: number, rate = MATHPIX_OFFICIAL_PRICING.krw_per_usd_assumption) {
  return {
    usd: Number(usd.toFixed(4)),
    krw_approx: Math.round(usd * rate),
    krw_per_usd: rate,
    krw_exchange_marked: 'variable' as const,
    marked: 'ESTIMATED' as const,
  }
}

export function estimateMistralCost(pagesProcessed: number) {
  return moneyUsd(pagesProcessed * MISTRAL_OFFICIAL_PRICING.usd_per_page)
}

export function estimateMathpixCost(images: number, conservative = false) {
  const unit = conservative ? MATHPIX_OFFICIAL_PRICING.page_usd_0_to_1m : MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m
  return moneyUsd(images * unit)
}

export function adoptDecision(input: {
  recovered: number
  sample: number
  false_safe: number
  unique_gain: number
}): AdoptDecision {
  if (input.false_safe > 0) return 'REJECT'
  if (input.recovered === 0 && input.unique_gain === 0) return 'RESEARCH_ONLY'
  if (input.recovered / Math.max(1, input.sample) >= 0.25 && input.false_safe === 0) return 'CONDITIONAL_ADOPT'
  if (input.unique_gain > 0 && input.false_safe === 0) return 'CONDITIONAL_ADOPT'
  return 'RESEARCH_ONLY'
}

export function redactBenchmarkText(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets.filter(Boolean)) {
    out = out.split(secret).join('[REDACTED]')
  }
  return out
}
