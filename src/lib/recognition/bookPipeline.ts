import { canonicalizeProblemNumber } from './draftUpsert'
import type { BookPageKindV2, PageClassifyEvidence } from './bookClassify'
import type { LayoutKind, SegmentStatus } from './layoutSegment'
import type { NormalizedBBox } from '../pdf/bbox'
import { detectMathConflicts, type MathConflict } from './problemPipeline'

export const PIPELINE_STEP = '8.7'
export const ORIGINAL_PDF_REL = 'workers/ocr/data/ssen-common-math1.pdf'
export const EXPECTED_PAGE_COUNT = 192
export const PAGE_OCR_BATCH = 20
export const DB_INSERT_BATCH = 25
export const MAX_TRANSIENT_RETRIES = 2
export const STRUCTURE_RECOVERY_SAMPLE = 5
export const STRUCTURE_RECOVERY_MIN_RATE = 0.6
export const QA_SAMPLE_TARGET = 25
export const CACHED_OCR_PAGES = [8, 12, 20, 28, 36, 44, 60, 84, 96, 108, 120, 156, 180] as const
export const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'

export const PIPELINE_REVIEW_REASONS = [
  'CROP_UNSAFE',
  'BODY_INTRUSION',
  'NUMBER_UNCERTAIN',
  'STRUCTURE_INCOMPLETE',
  'CHOICES_INCOMPLETE',
  'FIGURE_CROP_RISK',
  'PAGE_KIND_UNCERTAIN',
  'THEORY_OR_SIDEBAR',
  'MATH_CONFLICT',
  'IDENTITY_UNSTABLE',
  'OCR_FAILED',
  'OTHER',
] as const

export type PipelineReviewReason = (typeof PIPELINE_REVIEW_REASONS)[number]
export type NumberFlowStatusV2 = 'NORMAL' | 'EXPECTED_BOOK_STRUCTURE' | 'SUSPICIOUS' | 'REVIEW'
export type PipelineQuality = 'DRAFT_READY' | 'PIPELINE_REVIEW' | 'OCR_FAILED' | 'BLOCKED_NON_PROBLEM'
export type PipelineRoute = 'MISTRAL_ONLY' | 'MISTRAL_PLUS_MATHPIX' | 'PIPELINE_REVIEW'
export type PipelineStage = 'A' | 'B' | 'C' | 'D' | 'E'

export type StagePageOcrRecord = {
  page: number
  cache_hit: boolean
  api_called: boolean
  http_status: number | null
  attempts: number
  ocr_success: boolean
  text_length: number
  block_count: number
  image_count: number
  warnings: string[]
  page_kind?: BookPageKindV2
  classification_confidence?: number
  evidence?: PageClassifyEvidence
}

export type PipelineCandidate = {
  page: number
  page_kind: BookPageKindV2
  problem_number: string
  canonical_problem_number: string | null
  bbox: NormalizedBBox
  layout_kind: LayoutKind
  segmentation_status: SegmentStatus
  confidence: number
  warnings: string[]
  review_reasons: PipelineReviewReason[]
  quality: PipelineQuality
  route: PipelineRoute
  figure_hint: boolean
  graph_hint: boolean
  table_hint: boolean
  figure_crop_risk: boolean
  number_flow: NumberFlowStatusV2
  stem_preview: string
  stem_text: string
  stem_markdown: string
  choice_count: number
  math: string[]
  choices: Array<{ index: number; text: string; math: string[] }>
  recovery_attempted: boolean
  recovery_reason: string | null
  mathpix_planned: boolean
  mathpix_called: boolean
  mathpix_cache_hit: boolean
  math_conflict: boolean
  crop: {
    width: number | null
    height: number | null
    blank_ratio: number | null
    bbox_valid: boolean
  }
  crop_gate_v2?: 'CROP_SAFE' | 'CROP_REVIEW' | 'CROP_UNSAFE'
}

export type StructureSnapshot = {
  page: number
  problem_number: string
  stem_length: number
  choice_count: number
  expected_choices: boolean
  incomplete: boolean
}

export type RecoveryPilotResult = {
  page: number
  problem_number: string
  reason: string
  before: StructureSnapshot
  after: StructureSnapshot
  recovered: boolean
  api_called: boolean
  cache_hit: boolean
}

export type PipelineReviewPayload = {
  document: string
  page: number
  problem_number: string
  bbox: NormalizedBBox
  original_crop_reference: string | null
  reason_codes: PipelineReviewReason[]
  ocr_raw_reference: string | null
  normalized_candidate: {
    stem_preview: string
    choice_count: number
    math: string[]
  }
  math_conflict: boolean
  figure_warning: boolean
}

export function mapPipelineGateReasons(reasons: string[], extra: PipelineReviewReason[] = []): PipelineReviewReason[] {
  const out = new Set<PipelineReviewReason>(extra)
  for (const reason of reasons) {
    if (reason === 'crop_gate' || reason === 'crop_not_safe' || reason.includes('body_clipped')) out.add('CROP_UNSAFE')
    else if (reason === 'body_intrusion' || reason === 'adjacent_body_intrusion') out.add('BODY_INTRUSION')
    else if (reason.includes('problem_number') || reason === 'segmentation_gate') out.add('NUMBER_UNCERTAIN')
    else if (reason === 'structure_gate' || reason === 'structure_incomplete') out.add('STRUCTURE_INCOMPLETE')
    else if (reason === 'missing_choice') out.add('CHOICES_INCOMPLETE')
    else if (reason.includes('figure') || reason === 'figure_cut_by_bbox') out.add('FIGURE_CROP_RISK')
    else if (reason === 'math_gate' || reason === 'math_conflict') out.add('MATH_CONFLICT')
    else if (reason === 'persistence_gate') out.add('IDENTITY_UNSTABLE')
    else if (reason === 'ocr_failed') out.add('OCR_FAILED')
    else if (reason === 'page_kind_uncertain') out.add('PAGE_KIND_UNCERTAIN')
    else out.add('OTHER')
  }
  return [...out]
}

export function emptyPipelineReasonCounts(): Record<PipelineReviewReason, number> {
  return Object.fromEntries(PIPELINE_REVIEW_REASONS.map((reason) => [reason, 0])) as Record<
    PipelineReviewReason,
    number
  >
}

export function inspectNumberFlowV2(candidates: Array<{ page: number; problem_number: string }>): {
  rows: Array<{ page: number; problem_number: string; status: NumberFlowStatusV2; note: string }>
  duplicate: number
  reverse: number
  suspicious_jump: number
  unstable: number
  expected_book_structure: number
} {
  const rows: Array<{ page: number; problem_number: string; status: NumberFlowStatusV2; note: string }> = []
  const seen = new Map<string, number[]>()
  let duplicate = 0
  let reverse = 0
  let suspicious_jump = 0
  let unstable = 0
  let expected_book_structure = 0
  const ordered = [...candidates].sort((a, b) => a.page - b.page || a.problem_number.localeCompare(b.problem_number))
  for (const row of ordered) {
    const canonical = canonicalizeProblemNumber(row.problem_number)
    if (!canonical) {
      unstable += 1
      rows.push({ ...row, status: 'REVIEW', note: 'IDENTITY_UNSTABLE' })
      continue
    }
    const pages = seen.get(canonical) ?? []
    pages.push(row.page)
    seen.set(canonical, pages)
    if (pages.length > 1) {
      duplicate += 1
      rows.push({ ...row, status: 'REVIEW', note: `duplicate_on_pages:${pages.join(',')}` })
    } else {
      rows.push({ ...row, status: 'NORMAL', note: 'unique' })
    }
  }
  const numbered = ordered
    .map((row) => ({ ...row, n: Number(canonicalizeProblemNumber(row.problem_number)) }))
    .filter((row) => Number.isFinite(row.n))
  for (let i = 1; i < numbered.length; i += 1) {
    const prev = numbered[i - 1]
    const cur = numbered[i]
    const target = rows.find((row) => row.page === cur.page && row.problem_number === cur.problem_number)
    if (!target || target.status === 'REVIEW') continue
    if (cur.page >= prev.page && cur.n < prev.n) {
      reverse += 1
      const chapterReset = cur.n <= 30 && prev.n >= 40
      if (chapterReset && cur.page !== prev.page) {
        expected_book_structure += 1
        target.status = 'EXPECTED_BOOK_STRUCTURE'
        target.note = `chapter_reset:${prev.problem_number}->${cur.problem_number}`
      } else {
        target.status = 'REVIEW'
        target.note = `reverse:${prev.problem_number}->${cur.problem_number}`
      }
      continue
    }
    const gap = cur.n - prev.n
    if (gap > 1 && cur.page === prev.page) {
      suspicious_jump += 1
      target.status = 'SUSPICIOUS'
      target.note = `same_page_gap:${gap}`
    } else if (gap > 20 && cur.page - prev.page >= 1) {
      expected_book_structure += 1
      target.status = 'EXPECTED_BOOK_STRUCTURE'
      target.note = `unit_jump:${gap}`
    }
  }
  return { rows, duplicate, reverse, suspicious_jump, unstable, expected_book_structure }
}

export function isStructureIncomplete(input: {
  stem: string
  choice_count: number
  expected_choices: boolean
}): boolean {
  if (input.stem.trim().length < 8) return true
  if (input.expected_choices && input.choice_count < 5) return true
  return false
}

export function pickRecoverySample<T extends { page: number; problem_number: string }>(items: T[], max = STRUCTURE_RECOVERY_SAMPLE): T[] {
  if (items.length <= max) return [...items]
  const picked: T[] = []
  const used = new Set<string>()
  const take = (hit: T | undefined) => {
    if (!hit || used.has(`${hit.page}:${hit.problem_number}`) || picked.length >= max) return
    used.add(`${hit.page}:${hit.problem_number}`)
    picked.push(hit)
  }
  take(items[0])
  take(items[Math.floor(items.length / 2)])
  take(items[items.length - 1])
  take(items.find((row) => row.page !== items[0]?.page))
  for (const row of items) take(row)
  return picked.slice(0, max)
}

export function recoveryHelped(before: StructureSnapshot, after: StructureSnapshot): boolean {
  if (after.incomplete) return false
  if (before.stem_length < 8 && after.stem_length >= 8) return true
  if (before.expected_choices && before.choice_count < 5 && after.choice_count >= 5) return true
  return after.stem_length >= Math.max(12, Math.ceil(before.stem_length * 1.2)) && !after.incomplete
}

export function recoveryPolicy(results: RecoveryPilotResult[]): {
  apply_rest: boolean
  recovered: number
  unrecovered: number
  rate: number
  reason: string
} {
  const recovered = results.filter((row) => row.recovered).length
  const unrecovered = results.length - recovered
  const rate = results.length ? recovered / results.length : 0
  if (!results.length) {
    return { apply_rest: false, recovered, unrecovered, rate, reason: 'no_sample' }
  }
  if (rate >= STRUCTURE_RECOVERY_MIN_RATE) {
    return { apply_rest: true, recovered, unrecovered, rate, reason: 'recovery_rate_ok' }
  }
  return { apply_rest: false, recovered, unrecovered, rate, reason: 'recovery_uncertain_keep_review' }
}

export function criticalMathConflicts(mistralLatex: string[], mathpixLatex: string[]): MathConflict[] {
  return detectMathConflicts(mistralLatex, mathpixLatex)
}

export function isFatalOcrHttp(status: number | null): boolean {
  if (status == null) return false
  return status >= 400 && status < 500 && status !== 429
}

export function isRetryableOcrHttp(status: number | null): boolean {
  if (status == null) return true
  return status === 429 || status >= 500
}

export function stageAShouldStop(input: {
  fatal?: string | null
  attempted: number
  failed: number
  consecutive_same_error: number
  unknown_after_ocr: number
  ocr_failed: number
  problem: number
  answer: number
  explanation: number
  median_text_length: number
  answer_leaked_into_problem: number
}): { stop: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (input.fatal) reasons.push(input.fatal)
  if (input.attempted >= 8 && input.failed / input.attempted >= 0.15) reasons.push('ocr_fail_rate_high')
  if (input.consecutive_same_error >= 3) reasons.push('repeated_same_error')
  if (input.unknown_after_ocr >= 40) reasons.push('classifier_mass_unknown')
  if (input.ocr_failed >= 20) reasons.push('ocr_failed_mass')
  if (input.attempted >= 20 && input.median_text_length < 40) reasons.push('ocr_text_systematic_corruption')
  if (input.answer_leaked_into_problem >= 5) reasons.push('answer_explanation_problem_confusion')
  if (input.problem >= 170 && input.answer + input.explanation === 0) reasons.push('answer_section_missing_suspicious')
  return { stop: reasons.length > 0, reasons }
}

export function drySummaryAbnormal(input: {
  candidates: number
  draft_ready: number
  pipeline_review: number
  blocked_non_problem: number
  answer_pages_in_candidates: number
  mathpix_planned: number
  hybrid: number
}): { stop: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (input.answer_pages_in_candidates > 0) reasons.push('answer_page_in_problem_candidates')
  if (input.candidates === 0) reasons.push('no_problem_candidates')
  if (input.draft_ready === 0 && input.candidates >= 20) reasons.push('zero_draft_ready')
  if (input.mathpix_planned > input.hybrid) reasons.push('mathpix_planned_exceeds_hybrid')
  return { stop: reasons.length > 0, reasons }
}

export function buildReviewPayload(input: {
  document: string
  candidate: Pick<
    PipelineCandidate,
    | 'page'
    | 'problem_number'
    | 'bbox'
    | 'review_reasons'
    | 'stem_preview'
    | 'choice_count'
    | 'math'
    | 'math_conflict'
    | 'figure_crop_risk'
  >
  crop_rel: string | null
  ocr_raw_reference: string | null
}): PipelineReviewPayload {
  return {
    document: input.document,
    page: input.candidate.page,
    problem_number: input.candidate.problem_number,
    bbox: input.candidate.bbox,
    original_crop_reference: input.crop_rel,
    reason_codes: input.candidate.review_reasons,
    ocr_raw_reference: input.ocr_raw_reference,
    normalized_candidate: {
      stem_preview: input.candidate.stem_preview,
      choice_count: input.candidate.choice_count,
      math: input.candidate.math,
    },
    math_conflict: input.candidate.math_conflict,
    figure_warning: input.candidate.figure_crop_risk,
  }
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function parsePipelineArgs(argv: string[]): {
  run: boolean
  resume: boolean
  fromPage: number
  batch: number | null
  maxBatches: number | null
  stage: 'all' | PipelineStage
  allowPaid: boolean
  confirmCost: boolean
  cacheOnly: boolean
  dryRun: boolean
  persist: boolean
} {
  const fromRaw = argv.find((row) => row.startsWith('--from-page='))?.slice('--from-page='.length)
  const batchRaw = argv.find((row) => row.startsWith('--batch='))?.slice('--batch='.length)
  const maxRaw = argv.find((row) => row.startsWith('--max-batches='))?.slice('--max-batches='.length)
  const stageRaw = argv.find((row) => row.startsWith('--stage='))?.slice('--stage='.length)
  const stage = stageRaw === 'A' || stageRaw === 'B' || stageRaw === 'C' || stageRaw === 'D' || stageRaw === 'E' ? stageRaw : 'all'
  const cacheOnly = argv.includes('--cache-only')
  const dryRun = argv.includes('--dry-run') || cacheOnly
  return {
    run: argv.includes('--run'),
    resume: argv.includes('--resume'),
    fromPage: Math.max(1, Number(fromRaw ?? '1') || 1),
    batch: batchRaw == null ? null : Number(batchRaw),
    maxBatches: maxRaw == null ? null : Number(maxRaw),
    stage,
    allowPaid: argv.includes('--allow-paid-api') && !cacheOnly,
    confirmCost: argv.includes('--i-understand-this-costs-money') && !cacheOnly,
    cacheOnly,
    dryRun,
    persist: argv.includes('--persist') && !cacheOnly && !dryRun,
  }
}

export function pickQaSample<T extends PipelineCandidate>(candidates: T[], target = QA_SAMPLE_TARGET): T[] {
  const groups: Array<(row: T) => boolean> = [
    (row) => row.page <= 36,
    (row) => row.page > 36 && row.page < 120,
    (row) => row.page >= 120,
    (row) => row.route === 'MISTRAL_ONLY',
    (row) => row.route === 'MISTRAL_PLUS_MATHPIX',
    (row) => row.choice_count >= 5,
    (row) => row.choice_count === 0,
    (row) => row.figure_hint,
    (row) => row.graph_hint,
    (row) => row.stem_text.length >= 80,
    (row) => row.math.length >= 3,
  ]
  const picked: T[] = []
  const used = new Set<string>()
  const key = (row: T) => `${row.page}:${row.problem_number}`
  for (const match of groups) {
    const hit = candidates.find((row) => match(row) && !used.has(key(row)))
    if (hit) {
      used.add(key(hit))
      picked.push(hit)
    }
  }
  for (const row of candidates) {
    if (picked.length >= target) break
    if (!used.has(key(row))) {
      used.add(key(row))
      picked.push(row)
    }
  }
  return picked.slice(0, Math.min(30, Math.max(20, target)))
}

export function qaVerdict(input: { stem: string; page_kind: BookPageKindV2; problem_number: string }): {
  level: 'CRITICAL' | 'COSMETIC' | 'OK'
  note: string
} {
  if (input.page_kind === 'ANSWER' || input.page_kind === 'EXPLANATION') {
    return { level: 'CRITICAL', note: 'non_problem_page_in_draft' }
  }
  if (!input.stem.trim()) return { level: 'CRITICAL', note: 'empty_stem' }
  if (/정답과\s*해설/.test(input.stem) && input.stem.trim().length < 40) {
    return { level: 'CRITICAL', note: 'answer_key_stem' }
  }
  if (input.stem.trim().length < 8) return { level: 'COSMETIC', note: 'short_stem' }
  return { level: 'OK', note: 'ok' }
}

export const PRE_MATHPIX_BLOCK_REASONS = [
  'CROP_UNSAFE',
  'BODY_INTRUSION',
  'NUMBER_UNCERTAIN',
  'STRUCTURE_INCOMPLETE',
  'IDENTITY_UNSTABLE',
  'THEORY_OR_SIDEBAR',
] as const

export const MATHPIX_OVERCALL_BUCKETS = [
  'STILL_ELIGIBLE',
  'CROP_UNSAFE_BLOCKED',
  'BODY_INTRUSION_BLOCKED',
  'NUMBER_UNCERTAIN_BLOCKED',
  'STRUCTURE_INCOMPLETE_BLOCKED',
  'IDENTITY_UNSTABLE_BLOCKED',
  'THEORY_OR_SIDEBAR_BLOCKED',
  'ROUTER_NOT_HYBRID',
  'OTHER_BLOCKED',
] as const

export type MathpixOvercallBucket = (typeof MATHPIX_OVERCALL_BUCKETS)[number]

export type MathpixEligibilityInput = Pick<
  PipelineCandidate,
  | 'page_kind'
  | 'layout_kind'
  | 'canonical_problem_number'
  | 'segmentation_status'
  | 'quality'
  | 'route'
  | 'review_reasons'
  | 'crop'
> & {
  crop_gate_v2?: PipelineCandidate['crop_gate_v2']
}

export type MathpixEligibility = {
  eligible: boolean
  reason: string
  blockedBy: string[]
  crop_gate: boolean
  structure_gate: boolean
}

const BLANK_RATIO_UNSAFE = 0.92

export function cropGatePass(crop: PipelineCandidate['crop']): boolean {
  if (!crop.bbox_valid) return false
  if (crop.blank_ratio != null && crop.blank_ratio >= BLANK_RATIO_UNSAFE) return false
  return true
}

/** v2 CROP_SAFE is the only auto path. Absent v2 keeps the 8.7 blank-ratio gate for regression. */
export function cropGateAllowsMathpix(candidate: MathpixEligibilityInput): boolean {
  if (candidate.crop_gate_v2) return candidate.crop_gate_v2 === 'CROP_SAFE'
  return cropGatePass(candidate.crop)
}

/**
 * Mathpix may run only after page/segment/identity/crop/structure gates and HYBRID routing.
 * MATH_CONFLICT is a post-Mathpix gate and does not by itself prove a pre-call was wrong.
 */
export function shouldCallMathpix(candidate: MathpixEligibilityInput, options: { ignoreMathConflict?: boolean } = {}): MathpixEligibility {
  const blockedBy: string[] = []
  const reasons = options.ignoreMathConflict
    ? candidate.review_reasons.filter((reason) => reason !== 'MATH_CONFLICT')
    : candidate.review_reasons
  const cropPass = cropGateAllowsMathpix(candidate)
  const crop_gate = cropPass && !reasons.includes('CROP_UNSAFE') && !reasons.includes('BODY_INTRUSION')
  const structure_gate = !reasons.includes('STRUCTURE_INCOMPLETE') && !reasons.includes('CHOICES_INCOMPLETE')
  const quality =
    options.ignoreMathConflict &&
    candidate.quality === 'PIPELINE_REVIEW' &&
    candidate.review_reasons.includes('MATH_CONFLICT') &&
    reasons.every((reason) => !(PRE_MATHPIX_BLOCK_REASONS as readonly string[]).includes(reason))
      ? 'DRAFT_READY'
      : candidate.quality
  const route =
    options.ignoreMathConflict && quality === 'DRAFT_READY' && candidate.review_reasons.includes('MATH_CONFLICT')
      ? 'MISTRAL_PLUS_MATHPIX'
      : candidate.route

  if (candidate.page_kind !== 'PROBLEM' && candidate.page_kind !== 'MIXED') blockedBy.push('PAGE_KIND')
  if (candidate.layout_kind !== 'PROBLEM' || reasons.includes('THEORY_OR_SIDEBAR')) blockedBy.push('THEORY_OR_SIDEBAR')
  if (!candidate.canonical_problem_number || reasons.includes('IDENTITY_UNSTABLE')) blockedBy.push('IDENTITY_UNSTABLE')
  if (candidate.segmentation_status !== 'AUTO_OK' || reasons.includes('NUMBER_UNCERTAIN')) blockedBy.push('NUMBER_UNCERTAIN')
  if (!cropPass || reasons.includes('CROP_UNSAFE')) blockedBy.push('CROP_UNSAFE')
  if (reasons.includes('BODY_INTRUSION')) blockedBy.push('BODY_INTRUSION')
  if (reasons.includes('STRUCTURE_INCOMPLETE') || reasons.includes('CHOICES_INCOMPLETE')) blockedBy.push('STRUCTURE_INCOMPLETE')
  if (quality === 'OCR_FAILED' || quality === 'BLOCKED_NON_PROBLEM') blockedBy.push(quality)
  if (quality === 'PIPELINE_REVIEW') blockedBy.push('PIPELINE_REVIEW')
  if (route !== 'MISTRAL_PLUS_MATHPIX') blockedBy.push('ROUTER_NOT_HYBRID')

  const unique = [...new Set(blockedBy)]
  if (unique.length) {
    return {
      eligible: false,
      reason: unique[0],
      blockedBy: unique,
      crop_gate,
      structure_gate,
    }
  }
  return {
    eligible: true,
    reason: 'hybrid_after_pre_mathpix_gates',
    blockedBy: [],
    crop_gate: true,
    structure_gate: true,
  }
}

export function mathpixOvercallBucket(candidate: MathpixEligibilityInput): MathpixOvercallBucket {
  const eligibility = shouldCallMathpix(candidate, { ignoreMathConflict: true })
  if (eligibility.eligible) return 'STILL_ELIGIBLE'
  const blocked = eligibility.blockedBy
  if (blocked.includes('CROP_UNSAFE')) return 'CROP_UNSAFE_BLOCKED'
  if (blocked.includes('BODY_INTRUSION')) return 'BODY_INTRUSION_BLOCKED'
  if (blocked.includes('NUMBER_UNCERTAIN')) return 'NUMBER_UNCERTAIN_BLOCKED'
  if (blocked.includes('STRUCTURE_INCOMPLETE')) return 'STRUCTURE_INCOMPLETE_BLOCKED'
  if (blocked.includes('IDENTITY_UNSTABLE')) return 'IDENTITY_UNSTABLE_BLOCKED'
  if (blocked.includes('THEORY_OR_SIDEBAR')) return 'THEORY_OR_SIDEBAR_BLOCKED'
  if (blocked.includes('ROUTER_NOT_HYBRID') || blocked.includes('PIPELINE_REVIEW')) return 'ROUTER_NOT_HYBRID'
  return 'OTHER_BLOCKED'
}

export function emptyOvercallCounts(): Record<MathpixOvercallBucket, number> {
  return Object.fromEntries(MATHPIX_OVERCALL_BUCKETS.map((bucket) => [bucket, 0])) as Record<MathpixOvercallBucket, number>
}

export function countEligibleMathpixInvocations(candidates: MathpixEligibilityInput[]): number {
  return candidates.filter((row) => shouldCallMathpix(row).eligible).length
}

export type MathpixCallPlan = {
  problem_number: string
  page: number
  pre_mathpix_status: PipelineQuality
  crop_gate: boolean
  structure_gate: boolean
  router: PipelineRoute
  mathpix_eligible: boolean
  cache_hit: boolean
  would_call_api: boolean
  blocked_reason: string
  blockedBy: string[]
}

export function planMathpixCall(input: {
  candidate: PipelineCandidate
  cacheHit: boolean
  cacheOnly: boolean
}): MathpixCallPlan {
  const eligibility = shouldCallMathpix(input.candidate)
  const would_call_api = eligibility.eligible && !input.cacheHit
  return {
    problem_number: input.candidate.problem_number,
    page: input.candidate.page,
    pre_mathpix_status: input.candidate.quality,
    crop_gate: eligibility.crop_gate,
    structure_gate: eligibility.structure_gate,
    router: input.candidate.route,
    mathpix_eligible: eligibility.eligible,
    cache_hit: input.cacheHit,
    would_call_api: input.cacheOnly ? false : would_call_api,
    blocked_reason: eligibility.eligible ? (input.cacheOnly && would_call_api ? 'CACHE_MISS_BLOCKED' : '') : eligibility.reason,
    blockedBy: eligibility.blockedBy,
  }
}
