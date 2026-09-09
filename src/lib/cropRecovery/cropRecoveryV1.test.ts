import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateBBox } from '../pdf/bbox'
import { CROP_PAD } from '../recognition/problemPipeline'
import { evaluateCropGateV2, type CropImageFeatures } from '../cropGate/cropGateV2'
import { STEP813_TYPE_THRESHOLD } from '../taxonomy/typeCoverageV2'
import { STEP811_THRESHOLDS } from '../taxonomy/classificationPersistence'
import { hardMapSourceToHyper } from '../taxonomy/sourceDifficultySystem'
import {
  computeRecoveryBBox,
  cropGateThresholdsFrozen,
  evaluateRecovery,
  FROZEN_CROP_GATE,
  FROZEN_TYPE_THRESHOLD,
  recoveryIncludesNextProblem,
  type RecoveryInput,
} from './cropRecoveryV1'

const bbox = validateBBox({ x: 0.05, y: 0.2, width: 0.45, height: 0.12, unit: 'normalized', origin: 'top-left' })
const nextBbox = validateBBox({ x: 0.05, y: 0.318, width: 0.45, height: 0.12, unit: 'normalized', origin: 'top-left' })

function image(partial: Partial<CropImageFeatures> = {}): CropImageFeatures {
  return {
    width: 520,
    height: 180,
    blank_ratio: 0.9,
    ink_ratio: 0.05,
    connected_components: 8,
    largest_component_area_frac: 0.07,
    ink_bbox: { x: 0.08, y: 0.12, width: 0.8, height: 0.7 },
    edge_touch: { top: 0.02, bottom: 0.04, left: 0.03, right: 0.02 },
    top_band_span: 0.04,
    bottom_band_span: 0.05,
    left_band_span: 0.06,
    right_band_span: 0.03,
    top_span_excluding_number_zone: 0.02,
    left_span_excluding_number_zone: 0.04,
    top_edge_px_span: 0.04,
    bottom_edge_px_span: 0.08,
    left_edge_px_span: 0.05,
    right_edge_px_span: 0.03,
    left_top_ink: true,
    figure_like_blob_edge: false,
    figure_like_blob_area_frac: 0,
    ...partial,
  }
}

function gateReview() {
  return evaluateCropGateV2({
    problem_number: '0011',
    canonical_problem_number: '0011',
    bbox,
    crop: { width: 520, height: 180, blank_ratio: 0.9, bbox_valid: true },
    image: image(),
    stem: '0011 다항식의 값을 구하시오.',
    markdown: '0011 다항식의 값을 구하시오.',
    page_problem_numbers: ['0011', '0012'],
    next_problem_number: '0012',
    next_bbox: nextBbox,
    neighbor_bboxes: [nextBbox],
    assigned_images: [],
    known_blocks: [],
    column_count: 2,
    is_column_last: false,
    figure_hint: false,
    identity_unstable: false,
    number_uncertain: false,
    segmentation_status: 'AUTO_OK',
    layout_kind: 'PROBLEM',
  })
}

function recoveryInput(partial: Partial<RecoveryInput> = {}): RecoveryInput {
  const gate = gateReview()
  return {
    page: 9,
    problem_number: '0011',
    canonical_problem_number: '0011',
    bbox,
    stem: '0011 다항식의 값을 구하시오.',
    markdown: '0011 다항식의 값을 구하시오.',
    choice_count: 0,
    choices: [],
    figure_hint: false,
    graph_hint: false,
    table_hint: false,
    figure_crop_risk: false,
    segmentation_status: 'AUTO_OK',
    layout_kind: 'PROBLEM',
    math_conflict: false,
    mathpix_cache_hit: true,
    needs_paid_ocr: false,
    remaining_blockers: ['crop_gate', 'PIPELINE_REVIEW'],
    gate,
    image: image(),
    next: { problem_number: '0012', bbox: nextBbox },
    page_problem_numbers: ['0011', '0012'],
    already_draft: false,
    ...partial,
  }
}

describe('STEP 8.15 crop recovery v1', () => {
  it('does not relax global crop gate thresholds', () => {
    const frozen = cropGateThresholdsFrozen()
    expect(frozen.crop_pad).toBe(CROP_PAD)
    expect(frozen.crop_pad).toBe(0.022)
    expect(frozen.neighbor_iou_max).toBe(0.12)
    expect(frozen.version).toBe('v2')
    const sql = readFileSync(path.join(process.cwd(), 'src/lib/cropGate/cropGateV2.ts'), 'utf8')
    expect(sql).toContain('const NEIGHBOR_IOU_MAX = 0.12')
    expect(sql).toContain('if (topEdge >= 0.5) hard.add(\'TOP_CUT_RISK\')')
    expect(FROZEN_CROP_GATE.top_cut_hard).toBe(0.5)
    const gate = gateReview()
    expect(gate.decision).toBe('CROP_REVIEW')
    expect(gate.hard_blockers).toEqual([])
  })

  it('recovers neighbor-header-in-pad without treating bbox as identity', () => {
    const row = evaluateRecovery(recoveryInput())
    expect(row.recovery_class).toBe('B_RECOVERABLE_NEIGHBOR_CONTEXT')
    expect(row.auto_recover).toBe(true)
    expect(row.original_bbox_overwritten).toBe(false)
    expect(row.recovery_bbox).not.toBeNull()
    expect(recoveryIncludesNextProblem(row.recovery_bbox!, { problem_number: '0012', bbox: nextBbox })).toBe(false)
  })

  it('never AUTO-recovers figure-cut or CROP_UNSAFE', () => {
    const figure = evaluateRecovery(
      recoveryInput({
        figure_hint: true,
        figure_crop_risk: true,
        image: image({ figure_like_blob_edge: true, figure_like_blob_area_frac: 0.12 }),
      }),
    )
    expect(figure.auto_recover).toBe(false)
    expect(figure.recovery_class).toBe('C_RECOVERABLE_FIGURE_CONTEXT')
    const unsafeGate = evaluateCropGateV2({
      problem_number: '0011',
      canonical_problem_number: '0011',
      bbox,
      crop: { width: 520, height: 180, blank_ratio: 0.9, bbox_valid: true },
      image: image({ top_edge_px_span: 0.72 }),
      stem: '0011 다항식의 값을 구하시오.',
      page_problem_numbers: ['0011'],
      identity_unstable: false,
      number_uncertain: false,
      segmentation_status: 'AUTO_OK',
      layout_kind: 'PROBLEM',
    })
    const unsafe = evaluateRecovery(recoveryInput({ gate: unsafeGate, image: image({ top_edge_px_span: 0.72 }) }))
    expect(unsafe.auto_recover).toBe(false)
    expect(unsafe.recovery_class).toBe('H_TRUE_UNSAFE')
  })

  it('clips recovery bbox so the next problem number is excluded', () => {
    const overlappingNext = validateBBox({ x: 0.05, y: 0.29, width: 0.45, height: 0.1, unit: 'normalized', origin: 'top-left' })
    const box = computeRecoveryBBox(bbox, { problem_number: '0012', bbox: overlappingNext })
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(overlappingNext.y - 0.005)
  })

  it('does not treat replay leftover CROP_UNSAFE string as a hard crop-gate fail', () => {
    const row = evaluateRecovery(recoveryInput({ remaining_blockers: ['crop_gate', 'PIPELINE_REVIEW', 'CROP_UNSAFE'] }))
    expect(row.auto_recover).toBe(true)
  })

  it('keeps TYPE threshold and refuses HYPER hard-mapping', () => {
    expect(FROZEN_TYPE_THRESHOLD).toBe(0.78)
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(STEP811_THRESHOLDS.type).toBe(0.78)
    expect(hardMapSourceToHyper('상')).toBeNull()
  })
})
