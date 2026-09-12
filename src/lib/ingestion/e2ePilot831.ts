/**
 * STEP 8.31 — end-to-end pilot: recover SSEN original, crop S01–S26, OCR, compare, queue review.
 * Production DRAFT persist is idempotent and never sets VERIFIED.
 */

import { canonicalizeProblemNumber } from '../recognition/draftUpsert'
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STEP824_BLOCKED_CANDIDATE_IDS,
  STEP825_SAFETY,
  STUDENT_CARE_REF,
  mapToGoldStandard,
  summarizeProgress,
  type PipelineItemStatus,
  type PipelineProgress,
  type PipelineStage,
} from './batchPipeline825'
import { SECOND_DOCUMENT, SECOND_PDF_SHA256 } from './cacheSegment827'
import type { Step829ReviewInput } from './imageCompare830'
import {
  EXPECTED_GT_COUNT,
  STEP828_DOCUMENT,
  STEP828_DOCUMENT_TITLE,
  STEP828_GT_SHA256,
  STEP828_SSEN_FILE_HASH,
  fingerprintGtItem,
  type GtItem,
} from './structureFromCache828'

export const STEP831 = '8.31'
export const STEP831_DIR = 'ocr-tests/taxonomy/step8-31'
export const ASSIGNED_BY = 'STEP_8_31'
export const STAGE: PipelineStage = 'QUEUE_HUMAN'
export const STEP831_DOCUMENT = STEP828_DOCUMENT
export const STEP831_DOCUMENT_TITLE = STEP828_DOCUMENT_TITLE
export const STEP831_PDF_SHA256 = STEP828_SSEN_FILE_HASH
export const STEP831_PAGE_COUNT = 192
export const STEP831_PAID_OCR_CAP = { maxCalls: 30, maxUsd: 2 } as const
export const MISTRAL_OCR_USD_PER_IMAGE = 0.004
export const STORAGE_BUCKET = 'question-bank-sources'
export const STORAGE_ORIGINAL = `${STEP831_DOCUMENT}/original.pdf`
export const CROP_CACHE_DIR = '.ocr-temp/step8-31'
export const GT_JSON_SHA256 = STEP828_GT_SHA256
export const STEP7_CROPSET_LABEL = 'bfd939311e7d5a6a8f627bc6fb9adaeb28443ae7b3d60898de5c7942acb70fae'

export type CompareCheck = 'PASS' | 'FAIL' | 'NOT_COMPARED'
export type PersistAction = 'CREATE_DRAFT' | 'RECORD_EXISTING' | 'SKIP_BLOCKED' | 'SKIP_IDENTITY'

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
}

export type OcrEvidence = {
  present: boolean
  provider: 'mistral-ocr' | null
  text: string
  http: number | null
  cached: boolean
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

export type PilotItem = {
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
  dual_would_auto: boolean
  upstream_status: PipelineItemStatus
  persist_action: PersistAction
  existing: ExistingDraft | null
  has_figure: boolean
  has_table: boolean
  choice_count: number
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const
const NEIGHBOR_RE = /소개기|논이기|본이기/

export function estimateMistralUsd(calls: number): number {
  return Number((Math.max(0, calls) * MISTRAL_OCR_USD_PER_IMAGE).toFixed(4))
}

export function authorizePilotPaidOcr(input: {
  estimatedCalls: number
  allowPaidApi: boolean
  confirmCost: boolean
  cacheOnly: boolean
}): { authorized: boolean; reason: string; estimatedUsd: number } {
  const estimatedUsd = estimateMistralUsd(input.estimatedCalls)
  if (input.cacheOnly) return { authorized: false, reason: 'CACHE_ONLY', estimatedUsd }
  if (!input.allowPaidApi || !input.confirmCost) return { authorized: false, reason: 'PAID_GATE_DENIED', estimatedUsd }
  if (estimatedUsd > STEP831_PAID_OCR_CAP.maxUsd) {
    return { authorized: false, reason: 'COST_EXCEEDS_CAP', estimatedUsd }
  }
  if (input.estimatedCalls > STEP831_PAID_OCR_CAP.maxCalls) {
    return { authorized: false, reason: 'CALLS_EXCEED_CAP', estimatedUsd }
  }
  return { authorized: true, reason: 'PILOT_CAP_OK', estimatedUsd }
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

export function compareOcrToGt(gt: GtItem, ocrText: string): VisualChecks {
  if (!ocrText.trim()) {
    return {
      identity: 'NOT_COMPARED',
      stem: 'NOT_COMPARED',
      choices: 'NOT_COMPARED',
      math: 'NOT_COMPARED',
      figure: 'NOT_COMPARED',
      boundary: 'NOT_COMPARED',
    }
  }
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
    gt.ground_truth_choices.length === 0
      ? 'PASS'
      : marks === gt.ground_truth_choices.length
        ? 'PASS'
        : 'FAIL'
  let mathHits = 0
  for (const expr of gt.ground_truth_math) {
    const token = normalizeCompareText(expr).slice(0, 12)
    if (token && nOcr.includes(token)) mathHits += 1
  }
  const math: CompareCheck =
    gt.ground_truth_math.length === 0 ? 'PASS' : mathHits / gt.ground_truth_math.length >= 0.34 ? 'PASS' : 'FAIL'
  const figure: CompareCheck = gt.has_figure
    ? /그림|도형|graph|triangle|반원|포물선/i.test(ocrText) || (ocrText.includes('그림') ? true : false)
      ? 'PASS'
      : 'FAIL'
    : 'PASS'
  const boundary: CompareCheck = NEIGHBOR_RE.test(ocrText) ? 'FAIL' : 'PASS'
  return { identity, stem, choices, math, figure, boundary }
}

export function imageComparePass(checks: VisualChecks, compared: boolean): boolean {
  if (!compared) return false
  return (
    checks.identity === 'PASS' &&
    checks.stem === 'PASS' &&
    checks.choices === 'PASS' &&
    checks.math === 'PASS' &&
    checks.figure === 'PASS'
  )
}

export function mapPilotStatus(input: {
  upstreamBlocked: boolean
  cropPresent: boolean
  ocrPresent: boolean
  compared: boolean
  imageComparePass: boolean
  canonical: string | null
  problemNumber: string | null
}): { status: PipelineItemStatus; persist: PersistAction; reasons: string[] } {
  const reasons: string[] = []
  if (input.upstreamBlocked || !input.problemNumber) {
    reasons.push('UPSTREAM_IDENTITY_UNSTABLE')
    if (!input.cropPresent) reasons.push('CROP_CACHE_MISSING')
    reasons.push('NO_VERIFIED', 'DRAFT_CONTENT_NOT_REWRITTEN')
    return { status: 'BLOCKED', persist: 'SKIP_BLOCKED', reasons }
  }
  if (!input.cropPresent) {
    reasons.push('CROP_CACHE_MISSING', 'NO_VERIFIED')
    return { status: 'BLOCKED', persist: 'SKIP_BLOCKED', reasons }
  }
  if (!input.ocrPresent) {
    reasons.push('OCR_MISSING', 'NO_VERIFIED')
    return { status: 'BLOCKED', persist: 'SKIP_BLOCKED', reasons }
  }
  if (!input.canonical) {
    reasons.push('IDENTITY_NOT_CANONICAL', 'COMPARED_NO_PRODUCTION_UPSERT', 'NO_VERIFIED')
    return { status: 'HUMAN_REVIEW', persist: 'SKIP_IDENTITY', reasons }
  }
  reasons.push('QUEUED_HUMAN_REVIEW', 'CONSERVATIVE_NO_AUTO_APPROVED', 'NO_VERIFIED')
  if (!input.imageComparePass) reasons.push('IMAGE_COMPARE_PARTIAL')
  return { status: 'HUMAN_REVIEW', persist: 'CREATE_DRAFT', reasons }
}

export function buildPilotItem(input: {
  gt: GtItem
  cachedStatus: PipelineItemStatus
  review: Step829ReviewInput
  crop: RecoveredCrop
  ocr: OcrEvidence
  existing: ExistingDraft | null
}): PilotItem {
  const checks = compareOcrToGt(input.gt, input.ocr.text)
  const compared = Boolean(input.crop.present && input.ocr.present && input.ocr.text.trim().length > 20)
  const pass = imageComparePass(checks, compared)
  const canonical = canonicalizeProblemNumber(input.gt.problem_number)
  const mapped = mapPilotStatus({
    upstreamBlocked: input.cachedStatus === 'BLOCKED' || !input.gt.problem_number,
    cropPresent: input.crop.present,
    ocrPresent: input.ocr.present,
    compared,
    imageComparePass: pass,
    canonical,
    problemNumber: input.gt.problem_number,
  })
  let persist = mapped.persist
  if (persist === 'CREATE_DRAFT' && input.existing) persist = 'RECORD_EXISTING'
  const reasons = [...mapped.reasons]
  if (persist === 'RECORD_EXISTING') reasons.unshift('EXISTING_PRODUCTION_DRAFT')
  if (persist === 'CREATE_DRAFT') reasons.unshift('NEW_IDENTITY_MAY_PERSIST')
  return {
    candidate_id: input.gt.sample_id,
    stage: STAGE,
    status: mapped.status,
    reasons,
    source_document_id: STEP831_DOCUMENT,
    page_number: input.gt.page_number,
    problem_number: input.gt.problem_number,
    canonical_number: canonical,
    content_fingerprint: fingerprintGtItem(input.gt),
    crop: input.crop,
    ocr: {
      present: input.ocr.present,
      cached: input.ocr.cached,
      http: input.ocr.http,
      text_len: input.ocr.text.length,
    },
    checks,
    compared,
    image_compare_pass: pass,
    dual_would_auto: input.review.dual_would_auto,
    upstream_status: input.cachedStatus,
    persist_action: persist,
    existing: input.existing,
    has_figure: input.gt.has_figure,
    has_table: input.gt.has_table,
    choice_count: input.gt.ground_truth_choices.length,
  }
}

export function persistPlanSafe(items: PilotItem[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const creates = items.filter((row) => row.persist_action === 'CREATE_DRAFT')
  const ids = new Set<string>()
  for (const row of items) {
    const key = `${row.page_number}|${row.canonical_number ?? ''}`
    if (row.canonical_number) {
      if (ids.has(key)) reasons.push(`DUP_PLAN_${row.candidate_id}`)
      ids.add(key)
    }
    if (row.status === 'AUTO_APPROVED') reasons.push(`AUTO_FORBIDDEN_${row.candidate_id}`)
    const gold = mapToGoldStandard(row.status)
    if (gold.mayVerify) reasons.push(`VERIFY_FORBIDDEN_${row.candidate_id}`)
  }
  for (const row of creates) {
    if (row.existing) reasons.push(`CREATE_WOULD_COLLIDE_${row.candidate_id}`)
    if (!row.canonical_number) reasons.push(`CREATE_WITHOUT_IDENTITY_${row.candidate_id}`)
  }
  return { ok: reasons.length === 0, reasons }
}

export function progressFromItems(items: PilotItem[]): PipelineProgress {
  return {
    ...summarizeProgress(items.map((row) => row.status)),
    estimated_paid_calls: EXPECTED_GT_COUNT,
    estimated_usd: estimateMistralUsd(EXPECTED_GT_COUNT),
    actual_paid_calls: items.filter((row) => row.ocr.present).length,
    actual_usd: estimateMistralUsd(items.filter((row) => row.ocr.present).length),
  }
}

export function tallyPilot(items: PilotItem[]) {
  return {
    crop_present: items.filter((row) => row.crop.present).length,
    crop_missing: items.filter((row) => !row.crop.present).length,
    compared: items.filter((row) => row.compared).length,
    auto_approved: items.filter((row) => row.status === 'AUTO_APPROVED').length,
    human_review: items.filter((row) => row.status === 'HUMAN_REVIEW').length,
    blocked: items.filter((row) => row.status === 'BLOCKED').length,
    create_draft: items.filter((row) => row.persist_action === 'CREATE_DRAFT').length,
    record_existing: items.filter((row) => row.persist_action === 'RECORD_EXISTING').length,
    skip_blocked: items.filter((row) => row.persist_action === 'SKIP_BLOCKED').length,
    skip_identity: items.filter((row) => row.persist_action === 'SKIP_IDENTITY').length,
  }
}

export const STEP831_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  secondDocument: SECOND_DOCUMENT,
  secondPdfSha256: SECOND_PDF_SHA256,
  frozen: FROZEN_PIPELINE_COUNTS,
  carryOver: STEP824_BLOCKED_CANDIDATE_IDS,
  neverVerified: true,
} as const
