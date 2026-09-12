/**
 * STEP 8.25 — Integrated textbook batch registration pipeline.
 * DESIGN FREEZE types and pure gates. No Production I/O, no paid OCR, no Storage writes.
 */

export const STEP825 = '8.25'
export const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
export const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'

/** Carry-over from STEP 8.24. Do not persist or OCR these in 8.25. */
export const STEP824_BLOCKED_CANDIDATE_IDS = [
  '108|0735',
  '108|0736',
  '114|0775',
  '122|0833',
  '134|0924',
  '134|0925',
  '134|0926',
  '189|1300',
] as const

/**
 * Historical frozen taxonomy counts. 8.25 must not rewrite them.
 * 227 = 265 expected drafts − 38 type AUTO.
 */
export const FROZEN_PIPELINE_COUNTS = {
  step812ExpectedDrafts: 265,
  frozenTypeAuto: 38,
  impliedNonTypeAuto: 227,
  step823FigureAssets: 3,
  step823FigureLinks: 3,
  step824BlockedRemaining: 8,
} as const

export const PIPELINE_ITEM_STATUSES = [
  'AUTO_APPROVED',
  'AI_FIXED',
  'HUMAN_REVIEW',
  'BLOCKED',
  'FAILED',
] as const

export type PipelineItemStatus = (typeof PIPELINE_ITEM_STATUSES)[number]

export const PIPELINE_STAGES = [
  'SOURCE_REGISTER',
  'PAGE_RENDER',
  'SEGMENT',
  'STRUCTURE',
  'FIGURE_DETECT_LINK',
  'SELECTIVE_OCR',
  'DUAL_AI_REVIEW',
  'IMAGE_COMPARE',
  'CONFIDENCE_GATE',
  'PERSIST_DRAFT',
  'QUEUE_HUMAN',
  'LEARN_CORRECTIONS',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const GOLD_REVIEW_STATUSES = [
  'UNREVIEWED',
  'AUTO_CLASSIFIED',
  'NEEDS_REVIEW',
  'VERIFIED',
  'REJECTED',
] as const

export type GoldReviewStatus = (typeof GOLD_REVIEW_STATUSES)[number]

export const LIFECYCLE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number]

export const USE_STATUSES = ['INTERNAL_ONLY', 'REVIEW_ONLY', 'WORKSHEET_ELIGIBLE', 'BLOCKED'] as const
export type UseStatus = (typeof USE_STATUSES)[number]

/** Router HIGH band and STEP 8.11 type threshold. Do not relax in 8.25. */
export const CONFIDENCE_HIGH = 0.78
export const FIGURE_OWNERSHIP_MIN = 0.85

export const STEP825_PAID_OCR_CAP = {
  maxCalls: 0,
  maxUsd: 0,
} as const

export const MATHPIX_IMAGE_USD = 0.002

export type DualReviewScore = {
  checker: 'A' | 'B'
  identity: number
  structure: number
  math: number
  figureOwnership: number
}

export type ConfidenceEvidence = {
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
  needsPaidOcr: boolean
  problemIngested: boolean
  committedStem: boolean
}

export type PaidOcrRequest = {
  providerConfigured: boolean
  estimatedCalls: number
  estimatedUsd: number
  cacheOnly: boolean
  allowPaidApi: boolean
  confirmCost: boolean
  paidRoutingEnabled: boolean
  stepMaxCalls: number
  stepMaxUsd: number
}

export type PaidOcrDecision = {
  authorized: boolean
  reason: string
}

export type GoldMapping = {
  lifecycle: LifecycleStatus | null
  review: GoldReviewStatus | null
  useStatus: UseStatus | null
  persistDraft: boolean
  queueHuman: boolean
  mayVerify: false
}

export type PipelineProgress = {
  total: number
  auto_approved: number
  ai_fixed: number
  human_review: number
  blocked: number
  failed: number
  unresolved: number
  estimated_paid_calls: number
  estimated_usd: number
  actual_paid_calls: number
  actual_usd: number
}

export type DedupKind = 'SOURCE_SHA256' | 'PROBLEM_IDENTITY' | 'FIGURE_HASH' | 'CONTENT_FINGERPRINT'

export type DedupKey =
  | { kind: 'SOURCE_SHA256'; sha256: string }
  | { kind: 'PROBLEM_IDENTITY'; documentId: string; page: number; canonical: string }
  | { kind: 'FIGURE_HASH'; documentId: string; page: number; sourceHash: string }
  | { kind: 'CONTENT_FINGERPRINT'; fingerprintType: 'NORMALIZED_TEXT' | 'STRUCTURE' | 'FILE_HASH'; value: string }

export function refuseStudentCareUrl(url: string): void {
  if (url.includes(STUDENT_CARE_REF)) {
    throw new Error('Student Care project refused')
  }
  if (url.includes('supabase') && !url.includes(QUESTION_BANK_REF)) {
    throw new Error('Wrong Supabase project')
  }
}

export function isPipelineItemStatus(value: string): value is PipelineItemStatus {
  return (PIPELINE_ITEM_STATUSES as readonly string[]).includes(value)
}

export function estimateMathpixUsd(calls: number): number {
  if (calls <= 0) return 0
  return Number((calls * MATHPIX_IMAGE_USD).toFixed(4))
}

/**
 * STEP 8.25 hard-denies paid OCR even if a later STEP would pass paidGate.
 * Free/cache work is still allowed.
 */
export function authorizePaidOcr(req: PaidOcrRequest): PaidOcrDecision {
  if (req.paidRoutingEnabled) {
    return { authorized: false, reason: 'PAID_ROUTING_FLAG_MUST_STAY_FALSE' }
  }
  if (req.stepMaxCalls <= 0 || req.stepMaxUsd <= 0) {
    return { authorized: false, reason: 'STEP_PAID_OCR_CAP_ZERO' }
  }
  if (req.cacheOnly) return { authorized: false, reason: 'CACHE_ONLY' }
  if (!req.providerConfigured) return { authorized: false, reason: 'PROVIDER_NOT_CONFIGURED' }
  if (!req.allowPaidApi || !req.confirmCost) return { authorized: false, reason: 'PAID_GATE_DENIED' }
  if (req.estimatedCalls > req.stepMaxCalls) return { authorized: false, reason: 'CALLS_EXCEED_CAP' }
  if (req.estimatedUsd > req.stepMaxUsd) return { authorized: false, reason: 'COST_EXCEEDS_CAP' }
  return { authorized: false, reason: 'STEP_8_25_FORBIDS_PAID_OCR' }
}

export function dualReviewAgrees(a: DualReviewScore, b: DualReviewScore): boolean {
  const fields: Array<keyof Omit<DualReviewScore, 'checker'>> = ['identity', 'structure', 'math', 'figureOwnership']
  return fields.every((field) => a[field] >= CONFIDENCE_HIGH && b[field] >= CONFIDENCE_HIGH)
}

export function combineDualReview(a: DualReviewScore, b: DualReviewScore): Exclude<PipelineItemStatus, 'AI_FIXED'> {
  if (!dualReviewAgrees(a, b)) return 'HUMAN_REVIEW'
  return 'AUTO_APPROVED'
}

export function reGateAfterAiFix(statusAfterGate: Exclude<PipelineItemStatus, 'AI_FIXED'>): Exclude<PipelineItemStatus, 'AI_FIXED'> {
  return statusAfterGate
}

export function evaluateConfidenceGate(evidence: ConfidenceEvidence): Exclude<PipelineItemStatus, 'AI_FIXED'> {
  if (evidence.mathConflict) return 'HUMAN_REVIEW'
  if (evidence.neighborBlocking || !evidence.cropSafe) return 'BLOCKED'
  if (evidence.identityConfidence < 0.5) return 'BLOCKED'
  if (!evidence.problemIngested && !evidence.committedStem) return 'BLOCKED'
  if (!evidence.problemIngested && evidence.committedStem) return 'HUMAN_REVIEW'
  if (evidence.needsPaidOcr) return 'BLOCKED'
  if (!evidence.imageComparePass) return 'HUMAN_REVIEW'
  if (evidence.hasFigure && (evidence.figureOwnershipConfidence < FIGURE_OWNERSHIP_MIN || !evidence.figureAutoSafe)) {
    return 'HUMAN_REVIEW'
  }
  if (evidence.identityConfidence < CONFIDENCE_HIGH || evidence.structureConfidence < CONFIDENCE_HIGH) {
    return 'HUMAN_REVIEW'
  }
  const dual = combineDualReview(evidence.dual[0], evidence.dual[1])
  if (dual !== 'AUTO_APPROVED') return dual
  return 'AUTO_APPROVED'
}

export function mapToGoldStandard(status: PipelineItemStatus): GoldMapping {
  const denyVerify = { mayVerify: false as const }
  if (status === 'AUTO_APPROVED') {
    return {
      lifecycle: 'DRAFT',
      review: 'AUTO_CLASSIFIED',
      useStatus: 'INTERNAL_ONLY',
      persistDraft: true,
      queueHuman: false,
      ...denyVerify,
    }
  }
  if (status === 'AI_FIXED') {
    return {
      lifecycle: null,
      review: null,
      useStatus: null,
      persistDraft: false,
      queueHuman: false,
      ...denyVerify,
    }
  }
  if (status === 'HUMAN_REVIEW') {
    return {
      lifecycle: 'DRAFT',
      review: 'NEEDS_REVIEW',
      useStatus: 'REVIEW_ONLY',
      persistDraft: true,
      queueHuman: true,
      ...denyVerify,
    }
  }
  return {
    lifecycle: null,
    review: null,
    useStatus: null,
    persistDraft: false,
    queueHuman: status === 'BLOCKED',
    ...denyVerify,
  }
}

export function assertNeverVerified(mapping: GoldMapping): void {
  if (mapping.review === 'VERIFIED') throw new Error('pipeline must never set VERIFIED')
  if (mapping.useStatus === 'WORKSHEET_ELIGIBLE') throw new Error('pipeline must never set WORKSHEET_ELIGIBLE')
  if (mapping.mayVerify) throw new Error('pipeline must never verify')
}

export function summarizeProgress(statuses: PipelineItemStatus[]): PipelineProgress {
  const count = (want: PipelineItemStatus) => statuses.filter((row) => row === want).length
  return {
    total: statuses.length,
    auto_approved: count('AUTO_APPROVED'),
    ai_fixed: count('AI_FIXED'),
    human_review: count('HUMAN_REVIEW'),
    blocked: count('BLOCKED'),
    failed: count('FAILED'),
    unresolved: count('HUMAN_REVIEW') + count('BLOCKED') + count('FAILED') + count('AI_FIXED'),
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function sameDedupKey(a: DedupKey, b: DedupKey): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'SOURCE_SHA256' && b.kind === 'SOURCE_SHA256') return a.sha256 === b.sha256
  if (a.kind === 'PROBLEM_IDENTITY' && b.kind === 'PROBLEM_IDENTITY') {
    return a.documentId === b.documentId && a.page === b.page && a.canonical === b.canonical
  }
  if (a.kind === 'FIGURE_HASH' && b.kind === 'FIGURE_HASH') {
    return a.documentId === b.documentId && a.page === b.page && a.sourceHash === b.sourceHash
  }
  if (a.kind === 'CONTENT_FINGERPRINT' && b.kind === 'CONTENT_FINGERPRINT') {
    return a.fingerprintType === b.fingerprintType && a.value === b.value
  }
  return false
}

export function carryOverBlockedReason(id: string): string[] {
  if (!(STEP824_BLOCKED_CANDIDATE_IDS as readonly string[]).includes(id)) {
    throw new Error(`not a STEP 8.24 blocked candidate: ${id}`)
  }
  return ['PROBLEM_NOT_INGESTED', 'NO_COMMITTED_STEM', 'NEEDS_PAID_OCR', 'CARRY_OVER_STEP_8_24']
}

export const STEP825_SAFETY = {
  productionWrites: 0,
  paidApiCalls: { mathpix: 0, mistral: 0 },
  studentCareAccessed: false,
  runtimeIngestImplemented: false,
} as const
