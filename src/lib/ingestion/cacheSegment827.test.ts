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
  SECOND_DOCUMENT,
  SECOND_PDF_SHA256,
  STEP827,
  STEP827_DOCUMENT,
  STEP827_DOCUMENT_TITLE,
  STEP827_PAID_OCR_CAP,
  STEP827_SSEN_FILE_HASH,
  STEP827_SSEN_PAGE_COUNT,
  assertNoAutoApproved,
  denyPaidOcr827,
  emptyInventory,
  evaluateDryRun,
  findDuplicateCandidateIds,
  findOrphanItems,
  findWrongSourceItems,
  isolated826ApplyAllowed,
  mapSegmentStatusToPipeline,
  progressFromItems,
  progressMatchesItems,
  projectStep827Targets,
  tallyVerdicts,
  accessTokenUsable,
  upsertItemsIdempotent,
  type SchemaProbe,
  type SegmentPipelineItem,
} from './cacheSegment827'

const missingSchema: SchemaProbe = {
  queried: false,
  present: null,
  reason: 'access_token_placeholder',
  tables: { pipeline_runs: null, pipeline_items: null },
  rpcs: {
    hqb_start_pipeline_run: null,
    hqb_upsert_pipeline_item: null,
    hqb_pipeline_progress_from_items: null,
  },
  isolated_826_apply_allowed: false,
  isolated_826_apply_reason: 'PENDING_MIGRATIONS_UNKNOWN',
}

describe('STEP 8.27 scope freeze', () => {
  it('locks the SSEN Production textbook and excludes SECOND', () => {
    expect(STEP827).toBe('8.27')
    expect(STEP827_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    expect(STEP827_DOCUMENT_TITLE).toBe('쎈수학 공통수학1')
    expect(SECOND_DOCUMENT).toBe('190fb31b-03f5-43b9-b696-cce7a823a321')
    expect(STEP827_DOCUMENT).not.toBe(SECOND_DOCUMENT)
    expect(STEP827_SSEN_FILE_HASH).not.toBe(SECOND_PDF_SHA256)
    expect(STEP827_SSEN_PAGE_COUNT).toBe(192)
    const freeze = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md'),
      'utf8',
    )
    expect(freeze).toContain('Cache-only batch segmentation on **one** already-stored textbook')
    expect(freeze).toContain('No new problems unless explicitly scoped')
    const spec = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_27_CACHE_ONLY_SEGMENTATION_v1.md'),
      'utf8',
    )
    expect(spec).toContain(STEP827_DOCUMENT)
    expect(spec).toContain('Do not start 8.28')
  })

  it('keeps frozen 265 / 38 / 227 and the 8 STEP 8.24 BLOCKED ids', () => {
    expect(FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts).toBe(265)
    expect(FROZEN_PIPELINE_COUNTS.frozenTypeAuto).toBe(38)
    expect(FROZEN_PIPELINE_COUNTS.impliedNonTypeAuto).toBe(227)
    expect(FROZEN_PIPELINE_COUNTS.step823FigureAssets).toBe(3)
    expect(FROZEN_PIPELINE_COUNTS.step823FigureLinks).toBe(3)
    expect([...STEP824_BLOCKED_CANDIDATE_IDS]).toEqual([...UNRESOLVED_PENDING_IDS])
  })
})

describe('STEP 8.27 status mapping', () => {
  it('maps AUTO_OK to HUMAN_REVIEW and never AUTO_APPROVED', () => {
    expect(mapSegmentStatusToPipeline('AUTO_OK')).toEqual({
      status: 'HUMAN_REVIEW',
      reasons: ['SEGMENT_AUTO_OK', 'LATER_GATE_REQUIRED', 'NO_AUTO_APPROVED_IN_8_27'],
    })
    expect(mapSegmentStatusToPipeline('REVIEW').status).toBe('HUMAN_REVIEW')
    expect(mapToGoldStandard('AUTO_APPROVED').mayVerify).toBe(false)
    expect(mapToGoldStandard('HUMAN_REVIEW').review).toBe('NEEDS_REVIEW')
    const items: SegmentPipelineItem[] = [
      {
        candidate_id: '012|0045',
        stage: 'SEGMENT',
        status: 'HUMAN_REVIEW',
        reasons: ['SEGMENT_AUTO_OK'],
        segment_engine_status: 'AUTO_OK',
        source_document_id: STEP827_DOCUMENT,
      },
    ]
    expect(() => assertNoAutoApproved(items)).not.toThrow()
    expect(() =>
      assertNoAutoApproved([{ ...items[0], status: 'AUTO_APPROVED' }]),
    ).toThrow(/must not set AUTO_APPROVED/)
  })
})

describe('STEP 8.27 dry-run gates', () => {
  it('BLOCKED when layout cache and Production schema are missing', () => {
    const dry = evaluateDryRun({
      inventory: emptyInventory(),
      schema: missingSchema,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toEqual(
      expect.arrayContaining([
        'LAYOUT_OCR_CACHE_MISSING',
        'CANDIDATES_CACHE_MISSING',
        'CACHE_MISS_WOULD_CALL_PAID_OCR',
        'PRODUCTION_SCHEMA_ABSENT_OR_UNCONFIRMED',
      ]),
    )
    expect(dry.expected_pipeline_runs).toBe(0)
    expect(dry.expected_pipeline_items).toBe(0)
    expect(dry.problem_production_writes).toBe(0)
    expect(dry.ocr_network_calls).toBe(0)
    expect(dry.original_pdf_required).toBe(false)
    expect(dry.textbook.id).toBe(STEP827_DOCUMENT)
  })

  it('still BLOCKED when schema is present but layout cache is missing', () => {
    const dry = evaluateDryRun({
      inventory: emptyInventory(),
      schema: { ...missingSchema, present: true, queried: true, reason: 'migration_history_has_20260912120000' },
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toEqual(
      expect.arrayContaining(['LAYOUT_OCR_CACHE_MISSING', 'CACHE_MISS_WOULD_CALL_PAID_OCR']),
    )
    expect(dry.blockers).not.toContain('PRODUCTION_SCHEMA_ABSENT_OR_UNCONFIRMED')
    const targets = projectStep827Targets({
      dryRun: dry,
      schemaPresent: true,
      executed: false,
      originalPdfPresent: false,
      originalPdfIsSecondBook: false,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.PASS).toBe(5)
    expect(tally.REVIEW).toBe(0)
    expect(tally.BLOCKED).toBe(13)
    expect(targets.find((row) => row.id === 'production.schema')?.verdict).toBe('PASS')
    expect(targets.find((row) => row.id === 'execute.segment')?.verdict).toBe('BLOCKED')
  })

  it('does not PASS if another textbook is mixed in even with cache', () => {
    const inventory = emptyInventory()
    inventory.candidates_present = true
    inventory.mistral_dir_present = true
    inventory.layout_hits = [
      { page: 12, png_path: 'page-012.png', layout_cache_path: 'mistral.json', hit: true, book: 'SSEN' },
    ]
    const dry = evaluateDryRun({
      inventory,
      schema: { ...missingSchema, present: true },
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: true,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toContain('MIXED_TEXTBOOK')
  })
})

describe('STEP 8.27 progress and idempotency', () => {
  it('matches counters to item statuses and upserts by candidate_id', () => {
    const first: SegmentPipelineItem[] = [
      {
        candidate_id: '108|0735',
        stage: 'SEGMENT',
        status: 'BLOCKED',
        reasons: ['LAYOUT_OCR_CACHE_MISSING'],
        segment_engine_status: null,
        source_document_id: STEP827_DOCUMENT,
      },
      {
        candidate_id: '012|0045',
        stage: 'SEGMENT',
        status: 'HUMAN_REVIEW',
        reasons: ['SEGMENT_AUTO_OK'],
        segment_engine_status: 'AUTO_OK',
        source_document_id: STEP827_DOCUMENT,
      },
    ]
    const progress = progressFromItems(first)
    expect(progress.total).toBe(2)
    expect(progress.blocked).toBe(1)
    expect(progress.human_review).toBe(1)
    expect(progress.auto_approved).toBe(0)
    expect(progress.actual_paid_calls).toBe(0)
    expect(progressMatchesItems(progress, first)).toBe(true)

    const again = upsertItemsIdempotent(first, [
      { ...first[0], reasons: ['LAYOUT_OCR_CACHE_MISSING', 'RESUME'] },
    ])
    expect(again).toHaveLength(2)
    expect(findDuplicateCandidateIds(again)).toEqual([])
    expect(findOrphanItems(again, STEP827_DOCUMENT)).toEqual([])
    expect(findWrongSourceItems([{ ...first[0], source_document_id: SECOND_DOCUMENT }])).toHaveLength(1)
  })
})

describe('STEP 8.27 schema isolation and paid OCR', () => {
  it('refuses mixed pending migrations and placeholder tokens', () => {
    expect(isolated826ApplyAllowed(null)).toEqual({
      allowed: false,
      reason: 'PENDING_MIGRATIONS_UNKNOWN',
    })
    expect(isolated826ApplyAllowed(['20260912120000']).allowed).toBe(true)
    expect(isolated826ApplyAllowed(['20260911123000', '20260912120000']).reason).toBe(
      'OTHER_PENDING_MIGRATIONS_MIXED',
    )
    expect(accessTokenUsable('short-placeholder')).toBe(false)
    expect(accessTokenUsable('')).toBe(false)
    expect(accessTokenUsable('sbp_' + 'x'.repeat(36))).toBe(true)
    expect(accessTokenUsable('a'.repeat(90) + '.b.c')).toBe(true)
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(STEP827_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(denyPaidOcr827()).toEqual({ authorized: false, reason: 'STEP_PAID_OCR_CAP_ZERO' })
  })
})

describe('STEP 8.27 target projection', () => {
  it('PASS lock/exclude/writes/frozen and BLOCKED cache/schema/execute/ocr/pdf/carry-over', () => {
    const dry = evaluateDryRun({
      inventory: emptyInventory(),
      schema: missingSchema,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    const targets = projectStep827Targets({
      dryRun: dry,
      schemaPresent: null,
      executed: false,
      originalPdfPresent: false,
      originalPdfIsSecondBook: false,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.PASS).toBe(4)
    expect(tally.REVIEW).toBe(0)
    expect(tally.BLOCKED).toBe(14)
    expect(targets.find((row) => row.id === 'target.lock')?.verdict).toBe('PASS')
    expect(targets.find((row) => row.id === 'execute.segment')?.reasons).toContain('DRY_RUN_BLOCKED_NO_EXECUTE')
    expect(targets.filter((row) => row.kind === 'CARRY_OVER').map((row) => row.id)).toEqual([
      ...STEP824_BLOCKED_CANDIDATE_IDS,
    ])
  })
})
