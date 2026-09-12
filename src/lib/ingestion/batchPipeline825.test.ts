import { describe, expect, it } from 'vitest'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'
import { FROZEN_TYPE_AUTO } from './step817Run'
import { STEP812_EXPECTED_DRAFTS } from '../taxonomy/classificationPersistence'
import { FROZEN_DRAFTS_BEFORE } from '../cropRecovery/cropRecoveryV1'
import {
  CONFIDENCE_HIGH,
  FROZEN_PIPELINE_COUNTS,
  PIPELINE_ITEM_STATUSES,
  PIPELINE_STAGES,
  QUESTION_BANK_REF,
  STEP824_BLOCKED_CANDIDATE_IDS,
  STEP825,
  STEP825_PAID_OCR_CAP,
  STEP825_SAFETY,
  STUDENT_CARE_REF,
  assertNeverVerified,
  authorizePaidOcr,
  carryOverBlockedReason,
  combineDualReview,
  estimateMathpixUsd,
  evaluateConfidenceGate,
  mapToGoldStandard,
  reGateAfterAiFix,
  refuseStudentCareUrl,
  sameDedupKey,
  summarizeProgress,
  type ConfidenceEvidence,
  type DualReviewScore,
  type PaidOcrRequest,
} from './batchPipeline825'

function score(checker: 'A' | 'B', n: number): DualReviewScore {
  return { checker, identity: n, structure: n, math: n, figureOwnership: n }
}

function evidence(partial: Partial<ConfidenceEvidence> = {}): ConfidenceEvidence {
  return {
    identityConfidence: 0.92,
    structureConfidence: 0.88,
    cropSafe: true,
    neighborBlocking: false,
    mathConflict: false,
    hasFigure: false,
    figureOwnershipConfidence: 1,
    figureAutoSafe: true,
    imageComparePass: true,
    dual: [score('A', 0.9), score('B', 0.9)],
    needsPaidOcr: false,
    problemIngested: true,
    committedStem: true,
    ...partial,
  }
}

function paid(partial: Partial<PaidOcrRequest> = {}): PaidOcrRequest {
  return {
    providerConfigured: true,
    estimatedCalls: 5,
    estimatedUsd: 0.025,
    cacheOnly: false,
    allowPaidApi: true,
    confirmCost: true,
    paidRoutingEnabled: false,
    stepMaxCalls: 8,
    stepMaxUsd: 1,
    ...partial,
  }
}

describe('STEP 8.25 design freeze identity', () => {
  it('uses the next sequential step number and question-bank ref only', () => {
    expect(STEP825).toBe('8.25')
    expect(QUESTION_BANK_REF).toBe('owpxsmdcxjmsgadkdsci')
    expect(STUDENT_CARE_REF).toBe('pwuswjauzdxewmtgoitf')
    expect(STEP825_SAFETY.runtimeIngestImplemented).toBe(false)
    expect(STEP825_SAFETY.productionWrites).toBe(0)
    expect(STEP825_SAFETY.paidApiCalls).toEqual({ mathpix: 0, mistral: 0 })
    expect(STEP825_SAFETY.studentCareAccessed).toBe(false)
  })

  it('refuses Student Care URLs and non-question-bank supabase URLs', () => {
    expect(() => refuseStudentCareUrl(`https://${STUDENT_CARE_REF}.supabase.co`)).toThrow(/Student Care/)
    expect(() => refuseStudentCareUrl('https://otherproj.supabase.co')).toThrow(/Wrong Supabase/)
    expect(() => refuseStudentCareUrl(`https://${QUESTION_BANK_REF}.supabase.co`)).not.toThrow()
  })

  it('keeps five distinct pipeline statuses and the frozen stage order', () => {
    expect([...PIPELINE_ITEM_STATUSES]).toEqual([
      'AUTO_APPROVED',
      'AI_FIXED',
      'HUMAN_REVIEW',
      'BLOCKED',
      'FAILED',
    ])
    expect(new Set(PIPELINE_ITEM_STATUSES).size).toBe(5)
    expect(PIPELINE_STAGES[0]).toBe('SOURCE_REGISTER')
    expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1]).toBe('LEARN_CORRECTIONS')
  })
})

describe('STEP 8.25 frozen historical counts', () => {
  it('does not change 265 drafts / 38 type AUTO / 227 remainder', () => {
    expect(FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts).toBe(265)
    expect(FROZEN_PIPELINE_COUNTS.frozenTypeAuto).toBe(38)
    expect(FROZEN_PIPELINE_COUNTS.impliedNonTypeAuto).toBe(227)
    expect(FROZEN_PIPELINE_COUNTS.impliedNonTypeAuto).toBe(
      FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts - FROZEN_PIPELINE_COUNTS.frozenTypeAuto,
    )
    expect(STEP812_EXPECTED_DRAFTS).toBe(265)
    expect(FROZEN_DRAFTS_BEFORE).toBe(265)
    expect(FROZEN_TYPE_AUTO).toBe(38)
    expect(FROZEN_PIPELINE_COUNTS.step823FigureAssets).toBe(3)
    expect(FROZEN_PIPELINE_COUNTS.step823FigureLinks).toBe(3)
    expect(FROZEN_PIPELINE_COUNTS.step824BlockedRemaining).toBe(8)
  })

  it('carries the same 8 STEP 8.24 BLOCKED ids and does not invent new ones', () => {
    expect([...STEP824_BLOCKED_CANDIDATE_IDS]).toEqual([...UNRESOLVED_PENDING_IDS])
    expect(STEP824_BLOCKED_CANDIDATE_IDS).toHaveLength(8)
    for (const id of STEP824_BLOCKED_CANDIDATE_IDS) {
      expect(carryOverBlockedReason(id)).toEqual([
        'PROBLEM_NOT_INGESTED',
        'NO_COMMITTED_STEM',
        'NEEDS_PAID_OCR',
        'CARRY_OVER_STEP_8_24',
      ])
    }
    expect(() => carryOverBlockedReason('12|0045')).toThrow(/not a STEP 8.24/)
  })
})

describe('STEP 8.25 Gold Standard mapping', () => {
  it('never maps AUTO_APPROVED to VERIFIED or WORKSHEET_ELIGIBLE', () => {
    const mapping = mapToGoldStandard('AUTO_APPROVED')
    expect(mapping.lifecycle).toBe('DRAFT')
    expect(mapping.review).toBe('AUTO_CLASSIFIED')
    expect(mapping.useStatus).toBe('INTERNAL_ONLY')
    expect(mapping.persistDraft).toBe(true)
    expect(mapping.queueHuman).toBe(false)
    expect(mapping.mayVerify).toBe(false)
    expect(() => assertNeverVerified(mapping)).not.toThrow()
  })

  it('queues HUMAN_REVIEW as NEEDS_REVIEW drafts and leaves BLOCKED/FAILED unpersisted', () => {
    const human = mapToGoldStandard('HUMAN_REVIEW')
    expect(human.review).toBe('NEEDS_REVIEW')
    expect(human.queueHuman).toBe(true)
    expect(human.mayVerify).toBe(false)
    const blocked = mapToGoldStandard('BLOCKED')
    expect(blocked.persistDraft).toBe(false)
    expect(blocked.queueHuman).toBe(true)
    const failed = mapToGoldStandard('FAILED')
    expect(failed.persistDraft).toBe(false)
    expect(failed.review).toBeNull()
  })

  it('treats AI_FIXED as intermediate and requires re-gate to a terminal status', () => {
    const mapping = mapToGoldStandard('AI_FIXED')
    expect(mapping.persistDraft).toBe(false)
    expect(mapping.review).toBeNull()
    expect(reGateAfterAiFix('AUTO_APPROVED')).toBe('AUTO_APPROVED')
    expect(reGateAfterAiFix('HUMAN_REVIEW')).toBe('HUMAN_REVIEW')
    expect(reGateAfterAiFix('BLOCKED')).toBe('BLOCKED')
    expect(reGateAfterAiFix('FAILED')).toBe('FAILED')
  })
})

describe('STEP 8.25 confidence gate and dual review', () => {
  it('AUTO_APPROVED only when dual checkers agree above the frozen HIGH band', () => {
    expect(evaluateConfidenceGate(evidence())).toBe('AUTO_APPROVED')
    expect(CONFIDENCE_HIGH).toBe(0.78)
    expect(combineDualReview(score('A', 0.9), score('B', 0.9))).toBe('AUTO_APPROVED')
    expect(combineDualReview(score('A', 0.9), score('B', 0.5))).toBe('HUMAN_REVIEW')
  })

  it('sends image-compare failure, dual disagreement, and weak structure to HUMAN_REVIEW', () => {
    expect(evaluateConfidenceGate(evidence({ imageComparePass: false }))).toBe('HUMAN_REVIEW')
    expect(evaluateConfidenceGate(evidence({ dual: [score('A', 0.9), score('B', 0.4)] }))).toBe('HUMAN_REVIEW')
    expect(evaluateConfidenceGate(evidence({ structureConfidence: 0.4 }))).toBe('HUMAN_REVIEW')
    expect(evaluateConfidenceGate(evidence({ mathConflict: true }))).toBe('HUMAN_REVIEW')
  })

  it('blocks unsafe crops, unstable identity, unpaid OCR, and 8.24-style missing ingest without stem', () => {
    expect(evaluateConfidenceGate(evidence({ cropSafe: false }))).toBe('BLOCKED')
    expect(evaluateConfidenceGate(evidence({ neighborBlocking: true }))).toBe('BLOCKED')
    expect(evaluateConfidenceGate(evidence({ identityConfidence: 0.2 }))).toBe('BLOCKED')
    expect(evaluateConfidenceGate(evidence({ needsPaidOcr: true }))).toBe('BLOCKED')
    expect(
      evaluateConfidenceGate(evidence({ problemIngested: false, committedStem: false })),
    ).toBe('BLOCKED')
    expect(
      evaluateConfidenceGate(evidence({ problemIngested: false, committedStem: true })),
    ).toBe('HUMAN_REVIEW')
  })
})

describe('STEP 8.25 paid OCR deny and cost estimate', () => {
  it('keeps production paid routing disabled and this STEP cap at 0', () => {
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(STEP825_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(estimateMathpixUsd(5)).toBe(0.01)
    expect(estimateMathpixUsd(0)).toBe(0)
  })

  it('never authorizes paid OCR in 8.25, including when a later gate would look open', () => {
    expect(authorizePaidOcr(paid({ stepMaxCalls: 0, stepMaxUsd: 0 })).authorized).toBe(false)
    expect(authorizePaidOcr(paid({ stepMaxCalls: 0, stepMaxUsd: 0 })).reason).toBe('STEP_PAID_OCR_CAP_ZERO')
    expect(authorizePaidOcr(paid({ paidRoutingEnabled: true })).reason).toBe('PAID_ROUTING_FLAG_MUST_STAY_FALSE')
    expect(authorizePaidOcr(paid({ cacheOnly: true, stepMaxCalls: 8 })).reason).toBe('CACHE_ONLY')
    expect(authorizePaidOcr(paid({ providerConfigured: false, stepMaxCalls: 8 })).reason).toBe(
      'PROVIDER_NOT_CONFIGURED',
    )
    expect(authorizePaidOcr(paid({ allowPaidApi: false, stepMaxCalls: 8 })).reason).toBe('PAID_GATE_DENIED')
    expect(authorizePaidOcr(paid({ estimatedCalls: 99, stepMaxCalls: 8, stepMaxUsd: 1 })).reason).toBe(
      'CALLS_EXCEED_CAP',
    )
    expect(authorizePaidOcr(paid({ estimatedUsd: 2, stepMaxCalls: 8, stepMaxUsd: 1 })).reason).toBe(
      'COST_EXCEEDS_CAP',
    )
    const openLooking = authorizePaidOcr(paid({ stepMaxCalls: 8, stepMaxUsd: 1 }))
    expect(openLooking.authorized).toBe(false)
    expect(openLooking.reason).toBe('STEP_8_25_FORBIDS_PAID_OCR')
  })
})

describe('STEP 8.25 progress and dedup', () => {
  it('counts statuses without inventing Production totals', () => {
    const progress = summarizeProgress([
      'AUTO_APPROVED',
      'HUMAN_REVIEW',
      'BLOCKED',
      'BLOCKED',
      'FAILED',
      'AI_FIXED',
    ])
    expect(progress.total).toBe(6)
    expect(progress.auto_approved).toBe(1)
    expect(progress.human_review).toBe(1)
    expect(progress.blocked).toBe(2)
    expect(progress.failed).toBe(1)
    expect(progress.ai_fixed).toBe(1)
    expect(progress.unresolved).toBe(5)
    expect(progress.actual_paid_calls).toBe(0)
    expect(progress.actual_usd).toBe(0)
  })

  it('treats identical identity and figure hashes as duplicates', () => {
    expect(
      sameDedupKey(
        { kind: 'PROBLEM_IDENTITY', documentId: 'doc', page: 108, canonical: '735' },
        { kind: 'PROBLEM_IDENTITY', documentId: 'doc', page: 108, canonical: '735' },
      ),
    ).toBe(true)
    expect(
      sameDedupKey(
        { kind: 'FIGURE_HASH', documentId: 'doc', page: 108, sourceHash: 'abc' },
        { kind: 'FIGURE_HASH', documentId: 'doc', page: 108, sourceHash: 'def' },
      ),
    ).toBe(false)
    expect(
      sameDedupKey(
        { kind: 'SOURCE_SHA256', sha256: 'aa' },
        { kind: 'CONTENT_FINGERPRINT', fingerprintType: 'FILE_HASH', value: 'aa' },
      ),
    ).toBe(false)
  })
})
