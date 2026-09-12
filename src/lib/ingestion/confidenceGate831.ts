/**
 * STEP 8.31 — confidence gate + DRAFT persist policy + HUMAN_REVIEW queue mapping.
 * Implements docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J row 8.31.
 * Paid OCR cap is 0 / $0. AUTO_APPROVED only if 8.25 §D all hold.
 * HUMAN_REVIEW does not mint a new problems.id.
 */

import { canonicalizeProblemNumber } from '../recognition/draftUpsert'
import {
  CONFIDENCE_HIGH,
  FIGURE_OWNERSHIP_MIN,
  FROZEN_PIPELINE_COUNTS,
  PIPELINE_ITEM_STATUSES,
  QUESTION_BANK_REF,
  STEP824_BLOCKED_CANDIDATE_IDS,
  STEP825_SAFETY,
  STUDENT_CARE_REF,
  authorizePaidOcr,
  evaluateConfidenceGate,
  mapToGoldStandard,
  summarizeProgress,
  type ConfidenceEvidence,
  type DualReviewScore,
  type PipelineItemStatus,
  type PipelineProgress,
  type PipelineStage,
} from './batchPipeline825'
import { SECOND_DOCUMENT, SECOND_PDF_SHA256 } from './cacheSegment827'
import {
  bboxValid,
  type ManifestBbox,
  type ManifestSample,
  type Step829ReviewInput,
} from './imageCompare830'
import {
  EXPECTED_GT_COUNT,
  STEP828_DOCUMENT,
  STEP828_DOCUMENT_TITLE,
  STEP828_GT_SHA256,
  STEP828_SSEN_FILE_HASH,
  fingerprintGtItem,
  type GtItem,
} from './structureFromCache828'
import type { Step828CachedItem } from './dualAiReview829'

export const STEP831 = '8.31'
export const STEP831_DIR = 'ocr-tests/taxonomy/step8-31'
export const ASSIGNED_BY = 'STEP_8_31'
export const STAGE: PipelineStage = 'CONFIDENCE_GATE'
export const STEP831_DOCUMENT = STEP828_DOCUMENT
export const STEP831_DOCUMENT_TITLE = STEP828_DOCUMENT_TITLE
export const STEP831_PDF_SHA256 = STEP828_SSEN_FILE_HASH
export const STEP831_PAGE_COUNT = 192
export const STEP831_PAID_OCR_CAP = { maxCalls: 0, maxUsd: 0 } as const
export const GT_JSON_SHA256 = STEP828_GT_SHA256
export const STORAGE_BUCKET = 'question-bank-sources'
export const STORAGE_ORIGINAL = `${STEP831_DOCUMENT}/original.pdf`
export const CROP_CACHE_DIR = '.ocr-temp/step8-31'
export const STEP830_COMPARES_PATH = 'ocr-tests/taxonomy/step8-30/compares.json'

export type Step831Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'
export type PersistAction = 'CREATE_DRAFT' | 'RECORD_EXISTING' | 'QUEUE_ONLY' | 'SKIP_BLOCKED' | 'SKIP_IDENTITY'
export type CompareCheck = 'PASS' | 'FAIL' | 'NOT_COMPARED'

export type Step831Target = {
  id: string
  kind:
    | 'TARGET'
    | 'CACHE'
    | 'EXECUTE'
    | 'PAID_OCR'
    | 'ORIGINAL_PDF'
    | 'CROPS'
    | 'MIXED_SOURCE'
    | 'WRITES'
    | 'DRAFTS'
    | 'GOLD'
    | 'FROZEN'
    | 'TEXTBOOK'
    | 'CARRY_OVER'
    | 'GATE'
  verdict: Step831Verdict
  reasons: string[]
}

export type RecoveredCrop = {
  sample_id: string
  present: boolean
  path: string | null
  sha256: string | null
  bytes: number | null
  width: number | null
  height: number | null
  frozen_sha256: string
  frozen_bytes: number
  matches_frozen: boolean
  source_kind: 'recovered_from_original_bbox' | 'step7_crop' | null
  substituted: false
}

export type CachedOcrEvidence = {
  present: boolean
  cached: boolean
  provider: 'mistral-ocr' | null
  text: string
  http: number | null
}

export type ExistingDraft = {
  problem_id: string
  public_code: string
  review_status: string
  lifecycle_status: string
  current_version_id: string | null
}

export type VisualChecks = {
  identity: CompareCheck
  stem: CompareCheck
  choices: CompareCheck
  math: CompareCheck
  figure: CompareCheck
  boundary: CompareCheck
}

export type GateItem = {
  candidate_id: string
  stage: PipelineStage
  status: PipelineItemStatus
  reasons: string[]
  source_document_id: string
  page_number: number
  problem_number: string | null
  canonical_number: string | null
  content_fingerprint: string
  crop: RecoveredCrop
  ocr: { present: boolean; cached: boolean; http: number | null; text_len: number }
  checks: VisualChecks
  compared: boolean
  image_compare_pass: boolean
  step830_image_compare_pass: boolean
  dual_agrees: boolean
  dual_would_auto: boolean
  upstream_status: PipelineItemStatus
  dual_status: PipelineItemStatus
  persist_action: PersistAction
  existing: ExistingDraft | null
  has_figure: boolean
  has_table: boolean
  choice_count: number
  section_d_all_met: boolean
  gate_raw: Exclude<PipelineItemStatus, 'AI_FIXED'>
  bbox_valid: boolean
  declared_bbox_overlap: boolean
}

export type GateInventory = {
  step828_items_present: boolean
  step828_count: number
  step829_reviews_present: boolean
  step829_count: number
  step830_compares_present: boolean
  step830_count: number
  gt_present: boolean
  gt_count: number
  gt_sha256: string | null
  gt_sha256_after: string | null
  mutated: boolean
  manifest_present: boolean
  manifest_count: number
  recovered_crops: number
  frozen_hash_matches: number
  original_pdf: {
    present: boolean
    path: string | null
    sha256: string | null
    hash_match: boolean
    is_second_book: boolean
    substituted: false
  }
}

export type DryRunResult = {
  pass: boolean
  blockers: string[]
  textbook: { id: string; title: string }
  source_id: string
  cached_items: number
  gate_targets: number
  expected_auto_approved: number
  problem_production_writes: number
  ocr_network_calls: 0
}

export type GateTally = {
  crop_present: number
  crop_missing: number
  frozen_hash_match: number
  compared: number
  auto_approved: number
  human_review: number
  blocked: number
  create_draft: number
  record_existing: number
  queue_only: number
  skip_blocked: number
  skip_identity: number
}

const NOT_COMPARED_CHECKS: VisualChecks = {
  identity: 'NOT_COMPARED',
  stem: 'NOT_COMPARED',
  choices: 'NOT_COMPARED',
  math: 'NOT_COMPARED',
  figure: 'NOT_COMPARED',
  boundary: 'NOT_COMPARED',
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const
const NEIGHBOR_RE = /소개기|논이기|본이기/

export function denyPaidOcr831(): { authorized: false; reason: string } {
  const decision = authorizePaidOcr({
    providerConfigured: false,
    estimatedCalls: 0,
    estimatedUsd: 0,
    cacheOnly: true,
    allowPaidApi: false,
    confirmCost: false,
    paidRoutingEnabled: false,
    stepMaxCalls: STEP831_PAID_OCR_CAP.maxCalls,
    stepMaxUsd: STEP831_PAID_OCR_CAP.maxUsd,
  })
  return { authorized: false, reason: decision.reason }
}

export function emptyGateInventory(): GateInventory {
  return {
    step828_items_present: false,
    step828_count: 0,
    step829_reviews_present: false,
    step829_count: 0,
    step830_compares_present: false,
    step830_count: 0,
    gt_present: false,
    gt_count: 0,
    gt_sha256: null,
    gt_sha256_after: null,
    mutated: false,
    manifest_present: false,
    manifest_count: 0,
    recovered_crops: 0,
    frozen_hash_matches: 0,
    original_pdf: {
      present: false,
      path: null,
      sha256: null,
      hash_match: false,
      is_second_book: false,
      substituted: false,
    },
  }
}

export function emptyRecoveredCrop(sample: Pick<ManifestSample, 'sample_id' | 'crop_sha256' | 'crop_bytes'>): RecoveredCrop {
  return {
    sample_id: sample.sample_id,
    present: false,
    path: null,
    sha256: null,
    bytes: null,
    width: null,
    height: null,
    frozen_sha256: sample.crop_sha256,
    frozen_bytes: sample.crop_bytes,
    matches_frozen: false,
    source_kind: null,
    substituted: false,
  }
}

export function normalizeCompareText(value: string): string {
  return value
    .replace(/\$/g, '')
    .replace(/[−–]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function circledChoiceCount(text: string): number {
  return CIRCLED.filter((mark) => text.includes(mark)).length
}

export function compareCachedOcrToGt(gt: GtItem, ocrText: string): VisualChecks {
  if (!ocrText.trim()) return { ...NOT_COMPARED_CHECKS }
  const nOcr = normalizeCompareText(ocrText)
  const identity: CompareCheck = gt.problem_number
    ? nOcr.includes(normalizeCompareText(gt.problem_number)) || ocrText.includes(gt.problem_number)
      ? 'PASS'
      : 'FAIL'
    : 'FAIL'
  const lines = gt.ground_truth_text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 8)
    .slice(0, 4)
  const stemHits = lines.filter((line) => nOcr.includes(normalizeCompareText(line).slice(0, 16))).length
  const stem: CompareCheck = lines.length === 0 ? (gt.ground_truth_text.trim() ? 'FAIL' : 'PASS') : stemHits / lines.length >= 0.5 ? 'PASS' : 'FAIL'
  const marks = circledChoiceCount(ocrText)
  const choices: CompareCheck =
    gt.ground_truth_choices.length === 0 ? 'PASS' : marks === gt.ground_truth_choices.length ? 'PASS' : 'FAIL'
  let mathHits = 0
  for (const expr of gt.ground_truth_math) {
    const token = normalizeCompareText(expr).slice(0, 12)
    if (token && nOcr.includes(token)) mathHits += 1
  }
  const math: CompareCheck =
    gt.ground_truth_math.length === 0 ? 'PASS' : mathHits / gt.ground_truth_math.length >= 0.34 ? 'PASS' : 'FAIL'
  const figure: CompareCheck = gt.has_figure
    ? /그림|도형|graph|triangle|반원|포물선/i.test(ocrText)
      ? 'PASS'
      : 'FAIL'
    : 'PASS'
  const boundary: CompareCheck = NEIGHBOR_RE.test(ocrText) ? 'FAIL' : 'PASS'
  return { identity, stem, choices, math, figure, boundary }
}

export function allVisualCompared(checks: VisualChecks): boolean {
  return (Object.values(checks) as CompareCheck[]).every((row) => row !== 'NOT_COMPARED')
}

export function allVisualPass(checks: VisualChecks): boolean {
  return (Object.values(checks) as CompareCheck[]).every((row) => row === 'PASS')
}

export function minDual(a: DualReviewScore, b: DualReviewScore, field: keyof Omit<DualReviewScore, 'checker'>): number {
  return Math.min(a[field], b[field])
}

export function sectionDAllMet(input: {
  canonical: string | null
  fingerprintOk: boolean
  cropPresent: boolean
  frozenHashMatch: boolean
  cropSafe: boolean
  neighborBlocking: boolean
  substituted: boolean
  structureConfidence: number
  identityConfidence: number
  hasFigure: boolean
  figureOwnershipConfidence: number
  figureAutoSafe: boolean
  dualAgrees: boolean
  imageComparePass: boolean
  step830ImageComparePass: boolean
  needsPaidOcr: boolean
  upstreamBlocked: boolean
}): boolean {
  if (!input.canonical) return false
  if (!input.fingerprintOk) return false
  if (!input.cropPresent || !input.frozenHashMatch) return false
  if (!input.cropSafe || input.neighborBlocking || input.substituted) return false
  if (input.structureConfidence < CONFIDENCE_HIGH) return false
  if (input.identityConfidence < CONFIDENCE_HIGH) return false
  if (input.hasFigure && (input.figureOwnershipConfidence < FIGURE_OWNERSHIP_MIN || !input.figureAutoSafe)) {
    return false
  }
  if (!input.dualAgrees) return false
  if (!input.imageComparePass) return false
  if (!input.step830ImageComparePass) return false
  if (input.needsPaidOcr) return false
  if (input.upstreamBlocked) return false
  return true
}

export function mapConfidence831(input: {
  fingerprintOk: boolean
  upstreamStatus: PipelineItemStatus
  dualStatus: PipelineItemStatus
  cropPresent: boolean
  frozenHashMatch: boolean
  substituted: boolean
  imageComparePass: boolean
  step830ImageComparePass: boolean
  sectionDAllMet: boolean
  canonical: string | null
  problemNumber: string | null
  existing: ExistingDraft | null
  gateRaw: Exclude<PipelineItemStatus, 'AI_FIXED'>
}): { status: PipelineItemStatus; persist: PersistAction; reasons: string[] } {
  const reasons: string[] = ['NO_VERIFIED', 'NO_WORKSHEET_ELIGIBLE']
  if (!input.fingerprintOk) reasons.push('CONTENT_FINGERPRINT_DRIFT')
  if (input.substituted) reasons.push('NO_SUBSTITUTE')
  if (!input.cropPresent) reasons.push('CROP_CACHE_MISSING')
  if (input.cropPresent && !input.frozenHashMatch) reasons.push('CROP_HASH_MISMATCH')
  if (!input.step830ImageComparePass) reasons.push('STEP_8_30_IMAGE_COMPARE_FAIL')
  if (!input.imageComparePass) reasons.push('IMAGE_COMPARE_NOT_PASS')
  if (!input.canonical && input.problemNumber) reasons.push('IDENTITY_NOT_CANONICAL')
  if (!input.problemNumber || input.upstreamStatus === 'BLOCKED') reasons.push('UPSTREAM_IDENTITY_UNSTABLE')
  reasons.push('NO_AUTO_APPROVED_UNLESS_SECTION_D')

  if (input.substituted || !input.fingerprintOk) {
    return { status: 'BLOCKED', persist: 'SKIP_BLOCKED', reasons }
  }
  if (!input.problemNumber || input.upstreamStatus === 'BLOCKED') {
    return { status: 'BLOCKED', persist: 'SKIP_BLOCKED', reasons }
  }
  if (!input.cropPresent) {
    return { status: 'BLOCKED', persist: 'SKIP_BLOCKED', reasons }
  }
  if (input.sectionDAllMet && input.gateRaw === 'AUTO_APPROVED') {
    return {
      status: 'AUTO_APPROVED',
      persist: input.existing ? 'RECORD_EXISTING' : 'CREATE_DRAFT',
      reasons: ['SECTION_D_ALL_MET', 'IMAGE_COMPARE_PASS', 'NO_VERIFIED'],
    }
  }
  if (!input.canonical) {
    return { status: 'HUMAN_REVIEW', persist: 'SKIP_IDENTITY', reasons: [...reasons, 'QUEUED_HUMAN_REVIEW'] }
  }
  if (input.existing) {
    return { status: 'HUMAN_REVIEW', persist: 'RECORD_EXISTING', reasons: [...reasons, 'EXISTING_PRODUCTION_DRAFT', 'QUEUED_HUMAN_REVIEW'] }
  }
  return { status: 'HUMAN_REVIEW', persist: 'QUEUE_ONLY', reasons: [...reasons, 'QUEUED_HUMAN_REVIEW', 'NO_NEW_PROBLEM_FOR_HUMAN_REVIEW'] }
}

export function buildConfidenceEvidence(input: {
  identityConfidence: number
  structureConfidence: number
  cropSafe: boolean
  neighborBlocking: boolean
  mathConflict: boolean
  hasFigure: boolean
  figureOwnershipConfidence: number
  figureAutoSafe: boolean
  imageComparePass: boolean
  dual: [DualReviewScore, DualReviewScore]
  problemIngested: boolean
  committedStem: boolean
}): ConfidenceEvidence {
  return {
    identityConfidence: input.identityConfidence,
    structureConfidence: input.structureConfidence,
    cropSafe: input.cropSafe,
    neighborBlocking: input.neighborBlocking,
    mathConflict: input.mathConflict,
    hasFigure: input.hasFigure,
    figureOwnershipConfidence: input.figureOwnershipConfidence,
    figureAutoSafe: input.figureAutoSafe,
    imageComparePass: input.imageComparePass,
    dual: input.dual,
    needsPaidOcr: false,
    problemIngested: input.problemIngested,
    committedStem: input.committedStem,
  }
}

export function buildGateItem(input: {
  gt: GtItem
  cached: Step828CachedItem
  review: Step829ReviewInput
  sample: ManifestSample
  crop: RecoveredCrop
  ocr: CachedOcrEvidence
  existing: ExistingDraft | null
  siblingBboxes: ManifestBbox[]
  step830ImageComparePass: boolean
}): GateItem {
  const fingerprintOk = input.cached.content_fingerprint === fingerprintGtItem(input.gt)
  const canonical = canonicalizeProblemNumber(input.gt.problem_number)
  const cropPresent =
    input.crop.present &&
    !input.crop.substituted &&
    (input.crop.source_kind === 'recovered_from_original_bbox' || input.crop.source_kind === 'step7_crop')
  const checks = compareCachedOcrToGt(input.gt, input.ocr.text)
  const compared = cropPresent && input.ocr.present && allVisualCompared(checks)
  const frozenHashMatch = cropPresent && input.crop.matches_frozen
  const imageComparePass =
    compared &&
    allVisualPass(checks) &&
    frozenHashMatch &&
    input.step830ImageComparePass
  const bboxOk = bboxValid(input.sample.bbox)
  const declaredOverlap = input.siblingBboxes.some((bbox) => {
    const overlapX = Math.min(input.sample.bbox.x + input.sample.bbox.width, bbox.x + bbox.width) - Math.max(input.sample.bbox.x, bbox.x)
    const overlapY = Math.min(input.sample.bbox.y + input.sample.bbox.height, bbox.y + bbox.height) - Math.max(input.sample.bbox.y, bbox.y)
    return overlapX > 1e-6 && overlapY > 1e-6
  })
  const identityConfidence = minDual(input.review.checker_a, input.review.checker_b, 'identity')
  const structureConfidence = minDual(input.review.checker_a, input.review.checker_b, 'structure')
  const figureOwnershipConfidence = minDual(input.review.checker_a, input.review.checker_b, 'figureOwnership')
  const mathA = input.review.checker_a.math
  const mathB = input.review.checker_b.math
  const evidence = buildConfidenceEvidence({
    identityConfidence,
    structureConfidence,
    cropSafe: cropPresent && bboxOk,
    neighborBlocking: declaredOverlap,
    mathConflict: Math.abs(mathA - mathB) >= 0.2,
    hasFigure: input.gt.has_figure,
    figureOwnershipConfidence,
    figureAutoSafe: !input.gt.has_figure || figureOwnershipConfidence >= FIGURE_OWNERSHIP_MIN,
    imageComparePass,
    dual: [input.review.checker_a, input.review.checker_b],
    problemIngested: Boolean(input.existing),
    committedStem: Boolean(input.gt.ground_truth_text.trim()),
  })
  const gateRaw = evaluateConfidenceGate(evidence)
  const sectionD = sectionDAllMet({
    canonical,
    fingerprintOk,
    cropPresent,
    frozenHashMatch,
    cropSafe: cropPresent && bboxOk,
    neighborBlocking: declaredOverlap,
    substituted: input.crop.substituted,
    structureConfidence,
    identityConfidence,
    hasFigure: input.gt.has_figure,
    figureOwnershipConfidence,
    figureAutoSafe: !input.gt.has_figure || figureOwnershipConfidence >= FIGURE_OWNERSHIP_MIN,
    dualAgrees: input.review.agrees && input.review.dual_would_auto,
    imageComparePass,
    step830ImageComparePass: input.step830ImageComparePass,
    needsPaidOcr: false,
    upstreamBlocked: input.cached.status === 'BLOCKED',
  })
  const mapped = mapConfidence831({
    fingerprintOk,
    upstreamStatus: input.cached.status,
    dualStatus: input.review.status,
    cropPresent,
    frozenHashMatch,
    substituted: input.crop.substituted,
    imageComparePass,
    step830ImageComparePass: input.step830ImageComparePass,
    sectionDAllMet: sectionD,
    canonical,
    problemNumber: input.gt.problem_number,
    existing: input.existing,
    gateRaw,
  })
  return {
    candidate_id: input.gt.sample_id,
    stage: STAGE,
    status: mapped.status,
    reasons: mapped.reasons,
    source_document_id: STEP831_DOCUMENT,
    page_number: input.gt.page_number,
    problem_number: input.gt.problem_number,
    canonical_number: canonical,
    content_fingerprint: input.cached.content_fingerprint,
    crop: input.crop,
    ocr: {
      present: input.ocr.present,
      cached: input.ocr.cached,
      http: input.ocr.http,
      text_len: input.ocr.text.length,
    },
    checks,
    compared,
    image_compare_pass: imageComparePass,
    step830_image_compare_pass: input.step830ImageComparePass,
    dual_agrees: input.review.agrees,
    dual_would_auto: input.review.dual_would_auto,
    upstream_status: input.cached.status,
    dual_status: input.review.status,
    persist_action: mapped.persist,
    existing: input.existing,
    has_figure: input.gt.has_figure,
    has_table: input.gt.has_table,
    choice_count: input.gt.ground_truth_choices.length,
    section_d_all_met: sectionD,
    gate_raw: gateRaw,
    bbox_valid: bboxOk,
    declared_bbox_overlap: declaredOverlap,
  }
}

export function persistPlanSafe(items: GateItem[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const ids = new Set<string>()
  for (const row of items) {
    if (row.status === 'AUTO_APPROVED' && !row.section_d_all_met) {
      reasons.push(`AUTO_WITHOUT_SECTION_D_${row.candidate_id}`)
    }
    if (row.status === 'AUTO_APPROVED' && !row.image_compare_pass) {
      reasons.push(`AUTO_WITHOUT_IMAGE_COMPARE_${row.candidate_id}`)
    }
    if (row.status === 'AUTO_APPROVED' && !row.step830_image_compare_pass) {
      reasons.push(`AUTO_FROM_8_30_FAIL_${row.candidate_id}`)
    }
    if (row.persist_action === 'CREATE_DRAFT' && row.status !== 'AUTO_APPROVED') {
      reasons.push(`CREATE_WITHOUT_AUTO_${row.candidate_id}`)
    }
    if (row.persist_action === 'CREATE_DRAFT' && row.existing) {
      reasons.push(`CREATE_WOULD_COLLIDE_${row.candidate_id}`)
    }
    if (row.persist_action === 'CREATE_DRAFT' && !row.canonical_number) {
      reasons.push(`CREATE_WITHOUT_IDENTITY_${row.candidate_id}`)
    }
    const gold = mapToGoldStandard(row.status)
    if (gold.mayVerify || gold.review === 'VERIFIED' || gold.useStatus === 'WORKSHEET_ELIGIBLE') {
      reasons.push(`GOLD_FORBIDDEN_${row.candidate_id}`)
    }
    if (!(PIPELINE_ITEM_STATUSES as readonly string[]).includes(row.status)) {
      reasons.push(`UNKNOWN_STATUS_${row.candidate_id}`)
    }
    if (row.canonical_number) {
      const key = `${row.page_number}|${row.canonical_number}`
      if (ids.has(key)) reasons.push(`DUP_PLAN_${row.candidate_id}`)
      ids.add(key)
    }
    if (row.source_document_id !== STEP831_DOCUMENT) reasons.push(`WRONG_SOURCE_${row.candidate_id}`)
  }
  return { ok: reasons.length === 0, reasons }
}

export function progressFromItems(items: GateItem[]): PipelineProgress {
  return {
    ...summarizeProgress(items.map((row) => row.status)),
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function progressMatchesItems(progress: PipelineProgress, items: GateItem[]): boolean {
  const expected = progressFromItems(items)
  return (
    progress.total === expected.total &&
    progress.auto_approved === expected.auto_approved &&
    progress.human_review === expected.human_review &&
    progress.blocked === expected.blocked &&
    progress.failed === expected.failed &&
    progress.actual_paid_calls === 0
  )
}

export function findDuplicateCandidateIds(items: GateItem[]): string[] {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of items) {
    if (seen.has(row.candidate_id)) dup.push(row.candidate_id)
    seen.add(row.candidate_id)
  }
  return dup
}

export function findOrphanItems(items: GateItem[], runSourceId: string): GateItem[] {
  return items.filter((row) => row.source_document_id !== runSourceId)
}

export function findWrongSourceItems(items: GateItem[]): GateItem[] {
  return items.filter((row) => row.source_document_id !== STEP831_DOCUMENT)
}

export function tallyGate(items: GateItem[]): GateTally {
  return {
    crop_present: items.filter((row) => row.crop.present).length,
    crop_missing: items.filter((row) => !row.crop.present).length,
    frozen_hash_match: items.filter((row) => row.crop.matches_frozen).length,
    compared: items.filter((row) => row.compared).length,
    auto_approved: items.filter((row) => row.status === 'AUTO_APPROVED').length,
    human_review: items.filter((row) => row.status === 'HUMAN_REVIEW').length,
    blocked: items.filter((row) => row.status === 'BLOCKED').length,
    create_draft: items.filter((row) => row.persist_action === 'CREATE_DRAFT').length,
    record_existing: items.filter((row) => row.persist_action === 'RECORD_EXISTING').length,
    queue_only: items.filter((row) => row.persist_action === 'QUEUE_ONLY').length,
    skip_blocked: items.filter((row) => row.persist_action === 'SKIP_BLOCKED').length,
    skip_identity: items.filter((row) => row.persist_action === 'SKIP_IDENTITY').length,
  }
}

export function evaluateDryRun(input: {
  inventory: GateInventory
  problemPersistRequested: boolean
  paidApiRequested: boolean
  mixedTextbook: boolean
}): DryRunResult {
  const blockers: string[] = []
  if (!input.inventory.step828_items_present || input.inventory.step828_count !== EXPECTED_GT_COUNT) {
    blockers.push('STEP828_CACHE_MISSING')
  }
  if (!input.inventory.step829_reviews_present || input.inventory.step829_count !== EXPECTED_GT_COUNT) {
    blockers.push('STEP829_CACHE_MISSING')
  }
  if (!input.inventory.step830_compares_present || input.inventory.step830_count !== EXPECTED_GT_COUNT) {
    blockers.push('STEP830_CACHE_MISSING')
  }
  if (!input.inventory.gt_present || input.inventory.gt_count !== EXPECTED_GT_COUNT) blockers.push('GT_CACHE_MISSING')
  if (input.inventory.gt_present && input.inventory.gt_sha256 !== STEP828_GT_SHA256) blockers.push('GT_HASH_MISMATCH')
  if (input.inventory.mutated) blockers.push('GT_MUTATED')
  if (!input.inventory.manifest_present || input.inventory.manifest_count !== EXPECTED_GT_COUNT) {
    blockers.push('MANIFEST_CACHE_MISSING')
  }
  if (input.mixedTextbook) blockers.push('MIXED_TEXTBOOK')
  if (input.paidApiRequested) blockers.push('PAID_OCR_FLAG')
  void input.problemPersistRequested
  const pass = blockers.length === 0
  return {
    pass,
    blockers,
    textbook: { id: STEP831_DOCUMENT, title: STEP831_DOCUMENT_TITLE },
    source_id: STEP831_DOCUMENT,
    cached_items: input.inventory.step828_count,
    gate_targets: pass ? EXPECTED_GT_COUNT : 0,
    expected_auto_approved: 0,
    problem_production_writes: 0,
    ocr_network_calls: 0,
  }
}

export function projectStep831Targets(input: {
  dryRun: DryRunResult
  executed: boolean
  originalPdfHashMatch: boolean
  recoveredCrops: number
  autoApproved: number
  createDraft: number
}): Step831Target[] {
  const step828Blocked = input.dryRun.blockers.includes('STEP828_CACHE_MISSING')
  const step829Blocked = input.dryRun.blockers.includes('STEP829_CACHE_MISSING')
  const step830Blocked = input.dryRun.blockers.includes('STEP830_CACHE_MISSING')
  const targets: Step831Target[] = [
    {
      id: 'target.lock',
      kind: 'TARGET',
      verdict: 'PASS',
      reasons: ['SSEN_DOCUMENT_LOCKED', STEP831_DOCUMENT],
    },
    {
      id: 'cache.step828',
      kind: 'CACHE',
      verdict: step828Blocked ? 'BLOCKED' : 'PASS',
      reasons: step828Blocked ? ['STEP828_CACHE_MISSING'] : ['STEP828_CACHE_PRESENT'],
    },
    {
      id: 'cache.step829',
      kind: 'CACHE',
      verdict: step829Blocked ? 'BLOCKED' : 'PASS',
      reasons: step829Blocked ? ['STEP829_CACHE_MISSING'] : ['STEP829_CACHE_PRESENT'],
    },
    {
      id: 'cache.step830',
      kind: 'CACHE',
      verdict: step830Blocked ? 'BLOCKED' : 'PASS',
      reasons: step830Blocked ? ['STEP830_CACHE_MISSING'] : ['STEP830_CACHE_PRESENT'],
    },
    {
      id: 'execute.gate',
      kind: 'EXECUTE',
      verdict: input.executed ? 'PASS' : 'BLOCKED',
      reasons: input.executed ? ['CONFIDENCE_GATE_ONCE'] : ['DRY_RUN_BLOCKED_NO_EXECUTE'],
    },
    {
      id: 'full_textbook',
      kind: 'TEXTBOOK',
      verdict: 'BLOCKED',
      reasons: ['OUT_OF_SCOPE_STEP_8_31', 'TWENTY_SIX_CACHED_SAMPLES_ONLY'],
    },
    {
      id: 'paid_ocr',
      kind: 'PAID_OCR',
      verdict: 'BLOCKED',
      reasons: ['STEP_PAID_OCR_CAP_ZERO', 'NO_SEPARATE_AUTHORIZED_FREEZE'],
    },
    {
      id: 'original_pdf',
      kind: 'ORIGINAL_PDF',
      verdict: input.originalPdfHashMatch ? 'PASS' : 'BLOCKED',
      reasons: input.originalPdfHashMatch
        ? ['FROZEN_SSEN_HASH_MATCH', 'CROP_REGEN_ALLOWED']
        : ['ORIGINAL_PDF_ABSENT_OR_HASH_MISMATCH', 'NO_SUBSTITUTE'],
    },
    {
      id: 'recovered_crops',
      kind: 'CROPS',
      verdict: input.recoveredCrops === EXPECTED_GT_COUNT ? 'PASS' : 'BLOCKED',
      reasons:
        input.recoveredCrops === EXPECTED_GT_COUNT
          ? ['RECOVERED_FROM_ORIGINAL_AND_BBOX']
          : ['CROP_CACHE_MISSING', 'NO_SUBSTITUTE', `PRESENT_${input.recoveredCrops}_OF_${EXPECTED_GT_COUNT}`],
    },
    {
      id: 'mixed_source',
      kind: 'MIXED_SOURCE',
      verdict: 'PASS',
      reasons: ['SECOND_BOOK_EXCLUDED', SECOND_DOCUMENT, SECOND_PDF_SHA256, 'PAGE_PNG_NOT_USED_AS_CROP'],
    },
    {
      id: 'auto_gate',
      kind: 'GATE',
      verdict: input.autoApproved === 0 ? 'PASS' : 'BLOCKED',
      reasons: ['NO_AUTO_APPROVED_UNLESS_SECTION_D', `AUTO_${input.autoApproved}`],
    },
    {
      id: 'draft_policy',
      kind: 'DRAFTS',
      verdict: input.createDraft === 0 || input.createDraft === input.autoApproved ? 'PASS' : 'BLOCKED',
      reasons: ['HUMAN_REVIEW_DOES_NOT_CREATE_PROBLEM', `CREATE_${input.createDraft}`],
    },
    {
      id: 'gold_verify_denied',
      kind: 'GOLD',
      verdict: 'PASS',
      reasons: ['NO_GOLD_STANDARD_VERIFY'],
    },
    {
      id: 'frozen_counts',
      kind: 'FROZEN',
      verdict: 'PASS',
      reasons: ['DRAFTS_265', 'TYPE_AUTO_38', 'REMAINDER_227', 'FIGURES_3_3'],
    },
  ]
  for (const id of STEP824_BLOCKED_CANDIDATE_IDS) {
    targets.push({
      id,
      kind: 'CARRY_OVER',
      verdict: 'BLOCKED',
      reasons: [
        'PROBLEM_NOT_INGESTED',
        'NO_COMMITTED_STEM',
        'NEEDS_PAID_OCR',
        'CARRY_OVER_STEP_8_24',
        'OUT_OF_SCOPE_STEP_8_31',
      ],
    })
  }
  return targets
}

export function tallyVerdicts(targets: Step831Target[]): Record<Step831Verdict, number> {
  return {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
}

export const STEP831_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  nextStepStarted: false,
  frozen: FROZEN_PIPELINE_COUNTS,
  goldVerify: false,
  paidOcrCap: STEP831_PAID_OCR_CAP,
  humanReviewCreatesProblem: false,
} as const
