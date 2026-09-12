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
import { SECOND_DOCUMENT, SECOND_PDF_SHA256 } from './cacheSegment827'
import {
  EXPECTED_GT_COUNT,
  STEP828,
  STEP828_DOCUMENT,
  STEP828_DOCUMENT_TITLE,
  STEP828_GT_SHA256,
  STEP828_PAID_OCR_CAP,
  assertDraftPersistFrozenOff,
  assertNoAutoApproved,
  assertNoContentRewrite,
  denyPaidOcr828,
  emptyGtInventory,
  evaluateDryRun,
  findDuplicateCandidateIds,
  findOrphanItems,
  findWrongSourceItems,
  fingerprintGtItem,
  mapGtToPipeline,
  mapStructureStatus,
  parseGtFile,
  progressFromItems,
  progressMatchesItems,
  projectStep828Targets,
  tallyVerdicts,
  upsertItemsIdempotent,
  type GtItem,
  type StructurePipelineItem,
} from './structureFromCache828'

function sample(partial: Partial<GtItem> = {}): GtItem {
  return {
    sample_id: 'S04',
    page_number: 12,
    problem_number: '0040',
    ground_truth_text: '0040 stem\n① a\n② b',
    ground_truth_math: ['x²'],
    ground_truth_choices: ['a', 'b'],
    has_figure: false,
    has_table: false,
    ...partial,
  }
}

describe('STEP 8.28 scope freeze', () => {
  it('locks SSEN, excludes SECOND, and names 8.28 from the 8.25 freeze', () => {
    expect(STEP828).toBe('8.28')
    expect(STEP828_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    expect(STEP828_DOCUMENT_TITLE).toBe('쎈수학 공통수학1')
    expect(SECOND_DOCUMENT).toBe('190fb31b-03f5-43b9-b696-cce7a823a321')
    expect(STEP828_DOCUMENT).not.toBe(SECOND_DOCUMENT)
    expect(STEP828_GT_SHA256).toBe('31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb')
    expect(EXPECTED_GT_COUNT).toBe(26)
    const freeze = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md'),
      'utf8',
    )
    expect(freeze).toContain('Structure stem/choices/answer/explanation from existing OCR/GT only')
    expect(freeze).toContain('Drafts only if a later freeze allows')
    const spec = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_28_STRUCTURE_FROM_CACHE_v1.md'),
      'utf8',
    )
    expect(spec).toContain(STEP828_DOCUMENT)
    expect(spec).toContain('Do not start 8.29')
    expect(spec).toContain(STEP828_GT_SHA256)
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

describe('STEP 8.28 status mapping', () => {
  it('maps stable GT to HUMAN_REVIEW and never AUTO_APPROVED', () => {
    expect(mapStructureStatus({ problemNumber: '0040', stemText: 'stem' })).toEqual({
      status: 'HUMAN_REVIEW',
      reasons: [
        'STRUCTURED_FROM_GT',
        'LATER_GATE_REQUIRED',
        'NO_AUTO_APPROVED_IN_8_28',
        'DRAFT_PERSIST_FROZEN_OFF',
      ],
    })
    expect(mapStructureStatus({ problemNumber: null, stemText: 'sidebar' }).status).toBe('BLOCKED')
    expect(mapStructureStatus({ problemNumber: '0040', stemText: '  ' }).reasons).toContain('NO_COMMITTED_STEM')
    expect(mapToGoldStandard('AUTO_APPROVED').mayVerify).toBe(false)
    expect(mapToGoldStandard('HUMAN_REVIEW').review).toBe('NEEDS_REVIEW')
    const item = mapGtToPipeline(sample())
    expect(item.status).toBe('HUMAN_REVIEW')
    expect(item.explanation).toBeNull()
    expect(item.stem_text).toBe(sample().ground_truth_text)
    expect(item.choices.map((row) => row.text)).toEqual(['a', 'b'])
    expect(() => assertNoAutoApproved([item])).not.toThrow()
    expect(() => assertDraftPersistFrozenOff([item])).not.toThrow()
    expect(() => assertNoAutoApproved([{ ...item, status: 'AUTO_APPROVED' }])).toThrow(/must not set AUTO_APPROVED/)
  })

  it('copies GT and does not invent explanations or rewrite stem/choices', () => {
    const gt = sample()
    const item = mapGtToPipeline(gt)
    expect(() => assertNoContentRewrite([item], [gt])).not.toThrow()
    expect(() =>
      assertNoContentRewrite([{ ...item, stem_text: 'rewritten' }], [gt]),
    ).toThrow(/rewrote stem/)
    expect(() =>
      assertNoContentRewrite([{ ...item, explanation: 'made up' as unknown as null }], [gt]),
    ).toThrow(/invented explanation/)
  })
})

describe('STEP 8.28 dry-run gates', () => {
  it('BLOCKED when GT cache is missing', () => {
    const dry = evaluateDryRun({
      inventory: emptyGtInventory(),
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toEqual(expect.arrayContaining(['GT_CACHE_MISSING']))
    expect(dry.expected_pipeline_runs).toBe(0)
    expect(dry.expected_pipeline_items).toBe(0)
    expect(dry.problem_production_writes).toBe(0)
    expect(dry.draft_persist).toBe(false)
    expect(dry.ocr_network_calls).toBe(0)
    expect(dry.structure_targets).toBe(0)
  })

  it('PASSes dry-run when frozen 26-item GT hash matches', () => {
    const inventory = emptyGtInventory()
    inventory.present = true
    inventory.count = 26
    inventory.document_id = STEP828_DOCUMENT
    inventory.sha256 = STEP828_GT_SHA256
    const dry = evaluateDryRun({
      inventory,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(true)
    expect(dry.structure_targets).toBe(26)
    expect(dry.blockers).toEqual([])
  })

  it('does not PASS if persist, paid OCR, or another textbook is mixed in', () => {
    const inventory = emptyGtInventory()
    inventory.present = true
    inventory.count = 26
    inventory.document_id = STEP828_DOCUMENT
    inventory.sha256 = STEP828_GT_SHA256
    expect(
      evaluateDryRun({
        inventory,
        problemPersistRequested: true,
        paidApiRequested: false,
        mixedTextbook: false,
      }).blockers,
    ).toContain('PROBLEM_PERSIST_ENABLED')
    expect(
      evaluateDryRun({
        inventory,
        problemPersistRequested: false,
        paidApiRequested: true,
        mixedTextbook: false,
      }).blockers,
    ).toContain('PAID_OCR_FLAG')
    expect(
      evaluateDryRun({
        inventory,
        problemPersistRequested: false,
        paidApiRequested: false,
        mixedTextbook: true,
      }).blockers,
    ).toContain('MIXED_TEXTBOOK')
  })
})

describe('STEP 8.28 progress and idempotency', () => {
  it('matches counters to item statuses and upserts by sample_id', () => {
    const first: StructurePipelineItem[] = [
      mapGtToPipeline(sample()),
      mapGtToPipeline(sample({ sample_id: 'S02', problem_number: null, ground_truth_choices: [] })),
    ]
    const progress = progressFromItems(first)
    expect(progress.total).toBe(2)
    expect(progress.human_review).toBe(1)
    expect(progress.blocked).toBe(1)
    expect(progress.auto_approved).toBe(0)
    expect(progress.actual_paid_calls).toBe(0)
    expect(progressMatchesItems(progress, first)).toBe(true)
    const again = upsertItemsIdempotent(first, [{ ...first[0], reasons: [...first[0].reasons, 'RESUME'] }])
    expect(again).toHaveLength(2)
    expect(findDuplicateCandidateIds(again)).toEqual([])
    expect(findOrphanItems(again, STEP828_DOCUMENT)).toEqual([])
    expect(findWrongSourceItems([{ ...first[0], source_document_id: SECOND_DOCUMENT }])).toHaveLength(1)
    expect(fingerprintGtItem(sample()).includes('S04')).toBe(true)
  })
})

describe('STEP 8.28 paid OCR and target projection', () => {
  it('keeps paid routing false and cap at zero', () => {
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(STEP828_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(denyPaidOcr828()).toEqual({ authorized: false, reason: 'STEP_PAID_OCR_CAP_ZERO' })
  })

  it('PASS lock/gt/execute/writes/frozen and BLOCKED textbook/ocr/pdf/carry-over', () => {
    const inventory = emptyGtInventory()
    inventory.present = true
    inventory.count = 26
    inventory.document_id = STEP828_DOCUMENT
    inventory.sha256 = STEP828_GT_SHA256
    const dry = evaluateDryRun({
      inventory,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    const targets = projectStep828Targets({
      dryRun: dry,
      executed: true,
      originalPdfPresent: false,
      originalPdfIsSecondBook: false,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.PASS).toBe(7)
    expect(tally.REVIEW).toBe(0)
    expect(tally.BLOCKED).toBe(11)
    expect(targets.find((row) => row.id === 'execute.structure')?.verdict).toBe('PASS')
    expect(targets.find((row) => row.id === 'full_textbook')?.verdict).toBe('BLOCKED')
    expect(targets.find((row) => row.id === 'draft_persist_denied')?.verdict).toBe('PASS')
    expect(targets.filter((row) => row.kind === 'CARRY_OVER').map((row) => row.id)).toEqual([
      ...STEP824_BLOCKED_CANDIDATE_IDS,
    ])
    expect(SECOND_PDF_SHA256).not.toBe(STEP828_GT_SHA256)
  })
})

describe('STEP 8.28 real GT parse', () => {
  it('reads 26 SSEN items without rewriting bytes', () => {
    const raw = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'), 'utf8')
    const gt = parseGtFile(JSON.parse(raw))
    expect(gt.document_id).toBe(STEP828_DOCUMENT)
    expect(gt.items).toHaveLength(26)
    const items = gt.items.map((row) => mapGtToPipeline(row))
    expect(() => assertNoContentRewrite(items, gt.items)).not.toThrow()
    expect(() => assertNoAutoApproved(items)).not.toThrow()
    expect(items.filter((row) => row.status === 'HUMAN_REVIEW')).toHaveLength(22)
    expect(items.filter((row) => row.status === 'BLOCKED')).toHaveLength(4)
    expect(items.every((row) => row.explanation === null)).toBe(true)
  })
})
