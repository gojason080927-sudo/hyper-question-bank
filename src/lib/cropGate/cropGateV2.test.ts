import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import {
  evaluateCropGateV2,
  findNeighborProblemAnchors,
  stripMathRegions,
  type CropGateInput,
  type CropImageFeatures,
} from './cropGateV2'

const bbox = validateBBox({ x: 0.05, y: 0.2, width: 0.45, height: 0.18, unit: 'normalized', origin: 'top-left' })

function image(partial: Partial<CropImageFeatures> = {}): CropImageFeatures {
  return {
    width: 520,
    height: 220,
    blank_ratio: 0.95,
    ink_ratio: 0.04,
    connected_components: 6,
    largest_component_area_frac: 0.08,
    ink_bbox: { x: 0.08, y: 0.12, width: 0.8, height: 0.7 },
    edge_touch: { top: 0.04, bottom: 0.02, left: 0.06, right: 0.03 },
    top_band_span: 0.08,
    bottom_band_span: 0.03,
    left_band_span: 0.12,
    right_band_span: 0.04,
    top_span_excluding_number_zone: 0.04,
    left_span_excluding_number_zone: 0.08,
    top_edge_px_span: 0.06,
    bottom_edge_px_span: 0.04,
    left_edge_px_span: 0.08,
    right_edge_px_span: 0.03,
    left_top_ink: true,
    figure_like_blob_edge: false,
    figure_like_blob_area_frac: 0,
    ...partial,
  }
}

function input(partial: Partial<CropGateInput> = {}): CropGateInput {
  return {
    problem_number: '0159',
    canonical_problem_number: '0159',
    bbox,
    crop: { width: 520, height: 220, blank_ratio: 0.95, bbox_valid: true },
    image: image(),
    stem: '0159 다항식 $x^3+ax^2$ 의 값을 구하시오.',
    markdown: '0159 다항식 $x^3+ax^2$ 의 값을 구하시오.',
    page_problem_numbers: ['0159', '0160', '0162'],
    next_problem_number: '0160',
    neighbor_bboxes: [
      validateBBox({ x: 0.05, y: 0.42, width: 0.45, height: 0.16, unit: 'normalized', origin: 'top-left' }),
    ],
    assigned_images: [],
    known_blocks: [],
    column_count: 2,
    is_column_last: false,
    figure_hint: false,
    graph_hint: false,
    table_hint: false,
    identity_unstable: false,
    number_uncertain: false,
    segmentation_status: 'AUTO_OK',
    layout_kind: 'PROBLEM',
    ...partial,
  }
}

describe('CROP GATE v2', () => {
  it('treats high blank but valid math crop as SAFE', () => {
    const result = evaluateCropGateV2(input())
    expect(result.decision).toBe('CROP_SAFE')
    expect(result.features.blank_ratio_hard_blocker).toBe(false)
    expect(result.crop_gate_version).toBe('v2')
  })

  it('marks low blank with neighbor intrusion as UNSAFE', () => {
    const result = evaluateCropGateV2(
      input({
        crop: { width: 520, height: 400, blank_ratio: 0.7, bbox_valid: true },
        image: image({ blank_ratio: 0.7, ink_ratio: 0.12, height: 400 }),
        stem: '0159 다음 중 옳은 것은?\n0160 | 대표 문제 이차방정식의 근을 구하시오. 이것은 다음 문제 본문입니다.',
      }),
    )
    expect(result.decision).toBe('CROP_UNSAFE')
    expect(result.hard_blockers).toEqual(expect.arrayContaining(['NEIGHBOR_NUMBER_INTRUSION']))
  })

  it('marks top cut as UNSAFE', () => {
    const result = evaluateCropGateV2(
      input({
        image: image({ top_span_excluding_number_zone: 0.42, top_band_span: 0.5, top_edge_px_span: 0.62 }),
      }),
    )
    expect(result.decision).toBe('CROP_UNSAFE')
    expect(result.hard_blockers).toContain('TOP_CUT_RISK')
  })

  it('marks bottom cut as UNSAFE', () => {
    const result = evaluateCropGateV2(input({ image: image({ bottom_band_span: 0.24, bottom_edge_px_span: 0.58 }) }))
    expect(result.decision).toBe('CROP_UNSAFE')
    expect(result.hard_blockers).toContain('BOTTOM_CUT_RISK')
  })

  it('marks figure cut as UNSAFE', () => {
    const result = evaluateCropGateV2(
      input({
        figure_hint: true,
        image: image({ figure_like_blob_edge: true, figure_like_blob_area_frac: 0.11 }),
        assigned_images: [
          { bbox: validateBBox({ x: 0.08, y: 0.22, width: 0.3, height: 0.2, unit: 'normalized', origin: 'top-left' }) },
        ],
        bbox: validateBBox({ x: 0.05, y: 0.2, width: 0.45, height: 0.12, unit: 'normalized', origin: 'top-left' }),
      }),
    )
    expect(result.decision).toBe('CROP_UNSAFE')
    expect(result.hard_blockers).toContain('FIGURE_BOUNDARY_RISK')
  })

  it('marks empty crop as UNSAFE', () => {
    const result = evaluateCropGateV2(
      input({
        crop: { width: 20, height: 10, blank_ratio: 0.99, bbox_valid: true },
        image: image({
          width: 20,
          height: 10,
          blank_ratio: 0.99,
          ink_ratio: 0.002,
          connected_components: 0,
          left_top_ink: false,
        }),
      }),
    )
    expect(result.decision).toBe('CROP_UNSAFE')
    expect(result.hard_blockers).toEqual(expect.arrayContaining(['EMPTY_CROP', 'NO_CONTENT']))
  })

  it('marks ambiguous edge content as REVIEW', () => {
    const result = evaluateCropGateV2(input({ image: image({ bottom_band_span: 0.12, bottom_edge_px_span: 0.36 }) }))
    expect(result.decision).toBe('CROP_REVIEW')
    expect(result.soft_features).toContain('bottom_edge_ambiguous')
  })

  it('does not treat a 4-digit number inside math as a neighbor problem', () => {
    const text = '다음 식 $i^{2025}+f(2024)$ 의 값을 구하시오.'
    expect(stripMathRegions(text)).not.toMatch(/2025/)
    const neighbors = findNeighborProblemAnchors({
      text,
      self: '0159',
      page_problem_numbers: ['0159', '0160', '2025', '2024'],
    })
    expect(neighbors.neighbors).toEqual([])
    const result = evaluateCropGateV2(
      input({
        stem: text,
        markdown: text,
        page_problem_numbers: ['0159', '0160', '2025', '2024'],
      }),
    )
    expect(result.hard_blockers).not.toContain('NEIGHBOR_NUMBER_INTRUSION')
    expect(result.decision).toBe('CROP_SAFE')
  })

  it('keeps a column-last safe crop as SAFE', () => {
    const result = evaluateCropGateV2(
      input({
        is_column_last: true,
        image: image({ bottom_band_span: 0.04 }),
        stem: '0159 긴 조건이 있는 열의 마지막 문제. 선택지 ① ② ③ ④ ⑤',
      }),
    )
    expect(result.decision).toBe('CROP_SAFE')
  })

  it('reviews a crop whose padding includes the next problem header', () => {
    const result = evaluateCropGateV2(
      input({
        next_bbox: validateBBox({ x: 0.05, y: 0.372, width: 0.45, height: 0.16, unit: 'normalized', origin: 'top-left' }),
      }),
    )
    expect(result.decision).toBe('CROP_REVIEW')
    expect(result.soft_features).toContain('neighbor_header_in_pad')
  })

  it('marks a following problem-range header inside the crop as UNSAFE', () => {
    const result = evaluateCropGateV2(
      input({
        stem: '0007 $(4x^2+y^2)-(2xy-5y^2)+(x^2-3xy)$ [0008~0010] 세 다항식 $A$에 대하여 다음을 계산하시오.',
        page_problem_numbers: ['0007', '0008', '0009', '0010'],
      }),
    )
    expect(result.decision).toBe('CROP_UNSAFE')
    expect(result.hard_blockers).toContain('NEIGHBOR_NUMBER_INTRUSION')
  })

  it('does not reject a long problem only because the bbox is large', () => {
    const tall = validateBBox({ x: 0.05, y: 0.12, width: 0.45, height: 0.55, unit: 'normalized', origin: 'top-left' })
    const result = evaluateCropGateV2(
      input({
        bbox: tall,
        neighbor_bboxes: [
          validateBBox({ x: 0.05, y: 0.72, width: 0.45, height: 0.12, unit: 'normalized', origin: 'top-left' }),
        ],
        crop: { width: 520, height: 900, blank_ratio: 0.81, bbox_valid: true },
        image: image({ width: 520, height: 900, blank_ratio: 0.81, ink_ratio: 0.09, bottom_band_span: 0.03 }),
        stem: '0159 다음 조건을 만족시키는 다항식에 대하여 물음에 답하시오. '.repeat(8),
      }),
    )
    expect(result.decision).toBe('CROP_SAFE')
    expect(result.hard_blockers).toEqual([])
  })
})
