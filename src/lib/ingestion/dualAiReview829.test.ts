import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'
import {
  CONFIDENCE_HIGH,
  FROZEN_PIPELINE_COUNTS,
  STEP824_BLOCKED_CANDIDATE_IDS,
  combineDualReview,
  dualReviewAgrees,
  mapToGoldStandard,
} from './batchPipeline825'
import { fingerprintGtItem, parseGtFile, type GtItem } from './structureFromCache828'
import {
  FIGURE_OWNERSHIP_UNVERIFIED,
  STEP829,
  STEP829_DOCUMENT,
  STEP829_PAID_OCR_CAP,
  assertNoAutoApproved,
  assertNoGoldVerify,
  denyPaidOcr829,
  emptyDualInventory,
  evaluateDryRun,
  fieldDiffs,
  mapDualToPipeline,
  projectStep829Targets,
  reviewCachedItem,
  scoreCheckerA,
  scoreCheckerB,
  tallyDual,
  tallyVerdicts,
  type Step828CachedItem,
} from './dualAiReview829'

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

describe('STEP 8.29 scope freeze', () => {
  it('locks SSEN and names dual-AI review from the 8.25 freeze', () => {
    expect(STEP829).toBe('8.29')
    expect(STEP829_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    const freeze = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md'),
      'utf8',
    )
    expect(freeze).toContain('Dual-AI review pilot on cached artifacts')
    expect(freeze).toContain('No unless a separate authorized freeze')
    const spec = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_29_DUAL_AI_REVIEW_v1.md'),
      'utf8',
    )
    expect(spec).toContain(STEP829_DOCUMENT)
    expect(spec).toContain('Do not start 8.30')
    expect(spec).toContain('0 calls / $0')
    expect([...STEP824_BLOCKED_CANDIDATE_IDS]).toEqual([...UNRESOLVED_PENDING_IDS])
    expect(FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts).toBe(265)
    expect(FROZEN_PIPELINE_COUNTS.frozenTypeAuto).toBe(38)
  })
})

describe('STEP 8.29 dual checkers', () => {
  it('agrees on a cached MCQ with stable identity and no figure, but does not AUTO_APPROVE', () => {
    const item = gt()
    const a = scoreCheckerA(item)
    const b = scoreCheckerB(item)
    expect(a.checker).toBe('A')
    expect(b.checker).toBe('B')
    expect(a.identity).toBeGreaterThanOrEqual(CONFIDENCE_HIGH)
    expect(b.identity).toBeGreaterThanOrEqual(CONFIDENCE_HIGH)
    expect(a.figureOwnership).toBe(1)
    expect(b.figureOwnership).toBe(1)
    expect(dualReviewAgrees(a, b)).toBe(true)
    const mapped = mapDualToPipeline({
      upstreamStatus: 'HUMAN_REVIEW',
      fingerprintOk: true,
      a,
      b,
    })
    expect(mapped.agrees).toBe(true)
    expect(mapped.dualWouldAuto).toBe(true)
    expect(mapped.status).toBe('HUMAN_REVIEW')
    expect(mapped.reasons).toContain('DUAL_AGREE')
    expect(mapped.reasons).toContain('IMAGE_COMPARE_NOT_RUN')
    expect(mapped.reasons).toContain('NO_AUTO_APPROVED_IN_8_29')
    expect(combineDualReview(a, b)).toBe('AUTO_APPROVED')
    expect(mapToGoldStandard(mapped.status).mayVerify).toBe(false)
  })

  it('keeps upstream BLOCKED and treats unverified figures as below ownership min', () => {
    const blocked = mapDualToPipeline({
      upstreamStatus: 'BLOCKED',
      fingerprintOk: true,
      a: scoreCheckerA(gt({ problem_number: null })),
      b: scoreCheckerB(gt({ problem_number: null })),
    })
    expect(blocked.status).toBe('BLOCKED')
    expect(blocked.reasons).toContain('UPSTREAM_BLOCKED')

    const figured = gt({ has_figure: true })
    const a = scoreCheckerA(figured)
    const b = scoreCheckerB(figured)
    expect(a.figureOwnership).toBe(FIGURE_OWNERSHIP_UNVERIFIED)
    expect(b.figureOwnership).toBe(FIGURE_OWNERSHIP_UNVERIFIED)
    expect(a.figureOwnership).toBeLessThan(CONFIDENCE_HIGH)
    expect(dualReviewAgrees(a, b)).toBe(false)
    const mapped = mapDualToPipeline({
      upstreamStatus: 'HUMAN_REVIEW',
      fingerprintOk: true,
      a,
      b,
    })
    expect(mapped.status).toBe('HUMAN_REVIEW')
    expect(mapped.agrees).toBe(false)
    expect(mapped.reasons).toContain('DUAL_DISAGREE')
  })

  it('BLOCKED on fingerprint drift and never rewrites GT', () => {
    const item = gt()
    const row = cached(item)
    row.content_fingerprint = 'tampered'
    const reviewed = reviewCachedItem(row, item)
    expect(reviewed.status).toBe('BLOCKED')
    expect(reviewed.reasons).toContain('CONTENT_FINGERPRINT_DRIFT')
    expect(reviewed.content_fingerprint).toBe('tampered')
    expect(() => assertNoAutoApproved([reviewed])).not.toThrow()
    expect(() => assertNoGoldVerify([reviewed])).not.toThrow()
  })
})

describe('STEP 8.29 dry-run and targets', () => {
  it('BLOCKED when STEP 8.28 cache is missing', () => {
    const dry = evaluateDryRun({
      inventory: emptyDualInventory(),
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toEqual(expect.arrayContaining(['STEP828_CACHE_MISSING', 'GT_CACHE_MISSING']))
    expect(dry.ocr_network_calls).toBe(0)
    expect(dry.draft_persist).toBe(false)
  })

  it('PASSes dry-run when 26 cached items and frozen GT hash match', () => {
    const inventory = emptyDualInventory()
    inventory.step828_items_present = true
    inventory.step828_count = 26
    inventory.gt_present = true
    inventory.gt_count = 26
    inventory.gt_sha256 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
    const dry = evaluateDryRun({
      inventory,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(true)
    expect(dry.review_targets).toBe(26)
    const targets = projectStep829Targets({
      dryRun: dry,
      executed: true,
      originalPdfPresent: false,
      originalPdfIsSecondBook: false,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.PASS).toBe(8)
    expect(tally.REVIEW).toBe(0)
    expect(tally.BLOCKED).toBe(11)
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(STEP829_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(denyPaidOcr829()).toEqual({ authorized: false, reason: 'STEP_PAID_OCR_CAP_ZERO' })
  })
})

describe('STEP 8.29 real STEP 8.28 cache', () => {
  it('reviews all 26 cached items without AUTO_APPROVED or content rewrite', () => {
    const gtFile = parseGtFile(
      JSON.parse(readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'), 'utf8')),
    )
    const cachedFile = JSON.parse(
      readFileSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-28/items.json'), 'utf8'),
    ) as { items: Step828CachedItem[] }
    expect(cachedFile.items).toHaveLength(26)
    const byId = new Map(gtFile.items.map((row) => [row.sample_id, row]))
    const reviewed = cachedFile.items.map((row) => {
      const match = byId.get(row.candidate_id)
      expect(match).toBeTruthy()
      return reviewCachedItem(row, match!)
    })
    expect(() => assertNoAutoApproved(reviewed)).not.toThrow()
    expect(() => assertNoGoldVerify(reviewed)).not.toThrow()
    expect(reviewed.every((row) => row.status !== 'AUTO_APPROVED')).toBe(true)
    expect(reviewed.filter((row) => row.upstream_status === 'BLOCKED').every((row) => row.status === 'BLOCKED')).toBe(
      true,
    )
    const dual = tallyDual(reviewed)
    expect(dual.agree + dual.disagree).toBe(26)
    expect(fieldDiffs(reviewed[0].checker_a, reviewed[0].checker_b)).toHaveLength(4)
  })
})
