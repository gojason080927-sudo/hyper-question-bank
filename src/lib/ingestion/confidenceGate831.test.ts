import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'
import { FROZEN_PIPELINE_COUNTS, STEP824_BLOCKED_CANDIDATE_IDS, mapToGoldStandard } from './batchPipeline825'
import { fingerprintGtItem, type GtItem } from './structureFromCache828'
import type { Step828CachedItem } from './dualAiReview829'
import {
  STEP830_DOCUMENT,
  type ManifestSample,
  type Step829ReviewInput,
} from './imageCompare830'
import {
  STEP831,
  STEP831_DOCUMENT,
  STEP831_PAID_OCR_CAP,
  buildGateItem,
  denyPaidOcr831,
  emptyRecoveredCrop,
  evaluateDryRun,
  emptyGateInventory,
  mapConfidence831,
  persistPlanSafe,
  projectStep831Targets,
  sectionDAllMet,
  tallyVerdicts,
  type GateItem,
  type RecoveredCrop,
} from './confidenceGate831'

function gt(partial: Partial<GtItem> = {}): GtItem {
  return {
    sample_id: 'S04',
    page_number: 12,
    problem_number: '0040',
    ground_truth_text:
      '0040 | 대표 문제\n두 다항식 A=2x²-4xy+6y²\n① a\n② b\n③ c\n④ d\n⑤ e',
    ground_truth_math: ['A=2x²-4xy+6y²'],
    ground_truth_choices: ['a', 'b', 'c', 'd', 'e'],
    has_figure: false,
    has_table: false,
    ...partial,
  }
}

function cached(item: GtItem, status: Step828CachedItem['status'] = 'HUMAN_REVIEW'): Step828CachedItem {
  return {
    candidate_id: item.sample_id,
    page_number: item.page_number,
    problem_number: item.problem_number,
    status,
    reasons: ['STRUCTURED_FROM_GT'],
    choice_count: item.ground_truth_choices.length,
    answer_candidate: null,
    explanation: null,
    content_fingerprint: fingerprintGtItem(item),
  }
}

function review(partial: Partial<Step829ReviewInput> = {}): Step829ReviewInput {
  return {
    candidate_id: 'S04',
    status: 'HUMAN_REVIEW',
    agrees: true,
    dual_would_auto: true,
    checker_a: { checker: 'A', identity: 0.92, structure: 0.9, math: 0.9, figureOwnership: 1 },
    checker_b: { checker: 'B', identity: 0.9, structure: 0.88, math: 0.85, figureOwnership: 1 },
    reasons: ['DUAL_AGREE'],
    ...partial,
  }
}

function sample(item: GtItem): ManifestSample {
  return {
    sample_id: item.sample_id,
    document_id: STEP830_DOCUMENT,
    page_number: item.page_number,
    bbox: { x: 0.04, y: 0.11, width: 0.45, height: 0.28, unit: 'normalized', origin: 'top-left' },
    crop_file: `data/crops/${item.sample_id}.png`,
    crop_sha256: 'frozen-hash',
    crop_bytes: 10,
  }
}

function recovered(item: GtItem, matchFrozen = false): RecoveredCrop {
  return {
    sample_id: item.sample_id,
    present: true,
    path: `.ocr-temp/step8-31/crops/${item.sample_id}.png`,
    sha256: matchFrozen ? 'frozen-hash' : 'recovered-hash',
    bytes: 12,
    width: 100,
    height: 80,
    frozen_sha256: 'frozen-hash',
    frozen_bytes: 10,
    matches_frozen: matchFrozen,
    source_kind: 'recovered_from_original_bbox',
    substituted: false,
  }
}

function ocrOk() {
  return {
    present: true,
    cached: true,
    provider: 'mistral-ocr' as const,
    text: '0040 대표 문제 두 다항식 A=2x^2-4xy+6y^2 ① a ② b ③ c ④ d ⑤ e',
    http: 200,
  }
}

describe('STEP 8.31 scope freeze', () => {
  it('locks SSEN, 8.25 §J 8.31, and paid OCR 0 / $0', () => {
    expect(STEP831).toBe('8.31')
    expect(STEP831_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    expect(STEP831_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(denyPaidOcr831().authorized).toBe(false)
    const freeze = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md'),
      'utf8',
    )
    expect(freeze).toContain('Confidence gate persist **DRAFT** + queue `HUMAN_REVIEW`')
    expect(freeze).toMatch(/\*\*8\.31\*\*.*Drafts only, never VERIFIED/)
    const spec = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_31_CONFIDENCE_GATE_PERSIST_v1.md'),
      'utf8',
    )
    expect(spec).toContain(STEP831_DOCUMENT)
    expect(spec).toContain('0 calls / $0')
    expect(spec).toContain('Do not AUTO_APPROVE those items on confidence score alone')
    expect(spec).toContain('does **not** start STEP 8.32')
    expect([...STEP824_BLOCKED_CANDIDATE_IDS]).toEqual([...UNRESOLVED_PENDING_IDS])
    expect(FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts).toBe(265)
    expect(FROZEN_PIPELINE_COUNTS.frozenTypeAuto).toBe(38)
  })
})

describe('STEP 8.31 confidence mapping', () => {
  it('BLOCKED when crop is still missing', () => {
    const mapped = mapConfidence831({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: false,
      frozenHashMatch: false,
      substituted: false,
      imageComparePass: false,
      step830ImageComparePass: false,
      sectionDAllMet: false,
      canonical: '0040',
      problemNumber: '0040',
      existing: null,
      gateRaw: 'HUMAN_REVIEW',
    })
    expect(mapped.status).toBe('BLOCKED')
    expect(mapped.persist).toBe('SKIP_BLOCKED')
    expect(mapped.reasons).toContain('CROP_CACHE_MISSING')
  })

  it('BLOCKED when identity is unstable', () => {
    const mapped = mapConfidence831({
      fingerprintOk: true,
      upstreamStatus: 'BLOCKED',
      dualStatus: 'BLOCKED',
      cropPresent: true,
      frozenHashMatch: false,
      substituted: false,
      imageComparePass: false,
      step830ImageComparePass: false,
      sectionDAllMet: false,
      canonical: null,
      problemNumber: null,
      existing: null,
      gateRaw: 'BLOCKED',
    })
    expect(mapped.status).toBe('BLOCKED')
    expect(mapped.persist).toBe('SKIP_BLOCKED')
    expect(mapped.reasons).toContain('UPSTREAM_IDENTITY_UNSTABLE')
  })

  it('HUMAN_REVIEW for recovered crop + identity without §D, never AUTO from 8.30 fail', () => {
    const mapped = mapConfidence831({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      frozenHashMatch: false,
      substituted: false,
      imageComparePass: false,
      step830ImageComparePass: false,
      sectionDAllMet: false,
      canonical: '0040',
      problemNumber: '0040',
      existing: null,
      gateRaw: 'HUMAN_REVIEW',
    })
    expect(mapped.status).toBe('HUMAN_REVIEW')
    expect(mapped.persist).toBe('QUEUE_ONLY')
    expect(mapped.reasons).toContain('STEP_8_30_IMAGE_COMPARE_FAIL')
    expect(mapped.reasons).toContain('NO_NEW_PROBLEM_FOR_HUMAN_REVIEW')
    expect(mapToGoldStandard(mapped.status).mayVerify).toBe(false)
    expect(mapToGoldStandard(mapped.status).review).not.toBe('VERIFIED')
  })

  it('SKIP_IDENTITY for non-canonical numbers that still have a crop', () => {
    const mapped = mapConfidence831({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      frozenHashMatch: false,
      substituted: false,
      imageComparePass: false,
      step830ImageComparePass: false,
      sectionDAllMet: false,
      canonical: null,
      problemNumber: '01-1',
      existing: null,
      gateRaw: 'HUMAN_REVIEW',
    })
    expect(mapped.status).toBe('HUMAN_REVIEW')
    expect(mapped.persist).toBe('SKIP_IDENTITY')
  })

  it('AUTO_APPROVED only when every §D clause including 8.30 image compare holds', () => {
    expect(
      sectionDAllMet({
        canonical: '0040',
        fingerprintOk: true,
        cropPresent: true,
        frozenHashMatch: true,
        cropSafe: true,
        neighborBlocking: false,
        substituted: false,
        structureConfidence: 0.9,
        identityConfidence: 0.9,
        hasFigure: false,
        figureOwnershipConfidence: 1,
        figureAutoSafe: true,
        dualAgrees: true,
        imageComparePass: true,
        step830ImageComparePass: true,
        needsPaidOcr: false,
        upstreamBlocked: false,
      }),
    ).toBe(true)
    expect(
      sectionDAllMet({
        canonical: '0040',
        fingerprintOk: true,
        cropPresent: true,
        frozenHashMatch: false,
        cropSafe: true,
        neighborBlocking: false,
        substituted: false,
        structureConfidence: 0.99,
        identityConfidence: 0.99,
        hasFigure: false,
        figureOwnershipConfidence: 1,
        figureAutoSafe: true,
        dualAgrees: true,
        imageComparePass: false,
        step830ImageComparePass: false,
        needsPaidOcr: false,
        upstreamBlocked: false,
      }),
    ).toBe(false)
    const mapped = mapConfidence831({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      frozenHashMatch: true,
      substituted: false,
      imageComparePass: true,
      step830ImageComparePass: true,
      sectionDAllMet: true,
      canonical: '0040',
      problemNumber: '0040',
      existing: null,
      gateRaw: 'AUTO_APPROVED',
    })
    expect(mapped.status).toBe('AUTO_APPROVED')
    expect(mapped.persist).toBe('CREATE_DRAFT')
    expect(mapToGoldStandard(mapped.status).lifecycle).toBe('DRAFT')
    expect(mapToGoldStandard(mapped.status).mayVerify).toBe(false)
  })

  it('does not AUTO_APPROVE a recovered crop even when dual scores are high', () => {
    const item = gt()
    const row = buildGateItem({
      gt: item,
      cached: cached(item),
      review: review(),
      sample: sample(item),
      crop: recovered(item, false),
      ocr: ocrOk(),
      existing: null,
      siblingBboxes: [],
      step830ImageComparePass: false,
    })
    expect(row.status).toBe('HUMAN_REVIEW')
    expect(row.section_d_all_met).toBe(false)
    expect(row.image_compare_pass).toBe(false)
    expect(row.persist_action).toBe('QUEUE_ONLY')
  })

  it('abort persist if AUTO is planned without §D or HUMAN_REVIEW would CREATE', () => {
    const item = gt()
    const illegal = buildGateItem({
      gt: item,
      cached: cached(item),
      review: review(),
      sample: sample(item),
      crop: recovered(item, false),
      ocr: ocrOk(),
      existing: null,
      siblingBboxes: [],
      step830ImageComparePass: false,
    })
    const forced: GateItem = { ...illegal, status: 'AUTO_APPROVED', persist_action: 'CREATE_DRAFT', section_d_all_met: false }
    const plan = persistPlanSafe([forced])
    expect(plan.ok).toBe(false)
    expect(plan.reasons.some((row) => row.startsWith('AUTO_WITHOUT_SECTION_D'))).toBe(true)
    const humanCreate: GateItem = { ...illegal, persist_action: 'CREATE_DRAFT' }
    expect(persistPlanSafe([humanCreate]).ok).toBe(false)
  })
})

describe('STEP 8.31 dry-run and targets', () => {
  it('fails closed on paid OCR and missing 8.30 cache', () => {
    const inventory = emptyGateInventory()
    const dry = evaluateDryRun({
      inventory,
      problemPersistRequested: false,
      paidApiRequested: true,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toContain('PAID_OCR_FLAG')
    expect(dry.ocr_network_calls).toBe(0)
  })

  it('never mints a target REVIEW by relaxing gates', () => {
    const inventory = emptyGateInventory()
    inventory.step828_items_present = true
    inventory.step828_count = 26
    inventory.step829_reviews_present = true
    inventory.step829_count = 26
    inventory.step830_compares_present = true
    inventory.step830_count = 26
    inventory.gt_present = true
    inventory.gt_count = 26
    inventory.gt_sha256 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
    inventory.manifest_present = true
    inventory.manifest_count = 26
    const dry = evaluateDryRun({
      inventory,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    const targets = projectStep831Targets({
      dryRun: dry,
      executed: true,
      originalPdfHashMatch: true,
      recoveredCrops: 26,
      autoApproved: 0,
      createDraft: 0,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.REVIEW).toBe(0)
    expect(tally.PASS).toBe(12)
    expect(tally.BLOCKED).toBe(10)
    expect(emptyRecoveredCrop(sample(gt())).present).toBe(false)
  })
})
