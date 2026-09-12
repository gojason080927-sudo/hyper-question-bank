/**
 * STEP 8.30 — original-image compare gate on cached STEP 8.28 / 8.29 / STEP 7 crops.
 * Implements docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J row 8.30.
 * Missing original or crop → BLOCKED, never PASS. No paid OCR. AUTO_APPROVED only if §D holds.
 */

import {
  FROZEN_PIPELINE_COUNTS,
  PIPELINE_ITEM_STATUSES,
  QUESTION_BANK_REF,
  STEP824_BLOCKED_CANDIDATE_IDS,
  STEP825_SAFETY,
  STUDENT_CARE_REF,
  authorizePaidOcr,
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
  SECOND_SAMPLE_PAGES_DIR,
  SSEN_FIGURE_PAGES_DIR,
} from './cacheSegment827'
import {
  STEP829,
  STEP829_DIR,
  type Step828CachedItem,
} from './dualAiReview829'
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

export const STEP830 = '8.30'
export const STEP830_DIR = 'ocr-tests/taxonomy/step8-30'
export const ASSIGNED_BY = 'STEP_8_30'
export const STAGE: PipelineStage = 'IMAGE_COMPARE'
export const STEP828_ITEMS_PATH = `${STEP828_DIR}/items.json`
export const STEP829_REVIEWS_PATH = `${STEP829_DIR}/reviews.json`
export const STEP830_PAID_OCR_CAP = { maxCalls: 0, maxUsd: 0 } as const
export const STEP7_CROP_DIR = 'workers/ocr/data/crops'
export const SSEN_FIGURE_CROPS_DIR = 'ocr-tests/taxonomy/step8-22/crops'
export const ORIGINAL_PAGES_DIR = 'ocr-tests/original'
export const BOOK_PIPELINE_PAGES_DIR = 'ocr-tests/book-pipeline/pages'

export const STEP830_DOCUMENT = STEP828_DOCUMENT
export const STEP830_DOCUMENT_TITLE = STEP828_DOCUMENT_TITLE

export type Step830Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type CompareCheck = 'PASS' | 'FAIL' | 'NOT_COMPARED'

export type Step830Target = {
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
    | 'CROPS'
  verdict: Step830Verdict
  reasons: string[]
}

export type ManifestBbox = {
  x: number
  y: number
  width: number
  height: number
  unit: string
  origin: string
}

export type ManifestSample = {
  sample_id: string
  document_id: string
  page_number: number
  bbox: ManifestBbox
  crop_file: string
  crop_sha256: string
  crop_bytes: number
}

export type Step829ReviewInput = {
  candidate_id: string
  status: PipelineItemStatus
  agrees: boolean
  dual_would_auto: boolean
  checker_a: DualReviewScore
  checker_b: DualReviewScore
  reasons: string[]
}

export type FileEvidence = {
  present: boolean
  path: string | null
  sha256: string | null
  bytes: number | null
  sha256_match: boolean | null
  substituted: false
  used_as_crop: boolean
  source_kind:
    | 'step7_crop'
    | 'ssen_figure_page'
    | 'original_page'
    | 'book_pipeline_page'
    | 'figure_crop'
    | 'second_page'
    | null
}

export type VisualChecks = {
  identity: CompareCheck
  stem: CompareCheck
  choices: CompareCheck
  math: CompareCheck
  figure: CompareCheck
  boundary: CompareCheck
}

export type ImageCompareRecord = {
  candidate_id: string
  stage: PipelineStage
  status: PipelineItemStatus
  reasons: string[]
  source_document_id: string
  page_number: number
  problem_number: string | null
  content_fingerprint: string
  crop: FileEvidence
  page_png: FileEvidence
  bbox_valid: boolean
  declared_bbox_overlap: boolean
  checks: VisualChecks
  compared: boolean
  image_compare_pass: boolean
  dual_agrees: boolean
  dual_would_auto: boolean
  upstream_status: PipelineItemStatus
  dual_status: PipelineItemStatus
  has_figure: boolean
  has_table: boolean
  choice_count: number
}

export type CompareInventory = {
  step828_items_present: boolean
  step828_count: number
  step829_reviews_present: boolean
  step829_count: number
  gt_present: boolean
  gt_count: number
  gt_sha256: string | null
  gt_sha256_after: string | null
  mutated: false | true
  manifest_present: boolean
  manifest_count: number
  crop_present: number
  crop_missing: number
  page_png_present: number
  page_png_missing: number
  figure_crops_inventoried: number
  second_pages_inventoried: number
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
  compare_targets: number
  expected_pipeline_runs: 0
  expected_pipeline_items: 0
  problem_production_writes: 0
  draft_persist: false
  ocr_network_calls: 0
  original_pdf_required: false
}

export type CompareTally = {
  crop_present: number
  crop_missing: number
  page_png_present: number
  page_png_missing: number
  compared: number
  not_compared: number
  auto_approved: number
  human_review: number
  blocked: number
}

const NOT_COMPARED_CHECKS: VisualChecks = {
  identity: 'NOT_COMPARED',
  stem: 'NOT_COMPARED',
  choices: 'NOT_COMPARED',
  math: 'NOT_COMPARED',
  figure: 'NOT_COMPARED',
  boundary: 'NOT_COMPARED',
}

export function denyPaidOcr830(): { authorized: false; reason: string } {
  const decision = authorizePaidOcr({
    providerConfigured: false,
    estimatedCalls: 0,
    estimatedUsd: 0,
    cacheOnly: true,
    allowPaidApi: false,
    confirmCost: false,
    paidRoutingEnabled: false,
    stepMaxCalls: STEP830_PAID_OCR_CAP.maxCalls,
    stepMaxUsd: STEP830_PAID_OCR_CAP.maxUsd,
  })
  return { authorized: false, reason: decision.reason }
}

export function emptyCompareInventory(): CompareInventory {
  return {
    step828_items_present: false,
    step828_count: 0,
    step829_reviews_present: false,
    step829_count: 0,
    gt_present: false,
    gt_count: 0,
    gt_sha256: null,
    gt_sha256_after: null,
    mutated: false,
    manifest_present: false,
    manifest_count: 0,
    crop_present: 0,
    crop_missing: 0,
    page_png_present: 0,
    page_png_missing: 0,
    figure_crops_inventoried: 0,
    second_pages_inventoried: 0,
    original_pdf: {
      present: false,
      path: null,
      sha256: null,
      is_second_book: false,
      substituted: false,
    },
  }
}

export function emptyFileEvidence(): FileEvidence {
  return {
    present: false,
    path: null,
    sha256: null,
    bytes: null,
    sha256_match: null,
    substituted: false,
    used_as_crop: false,
    source_kind: null,
  }
}

export function padPage(page: number): string {
  return String(page).padStart(3, '0')
}

export function step7CropPath(cropFile: string): string {
  return `workers/ocr/${cropFile}`
}

export function ssenPagePngPath(page: number): string {
  return `${SSEN_FIGURE_PAGES_DIR}/page-${padPage(page)}.png`
}

export function originalPagePngPath(page: number): string {
  return `${ORIGINAL_PAGES_DIR}/page-${padPage(page)}.png`
}

export function bookPipelinePagePngPath(page: number): string {
  return `${BOOK_PIPELINE_PAGES_DIR}/page-${padPage(page)}.png`
}

export function secondPagePngPath(page: number): string {
  return `${SECOND_SAMPLE_PAGES_DIR}/page-${padPage(page)}.png`
}

export function isForbiddenCropSubstitute(filePath: string): boolean {
  return (
    filePath.includes(`${SSEN_FIGURE_CROPS_DIR}/`) ||
    filePath.includes(`${SECOND_SAMPLE_PAGES_DIR}/`) ||
    filePath.includes(`${SSEN_FIGURE_PAGES_DIR}/`)
  )
}

export function bboxValid(bbox: ManifestBbox): boolean {
  if (bbox.unit !== 'normalized' || bbox.origin !== 'top-left') return false
  if (!(bbox.width > 0) || !(bbox.height > 0)) return false
  if (bbox.x < 0 || bbox.y < 0) return false
  if (bbox.x + bbox.width > 1.001 || bbox.y + bbox.height > 1.001) return false
  return true
}

export function bboxesOverlap(a: ManifestBbox, b: ManifestBbox): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlapX > 1e-6 && overlapY > 1e-6
}

export function parseManifestFile(raw: unknown): { document_id: string; samples: ManifestSample[] } {
  if (!raw || typeof raw !== 'object') throw new Error('STEP 8.30 manifest missing')
  const rec = raw as Record<string, unknown>
  const documentId = typeof rec.document_id === 'string' ? rec.document_id : ''
  if (documentId !== STEP830_DOCUMENT) {
    throw new Error('STEP 8.30 manifest document_id is not SSEN')
  }
  if (!Array.isArray(rec.samples)) throw new Error('STEP 8.30 manifest samples missing')
  const samples: ManifestSample[] = rec.samples.map((row) => {
    const item = row as Record<string, unknown>
    const bbox = item.bbox as Record<string, unknown> | undefined
    if (!bbox) throw new Error('STEP 8.30 manifest sample missing bbox')
    return {
      sample_id: String(item.sample_id ?? ''),
      document_id: String(item.document_id ?? ''),
      page_number: Number(item.page_number),
      bbox: {
        x: Number(bbox.x),
        y: Number(bbox.y),
        width: Number(bbox.width),
        height: Number(bbox.height),
        unit: String(bbox.unit ?? ''),
        origin: String(bbox.origin ?? ''),
      },
      crop_file: String(item.crop_file ?? ''),
      crop_sha256: String(item.crop_sha256 ?? ''),
      crop_bytes: Number(item.crop_bytes ?? 0),
    }
  })
  if (samples.length !== EXPECTED_GT_COUNT) {
    throw new Error(`STEP 8.30 manifest count ${samples.length} !== ${EXPECTED_GT_COUNT}`)
  }
  return { document_id: documentId, samples }
}

export function allVisualCompared(checks: VisualChecks): boolean {
  return (Object.values(checks) as CompareCheck[]).every((row) => row !== 'NOT_COMPARED')
}

export function allVisualPass(checks: VisualChecks): boolean {
  return (Object.values(checks) as CompareCheck[]).every((row) => row === 'PASS')
}

export function mapImageCompareToPipeline(input: {
  fingerprintOk: boolean
  upstreamStatus: PipelineItemStatus
  dualStatus: PipelineItemStatus
  cropPresent: boolean
  cropHashMatch: boolean | null
  pagePresent: boolean
  pageUsedAsCrop: boolean
  substituted: boolean
  imageComparePass: boolean
  dualWouldAuto: boolean
  hasFigure: boolean
}): { status: PipelineItemStatus; reasons: string[] } {
  const reasons: string[] = []
  if (!input.fingerprintOk) reasons.push('CONTENT_FINGERPRINT_DRIFT')
  if (input.upstreamStatus === 'BLOCKED' || input.dualStatus === 'BLOCKED') reasons.push('UPSTREAM_BLOCKED')
  if (input.substituted || input.pageUsedAsCrop) reasons.push('NO_SUBSTITUTE')
  if (!input.cropPresent) reasons.push('CROP_CACHE_MISSING')
  if (input.cropPresent && input.cropHashMatch === false) reasons.push('CROP_HASH_MISMATCH')
  if (!input.pagePresent) reasons.push('ORIGINAL_PAGE_MISSING')
  if (input.pagePresent && !input.cropPresent) reasons.push('PAGE_PNG_NOT_USED_AS_CROP')
  if (input.hasFigure && !input.cropPresent) reasons.push('FIGURE_OWNERSHIP_UNVERIFIED_NO_CROP')
  if (input.cropPresent && input.cropHashMatch === true && !input.imageComparePass) {
    reasons.push('IMAGE_COMPARE_PIXELS_UNREADABLE_WITHOUT_OCR')
  }
  reasons.push('NO_AUTO_APPROVED_UNLESS_SECTION_D')
  reasons.push('DRAFT_PERSIST_FROZEN_OFF')

  if (
    !input.fingerprintOk ||
    input.upstreamStatus === 'BLOCKED' ||
    input.dualStatus === 'BLOCKED' ||
    input.substituted ||
    input.pageUsedAsCrop ||
    !input.cropPresent ||
    input.cropHashMatch === false ||
    !input.pagePresent
  ) {
    return { status: 'BLOCKED', reasons }
  }

  if (input.imageComparePass && input.dualWouldAuto) {
    return { status: 'AUTO_APPROVED', reasons: ['IMAGE_COMPARE_PASS', 'SECTION_D_ALL_MET'] }
  }
  if (input.imageComparePass) {
    return {
      status: 'HUMAN_REVIEW',
      reasons: ['IMAGE_COMPARE_PASS', 'LATER_GATE_REQUIRED', ...reasons],
    }
  }
  return { status: 'HUMAN_REVIEW', reasons }
}

export function compareCachedItem(input: {
  cached: Step828CachedItem
  review: Step829ReviewInput
  gt: GtItem
  sample: ManifestSample
  crop: FileEvidence
  pagePng: FileEvidence
  siblingBboxes: ManifestBbox[]
}): ImageCompareRecord {
  const fingerprintOk = input.cached.content_fingerprint === fingerprintGtItem(input.gt)
  const cropUsable =
    input.crop.present &&
    input.crop.used_as_crop &&
    input.crop.source_kind === 'step7_crop' &&
    !isForbiddenCropSubstitute(input.crop.path ?? '')
  const cropHashMatch = cropUsable ? input.crop.sha256_match : input.crop.present ? false : null
  const visualPossible =
    cropUsable && cropHashMatch === true && input.pagePng.present && !input.pagePng.used_as_crop
  const checks: VisualChecks = visualPossible
    ? {
        // Paid OCR / vision is forbidden. Hash+page presence is not a visual PASS.
        identity: 'NOT_COMPARED',
        stem: 'NOT_COMPARED',
        choices: 'NOT_COMPARED',
        math: 'NOT_COMPARED',
        figure: 'NOT_COMPARED',
        boundary: 'NOT_COMPARED',
      }
    : { ...NOT_COMPARED_CHECKS }
  const compared = allVisualCompared(checks)
  const imageComparePass = compared && allVisualPass(checks) && cropHashMatch === true && cropUsable
  const declaredOverlap = input.siblingBboxes.some((bbox) => bboxesOverlap(input.sample.bbox, bbox))
  const mapped = mapImageCompareToPipeline({
    fingerprintOk,
    upstreamStatus: input.cached.status,
    dualStatus: input.review.status,
    cropPresent: cropUsable,
    cropHashMatch,
    pagePresent: input.pagePng.present,
    pageUsedAsCrop: input.pagePng.used_as_crop || input.crop.source_kind === 'ssen_figure_page',
    substituted: input.crop.substituted || input.pagePng.substituted,
    imageComparePass,
    dualWouldAuto: input.review.dual_would_auto,
    hasFigure: input.gt.has_figure,
  })
  return {
    candidate_id: input.cached.candidate_id,
    stage: STAGE,
    status: mapped.status,
    reasons: mapped.reasons,
    source_document_id: STEP830_DOCUMENT,
    page_number: input.cached.page_number,
    problem_number: input.cached.problem_number,
    content_fingerprint: input.cached.content_fingerprint,
    crop: input.crop,
    page_png: input.pagePng,
    bbox_valid: bboxValid(input.sample.bbox),
    declared_bbox_overlap: declaredOverlap,
    checks,
    compared,
    image_compare_pass: imageComparePass,
    dual_agrees: input.review.agrees,
    dual_would_auto: input.review.dual_would_auto,
    upstream_status: input.cached.status,
    dual_status: input.review.status,
    has_figure: input.gt.has_figure,
    has_table: input.gt.has_table,
    choice_count: input.cached.choice_count,
  }
}

export function evaluateDryRun(input: {
  inventory: CompareInventory
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
  if (!input.inventory.step829_reviews_present || input.inventory.step829_count === 0) {
    blockers.push('STEP829_CACHE_MISSING')
  }
  if (input.inventory.step829_reviews_present && input.inventory.step829_count !== EXPECTED_GT_COUNT) {
    blockers.push('STEP829_COUNT_MISMATCH')
  }
  if (!input.inventory.gt_present || input.inventory.gt_count === 0) blockers.push('GT_CACHE_MISSING')
  if (input.inventory.gt_present && input.inventory.gt_count !== EXPECTED_GT_COUNT) blockers.push('GT_COUNT_MISMATCH')
  if (input.inventory.gt_present && input.inventory.gt_sha256 !== STEP828_GT_SHA256) blockers.push('GT_HASH_MISMATCH')
  if (input.inventory.mutated) blockers.push('GT_MUTATED')
  if (!input.inventory.manifest_present || input.inventory.manifest_count !== EXPECTED_GT_COUNT) {
    blockers.push('MANIFEST_CACHE_MISSING')
  }
  if (input.mixedTextbook) blockers.push('MIXED_TEXTBOOK')
  if (input.problemPersistRequested) blockers.push('PROBLEM_PERSIST_ENABLED')
  if (input.paidApiRequested) blockers.push('PAID_OCR_FLAG')

  const pass = blockers.length === 0
  return {
    pass,
    blockers,
    textbook: { id: STEP830_DOCUMENT, title: STEP830_DOCUMENT_TITLE },
    source_id: STEP830_DOCUMENT,
    cached_items: input.inventory.step828_count,
    review_targets: input.inventory.step829_count,
    compare_targets: pass ? EXPECTED_GT_COUNT : 0,
    expected_pipeline_runs: 0,
    expected_pipeline_items: 0,
    problem_production_writes: 0,
    draft_persist: false,
    ocr_network_calls: 0,
    original_pdf_required: false,
  }
}

export function progressFromItems(items: ImageCompareRecord[]): PipelineProgress {
  return {
    ...summarizeProgress(items.map((row) => row.status)),
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function progressMatchesItems(progress: PipelineProgress, items: ImageCompareRecord[]): boolean {
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

export function findDuplicateCandidateIds(items: ImageCompareRecord[]): string[] {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of items) {
    if (seen.has(row.candidate_id)) dup.push(row.candidate_id)
    seen.add(row.candidate_id)
  }
  return dup
}

export function findOrphanItems(items: ImageCompareRecord[], runSourceId: string): ImageCompareRecord[] {
  return items.filter((row) => row.source_document_id !== runSourceId)
}

export function findWrongSourceItems(items: ImageCompareRecord[]): ImageCompareRecord[] {
  return items.filter((row) => row.source_document_id !== STEP830_DOCUMENT)
}

export function assertNoAutoApprovedUnlessSectionD(items: ImageCompareRecord[]): void {
  for (const row of items) {
    if (row.status === 'AUTO_APPROVED' && !row.image_compare_pass) {
      throw new Error('STEP 8.30 must not AUTO_APPROVE without image_compare_pass')
    }
  }
  if (!(PIPELINE_ITEM_STATUSES as readonly string[]).includes('BLOCKED')) {
    throw new Error('frozen statuses missing BLOCKED')
  }
}

export function assertNoGoldVerify(items: ImageCompareRecord[]): void {
  for (const row of items) {
    const gold = mapToGoldStandard(row.status)
    if (gold.mayVerify) throw new Error('STEP 8.30 must never verify')
    if (gold.review === 'VERIFIED') throw new Error('STEP 8.30 must never set VERIFIED')
  }
}

export function assertNoContentRewrite(items: ImageCompareRecord[], gtById: Map<string, GtItem>): void {
  for (const row of items) {
    const gt = gtById.get(row.candidate_id)
    if (!gt) throw new Error(`STEP 8.30 missing GT for ${row.candidate_id}`)
    if (row.content_fingerprint !== fingerprintGtItem(gt) && !row.reasons.includes('CONTENT_FINGERPRINT_DRIFT')) {
      throw new Error(`STEP 8.30 content rewrite for ${row.candidate_id}`)
    }
  }
}

export function tallyCompare(items: ImageCompareRecord[]): CompareTally {
  return {
    crop_present: items.filter((row) => row.crop.present && row.crop.used_as_crop).length,
    crop_missing: items.filter((row) => !(row.crop.present && row.crop.used_as_crop)).length,
    page_png_present: items.filter((row) => row.page_png.present).length,
    page_png_missing: items.filter((row) => !row.page_png.present).length,
    compared: items.filter((row) => row.compared).length,
    not_compared: items.filter((row) => !row.compared).length,
    auto_approved: items.filter((row) => row.status === 'AUTO_APPROVED').length,
    human_review: items.filter((row) => row.status === 'HUMAN_REVIEW').length,
    blocked: items.filter((row) => row.status === 'BLOCKED').length,
  }
}

export function projectStep830Targets(input: {
  dryRun: DryRunResult
  executed: boolean
  originalPdfPresent: boolean
  originalPdfIsSecondBook: boolean
  cropPresent: number
}): Step830Target[] {
  const step828Blocked = input.dryRun.blockers.some((row) => row.startsWith('STEP828_'))
  const step829Blocked = input.dryRun.blockers.some((row) => row.startsWith('STEP829_'))
  const targets: Step830Target[] = [
    {
      id: 'target.lock',
      kind: 'TARGET',
      verdict: 'PASS',
      reasons: ['SSEN_DOCUMENT_LOCKED', STEP830_DOCUMENT],
    },
    {
      id: 'cache.step828',
      kind: 'CACHE',
      verdict: step828Blocked ? 'BLOCKED' : 'PASS',
      reasons: step828Blocked
        ? input.dryRun.blockers.filter((row) => row.startsWith('STEP828_'))
        : ['STEP828_CACHE_PRESENT', `STEP_${STEP828}`],
    },
    {
      id: 'cache.step829',
      kind: 'CACHE',
      verdict: step829Blocked ? 'BLOCKED' : 'PASS',
      reasons: step829Blocked
        ? input.dryRun.blockers.filter((row) => row.startsWith('STEP829_'))
        : ['STEP829_CACHE_PRESENT', `STEP_${STEP829}`],
    },
    {
      id: 'execute.compare',
      kind: 'EXECUTE',
      verdict: input.executed ? 'PASS' : 'BLOCKED',
      reasons: input.executed ? ['CACHE_ONLY_COMPARE_ONCE'] : ['DRY_RUN_BLOCKED_NO_EXECUTE'],
    },
    {
      id: 'full_textbook',
      kind: 'TEXTBOOK',
      verdict: 'BLOCKED',
      reasons: ['OUT_OF_SCOPE_STEP_8_30', 'TWENTY_SIX_CACHED_SAMPLES_ONLY'],
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
        ? ['WRONG_BOOK', 'NO_SUBSTITUTE', 'NOT_DOWNLOADED']
        : input.originalPdfPresent
          ? ['NOT_USED', 'NO_SUBSTITUTE', 'NOT_DOWNLOADED']
          : ['ORIGINAL_PDF_ABSENT', 'NO_SUBSTITUTE', 'NOT_DOWNLOADED'],
    },
    {
      id: 'step7_crops',
      kind: 'CROPS',
      verdict: input.cropPresent === EXPECTED_GT_COUNT ? 'PASS' : 'BLOCKED',
      reasons:
        input.cropPresent === EXPECTED_GT_COUNT
          ? ['STEP7_CROPS_PRESENT']
          : ['CROP_CACHE_MISSING', 'NO_SUBSTITUTE', `PRESENT_${input.cropPresent}_OF_${EXPECTED_GT_COUNT}`],
    },
    {
      id: 'mixed_source',
      kind: 'MIXED_SOURCE',
      verdict: 'PASS',
      reasons: [
        'SECOND_BOOK_EXCLUDED',
        SECOND_DOCUMENT,
        SECOND_PDF_SHA256,
        'FIGURE_CROPS_NOT_SUBSTITUTED',
        'SSEN_PAGE_PNG_NOT_USED_AS_CROP',
      ],
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
      reasons: ['THIS_FREEZE_DOES_NOT_ALLOW_DRAFTS', 'STEP_8_31_NOT_STARTED'],
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
        'OUT_OF_SCOPE_STEP_8_30',
      ],
    })
  }
  return targets
}

export function tallyVerdicts(targets: Step830Target[]): Record<Step830Verdict, number> {
  return {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
}

export const STEP830_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  nextStepStarted: false,
  frozen: FROZEN_PIPELINE_COUNTS,
  draftPersist: false,
  goldVerify: false,
  paidOcrCap: STEP830_PAID_OCR_CAP,
} as const
