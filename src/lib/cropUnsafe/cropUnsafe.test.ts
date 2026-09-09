import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import type { PipelineCandidate } from '../recognition/bookPipeline'
import {
  candidateCropGateBlocks,
  cropUnsafeDetails,
  labelCropSample,
  oldCropGateBlocks,
  simulateCropGates,
  analyzeCropUnsafe,
} from './cropUnsafeAnalyze'

const bbox = validateBBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.12, unit: 'normalized', origin: 'top-left' })

function candidate(partial: Partial<PipelineCandidate> = {}): PipelineCandidate {
  return {
    page: 9,
    page_kind: 'PROBLEM',
    problem_number: '0002',
    canonical_problem_number: '0002',
    bbox,
    layout_kind: 'PROBLEM',
    segmentation_status: 'AUTO_OK',
    confidence: 0.8,
    warnings: [],
    review_reasons: ['CROP_UNSAFE'],
    quality: 'PIPELINE_REVIEW',
    route: 'PIPELINE_REVIEW',
    figure_hint: false,
    graph_hint: false,
    table_hint: false,
    figure_crop_risk: false,
    number_flow: 'NORMAL',
    stem_preview: 'x에 대한 오름차순',
    stem_text: 'x에 대한 오름차순',
    stem_markdown: 'x에 대한 오름차순',
    choice_count: 0,
    math: [],
    choices: [],
    recovery_attempted: false,
    recovery_reason: null,
    mathpix_planned: false,
    mathpix_called: false,
    mathpix_cache_hit: false,
    math_conflict: false,
    crop: { width: 520, height: 180, blank_ratio: 0.94, bbox_valid: true },
    ...partial,
  }
}

describe('STEP 8.8 TRACK B crop unsafe reasons', () => {
  it('splits CROP_UNSAFE into blank/size/boundary reasons', () => {
    const reasons = cropUnsafeDetails(candidate())
    expect(reasons).toContain('BLANK_RATIO_HIGH')
    const tiny = cropUnsafeDetails(candidate({ crop: { width: 40, height: 20, blank_ratio: 0.5, bbox_valid: true } }))
    expect(tiny).toContain('HEIGHT_TOO_SMALL')
    expect(tiny).toContain('WIDTH_TOO_SMALL')
  })

  it('treats high blank + real ink as false-positive gate, not auto-pass for body intrusion', () => {
    const fp = analyzeCropUnsafe(candidate(), { width: 520, height: 180, blank_ratio: 0.94, ink_ratio: 0.04, page: 9, problem_number: '0002' })
    expect(labelCropSample(fp)).toBe('FALSE_POSITIVE_GATE')
    expect(oldCropGateBlocks(fp)).toBe(true)
    expect(candidateCropGateBlocks(fp)).toBe(false)
    const intrusion = analyzeCropUnsafe(
      candidate({ review_reasons: ['CROP_UNSAFE', 'BODY_INTRUSION'] }),
      { width: 520, height: 180, blank_ratio: 0.94, ink_ratio: 0.04, page: 9, problem_number: '0002' },
    )
    expect(labelCropSample(intrusion)).toBe('TRUE_UNSAFE')
    expect(candidateCropGateBlocks(intrusion)).toBe(true)
  })

  it('does not let TRUE_UNSAFE empty crops auto-pass the candidate gate', () => {
    const empty = Array.from({ length: 20 }, (_, i) =>
      analyzeCropUnsafe(candidate({ problem_number: String(i).padStart(4, '0') }), {
        width: 40,
        height: 20,
        blank_ratio: 0.99,
        ink_ratio: 0.004,
        page: 9,
        problem_number: String(i).padStart(4, '0'),
      }),
    )
    const sim = simulateCropGates(empty)
    expect(sim.candidate.unsafe_auto_pass).toBe(0)
    const fp = Array.from({ length: 20 }, (_, i) =>
      analyzeCropUnsafe(candidate({ problem_number: String(100 + i) }), {
        width: 400,
        height: 160,
        blank_ratio: 0.94,
        ink_ratio: 0.05,
        page: 20,
        problem_number: String(100 + i),
      }),
    )
    const recovered = simulateCropGates(fp)
    expect(recovered.expected_review_reduction).toBeGreaterThan(0)
  })
})
