/**
 * STEP 8.27 — cache-only batch segmentation on one already-stored textbook.
 * Implements docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J row 8.27.
 * No new problems. No paid OCR. AUTO_OK is not AUTO_APPROVED.
 */

import {
  FROZEN_PIPELINE_COUNTS,
  PIPELINE_ITEM_STATUSES,
  QUESTION_BANK_REF,
  STEP824_BLOCKED_CANDIDATE_IDS,
  STEP825_SAFETY,
  STUDENT_CARE_REF,
  authorizePaidOcr,
  summarizeProgress,
  type PipelineItemStatus,
  type PipelineProgress,
  type PipelineStage,
} from './batchPipeline825'
import type { SegmentStatus } from '../recognition/layoutSegment'

export const STEP827 = '8.27'
export const STEP827_DIR = 'ocr-tests/taxonomy/step8-27'
export const ASSIGNED_BY = 'STEP_8_27'
export const STAGE: PipelineStage = 'SEGMENT'

/**
 * Freeze §J does not reprint this UUID next to 8.27. The only Production-stored
 * textbook used by STEP 8.8–8.24 (and the frozen 265 drafts) is this document.
 * Evidence: STEP88_DOCUMENT / STEP817_DOCUMENT / STEP812_DOCUMENT /
 * workers/ocr/corpus-manifest.json document_id.
 */
export const STEP827_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const STEP827_DOCUMENT_TITLE = '쎈수학 공통수학1'
/** Production `source_documents.file_hash` for SSEN. Not the SECOND-book SHA. */
export const STEP827_SSEN_FILE_HASH = 'ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292'
export const STEP827_SSEN_PAGE_COUNT = 192
export const STEP827_SSEN_ORIGINAL_FILENAME = '쎈 공통수학1.pdf'
export const STEP827_DOCUMENT_EVIDENCE = [
  'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J: one already-stored textbook',
  'src/lib/classification/step88Io.ts STEP88_DOCUMENT',
  'src/lib/ingestion/step817Run.ts STEP817_DOCUMENT',
  'src/lib/taxonomy/classificationPersistence.ts STEP812_DOCUMENT',
  'workers/ocr/corpus-manifest.json document_id + title',
] as const

/** Different book. Must never mix into the 8.27 SSEN run. */
export const SECOND_DOCUMENT = '190fb31b-03f5-43b9-b696-cce7a823a321'
export const SECOND_PDF_SHA256 = '3b4e789ea8165f0473975d70de8d40658a391b65d21607997b77b468f124a5e9'

export const STEP827_PAID_OCR_CAP = { maxCalls: 0, maxUsd: 0 } as const

export const REQUIRED_CACHE_PATHS = {
  candidates: 'ocr-tests/book-pipeline/step8-7/stage-b-candidates.json',
  mistralDir: 'ocr-tests/mistral',
  originalPages: 'ocr-tests/original',
  bookPipelinePages: 'ocr-tests/book-pipeline/pages',
} as const

export const SSEN_FIGURE_PAGES_DIR = 'ocr-tests/taxonomy/step8-22/pages/ssen'
export const SECOND_SAMPLE_PAGES_DIR = 'ocr-tests/taxonomy/step8-18/pages'
export const SECOND_SAMPLE_LAYOUT = 'ocr-tests/taxonomy/step8-18/_sample-layout-raw.json'

/** Same profile as segmentBenchmark.MISTRAL_SEGMENT_PROFILE (node runner, not imported here). */
export const LAYOUT_CACHE_PROFILE = 'ocr-latest+blocks+tables+images'

export type Step827Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type Step827Target = {
  id: string
  kind:
    | 'TARGET'
    | 'CACHE'
    | 'SCHEMA'
    | 'EXECUTE'
    | 'PAID_OCR'
    | 'ORIGINAL_PDF'
    | 'MIXED_SOURCE'
    | 'WRITES'
    | 'FROZEN'
    | 'CARRY_OVER'
  verdict: Step827Verdict
  reasons: string[]
}

export type CachePageRow = {
  page: number
  png_path: string | null
  layout_cache_path: string | null
  hit: boolean
  book: 'SSEN' | 'SECOND' | 'UNKNOWN'
}

export type CacheInventory = {
  candidates_present: boolean
  mistral_dir_present: boolean
  original_pages_present: boolean
  book_pipeline_pages_present: boolean
  layout_hits: CachePageRow[]
  layout_misses: CachePageRow[]
  ssen_figure_page_pngs: string[]
  second_sample_page_pngs: string[]
  second_layout_present: boolean
  original_pdf: {
    present: boolean
    path: string | null
    sha256: string | null
    is_second_book: boolean
    substituted: false
  }
}

export type SchemaProbe = {
  queried: boolean
  present: boolean | null
  reason: string
  tables: { pipeline_runs: boolean | null; pipeline_items: boolean | null }
  rpcs: {
    hqb_start_pipeline_run: boolean | null
    hqb_upsert_pipeline_item: boolean | null
    hqb_pipeline_progress_from_items: boolean | null
  }
  isolated_826_apply_allowed: false | true
  isolated_826_apply_reason: string
}

export type DryRunResult = {
  pass: boolean
  blockers: string[]
  textbook: { id: string; title: string; evidence: readonly string[] }
  source_id: string
  cache_key_profile: string
  input_pages: number
  cache_hits: number
  cache_misses: number
  segment_targets: number
  excluded: Array<{ id: string; reason: string; count: number }>
  expected_pipeline_runs: 0 | 1
  expected_pipeline_items: number
  problem_production_writes: 0
  ocr_network_calls: 0
  original_pdf_required: false
}

export type SegmentPipelineItem = {
  candidate_id: string
  stage: PipelineStage
  status: PipelineItemStatus
  reasons: string[]
  segment_engine_status: SegmentStatus | null
  source_document_id: string
}

export function denyPaidOcr827(): { authorized: false; reason: string } {
  const decision = authorizePaidOcr({
    providerConfigured: false,
    estimatedCalls: 0,
    estimatedUsd: 0,
    cacheOnly: true,
    allowPaidApi: false,
    confirmCost: false,
    paidRoutingEnabled: false,
    stepMaxCalls: STEP827_PAID_OCR_CAP.maxCalls,
    stepMaxUsd: STEP827_PAID_OCR_CAP.maxUsd,
  })
  return { authorized: false, reason: decision.reason }
}

/**
 * Segmentation AUTO_OK is not pipeline AUTO_APPROVED.
 * 8.27 stops at SEGMENT; later gates (8.28–8.31) are not run.
 */
export function mapSegmentStatusToPipeline(status: SegmentStatus): {
  status: PipelineItemStatus
  reasons: string[]
} {
  if (status === 'AUTO_OK') {
    return {
      status: 'HUMAN_REVIEW',
      reasons: ['SEGMENT_AUTO_OK', 'LATER_GATE_REQUIRED', 'NO_AUTO_APPROVED_IN_8_27'],
    }
  }
  return {
    status: 'HUMAN_REVIEW',
    reasons: ['SEGMENT_REVIEW', 'LATER_GATE_REQUIRED', 'NO_AUTO_APPROVED_IN_8_27'],
  }
}

export function emptyInventory(): CacheInventory {
  return {
    candidates_present: false,
    mistral_dir_present: false,
    original_pages_present: false,
    book_pipeline_pages_present: false,
    layout_hits: [],
    layout_misses: [],
    ssen_figure_page_pngs: [],
    second_sample_page_pngs: [],
    second_layout_present: false,
    original_pdf: {
      present: false,
      path: null,
      sha256: null,
      is_second_book: false,
      substituted: false,
    },
  }
}

export function evaluateDryRun(input: {
  inventory: CacheInventory
  schema: SchemaProbe
  problemPersistRequested: boolean
  paidApiRequested: boolean
  mixedTextbook: boolean
}): DryRunResult {
  const blockers: string[] = []
  const hits = input.inventory.layout_hits.filter((row) => row.book === 'SSEN' && row.hit)
  const misses = input.inventory.layout_misses.filter((row) => row.book !== 'SECOND')

  if (!input.inventory.candidates_present) blockers.push('CANDIDATES_CACHE_MISSING')
  if (!input.inventory.mistral_dir_present || hits.length === 0) blockers.push('LAYOUT_OCR_CACHE_MISSING')
  if (misses.length > 0 || hits.length === 0) blockers.push('CACHE_MISS_WOULD_CALL_PAID_OCR')
  if (input.mixedTextbook) blockers.push('MIXED_TEXTBOOK')
  if (input.problemPersistRequested) blockers.push('PROBLEM_PERSIST_ENABLED')
  if (input.paidApiRequested) blockers.push('PAID_OCR_FLAG')
  if (input.schema.present !== true) blockers.push('PRODUCTION_SCHEMA_ABSENT_OR_UNCONFIRMED')
  if (input.inventory.second_layout_present) {
    // Presence is fine if unused. Mixing would already set MIXED_TEXTBOOK.
  }

  const excluded: DryRunResult['excluded'] = [
    {
      id: 'SECOND_DOCUMENT',
      reason: 'WRONG_BOOK',
      count: input.inventory.second_sample_page_pngs.length + (input.inventory.second_layout_present ? 1 : 0),
    },
    {
      id: 'SSEN_FIGURE_PAGE_PNGS',
      reason: 'NOT_LAYOUT_OCR_CACHE_DO_NOT_GUESS_SUBSET',
      count: input.inventory.ssen_figure_page_pngs.length,
    },
  ]

  const pass = blockers.length === 0
  const segmentTargets = pass ? hits.length : 0

  return {
    pass,
    blockers,
    textbook: {
      id: STEP827_DOCUMENT,
      title: STEP827_DOCUMENT_TITLE,
      evidence: STEP827_DOCUMENT_EVIDENCE,
    },
    source_id: STEP827_DOCUMENT,
    cache_key_profile: LAYOUT_CACHE_PROFILE,
    input_pages: hits.length + misses.length,
    cache_hits: hits.length,
    cache_misses: misses.length + (input.inventory.candidates_present ? 0 : 1),
    segment_targets: segmentTargets,
    excluded,
    expected_pipeline_runs: pass ? 1 : 0,
    expected_pipeline_items: pass ? segmentTargets : 0,
    problem_production_writes: 0,
    ocr_network_calls: 0,
    original_pdf_required: false,
  }
}

export function progressFromItems(items: SegmentPipelineItem[]): PipelineProgress {
  return {
    ...summarizeProgress(items.map((row) => row.status)),
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function progressMatchesItems(progress: PipelineProgress, items: SegmentPipelineItem[]): boolean {
  const expected = progressFromItems(items)
  return (
    progress.total === expected.total &&
    progress.auto_approved === expected.auto_approved &&
    progress.ai_fixed === expected.ai_fixed &&
    progress.human_review === expected.human_review &&
    progress.blocked === expected.blocked &&
    progress.failed === expected.failed &&
    progress.unresolved === expected.unresolved &&
    progress.actual_paid_calls === 0 &&
    progress.actual_usd === 0
  )
}

export function upsertItemsIdempotent(
  existing: SegmentPipelineItem[],
  next: SegmentPipelineItem[],
): SegmentPipelineItem[] {
  const map = new Map(existing.map((row) => [row.candidate_id, row]))
  for (const row of next) {
    const prev = map.get(row.candidate_id)
    if (!prev) {
      map.set(row.candidate_id, row)
      continue
    }
    map.set(row.candidate_id, { ...prev, ...row })
  }
  return [...map.values()]
}

export function findDuplicateCandidateIds(items: SegmentPipelineItem[]): string[] {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of items) {
    if (seen.has(row.candidate_id)) dup.push(row.candidate_id)
    seen.add(row.candidate_id)
  }
  return dup
}

export function findOrphanItems(items: SegmentPipelineItem[], runSourceId: string): SegmentPipelineItem[] {
  return items.filter((row) => row.source_document_id !== runSourceId)
}

export function findWrongSourceItems(items: SegmentPipelineItem[]): SegmentPipelineItem[] {
  return items.filter((row) => row.source_document_id !== STEP827_DOCUMENT)
}

/**
 * Do not judge tokens by JWT shape. Management/CLI access tokens are `sbp_…`.
 * Auth user JWTs are a different credential and are not required here.
 */
export function accessTokenUsable(value: string | undefined): boolean {
  const token = value?.trim() ?? ''
  if (!token) return false
  if (token.startsWith('sbp_') && token.length >= 20) return true
  if (token.length > 80 && token.split('.').length >= 3) return true
  return false
}

export function isolated826ApplyAllowed(pendingMigrationVersions: string[] | null): {
  allowed: boolean
  reason: string
} {
  if (pendingMigrationVersions === null) {
    return { allowed: false, reason: 'PENDING_MIGRATIONS_UNKNOWN' }
  }
  if (pendingMigrationVersions.length === 0) {
    return { allowed: false, reason: 'ALREADY_APPLIED_OR_NONE_PENDING' }
  }
  if (pendingMigrationVersions.length === 1 && pendingMigrationVersions[0] === '20260912120000') {
    return { allowed: true, reason: 'ISOLATED_826_ONLY' }
  }
  return { allowed: false, reason: 'OTHER_PENDING_MIGRATIONS_MIXED' }
}

export function projectStep827Targets(input: {
  dryRun: DryRunResult
  schemaPresent: boolean | null
  executed: boolean
  originalPdfPresent: boolean
  originalPdfIsSecondBook: boolean
}): Step827Target[] {
  const cacheBlocked = input.dryRun.blockers.includes('LAYOUT_OCR_CACHE_MISSING')
  const candidatesBlocked = input.dryRun.blockers.includes('CANDIDATES_CACHE_MISSING')
  const schemaBlocked = input.schemaPresent !== true
  const targets: Step827Target[] = [
    {
      id: 'target.lock',
      kind: 'TARGET',
      verdict: 'PASS',
      reasons: ['SSEN_DOCUMENT_LOCKED', STEP827_DOCUMENT],
    },
    {
      id: 'cache.layout',
      kind: 'CACHE',
      verdict: cacheBlocked ? 'BLOCKED' : 'PASS',
      reasons: cacheBlocked ? ['LAYOUT_OCR_CACHE_MISSING'] : ['LAYOUT_CACHE_HIT'],
    },
    {
      id: 'cache.candidates',
      kind: 'CACHE',
      verdict: candidatesBlocked ? 'BLOCKED' : 'PASS',
      reasons: candidatesBlocked ? ['CANDIDATES_CACHE_MISSING'] : ['CANDIDATES_PRESENT'],
    },
    {
      id: 'production.schema',
      kind: 'SCHEMA',
      verdict: schemaBlocked ? 'BLOCKED' : 'PASS',
      reasons: schemaBlocked ? ['PRODUCTION_SCHEMA_ABSENT_OR_UNCONFIRMED'] : ['SCHEMA_PRESENT'],
    },
    {
      id: 'execute.segment',
      kind: 'EXECUTE',
      verdict: input.executed ? 'PASS' : 'BLOCKED',
      reasons: input.executed ? ['CACHE_ONLY_SEGMENT_ONCE'] : ['DRY_RUN_BLOCKED_NO_EXECUTE'],
    },
    {
      id: 'paid_ocr',
      kind: 'PAID_OCR',
      verdict: 'BLOCKED',
      reasons: ['STEP_PAID_OCR_CAP_ZERO'],
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
      reasons: ['SECOND_BOOK_EXCLUDED'],
    },
    {
      id: 'problem_writes',
      kind: 'WRITES',
      verdict: 'PASS',
      reasons: ['PROBLEM_PRODUCTION_WRITES_ZERO'],
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
      reasons: ['PROBLEM_NOT_INGESTED', 'NO_COMMITTED_STEM', 'NEEDS_PAID_OCR', 'CARRY_OVER_STEP_8_24', 'OUT_OF_SCOPE_STEP_8_27'],
    })
  }
  return targets
}

export function tallyVerdicts(targets: Step827Target[]): Record<Step827Verdict, number> {
  return {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
}

export function assertNoAutoApproved(items: SegmentPipelineItem[]): void {
  if (items.some((row) => row.status === 'AUTO_APPROVED')) {
    throw new Error('STEP 8.27 must not set AUTO_APPROVED')
  }
  if (!(PIPELINE_ITEM_STATUSES as readonly string[]).includes('HUMAN_REVIEW')) {
    throw new Error('frozen statuses missing HUMAN_REVIEW')
  }
}

export const STEP827_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  nextStepStarted: false,
  frozen: FROZEN_PIPELINE_COUNTS,
} as const
