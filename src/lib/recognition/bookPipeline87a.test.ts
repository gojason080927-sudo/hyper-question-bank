import { describe, expect, it } from 'vitest'
import { CACHE_ONLY_NETWORK_BLOCKED } from '../ocr/mathOcrTypes'
import { createMathpixProvider } from '../ocr/mathpixProvider'
import { createMistralProvider } from '../ocr/mistralProvider'
import { validateBBox } from '../pdf/bbox'
import {
  countEligibleMathpixInvocations,
  mathpixOvercallBucket,
  parsePipelineArgs,
  planMathpixCall,
  shouldCallMathpix,
  type PipelineCandidate,
} from './bookPipeline'

const bbox = validateBBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.2, unit: 'normalized', origin: 'top-left' })

function candidate(partial: Partial<PipelineCandidate> = {}): PipelineCandidate {
  return {
    page: 28,
    page_kind: 'PROBLEM',
    problem_number: '0159',
    canonical_problem_number: '0159',
    bbox,
    layout_kind: 'PROBLEM',
    segmentation_status: 'AUTO_OK',
    confidence: 0.9,
    warnings: [],
    review_reasons: [],
    quality: 'DRAFT_READY',
    route: 'MISTRAL_PLUS_MATHPIX',
    figure_hint: false,
    graph_hint: false,
    table_hint: false,
    figure_crop_risk: false,
    number_flow: 'NORMAL',
    stem_preview: '다음 중 옳은 것은',
    stem_text: '다음 중 옳은 것은 x^2',
    stem_markdown: '다음 중 옳은 것은 $x^2$',
    choice_count: 5,
    math: ['x^2'],
    choices: [
      { index: 1, text: '①', math: [] },
      { index: 2, text: '②', math: [] },
      { index: 3, text: '③', math: [] },
      { index: 4, text: '④', math: [] },
      { index: 5, text: '⑤', math: [] },
    ],
    recovery_attempted: false,
    recovery_reason: null,
    mathpix_planned: true,
    mathpix_called: false,
    mathpix_cache_hit: false,
    math_conflict: false,
    crop: { width: 400, height: 300, blank_ratio: 0.2, bbox_valid: true },
    ...partial,
  }
}

describe('STEP 8.7A Mathpix eligibility', () => {
  it('blocks CROP_UNSAFE, BODY_INTRUSION, STRUCTURE_INCOMPLETE, IDENTITY_UNSTABLE, THEORY/SIDEBAR, MISTRAL_ONLY', () => {
    expect(shouldCallMathpix(candidate({ review_reasons: ['CROP_UNSAFE'], quality: 'PIPELINE_REVIEW', route: 'PIPELINE_REVIEW' })).eligible).toBe(false)
    expect(shouldCallMathpix(candidate({ review_reasons: ['BODY_INTRUSION'], quality: 'PIPELINE_REVIEW', route: 'PIPELINE_REVIEW' })).eligible).toBe(false)
    expect(shouldCallMathpix(candidate({ review_reasons: ['STRUCTURE_INCOMPLETE'], quality: 'PIPELINE_REVIEW', route: 'PIPELINE_REVIEW' })).eligible).toBe(false)
    expect(shouldCallMathpix(candidate({ canonical_problem_number: null, review_reasons: ['IDENTITY_UNSTABLE'], quality: 'PIPELINE_REVIEW', route: 'PIPELINE_REVIEW' })).eligible).toBe(false)
    expect(shouldCallMathpix(candidate({ layout_kind: 'THEORY', review_reasons: ['THEORY_OR_SIDEBAR'], quality: 'BLOCKED_NON_PROBLEM', route: 'PIPELINE_REVIEW' })).eligible).toBe(false)
    expect(shouldCallMathpix(candidate({ route: 'MISTRAL_ONLY' })).eligible).toBe(false)
  })

  it('allows HYBRID only after pre-Mathpix gates', () => {
    const ok = shouldCallMathpix(candidate())
    expect(ok.eligible).toBe(true)
    expect(ok.reason).toBe('hybrid_after_pre_mathpix_gates')
  })

  it('uses CROP GATE v2 CROP_SAFE instead of blank-ratio alone when versioned', () => {
    const highBlank = candidate({
      crop: { width: 400, height: 300, blank_ratio: 0.95, bbox_valid: true },
      crop_gate_v2: 'CROP_SAFE',
    })
    expect(shouldCallMathpix(highBlank).eligible).toBe(true)
    expect(
      shouldCallMathpix(
        candidate({
          crop: { width: 400, height: 300, blank_ratio: 0.2, bbox_valid: true },
          crop_gate_v2: 'CROP_REVIEW',
          quality: 'PIPELINE_REVIEW',
          route: 'PIPELINE_REVIEW',
        }),
      ).eligible,
    ).toBe(false)
  })

  it('counts provider invocations from eligibility, not from REVIEW rows', () => {
    const unsafe = Array.from({ length: 100 }, (_, index) =>
      candidate({
        problem_number: String(index).padStart(4, '0'),
        review_reasons: ['CROP_UNSAFE'],
        quality: 'PIPELINE_REVIEW',
        route: 'PIPELINE_REVIEW',
      }),
    )
    expect(countEligibleMathpixInvocations(unsafe)).toBe(0)
    const hybrid = Array.from({ length: 10 }, (_, index) => candidate({ problem_number: String(2000 + index) }))
    expect(countEligibleMathpixInvocations(hybrid)).toBe(10)
  })

  it('does not let resume bypass the pre-Mathpix gate', () => {
    const args = parsePipelineArgs(['--run', '--resume', '--cache-only', '--dry-run'])
    expect(args.resume).toBe(true)
    expect(args.cacheOnly).toBe(true)
    expect(args.persist).toBe(false)
    const review = candidate({ quality: 'PIPELINE_REVIEW', route: 'PIPELINE_REVIEW', review_reasons: ['CROP_UNSAFE'] })
    const plan = planMathpixCall({ candidate: review, cacheHit: false, cacheOnly: args.cacheOnly })
    expect(plan.mathpix_eligible).toBe(false)
    expect(plan.would_call_api).toBe(false)
  })

  it('classifies a crop-unsafe past Mathpix call as CROP_UNSAFE_BLOCKED', () => {
    expect(
      mathpixOvercallBucket(
        candidate({ review_reasons: ['CROP_UNSAFE'], quality: 'PIPELINE_REVIEW', route: 'PIPELINE_REVIEW' }),
      ),
    ).toBe('CROP_UNSAFE_BLOCKED')
    expect(mathpixOvercallBucket(candidate())).toBe('STILL_ELIGIBLE')
  })
})

describe('STEP 8.7A cache-only network hard guard', () => {
  it('throws before Mathpix or Mistral fetch in cache-only mode', async () => {
    let fetched = 0
    const fetchImpl = (async () => {
      fetched += 1
      return new Response('{}')
    }) as typeof fetch
    const gate = { allowPaidApi: true, confirmCost: true, cacheOnly: true as const }
    const input = { sampleId: 'guard', imageBytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' as const }
    await expect(createMathpixProvider({ fetchImpl }).recognizeCrop(input, gate)).rejects.toThrow(CACHE_ONLY_NETWORK_BLOCKED)
    await expect(createMistralProvider({ fetchImpl }).recognizeCrop(input, gate)).rejects.toThrow(CACHE_ONLY_NETWORK_BLOCKED)
    expect(fetched).toBe(0)
  })
})
