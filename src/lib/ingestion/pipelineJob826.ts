/**
 * STEP 8.26 — pipeline_runs / pipeline_items additive schema + progress counters.
 * No textbook run. No paid OCR. No problem/version/figure writes.
 */

import {
  FROZEN_PIPELINE_COUNTS,
  PIPELINE_ITEM_STATUSES,
  PIPELINE_STAGES,
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

export const STEP826 = '8.26'
export const STEP826_DIR = 'ocr-tests/taxonomy/step8-26'
export const STEP826_MIGRATION = 'supabase/migrations/20260912120000_hqb_pipeline_job_v1.sql'
export const MIGRATION_VERSION = '20260912120000'
export const MIGRATION_NAME = 'hqb_pipeline_job_v1'
export const ASSIGNED_BY = 'STEP_8_26'
export const ROLLBACK_ASSIGNED_BY = 'STEP_8_26_ROLLBACK_TEST'
export const EXPECTED_PDF_SHA256 = '3b4e789ea8165f0473975d70de8d40658a391b65d21607997b77b468f124a5e9'

export const STEP826_PAID_OCR_CAP = {
  maxCalls: 0,
  maxUsd: 0,
} as const

export const RUN_RPC = 'hqb_start_pipeline_run'
export const ITEM_RPC = 'hqb_upsert_pipeline_item'
export const ROLLBACK_RPC = 'hqb_delete_test_pipeline_job'

export type Step826Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type Step826Target = {
  id: string
  kind: 'SCHEMA' | 'COUNTERS' | 'TEXTBOOK' | 'CARRY_OVER' | 'PAID_OCR' | 'ORIGINAL_PDF'
  verdict: Step826Verdict
  reasons: string[]
}

export function emptyProgress(): PipelineProgress {
  return summarizeProgress([])
}

export function progressFromStatuses(statuses: PipelineItemStatus[]): PipelineProgress {
  const progress = summarizeProgress(statuses)
  return {
    ...progress,
    estimated_paid_calls: 0,
    estimated_usd: 0,
    actual_paid_calls: 0,
    actual_usd: 0,
  }
}

export function isFrozenStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value)
}

export function isFrozenItemStatus(value: string): value is PipelineItemStatus {
  return (PIPELINE_ITEM_STATUSES as readonly string[]).includes(value)
}

export function migrationIsAdditive826(sql: string): { ok: boolean; reasons: string[] } {
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const reasons: string[] = []
  if (/DROP\s+TABLE/i.test(stripped)) reasons.push('DROP_TABLE')
  if (/DROP\s+COLUMN/i.test(stripped)) reasons.push('DROP_COLUMN')
  if (/\bTRUNCATE\b/i.test(stripped)) reasons.push('TRUNCATE')
  if (/INSERT\s+INTO\s+public\.problems\b/i.test(stripped)) reasons.push('WRITES_PROBLEMS')
  if (/INSERT\s+INTO\s+public\.problem_versions\b/i.test(stripped)) reasons.push('WRITES_VERSIONS')
  if (/INSERT\s+INTO\s+public\.problem_figure_assets\b/i.test(stripped)) reasons.push('WRITES_FIGURE_ASSETS')
  if (/INSERT\s+INTO\s+public\.problem_figure_links\b/i.test(stripped)) reasons.push('WRITES_FIGURE_LINKS')
  if (/UPDATE\s+public\.problems\b/i.test(stripped)) reasons.push('UPDATES_PROBLEMS')
  if (!/CREATE TABLE IF NOT EXISTS public\.pipeline_runs/.test(sql)) reasons.push('MISSING_PIPELINE_RUNS')
  if (!/CREATE TABLE IF NOT EXISTS public\.pipeline_items/.test(sql)) reasons.push('MISSING_PIPELINE_ITEMS')
  if (!/hqb_start_pipeline_run/.test(sql)) reasons.push('MISSING_START_RPC')
  if (!/hqb_upsert_pipeline_item/.test(sql)) reasons.push('MISSING_ITEM_RPC')
  if (!/hqb_delete_test_pipeline_job/.test(sql)) reasons.push('MISSING_ROLLBACK')
  if (!/hqb_pipeline_progress_from_items/.test(sql)) reasons.push('MISSING_PROGRESS')
  if (!/SET search_path = public/.test(sql)) reasons.push('MISSING_SEARCH_PATH')
  if (!/hqb_require_staff_writer/.test(sql)) reasons.push('MISSING_STAFF_CHECK')
  if (!/HQB_GOLD_STANDARD_FORBIDDEN/.test(sql)) reasons.push('MISSING_GOLD_FORBID')
  if (!/REVOKE ALL ON FUNCTION public.hqb_start_pipeline_run\(jsonb\) FROM PUBLIC, anon/.test(sql)) {
    reasons.push('MISSING_ANON_REVOKE')
  }
  if (/ocr_result_cache/.test(sql)) reasons.push('OCR_CACHE_OUT_OF_SCOPE')
  return { ok: reasons.length === 0, reasons }
}

export function denyPaidOcr826(): { authorized: false; reason: string } {
  const decision = authorizePaidOcr({
    providerConfigured: false,
    estimatedCalls: 0,
    estimatedUsd: 0,
    cacheOnly: true,
    allowPaidApi: false,
    confirmCost: false,
    paidRoutingEnabled: false,
    stepMaxCalls: STEP826_PAID_OCR_CAP.maxCalls,
    stepMaxUsd: STEP826_PAID_OCR_CAP.maxUsd,
  })
  return { authorized: false, reason: decision.reason }
}

export function projectStep826Targets(input: {
  sqlAdditiveOk: boolean
  sqlReasons: string[]
  originalPdfPresent: boolean
  originalPdfHashMatch: boolean | null
}): Step826Target[] {
  const schemaReasons = input.sqlAdditiveOk ? [] : input.sqlReasons
  const schemaVerdict: Step826Verdict = input.sqlAdditiveOk ? 'PASS' : 'BLOCKED'
  const targets: Step826Target[] = [
    {
      id: 'schema.pipeline_runs',
      kind: 'SCHEMA',
      verdict: schemaVerdict,
      reasons: schemaReasons,
    },
    {
      id: 'schema.pipeline_items',
      kind: 'SCHEMA',
      verdict: schemaVerdict,
      reasons: schemaReasons,
    },
    {
      id: 'progress_counters',
      kind: 'COUNTERS',
      verdict: schemaVerdict,
      reasons: schemaReasons,
    },
    {
      id: 'textbook_run',
      kind: 'TEXTBOOK',
      verdict: 'BLOCKED',
      reasons: ['OUT_OF_SCOPE_STEP_8_26', 'NO_TEXTBOOK_RUN'],
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
      reasons: input.originalPdfPresent
        ? input.originalPdfHashMatch
          ? ['OUT_OF_SCOPE_STEP_8_26', 'HASH_MATCHED_NOT_USED']
          : ['OUT_OF_SCOPE_STEP_8_26', 'HASH_MISMATCH', 'NO_SUBSTITUTE']
        : ['OUT_OF_SCOPE_STEP_8_26', 'ORIGINAL_PDF_ABSENT', 'NO_SUBSTITUTE'],
    },
  ]
  for (const id of STEP824_BLOCKED_CANDIDATE_IDS) {
    targets.push({
      id,
      kind: 'CARRY_OVER',
      verdict: 'BLOCKED',
      reasons: ['PROBLEM_NOT_INGESTED', 'NO_COMMITTED_STEM', 'NEEDS_PAID_OCR', 'CARRY_OVER_STEP_8_24', 'OUT_OF_SCOPE_STEP_8_26'],
    })
  }
  return targets
}

export function tallyVerdicts(targets: Step826Target[]): Record<Step826Verdict, number> {
  return {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
}

export const STEP826_SAFETY = {
  ...STEP825_SAFETY,
  questionBankRef: QUESTION_BANK_REF,
  studentCareRef: STUDENT_CARE_REF,
  textbookRunImplemented: false,
  nextStepStarted: false,
  frozen: FROZEN_PIPELINE_COUNTS,
} as const
