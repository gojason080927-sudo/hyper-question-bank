/**
 * STEP 8.28 — structure stem/choices/answer/explanation from existing OCR/GT only.
 * Implements docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J row 8.28.
 * Draft persist is frozen off. No paid OCR. AUTO_APPROVED is forbidden.
 */

import { extractAnswerCandidate, extractChoices, splitLines } from '../recognition/structure'
import type { ChoiceDraft } from '../recognition/types'
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
  type PipelineItemStatus,
  type PipelineProgress,
  type PipelineStage,
} from './batchPipeline825'
import {
  SECOND_DOCUMENT,
  SECOND_PDF_SHA256,
  STEP827_DOCUMENT,
  STEP827_DOCUMENT_TITLE,
  STEP827_SSEN_FILE_HASH,
} from './cacheSegment827'

export const STEP828 = '8.28'
export const STEP828_DIR = 'ocr-tests/taxonomy/step8-28'
export const ASSIGNED_BY = 'STEP_8_28'
export const STAGE: PipelineStage = 'STRUCTURE'

export const STEP828_DOCUMENT = STEP827_DOCUMENT
export const STEP828_DOCUMENT_TITLE = STEP827_DOCUMENT_TITLE
export const STEP828_SSEN_FILE_HASH = STEP827_SSEN_FILE_HASH

export const STEP828_DOCUMENT_EVIDENCE = [
  'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J row 8.28: existing OCR/GT only',
  'docs/STEP8_27_CACHE_ONLY_SEGMENTATION_v1.md: 8.28 after 8.27 on main + later freeze',
  'workers/ocr/corpus-manifest.json document_id + ground_truth_file',
  'workers/ocr/ground-truth.json document_id',
] as const

export const GT_PATH = 'workers/ocr/ground-truth.json'
export const MANIFEST_PATH = 'workers/ocr/corpus-manifest.json'
export const EXPECTED_GT_COUNT = 26
/** SHA256 of ground-truth.json bytes on origin/main. Not the STEP 7 crop-set label. */
export const STEP828_GT_SHA256 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
export const STEP828_PAID_OCR_CAP = { maxCalls: 0, maxUsd: 0 } as const

export const CIRCLED_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const

export type Step828Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type Step828Target = {
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
    | 'FROZEN'
    | 'TEXTBOOK'
    | 'CARRY_OVER'
  verdict: Step828Verdict
  reasons: string[]
}

export type GtItem = {
  sample_id: string
  page_number: number
  problem_number: string | null
  ground_truth_text: string
  ground_truth_math: string[]
  ground_truth_choices: string[]
  has_figure: boolean
  has_table: boolean
}

export type GtFile = {
  kind: string
  document_id: string
  title: string
  items: GtItem[]
}

export type GtInventory = {
  present: boolean
  path: string
  count: number
  document_id: string | null
  sha256: string | null
  sha256_after: string | null
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
  textbook: { id: string; title: string; evidence: readonly string[] }
  source_id: string
  gt_path: string
  gt_count: number
  structure_targets: number
  excluded: Array<{ id: string; reason: string; count: number }>
  expected_pipeline_runs: 0
  expected_pipeline_items: 0
  problem_production_writes: 0
  draft_persist: false
  ocr_network_calls: 0
  original_pdf_required: false
}

export type StructurePipelineItem = {
  candidate_id: string
  stage: PipelineStage
  status: PipelineItemStatus
  reasons: string[]
  source_document_id: string
  page_number: number
  problem_number: string | null
  stem_text: string
  choices: ChoiceDraft[]
  answer_candidate: string | null
  explanation: null
  math: string[]
  has_figure: boolean
  has_table: boolean
  content_fingerprint: string
}

export function denyPaidOcr828(): { authorized: false; reason: string } {
  const decision = authorizePaidOcr({
    providerConfigured: false,
    estimatedCalls: 0,
    estimatedUsd: 0,
    cacheOnly: true,
    allowPaidApi: false,
    confirmCost: false,
    paidRoutingEnabled: false,
    stepMaxCalls: STEP828_PAID_OCR_CAP.maxCalls,
    stepMaxUsd: STEP828_PAID_OCR_CAP.maxUsd,
  })
  return { authorized: false, reason: decision.reason }
}

export function emptyGtInventory(): GtInventory {
  return {
    present: false,
    path: GT_PATH,
    count: 0,
    document_id: null,
    sha256: null,
    sha256_after: null,
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

export function parseGtFile(raw: unknown): GtFile {
  if (!raw || typeof raw !== 'object') throw new Error('STEP 8.28 GT must be an object')
  const row = raw as Record<string, unknown>
  if (!Array.isArray(row.items)) throw new Error('STEP 8.28 GT missing items')
  return {
    kind: String(row.kind ?? ''),
    document_id: String(row.document_id ?? ''),
    title: String(row.title ?? ''),
    items: row.items.map((item) => {
      const rec = item as Record<string, unknown>
      const problem = rec.problem_number
      return {
        sample_id: String(rec.sample_id ?? ''),
        page_number: Number(rec.page_number),
        problem_number: problem == null || problem === '' ? null : String(problem),
        ground_truth_text: String(rec.ground_truth_text ?? ''),
        ground_truth_math: Array.isArray(rec.ground_truth_math) ? rec.ground_truth_math.map((v) => String(v)) : [],
        ground_truth_choices: Array.isArray(rec.ground_truth_choices)
          ? rec.ground_truth_choices.map((v) => String(v))
          : [],
        has_figure: rec.has_figure === true,
        has_table: rec.has_table === true,
      }
    }),
  }
}

export function fingerprintGtItem(item: GtItem): string {
  return [
    item.sample_id,
    String(item.page_number),
    item.problem_number ?? '',
    item.ground_truth_text,
    item.ground_truth_choices.join('\n'),
    item.ground_truth_math.join('\n'),
  ].join('|')
}

export function choicesFromGt(texts: string[]): ChoiceDraft[] {
  return texts.map((text, index) => ({
    order: index + 1,
    label: CIRCLED_LABELS[index] ?? String(index + 1),
    text,
  }))
}

/**
 * Copy GT stem/choices/math. Parsed OCR is a gate helper only — it must not replace GT.
 */
export function mapGtToPipeline(item: GtItem): StructurePipelineItem {
  if (!item.sample_id) {
    throw new Error('STEP 8.28 GT item missing sample_id')
  }
  const stem = item.ground_truth_text
  const parsed = extractChoices(splitLines(stem))
  const choices = item.ground_truth_choices.length > 0 ? choicesFromGt(item.ground_truth_choices) : parsed.choices
  const answer = extractAnswerCandidate(splitLines(stem))
  const mapped = mapStructureStatus({
    problemNumber: item.problem_number,
    stemText: stem,
  })
  return {
    candidate_id: item.sample_id,
    stage: STAGE,
    status: mapped.status,
    reasons: mapped.reasons,
    source_document_id: STEP828_DOCUMENT,
    page_number: item.page_number,
    problem_number: item.problem_number,
    stem_text: stem,
    choices,
    answer_candidate: answer,
    explanation: null,
    math: [...item.ground_truth_math],
    has_figure: item.has_figure,
    has_table: item.has_table,
    content_fingerprint: fingerprintGtItem(item),
  }
}

export function mapStructureStatus(input: {
  problemNumber: string | null
  stemText: string
}): { status: PipelineItemStatus; reasons: string[] } {
  if (!input.problemNumber) {
    return {
      status: 'BLOCKED',
      reasons: ['IDENTITY_UNSTABLE', 'NO_AUTO_APPROVED_IN_8_28', 'DRAFT_PERSIST_FROZEN_OFF'],
    }
  }
  if (!input.stemText.trim()) {
    return {
      status: 'BLOCKED',
      reasons: ['NO_COMMITTED_STEM', 'NO_AUTO_APPROVED_IN_8_28', 'DRAFT_PERSIST_FROZEN_OFF'],
    }
  }
  return {
    status: 'HUMAN_REVIEW',
    reasons: [
      'STRUCTURED_FROM_GT',
      'LATER_GATE_REQUIRED',
      'NO_AUTO_APPROVED_IN_8_28',
      'DRAFT_PERSIST_FROZEN_OFF',
    ],
  }
}

export function evaluateDryRun(input: {
  inventory: GtInventory
  problemPersistRequested: boolean
  paidApiRequested: boolean
  mixedTextbook: boolean
}): DryRunResult {
  const blockers: string[] = []
  if (!input.inventory.present || input.inventory.count === 0) blockers.push('GT_CACHE_MISSING')
  if (input.inventory.present && input.inventory.count !== EXPECTED_GT_COUNT) blockers.push('GT_COUNT_MISMATCH')
  if (input.inventory.document_id && input.inventory.document_id !== STEP828_DOCUMENT) {
    blockers.push('GT_WRONG_DOCUMENT')
  }
  if (input.inventory.present && input.inventory.sha256 !== STEP828_GT_SHA256) blockers.push('GT_HASH_MISMATCH')
  if (input.inventory.mutated) blockers.push('GT_MUTATED')
  if (input.mixedTextbook) blockers.push('MIXED_TEXTBOOK')
  if (input.problemPersistRequested) blockers.push('PROBLEM_PERSIST_ENABLED')
  if (input.paidApiRequested) blockers.push('PAID_OCR_FLAG')

  const excluded: DryRunResult['excluded'] = [
    { id: 'SECOND_DOCUMENT', reason: 'WRONG_BOOK', count: input.inventory.original_pdf.is_second_book ? 1 : 0 },
    { id: 'FULL_TEXTBOOK', reason: 'OUT_OF_SCOPE_STEP_8_28', count: 0 },
    { id: 'STEP824_CARRY_OVER', reason: 'NOT_IN_STEP7_GT', count: STEP824_BLOCKED_CANDIDATE_IDS.length },
  ]

  const pass = blockers.length === 0
  return {
    pass,
    blockers,
    textbook: {
      id: STEP828_DOCUMENT,
      title: STEP828_DOCUMENT_TITLE,
      evidence: STEP828_DOCUMENT_EVIDENCE,
    },
    source_id: STEP828_DOCUMENT,
    gt_path: GT_PATH,
    gt_count: input.inventory.count,
    structure_targets: pass ? EXPECTED_GT_COUNT : 0,
    excluded,
    expected_pipeline_runs: 0,
    expected_pipeline_items: 0,
    problem_production_writes: 0,
    draft_persist: false,
    ocr_network_calls: 0,
    original_pdf_required: false,
  }
}

export function progressFromItems(items: StructurePipelineItem[]): PipelineProgress {
  return {
    ...summarizeProgress(items.map((row) => row.status)),
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function progressMatchesItems(progress: PipelineProgress, items: StructurePipelineItem[]): boolean {
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
  existing: StructurePipelineItem[],
  next: StructurePipelineItem[],
): StructurePipelineItem[] {
  const map = new Map(existing.map((row) => [row.candidate_id, row]))
  for (const row of next) {
    const prev = map.get(row.candidate_id)
    map.set(row.candidate_id, prev ? { ...prev, ...row } : row)
  }
  return [...map.values()]
}

export function findDuplicateCandidateIds(items: StructurePipelineItem[]): string[] {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of items) {
    if (seen.has(row.candidate_id)) dup.push(row.candidate_id)
    seen.add(row.candidate_id)
  }
  return dup
}

export function findOrphanItems(items: StructurePipelineItem[], runSourceId: string): StructurePipelineItem[] {
  return items.filter((row) => row.source_document_id !== runSourceId)
}

export function findWrongSourceItems(items: StructurePipelineItem[]): StructurePipelineItem[] {
  return items.filter((row) => row.source_document_id !== STEP828_DOCUMENT)
}

export function assertNoAutoApproved(items: StructurePipelineItem[]): void {
  if (items.some((row) => row.status === 'AUTO_APPROVED')) {
    throw new Error('STEP 8.28 must not set AUTO_APPROVED')
  }
  if (!(PIPELINE_ITEM_STATUSES as readonly string[]).includes('HUMAN_REVIEW')) {
    throw new Error('frozen statuses missing HUMAN_REVIEW')
  }
}

export function assertDraftPersistFrozenOff(items: StructurePipelineItem[]): void {
  for (const row of items) {
    const gold = mapToGoldStandard(row.status)
    if (gold.mayVerify) throw new Error('STEP 8.28 must never verify')
    if (row.status === 'AUTO_APPROVED') throw new Error('STEP 8.28 must not set AUTO_APPROVED')
  }
}

export function assertNoContentRewrite(items: StructurePipelineItem[], gtItems: GtItem[]): void {
  const byId = new Map(gtItems.map((row) => [row.sample_id, row]))
  for (const row of items) {
    const gt = byId.get(row.candidate_id)
    if (!gt) throw new Error(`STEP 8.28 orphan item ${row.candidate_id}`)
    if (row.stem_text !== gt.ground_truth_text) throw new Error(`STEP 8.28 rewrote stem ${row.candidate_id}`)
    if (row.explanation !== null) throw new Error(`STEP 8.28 invented explanation ${row.candidate_id}`)
    if (row.content_fingerprint !== fingerprintGtItem(gt)) {
      throw new Error(`STEP 8.28 fingerprint drift ${row.candidate_id}`)
    }
    if (gt.ground_truth_choices.length > 0) {
      const texts = row.choices.map((choice) => choice.text)
      if (texts.join('\n') !== gt.ground_truth_choices.join('\n')) {
        throw new Error(`STEP 8.28 rewrote choices ${row.candidate_id}`)
      }
    }
    if (row.math.join('\n') !== gt.ground_truth_math.join('\n')) {
      throw new Error(`STEP 8.28 rewrote math ${row.candidate_id}`)
    }
  }
}

export function projectStep828Targets(input: {
  dryRun: DryRunResult
  executed: boolean
  originalPdfPresent: boolean
  originalPdfIsSecondBook: boolean
}): Step828Target[] {
  const gtBlocked =
    input.dryRun.blockers.includes('GT_CACHE_MISSING') ||
    input.dryRun.blockers.includes('GT_COUNT_MISMATCH') ||
    input.dryRun.blockers.includes('GT_HASH_MISMATCH') ||
    input.dryRun.blockers.includes('GT_WRONG_DOCUMENT') ||
    input.dryRun.blockers.includes('GT_MUTATED')
  const targets: Step828Target[] = [
    {
      id: 'target.lock',
      kind: 'TARGET',
      verdict: 'PASS',
      reasons: ['SSEN_DOCUMENT_LOCKED', STEP828_DOCUMENT],
    },
    {
      id: 'cache.gt',
      kind: 'CACHE',
      verdict: gtBlocked ? 'BLOCKED' : 'PASS',
      reasons: gtBlocked ? [...input.dryRun.blockers.filter((b) => b.startsWith('GT_'))] : ['STEP7_GT_PRESENT'],
    },
    {
      id: 'execute.structure',
      kind: 'EXECUTE',
      verdict: input.executed ? 'PASS' : 'BLOCKED',
      reasons: input.executed ? ['CACHE_ONLY_STRUCTURE_ONCE'] : ['DRY_RUN_BLOCKED_NO_EXECUTE'],
    },
    {
      id: 'full_textbook',
      kind: 'TEXTBOOK',
      verdict: 'BLOCKED',
      reasons: ['OUT_OF_SCOPE_STEP_8_28', 'TWENTY_SIX_GT_SAMPLES_ONLY'],
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
      reasons: ['STEP_8_25_DRAFTS_ONLY_IF_LATER_FREEZE_ALLOWS', 'THIS_FREEZE_DOES_NOT_ALLOW'],
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
        'OUT_OF_SCOPE_STEP_8_28',
      ],
    })
  }
  return targets
}

export function tallyVerdicts(targets: Step828Target[]): Record<Step828Verdict, number> {
  return {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
}

export const STEP828_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  nextStepStarted: false,
  frozen: FROZEN_PIPELINE_COUNTS,
  draftPersist: false,
} as const
