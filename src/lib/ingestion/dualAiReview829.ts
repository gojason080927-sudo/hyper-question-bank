/**
 * STEP 8.29 — dual-AI review pilot on cached STEP 8.28 / STEP 7 GT artifacts.
 * Implements docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J row 8.29.
 * No Gold Standard verify. No paid OCR. AUTO_APPROVED is not stored.
 */

import { extractChoices, extractMath, extractScanProblemNumber, splitLines } from '../recognition/structure'
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
  combineDualReview,
  dualReviewAgrees,
  mapToGoldStandard,
  summarizeProgress,
  type DualReviewScore,
  type PipelineItemStatus,
  type PipelineProgress,
  type PipelineStage,
} from './batchPipeline825'
import {
  SECOND_DOCUMENT,
  SECOND_PDF_SHA256,
} from './cacheSegment827'
import {
  EXPECTED_GT_COUNT,
  STEP828,
  STEP828_DIR,
  STEP828_DOCUMENT,
  STEP828_DOCUMENT_TITLE,
  STEP828_GT_SHA256,
  fingerprintGtItem,
  type GtItem,
} from './structureFromCache828'

export const STEP829 = '8.29'
export const STEP829_DIR = 'ocr-tests/taxonomy/step8-29'
export const ASSIGNED_BY = 'STEP_8_29'
export const STAGE: PipelineStage = 'DUAL_AI_REVIEW'
export const STEP828_ITEMS_PATH = `${STEP828_DIR}/items.json`
export const STEP829_PAID_OCR_CAP = { maxCalls: 0, maxUsd: 0 } as const
/** Text-only cache cannot prove figure ownership (needs crop + 8.23 persist). Below 0.78. */
export const FIGURE_OWNERSHIP_UNVERIFIED = 0.4

export const STEP829_DOCUMENT = STEP828_DOCUMENT
export const STEP829_DOCUMENT_TITLE = STEP828_DOCUMENT_TITLE

export type Step829Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type Step829Target = {
  id: string
  kind:
    | 'TARGET'
    | 'CACHE'
    | 'EXECUTE'
    | 'PAID_OCR'
    | 'ORIGINAL_PDF'
    | 'MIXED_SOURCE'
    | 'WRITES'
    | 'DRAFTS'
    | 'GOLD'
    | 'FROZEN'
    | 'TEXTBOOK'
    | 'CARRY_OVER'
  verdict: Step829Verdict
  reasons: string[]
}

export type Step828CachedItem = {
  candidate_id: string
  page_number: number
  problem_number: string | null
  status: PipelineItemStatus
  reasons: string[]
  choice_count: number
  answer_candidate: string | null
  explanation: null
  content_fingerprint: string
}

export type DualFieldDiff = {
  field: keyof Omit<DualReviewScore, 'checker'>
  a: number
  b: number
  delta: number
  both_high: boolean
}

export type DualReviewRecord = {
  candidate_id: string
  stage: PipelineStage
  status: PipelineItemStatus
  reasons: string[]
  source_document_id: string
  page_number: number
  problem_number: string | null
  content_fingerprint: string
  checker_a: DualReviewScore
  checker_b: DualReviewScore
  agrees: boolean
  dual_would_auto: boolean
  diffs: DualFieldDiff[]
  upstream_status: PipelineItemStatus
}

export type DualInventory = {
  step828_items_present: boolean
  step828_count: number
  gt_present: boolean
  gt_count: number
  gt_sha256: string | null
  gt_sha256_after: string | null
  mutated: false | true
  original_pdf: {
    present: boolean
    path: string | null
    sha256: string | null
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
  review_targets: number
  expected_pipeline_runs: 0
  expected_pipeline_items: 0
  problem_production_writes: 0
  draft_persist: false
  ocr_network_calls: 0
  original_pdf_required: false
}

export function denyPaidOcr829(): { authorized: false; reason: string } {
  const decision = authorizePaidOcr({
    providerConfigured: false,
    estimatedCalls: 0,
    estimatedUsd: 0,
    cacheOnly: true,
    allowPaidApi: false,
    confirmCost: false,
    paidRoutingEnabled: false,
    stepMaxCalls: STEP829_PAID_OCR_CAP.maxCalls,
    stepMaxUsd: STEP829_PAID_OCR_CAP.maxUsd,
  })
  return { authorized: false, reason: decision.reason }
}

export function emptyDualInventory(): DualInventory {
  return {
    step828_items_present: false,
    step828_count: 0,
    gt_present: false,
    gt_count: 0,
    gt_sha256: null,
    gt_sha256_after: null,
    mutated: false,
    original_pdf: {
      present: false,
      path: null,
      sha256: null,
      is_second_book: false,
      substituted: false,
    },
  }
}

export function clampScore(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

export function fieldDiffs(a: DualReviewScore, b: DualReviewScore): DualFieldDiff[] {
  const fields: Array<keyof Omit<DualReviewScore, 'checker'>> = [
    'identity',
    'structure',
    'math',
    'figureOwnership',
  ]
  return fields.map((field) => ({
    field,
    a: a[field],
    b: b[field],
    delta: clampScore(Math.abs(a[field] - b[field])),
    both_high: a[field] >= CONFIDENCE_HIGH && b[field] >= CONFIDENCE_HIGH,
  }))
}

function figureOwnershipScore(hasFigure: boolean): number {
  return hasFigure ? FIGURE_OWNERSHIP_UNVERIFIED : 1
}

/** Checker A: declared GT fields only. Does not parse or invent text. */
export function scoreCheckerA(gt: GtItem): DualReviewScore {
  let identity = 0
  if (gt.problem_number) {
    identity = gt.ground_truth_text.includes(gt.problem_number) ? 0.92 : 0.45
  }
  let structure = 0
  if (gt.ground_truth_text.trim()) {
    if (gt.ground_truth_choices.length === 0) structure = 0.84
    else if (gt.ground_truth_choices.length === 1) structure = 0.6
    else structure = 0.9
  }
  let math = 0.8
  if (gt.ground_truth_math.length > 0) {
    const collapsed = /(?<![0-9])([A-Za-z])(\d)(?![0-9²³^])/.test(gt.ground_truth_math.join('\n'))
    math = collapsed ? 0.35 : 0.9
  }
  return {
    checker: 'A',
    identity: clampScore(identity),
    structure: clampScore(structure),
    math: clampScore(math),
    figureOwnership: clampScore(figureOwnershipScore(gt.has_figure)),
  }
}

/** Checker B: independent parse of the same GT text. Parsed output never replaces GT. */
export function scoreCheckerB(gt: GtItem): DualReviewScore {
  const text = gt.ground_truth_text
  const parsedNumber = extractScanProblemNumber(text)
  let identity = 0
  if (gt.problem_number) {
    identity = parsedNumber === gt.problem_number ? 0.9 : 0.55
    if (!parsedNumber && text.includes(gt.problem_number)) identity = 0.7
  }
  const parsedChoices = extractChoices(splitLines(text)).choices
  let structure = 0
  if (text.trim()) {
    structure = parsedChoices.length === gt.ground_truth_choices.length ? 0.88 : 0.55
  }
  const parsedMath = extractMath(text)
  let math = 0.8
  if (gt.ground_truth_math.length > 0) {
    const lost = parsedMath.some((row) => row.notes.some((note) => note.includes('lost exponent')))
    math = lost ? 0.35 : 0.85
  }
  return {
    checker: 'B',
    identity: clampScore(identity),
    structure: clampScore(structure),
    math: clampScore(math),
    figureOwnership: clampScore(figureOwnershipScore(gt.has_figure)),
  }
}

export function mapDualToPipeline(input: {
  upstreamStatus: PipelineItemStatus
  fingerprintOk: boolean
  a: DualReviewScore
  b: DualReviewScore
}): { status: PipelineItemStatus; reasons: string[]; agrees: boolean; dualWouldAuto: boolean } {
  const agrees = dualReviewAgrees(input.a, input.b)
  const dualWouldAuto = combineDualReview(input.a, input.b) === 'AUTO_APPROVED'
  if (!input.fingerprintOk) {
    return {
      status: 'BLOCKED',
      reasons: ['CONTENT_FINGERPRINT_DRIFT', 'NO_AUTO_APPROVED_IN_8_29', 'DRAFT_PERSIST_FROZEN_OFF'],
      agrees,
      dualWouldAuto: false,
    }
  }
  if (input.upstreamStatus === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      reasons: [
        'UPSTREAM_BLOCKED',
        agrees ? 'DUAL_AGREE' : 'DUAL_DISAGREE',
        'NO_AUTO_APPROVED_IN_8_29',
        'DRAFT_PERSIST_FROZEN_OFF',
      ],
      agrees,
      dualWouldAuto: false,
    }
  }
  if (agrees) {
    return {
      status: 'HUMAN_REVIEW',
      reasons: [
        'DUAL_AGREE',
        'IMAGE_COMPARE_NOT_RUN',
        'LATER_GATE_REQUIRED',
        'NO_AUTO_APPROVED_IN_8_29',
        'DRAFT_PERSIST_FROZEN_OFF',
      ],
      agrees,
      dualWouldAuto,
    }
  }
  return {
    status: 'HUMAN_REVIEW',
    reasons: ['DUAL_DISAGREE', 'NO_AUTO_APPROVED_IN_8_29', 'DRAFT_PERSIST_FROZEN_OFF'],
    agrees,
    dualWouldAuto: false,
  }
}

export function reviewCachedItem(cached: Step828CachedItem, gt: GtItem): DualReviewRecord {
  const fingerprintOk = cached.content_fingerprint === fingerprintGtItem(gt)
  const a = scoreCheckerA(gt)
  const b = scoreCheckerB(gt)
  const mapped = mapDualToPipeline({
    upstreamStatus: cached.status,
    fingerprintOk,
    a,
    b,
  })
  return {
    candidate_id: cached.candidate_id,
    stage: STAGE,
    status: mapped.status,
    reasons: mapped.reasons,
    source_document_id: STEP829_DOCUMENT,
    page_number: cached.page_number,
    problem_number: cached.problem_number,
    content_fingerprint: cached.content_fingerprint,
    checker_a: a,
    checker_b: b,
    agrees: mapped.agrees,
    dual_would_auto: mapped.dualWouldAuto,
    diffs: fieldDiffs(a, b),
    upstream_status: cached.status,
  }
}

export function evaluateDryRun(input: {
  inventory: DualInventory
  problemPersistRequested: boolean
  paidApiRequested: boolean
  mixedTextbook: boolean
}): DryRunResult {
  const blockers: string[] = []
  if (!input.inventory.step828_items_present || input.inventory.step828_count === 0) {
    blockers.push('STEP828_CACHE_MISSING')
  }
  if (input.inventory.step828_items_present && input.inventory.step828_count !== EXPECTED_GT_COUNT) {
    blockers.push('STEP828_COUNT_MISMATCH')
  }
  if (!input.inventory.gt_present || input.inventory.gt_count === 0) blockers.push('GT_CACHE_MISSING')
  if (input.inventory.gt_present && input.inventory.gt_count !== EXPECTED_GT_COUNT) blockers.push('GT_COUNT_MISMATCH')
  if (input.inventory.gt_present && input.inventory.gt_sha256 !== STEP828_GT_SHA256) blockers.push('GT_HASH_MISMATCH')
  if (input.inventory.mutated) blockers.push('GT_MUTATED')
  if (input.mixedTextbook) blockers.push('MIXED_TEXTBOOK')
  if (input.problemPersistRequested) blockers.push('PROBLEM_PERSIST_ENABLED')
  if (input.paidApiRequested) blockers.push('PAID_OCR_FLAG')

  const pass = blockers.length === 0
  return {
    pass,
    blockers,
    textbook: { id: STEP829_DOCUMENT, title: STEP829_DOCUMENT_TITLE },
    source_id: STEP829_DOCUMENT,
    cached_items: input.inventory.step828_count,
    review_targets: pass ? EXPECTED_GT_COUNT : 0,
    expected_pipeline_runs: 0,
    expected_pipeline_items: 0,
    problem_production_writes: 0,
    draft_persist: false,
    ocr_network_calls: 0,
    original_pdf_required: false,
  }
}

export function progressFromItems(items: DualReviewRecord[]): PipelineProgress {
  return {
    ...summarizeProgress(items.map((row) => row.status)),
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function progressMatchesItems(progress: PipelineProgress, items: DualReviewRecord[]): boolean {
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

export function findDuplicateCandidateIds(items: DualReviewRecord[]): string[] {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of items) {
    if (seen.has(row.candidate_id)) dup.push(row.candidate_id)
    seen.add(row.candidate_id)
  }
  return dup
}

export function findOrphanItems(items: DualReviewRecord[], runSourceId: string): DualReviewRecord[] {
  return items.filter((row) => row.source_document_id !== runSourceId)
}

export function findWrongSourceItems(items: DualReviewRecord[]): DualReviewRecord[] {
  return items.filter((row) => row.source_document_id !== STEP829_DOCUMENT)
}

export function assertNoAutoApproved(items: DualReviewRecord[]): void {
  if (items.some((row) => row.status === 'AUTO_APPROVED')) {
    throw new Error('STEP 8.29 must not set AUTO_APPROVED')
  }
  if (!(PIPELINE_ITEM_STATUSES as readonly string[]).includes('HUMAN_REVIEW')) {
    throw new Error('frozen statuses missing HUMAN_REVIEW')
  }
}

export function assertNoGoldVerify(items: DualReviewRecord[]): void {
  for (const row of items) {
    const gold = mapToGoldStandard(row.status)
    if (gold.mayVerify) throw new Error('STEP 8.29 must never verify')
    if (gold.review === 'VERIFIED') throw new Error('STEP 8.29 must never set VERIFIED')
  }
}

export function tallyDual(items: DualReviewRecord[]): { agree: number; disagree: number; dual_would_auto: number } {
  return {
    agree: items.filter((row) => row.agrees).length,
    disagree: items.filter((row) => !row.agrees).length,
    dual_would_auto: items.filter((row) => row.dual_would_auto).length,
  }
}

export function projectStep829Targets(input: {
  dryRun: DryRunResult
  executed: boolean
  originalPdfPresent: boolean
  originalPdfIsSecondBook: boolean
}): Step829Target[] {
  const cacheBlocked =
    input.dryRun.blockers.includes('STEP828_CACHE_MISSING') ||
    input.dryRun.blockers.includes('STEP828_COUNT_MISMATCH') ||
    input.dryRun.blockers.includes('GT_CACHE_MISSING') ||
    input.dryRun.blockers.includes('GT_COUNT_MISMATCH') ||
    input.dryRun.blockers.includes('GT_HASH_MISMATCH') ||
    input.dryRun.blockers.includes('GT_MUTATED')
  const targets: Step829Target[] = [
    {
      id: 'target.lock',
      kind: 'TARGET',
      verdict: 'PASS',
      reasons: ['SSEN_DOCUMENT_LOCKED', STEP829_DOCUMENT],
    },
    {
      id: 'cache.step828',
      kind: 'CACHE',
      verdict: cacheBlocked ? 'BLOCKED' : 'PASS',
      reasons: cacheBlocked
        ? input.dryRun.blockers.filter((row) => row.startsWith('STEP828_') || row.startsWith('GT_'))
        : ['STEP828_CACHE_PRESENT', `STEP_${STEP828}`],
    },
    {
      id: 'execute.dual',
      kind: 'EXECUTE',
      verdict: input.executed ? 'PASS' : 'BLOCKED',
      reasons: input.executed ? ['CACHE_ONLY_DUAL_ONCE'] : ['DRY_RUN_BLOCKED_NO_EXECUTE'],
    },
    {
      id: 'full_textbook',
      kind: 'TEXTBOOK',
      verdict: 'BLOCKED',
      reasons: ['OUT_OF_SCOPE_STEP_8_29', 'TWENTY_SIX_CACHED_SAMPLES_ONLY'],
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
      verdict: 'BLOCKED',
      reasons: input.originalPdfIsSecondBook
        ? ['WRONG_BOOK', 'NO_SUBSTITUTE', 'NOT_REQUIRED_FOR_CACHE_ONLY']
        : input.originalPdfPresent
          ? ['NOT_USED', 'NO_SUBSTITUTE', 'NOT_REQUIRED_FOR_CACHE_ONLY']
          : ['ORIGINAL_PDF_ABSENT', 'NO_SUBSTITUTE', 'NOT_REQUIRED_FOR_CACHE_ONLY'],
    },
    {
      id: 'mixed_source',
      kind: 'MIXED_SOURCE',
      verdict: 'PASS',
      reasons: ['SECOND_BOOK_EXCLUDED', SECOND_DOCUMENT, SECOND_PDF_SHA256],
    },
    {
      id: 'problem_writes',
      kind: 'WRITES',
      verdict: 'PASS',
      reasons: ['PROBLEM_PRODUCTION_WRITES_ZERO'],
    },
    {
      id: 'draft_persist_denied',
      kind: 'DRAFTS',
      verdict: 'PASS',
      reasons: ['THIS_FREEZE_DOES_NOT_ALLOW_DRAFTS'],
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
        'OUT_OF_SCOPE_STEP_8_29',
      ],
    })
  }
  return targets
}

export function tallyVerdicts(targets: Step829Target[]): Record<Step829Verdict, number> {
  return {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
}

export const STEP829_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  nextStepStarted: false,
  frozen: FROZEN_PIPELINE_COUNTS,
  draftPersist: false,
  goldVerify: false,
  figureOwnershipMin: FIGURE_OWNERSHIP_MIN,
} as const
