import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'
import {
  FROZEN_PIPELINE_COUNTS,
  STEP824_BLOCKED_CANDIDATE_IDS,
  mapToGoldStandard,
} from './batchPipeline825'
import {
  ASSIGNED_BY,
  EXPECTED_PDF_SHA256,
  ITEM_RPC,
  MIGRATION_NAME,
  ROLLBACK_RPC,
  RUN_RPC,
  STEP826,
  STEP826_PAID_OCR_CAP,
  denyPaidOcr826,
  emptyProgress,
  isFrozenItemStatus,
  isFrozenStage,
  migrationIsAdditive826,
  progressFromStatuses,
  projectStep826Targets,
  tallyVerdicts,
} from './pipelineJob826'

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260912120000_hqb_pipeline_job_v1.sql'),
  'utf8',
)

describe('STEP 8.26 scope freeze', () => {
  it('is schema + counters only and does not start 8.27 or a textbook run', () => {
    expect(STEP826).toBe('8.26')
    expect(MIGRATION_NAME).toBe('hqb_pipeline_job_v1')
    expect(ASSIGNED_BY).toBe('STEP_8_26')
    expect(RUN_RPC).toBe('hqb_start_pipeline_run')
    expect(ITEM_RPC).toBe('hqb_upsert_pipeline_item')
    expect(ROLLBACK_RPC).toBe('hqb_delete_test_pipeline_job')
    expect(sql).toContain('Do not start STEP 8.27')
    expect(sql).toContain('No textbook ingest')
    expect(sql).not.toContain('ocr_result_cache')
  })

  it('keeps frozen 265 / 38 / 227 and the 8 STEP 8.24 BLOCKED ids', () => {
    expect(FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts).toBe(265)
    expect(FROZEN_PIPELINE_COUNTS.frozenTypeAuto).toBe(38)
    expect(FROZEN_PIPELINE_COUNTS.impliedNonTypeAuto).toBe(227)
    expect(FROZEN_PIPELINE_COUNTS.step823FigureAssets).toBe(3)
    expect(FROZEN_PIPELINE_COUNTS.step823FigureLinks).toBe(3)
    expect([...STEP824_BLOCKED_CANDIDATE_IDS]).toEqual([...UNRESOLVED_PENDING_IDS])
    expect(EXPECTED_PDF_SHA256).toBe('3b4e789ea8165f0473975d70de8d40658a391b65d21607997b77b468f124a5e9')
  })
})

describe('STEP 8.26 additive schema', () => {
  it('accepts the committed migration as additive-only', () => {
    const check = migrationIsAdditive826(sql)
    expect(check.reasons).toEqual([])
    expect(check.ok).toBe(true)
  })

  it('rejects DROP/TRUNCATE and writes to problems or figures', () => {
    expect(migrationIsAdditive826(`${sql}\nDROP TABLE public.problems;`).ok).toBe(false)
    expect(migrationIsAdditive826(`${sql}\nTRUNCATE public.pipeline_runs;`).reasons).toContain('TRUNCATE')
    expect(migrationIsAdditive826(`${sql}\nINSERT INTO public.problems (id) VALUES (gen_random_uuid());`).reasons).toContain(
      'WRITES_PROBLEMS',
    )
    expect(migrationIsAdditive826('CREATE TABLE IF NOT EXISTS public.other (id uuid);').ok).toBe(false)
  })

  it('forbids Gold Standard VERIFIED in the item RPC', () => {
    expect(sql).toContain('HQB_GOLD_STANDARD_FORBIDDEN')
    expect(mapToGoldStandard('AUTO_APPROVED').mayVerify).toBe(false)
    expect(mapToGoldStandard('AUTO_APPROVED').review).not.toBe('VERIFIED')
  })
})

describe('STEP 8.26 progress counters', () => {
  it('starts at zeros and counts frozen statuses without inventing Production totals', () => {
    expect(emptyProgress()).toMatchObject({
      total: 0,
      auto_approved: 0,
      actual_paid_calls: 0,
      actual_usd: 0,
    })
    const progress = progressFromStatuses(['AUTO_APPROVED', 'HUMAN_REVIEW', 'BLOCKED', 'FAILED', 'AI_FIXED'])
    expect(progress.total).toBe(5)
    expect(progress.auto_approved).toBe(1)
    expect(progress.human_review).toBe(1)
    expect(progress.blocked).toBe(1)
    expect(progress.failed).toBe(1)
    expect(progress.ai_fixed).toBe(1)
    expect(progress.unresolved).toBe(4)
    expect(progress.actual_paid_calls).toBe(0)
    expect(isFrozenStage('SOURCE_REGISTER')).toBe(true)
    expect(isFrozenStage('NOT_A_STAGE')).toBe(false)
    expect(isFrozenItemStatus('BLOCKED')).toBe(true)
  })
})

describe('STEP 8.26 target projection', () => {
  it('PASS schema/counters and BLOCKED textbook, OCR, and 8.24 carry-over', () => {
    const targets = projectStep826Targets({
      sqlAdditiveOk: true,
      sqlReasons: [],
      originalPdfPresent: false,
      originalPdfHashMatch: null,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.PASS).toBe(3)
    expect(tally.REVIEW).toBe(0)
    expect(tally.BLOCKED).toBe(11)
    expect(targets.find((row) => row.id === 'textbook_run')?.reasons).toContain('NO_TEXTBOOK_RUN')
    expect(targets.find((row) => row.id === 'paid_ocr')?.reasons).toContain('STEP_PAID_OCR_CAP_ZERO')
    expect(targets.find((row) => row.id === 'original_pdf')?.reasons).toContain('NO_SUBSTITUTE')
    expect(targets.filter((row) => row.kind === 'CARRY_OVER').map((row) => row.id)).toEqual([
      ...STEP824_BLOCKED_CANDIDATE_IDS,
    ])
  })

  it('does not authorize paid OCR and keeps routing disabled', () => {
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(STEP826_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(denyPaidOcr826()).toEqual({ authorized: false, reason: 'STEP_PAID_OCR_CAP_ZERO' })
  })
})
