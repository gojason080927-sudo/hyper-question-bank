import { describe, expect, it } from 'vitest'
import { fingerprintGtItem, type GtItem } from './structureFromCache828'
import type { Step829ReviewInput } from './imageCompare830'
import {
  authorizePilotPaidOcr,
  buildPilotItem,
  compareOcrToGt,
  estimateMistralUsd,
  mapPilotStatus,
  persistPlanSafe,
  tallyPilot,
  type ExistingDraft,
  type OcrEvidence,
  type RecoveredCrop,
} from './e2ePilot831'

function gt(partial: Partial<GtItem> = {}): GtItem {
  return {
    sample_id: 'S04',
    page_number: 12,
    problem_number: '0040',
    ground_truth_text: '0040 | 대표 문제\n두 다항식 A=2x²-4xy+6y²\n① a\n② b\n③ c\n④ d\n⑤ e',
    ground_truth_math: ['A=2x²-4xy+6y²'],
    ground_truth_choices: ['a', 'b', 'c', 'd', 'e'],
    has_figure: false,
    has_table: false,
    ...partial,
  }
}

function crop(partial: Partial<RecoveredCrop> = {}): RecoveredCrop {
  return {
    sample_id: 'S04',
    present: true,
    path: '.ocr-temp/step8-31/crops/S04.png',
    sha256: 'abc',
    bytes: 100,
    width: 400,
    height: 300,
    frozen_sha256: 'frozen',
    frozen_bytes: 90,
    matches_frozen: false,
    ...partial,
  }
}

function ocr(text: string, present = true): OcrEvidence {
  return { present, provider: present ? 'mistral-ocr' : null, text, http: present ? 200 : null, cached: true }
}

function review(): Step829ReviewInput {
  return {
    candidate_id: 'S04',
    status: 'HUMAN_REVIEW',
    agrees: true,
    dual_would_auto: true,
    checker_a: { checker: 'A', identity: 0.9, structure: 0.9, math: 0.9, figureOwnership: 1 },
    checker_b: { checker: 'B', identity: 0.9, structure: 0.88, math: 0.85, figureOwnership: 1 },
    reasons: ['DUAL_AGREE'],
  }
}

describe('STEP 8.31 paid OCR cap', () => {
  it('authorizes 26 Mistral crop calls under $2 and 30-call cap', () => {
    const decision = authorizePilotPaidOcr({
      estimatedCalls: 26,
      allowPaidApi: true,
      confirmCost: true,
      cacheOnly: false,
    })
    expect(decision.authorized).toBe(true)
    expect(decision.estimatedUsd).toBe(0.104)
    expect(estimateMistralUsd(30)).toBe(0.12)
  })

  it('denies cache-only, missing flags, over 30 calls, and over $2', () => {
    expect(
      authorizePilotPaidOcr({
        estimatedCalls: 26,
        allowPaidApi: true,
        confirmCost: true,
        cacheOnly: true,
      }).reason,
    ).toBe('CACHE_ONLY')
    expect(
      authorizePilotPaidOcr({
        estimatedCalls: 26,
        allowPaidApi: false,
        confirmCost: true,
        cacheOnly: false,
      }).reason,
    ).toBe('PAID_GATE_DENIED')
    expect(
      authorizePilotPaidOcr({
        estimatedCalls: 31,
        allowPaidApi: true,
        confirmCost: true,
        cacheOnly: false,
      }).reason,
    ).toBe('CALLS_EXCEED_CAP')
    expect(
      authorizePilotPaidOcr({
        estimatedCalls: 600,
        allowPaidApi: true,
        confirmCost: true,
        cacheOnly: false,
      }).reason,
    ).toBe('COST_EXCEEDS_CAP')
  })
})

describe('STEP 8.31 original compare and status map', () => {
  it('fails boundary when a neighbor header is in the OCR crop', () => {
    const checks = compareOcrToGt(
      gt(),
      '0040 대표 문제 소개기\n두 다항식 A=2x^2-4xy+6y^2\n① a ② b ③ c ④ d ⑤ e',
    )
    expect(checks.identity).toBe('PASS')
    expect(checks.boundary).toBe('FAIL')
  })

  it('blocks unstable identity and never AUTO_APPROVES', () => {
    const blocked = mapPilotStatus({
      upstreamBlocked: true,
      cropPresent: true,
      ocrPresent: true,
      compared: true,
      imageComparePass: true,
      canonical: null,
      problemNumber: null,
    })
    expect(blocked.status).toBe('BLOCKED')
    expect(blocked.persist).toBe('SKIP_BLOCKED')
    const section = mapPilotStatus({
      upstreamBlocked: false,
      cropPresent: true,
      ocrPresent: true,
      compared: true,
      imageComparePass: true,
      canonical: null,
      problemNumber: '01-1',
    })
    expect(section.status).toBe('HUMAN_REVIEW')
    expect(section.persist).toBe('SKIP_IDENTITY')
    const numbered = mapPilotStatus({
      upstreamBlocked: false,
      cropPresent: true,
      ocrPresent: true,
      compared: true,
      imageComparePass: true,
      canonical: '0040',
      problemNumber: '0040',
    })
    expect(numbered.status).toBe('HUMAN_REVIEW')
    expect(numbered.persist).toBe('CREATE_DRAFT')
  })

  it('records an existing Production draft instead of creating a duplicate', () => {
    const existing: ExistingDraft = {
      problem_id: 'prob-1',
      public_code: 'HQB-000364',
      review_status: 'UNREVIEWED',
      lifecycle_status: 'DRAFT',
      current_version_id: 'ver-1',
    }
    const item = buildPilotItem({
      gt: gt(),
      cachedStatus: 'HUMAN_REVIEW',
      review: review(),
      crop: crop(),
      ocr: ocr('0040 두 다항식 A=2x^2-4xy+6y^2 ① a ② b ③ c ④ d ⑤ e'),
      existing,
    })
    expect(item.status).toBe('HUMAN_REVIEW')
    expect(item.persist_action).toBe('RECORD_EXISTING')
    expect(item.compared).toBe(true)
    expect(item.reasons).toContain('EXISTING_PRODUCTION_DRAFT')
    expect(item.content_fingerprint).toBe(fingerprintGtItem(gt()))
  })

  it('aborts persist when a create would collide or AUTO_APPROVED appears', () => {
    const item = buildPilotItem({
      gt: gt(),
      cachedStatus: 'HUMAN_REVIEW',
      review: review(),
      crop: crop(),
      ocr: ocr('0040 두 다항식 A=2x^2-4xy+6y^2 ① a ② b ③ c ④ d ⑤ e'),
      existing: {
        problem_id: 'prob-1',
        public_code: 'HQB-000364',
        review_status: 'UNREVIEWED',
        lifecycle_status: 'DRAFT',
        current_version_id: 'ver-1',
      },
    })
    const colliding = { ...item, persist_action: 'CREATE_DRAFT' as const }
    expect(persistPlanSafe([colliding]).ok).toBe(false)
    expect(persistPlanSafe([{ ...item, status: 'AUTO_APPROVED' }]).ok).toBe(false)
    expect(persistPlanSafe([item]).ok).toBe(true)
  })

  it('tallies conservative HUMAN_REVIEW without AUTO_APPROVED', () => {
    const human = buildPilotItem({
      gt: gt(),
      cachedStatus: 'HUMAN_REVIEW',
      review: review(),
      crop: crop(),
      ocr: ocr('0040 두 다항식 A=2x^2-4xy+6y^2 ① a ② b ③ c ④ d ⑤ e'),
      existing: null,
    })
    const blocked = buildPilotItem({
      gt: gt({ sample_id: 'S02', problem_number: null, page_number: 8 }),
      cachedStatus: 'BLOCKED',
      review: { ...review(), candidate_id: 'S02' },
      crop: crop({ sample_id: 'S02' }),
      ocr: ocr('empty identity'),
      existing: null,
    })
    const tally = tallyPilot([human, blocked])
    expect(tally.auto_approved).toBe(0)
    expect(tally.human_review).toBe(1)
    expect(tally.blocked).toBe(1)
    expect(tally.create_draft).toBe(1)
  })
})
