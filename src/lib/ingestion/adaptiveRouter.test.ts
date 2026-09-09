import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import { CROP_PAD } from '../recognition/problemPipeline'
import { FROZEN_CROP_GATE } from '../cropRecovery/cropRecoveryV1'
import { CROP_GATE_VERSION } from '../cropGate/cropGateV2'
import { STEP813_TYPE_THRESHOLD } from '../taxonomy/typeCoverageV2'
import { hardMapSourceToHyper } from '../taxonomy/sourceDifficultySystem'
import {
  FEATURE_FLAGS,
  PAID_OCR_ROUTING_ENABLED,
  ROUTER_EXECUTION_ORDER,
  SHADOW_ROUTING_ENABLED,
  conflictNeverMerged,
  featuresFromCandidate,
  paidRouteJustified,
  routeShadow,
  type RouterFeatures,
} from './adaptiveRouter'
import {
  buildBoundaryEvidence,
  choiceGroupValid,
  classifyNeighborIntrusion,
  columnIntrusion,
  detectColumnLayout,
  figureOwnership,
  mathConflictBetween,
  neighborBlocksAutoSafe,
} from './segmentationV3'

const box = (x: number, y: number, width: number, height: number) =>
  validateBBox({ x, y, width, height, unit: 'normalized', origin: 'top-left' })

function stable(partial: Partial<RouterFeatures> = {}): RouterFeatures {
  return {
    identity_confidence: 0.92,
    boundary_confidence: 0.88,
    neighbor_intrusion_risk: 'NONE',
    column_confidence: 0.84,
    stem_completeness: 0.9,
    choice_completeness: 0.95,
    choice_ownership_confidence: 0.95,
    math_confidence: 0.88,
    math_conflict: false,
    math_density: 'low',
    has_figure: false,
    figure_boundary_confidence: 1,
    figure_ownership_confidence: 1,
    structure_confidence: 0.9,
    current_ocr_available: true,
    mistral_cache_available: false,
    mathpix_cache_available: false,
    crop_unsafe: false,
    hard_blockers: [],
    ...partial,
  }
}

describe('STEP 8.17 segmentation v3 + shadow router', () => {
  it('keeps crop gate v2, TYPE 0.78, CURRENT default, and shadow paid routing off', () => {
    expect(FROZEN_CROP_GATE.version).toBe(CROP_GATE_VERSION)
    expect(CROP_PAD).toBe(0.022)
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(hardMapSourceToHyper('상')).toBeNull()
    expect(PAID_OCR_ROUTING_ENABLED).toBe(false)
    expect(SHADOW_ROUTING_ENABLED).toBe(true)
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(ROUTER_EXECUTION_ORDER[0]).toBe('IDENTITY')
    expect(ROUTER_EXECUTION_ORDER.includes('CURRENT')).toBe(true)
    expect(routeShadow(stable()).recommended_route).toBe('CURRENT_ONLY')
  })

  it('uses generic layout signals and does not hardcode SSEN pages, badges, or document ids', () => {
    const files = ['segmentationV3.ts', 'adaptiveRouter.ts'].map((name) =>
      readFileSync(path.join(process.cwd(), 'src/lib/ingestion', name), 'utf8'),
    )
    for (const src of files) {
      expect(src).not.toMatch(/9ff369b4-5b16-4cb8-bfc3-a6b180c18703/)
      expect(src).not.toMatch(/좋은책신사고/)
      expect(src).not.toMatch(/orange filled circle/)
      expect(src).not.toMatch(/SSEN_NOTE/)
      expect(src).not.toMatch(/page_number\s*===\s*8/)
      expect(src).not.toMatch(/pages\s*=\s*\[\s*8\s*,\s*12\s*,\s*20/)
    }
    expect(detectColumnLayout({ bbox_width: 0.45, page_problem_centers_x: [0.22, 0.72] })).toBe('TWO_COLUMN')
    expect(columnIntrusion({ bbox: box(0.05, 0.2, 0.9, 0.2), column_count: 2, other_column_boxes: [] })).toBe(true)
  })

  it('does not treat bbox as identity and treats neighbor header as distinct from body', () => {
    const header = classifyNeighborIntrusion({
      stem: '0042 다음 중 옳은 것은?\n0043',
      next_problem_number: '0043',
      next_bbox: box(0.05, 0.33, 0.4, 0.12),
      bbox: box(0.05, 0.2, 0.4, 0.14),
    })
    expect(header).toBe('NEIGHBOR_HEADER_ONLY')
    expect(neighborBlocksAutoSafe(header)).toBe(false)
    const body = classifyNeighborIntrusion({
      stem: '0042 식\n0043 다음 이차방정식의 해를 구하시오. 아주 긴 본문이 이어진다.',
      next_problem_number: '0043',
      bbox: box(0.05, 0.2, 0.4, 0.2),
      neighbor_body_in_bbox: true,
    })
    expect(body).toBe('NEIGHBOR_BODY_INTRUSION')
    expect(neighborBlocksAutoSafe(body)).toBe(true)
    expect(routeShadow(stable({ neighbor_intrusion_risk: body })).recommended_route).toBe('HUMAN_REVIEW')
    expect(routeShadow(stable({ neighbor_intrusion_risk: body })).would_auto_safe).toBe(false)
  })

  it('routes figure uncertainty to review and only auto-associates high-confidence same-column contained figures', () => {
    const owned = figureOwnership({
      figure: box(0.2, 0.22, 0.15, 0.1),
      stem: box(0.1, 0.2, 0.3, 0.08),
      column: box(0.05, 0.05, 0.45, 0.9),
      candidate: box(0.1, 0.18, 0.35, 0.25),
      text: '다음 그림을 보고',
    })
    expect(owned.auto_associate).toBe(true)
    const cut = figureOwnership({
      figure: box(0.3, 0.18, 0.4, 0.3),
      stem: box(0.1, 0.2, 0.2, 0.08),
      next: box(0.1, 0.5, 0.3, 0.1),
      column: box(0.05, 0.05, 0.45, 0.9),
      candidate: box(0.1, 0.18, 0.2, 0.12),
    })
    expect(cut.auto_associate).toBe(false)
    expect(cut.crosses_boundary).toBe(true)
    const routed = routeShadow(stable({ has_figure: true, figure_ownership_confidence: 0.5, figure_boundary_confidence: 0.5 }))
    expect(routed.recommended_route).toBe('HUMAN_REVIEW')
    expect(paidRouteJustified(routed.recommended_route)).toBe(false)
  })

  it('verifies choice ownership and does not treat OCR labels as automatic membership', () => {
    const owned = choiceGroupValid({
      detected_labels: ['①', '②', '③', '④', '⑤'],
      expected_count: 5,
      same_column: true,
      in_candidate: true,
    })
    expect(owned.complete).toBe(true)
    expect(owned.owned).toBe(true)
    const leaked = choiceGroupValid({
      detected_labels: ['①', '②', '③', '④', '⑤'],
      expected_count: 5,
      same_column: false,
      in_candidate: false,
    })
    expect(leaked.owned).toBe(false)
    expect(leaked.confidence).toBeLessThan(0.5)
  })

  it('routes math uncertainty to Mathpix candidate and never silent-merges provider conflicts', () => {
    expect(mathConflictBetween(['x^3'], ['x^2'])).toBe(true)
    expect(conflictNeverMerged(['x^3'], ['x^2'])).toBe(true)
    const math = routeShadow(stable({ math_confidence: 0.2, math_density: 'high', math_conflict: false }))
    expect(math.recommended_route).toBe('MATHPIX_MATH')
    const conflict = routeShadow(stable({ math_conflict: true, provider_math_conflict: true, math_density: 'high' }))
    expect(conflict.recommended_route).toBe('HUMAN_REVIEW')
    expect(conflict.estimated_paid_calls).toEqual({ mistral: 0, mathpix: 0 })
  })

  it('does not send pure boundary failures to paid OCR and keeps FALSE_SAFE at 0', () => {
    const boundary = routeShadow(stable({ boundary_confidence: 0.4 }))
    expect(boundary.recommended_route).toBe('SEGMENTATION_RECOVERY')
    expect(boundary.estimated_paid_calls).toEqual({ mistral: 0, mathpix: 0 })
    const unsafe = routeShadow(stable({ crop_unsafe: true, boundary_confidence: 0.1, hard_blockers: ['TOP_CUT_RISK'] }))
    expect(unsafe.recommended_route).toBe('HUMAN_REVIEW')
    expect(paidRouteJustified(unsafe.recommended_route)).toBe(false)
    const auto = routeShadow(stable())
    expect(auto.false_safe).toBe(false)
    expect(auto.would_auto_safe).toBe(true)
  })

  it('maps remaining failure strata to paid routes only when OCR can help', () => {
    const choice = routeShadow(
      featuresFromCandidate({
        status: 'CROP_REVIEW',
        reject_reasons: ['CHOICE_INCOMPLETE'],
        hard_blockers: [],
        has_choices: true,
        choice_count: 2,
        has_figure: false,
        math_density: 'low',
        math_conflict: false,
        stem_length: 80,
        canonical_ok: true,
        neighbor: 'NEIGHBOR_HEADER_ONLY',
        two_column: true,
      }),
    )
    expect(choice.recommended_route).toBe('MISTRAL_STRUCTURE')
    const identity = routeShadow(
      featuresFromCandidate({
        status: 'CROP_REVIEW',
        reject_reasons: ['IDENTITY_UNSTABLE'],
        hard_blockers: ['IDENTITY_UNSTABLE'],
        has_choices: false,
        choice_count: 0,
        has_figure: false,
        math_density: 'low',
        math_conflict: false,
        stem_length: 40,
        canonical_ok: false,
        neighbor: 'NONE',
        two_column: true,
      }),
    )
    expect(identity.recommended_route).toBe('HUMAN_REVIEW')
    const bounds = buildBoundaryEvidence({
      bbox: box(0.1, 0.2, 0.4, 0.12),
      current_number_y: 0.2,
      next_number_y: 0.34,
    })
    expect(bounds.bottom_anchor.evidence).toContain('next_problem_number')
  })
})
