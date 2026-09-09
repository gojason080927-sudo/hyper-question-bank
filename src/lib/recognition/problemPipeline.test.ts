import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import {
  CROP_PAD,
  PILOT_PROBLEMS,
  assessCropSafety,
  associateFigures,
  blocksInsideProblem,
  buildDraftInsertPlan,
  buildNormalizedProblem,
  detectMathConflicts,
  pipelineIdempotencyKey,
  structureFromPageBlocks,
} from './problemPipeline'

function box(x: number, y: number, width: number, height: number) {
  return validateBBox({ x, y, width, height, unit: 'normalized', origin: 'top-left' })
}

describe('STEP 8.3 crop safety', () => {
  it('refuses a crop that misses GT body or cuts an assigned figure', () => {
    const bbox = box(0.1, 0.2, 0.3, 0.1)
    const unsafe = assessCropSafety({
      problem_number: '0159',
      bbox,
      gt: { number: '0159', has_choices: true, has_figure: true, bbox: box(0.1, 0.2, 0.4, 0.35) },
      assigned_images: [{ id: 'img-0.jpeg', bbox: box(0.12, 0.4, 0.2, 0.12) }],
      neighbor_bboxes: [box(0.1, 0.28, 0.3, 0.2)],
    })
    expect(unsafe.crop_safe).toBe(false)
    expect(unsafe.reasons.some((row) => row.startsWith('body_clipped') || row === 'figure_cut_by_bbox')).toBe(true)
  })

  it('uses a crop pad that is larger than a single clipped glyph', () => {
    expect(CROP_PAD).toBeGreaterThan(0.01)
  })

  it('passes when the AUTO_OK box covers GT body, figures, and neighbors', () => {
    const bbox = box(0.01, 0.16, 0.48, 0.32)
    const safe = assessCropSafety({
      problem_number: '0159',
      bbox,
      gt: { number: '0159', has_choices: true, has_figure: false, bbox: box(0.09, 0.168, 0.42, 0.31) },
      assigned_images: [],
      neighbor_bboxes: [box(0.09, 0.478, 0.42, 0.235)],
    })
    expect(safe.crop_safe).toBe(true)
    expect(safe.checks.body_coverage).toBeGreaterThan(0.88)
  })
})

describe('STEP 8.3 choices / figures / conflicts', () => {
  it('parses circled choices into structured rows', () => {
    const structured = structureFromPageBlocks({
      problem_number: '0159',
      hasFigure: false,
      blocks: [
        { content: '0159 대표 문제', bbox: box(0.12, 0.17, 0.2, 0.03) },
        { content: '항등식 $x^3+ax^2-36=(x+c)(x^2+bx-12)$', bbox: box(0.12, 0.21, 0.35, 0.08) },
        { content: '① 10', bbox: box(0.12, 0.4, 0.08, 0.03) },
        { content: '② 12', bbox: box(0.22, 0.4, 0.08, 0.03) },
        { content: '③ 14', bbox: box(0.32, 0.4, 0.08, 0.03) },
        { content: '④ 16', bbox: box(0.12, 0.44, 0.08, 0.03) },
        { content: '⑤ 18', bbox: box(0.22, 0.44, 0.08, 0.03) },
      ],
    })
    expect(structured.detected_number).toBe('0159')
    expect(structured.choices.map((row) => row.index)).toEqual([1, 2, 3, 4, 5])
    expect(structured.choices[0].text).toBe('10')
  })

  it('keeps figure association on the problem, not a neighbor', () => {
    const figures = associateFigures({
      problem_number: '0274',
      assigned_ids: ['img-0.jpeg'],
      images: [
        { id: 'img-0.jpeg', bbox: box(0.1, 0.2, 0.3, 0.1) },
        { id: 'img-9.jpeg', bbox: box(0.6, 0.2, 0.2, 0.1) },
      ],
    })
    expect(figures).toHaveLength(2)
    expect(figures[0]).toMatchObject({
      associated_problem: '0274',
      detection_source: 'assigned_region',
    })
    expect(figures[0].crop_reference).toContain('img-0')
  })

  it('flags exponent / fraction CRITICAL conflicts and ignores cosmetic ① vs (1)', () => {
    const conflicts = detectMathConflicts(['x^{2}+\\frac{1}{2}'], ['x^{3}+\\frac{1}{2}'])
    expect(conflicts.some((row) => row.code === 'exponent_mismatch')).toBe(true)
    expect(detectMathConflicts(['x^{2}'], ['x^{2}'])).toEqual([])
    const blocks = blocksInsideProblem(
      [
        { content: '0159', bbox: box(0.12, 0.2, 0.1, 0.03) },
        { content: 'outside', bbox: box(0.7, 0.7, 0.1, 0.03) },
      ],
      box(0.1, 0.18, 0.4, 0.2),
    )
    expect(blocks.map((row) => row.content)).toEqual(['0159'])
  })
})

describe('STEP 8.3 normalized schema and idempotency', () => {
  it('builds a DRAFT payload without claiming a DB write', () => {
    const bbox = box(0.012, 0.167, 0.48, 0.313)
    const mistral = structureFromPageBlocks({
      problem_number: '0159',
      hasFigure: false,
      blocks: [
        { content: '0159 | 대표 문제', bbox: box(0.12, 0.17, 0.2, 0.03) },
        { content: '모든 실수 $x$에 대하여 $x^3+ax^2-36=(x+c)(x^2+bx-12)$', bbox: box(0.12, 0.21, 0.35, 0.1) },
        { content: '① 10', bbox: box(0.12, 0.4, 0.08, 0.03) },
        { content: '② 12', bbox: box(0.22, 0.4, 0.08, 0.03) },
        { content: '③ 14', bbox: box(0.32, 0.4, 0.08, 0.03) },
        { content: '④ 16', bbox: box(0.12, 0.44, 0.08, 0.03) },
        { content: '⑤ 18', bbox: box(0.22, 0.44, 0.08, 0.03) },
      ],
    })
    const normalized = buildNormalizedProblem({
      spec: PILOT_PROBLEMS[0],
      bbox,
      auto_bbox: bbox,
      confirmed_bbox: bbox,
      segmentation_status: 'AUTO_OK',
      confidence: 0.88,
      crop_rel: 'ocr-tests/problem-pipeline/problem-0159/original-crop.png',
      crop_safe: true,
      mistral,
      mathpix_latex: ['x^{3}+ax^{2}-36=(x+c)(x^{2}+bx-12)'],
      figures: [],
      expected_choices: true,
      expected_figure: false,
      mistral_used: true,
      mathpix_used: true,
      mistral_source: 'page_cache',
      mathpix_source: 'crop_call',
    })
    expect(normalized.status).toBe('DRAFT')
    expect(normalized.quality.requires_review).toBe(false)
    expect(normalized.content.choices).toHaveLength(5)
    const plan = buildDraftInsertPlan(normalized)
    expect(plan.db_writes).toBe(0)
    expect(plan.production_inserts).toBe(0)
    expect(plan.schema_changes_required).toBe(false)
    expect(plan.idempotency_key).toBe(
      pipelineIdempotencyKey({
        document_id: 'ssen-common-math1',
        page_number: 28,
        problem_number: '0159',
        bbox,
      }),
    )
    expect(pipelineIdempotencyKey({ document_id: 'ssen-common-math1', page_number: 28, problem_number: '0159', bbox })).toBe(
      pipelineIdempotencyKey({ document_id: 'ssen-common-math1', page_number: 28, problem_number: '0159', bbox }),
    )
  })

  it('keeps AUTO_OK segmentation from becoming DRAFT when crop is unsafe', () => {
    const bbox = box(0.012, 0.167, 0.48, 0.313)
    const mistral = structureFromPageBlocks({
      problem_number: '0274',
      hasFigure: true,
      blocks: [{ content: '0274 도형', bbox: box(0.1, 0.1, 0.2, 0.04) }],
    })
    const normalized = buildNormalizedProblem({
      spec: PILOT_PROBLEMS[3],
      bbox,
      auto_bbox: bbox,
      confirmed_bbox: bbox,
      segmentation_status: 'AUTO_OK',
      confidence: 0.88,
      crop_rel: 'ocr-tests/problem-pipeline/problem-0274/original-crop.png',
      crop_safe: false,
      mistral,
      mathpix_latex: [],
      figures: [],
      expected_choices: true,
      expected_figure: true,
      mistral_used: false,
      mathpix_used: false,
      mistral_source: 'none',
      mathpix_source: 'none',
    })
    expect(normalized.status).toBe('PIPELINE_REVIEW')
    expect(normalized.quality.missing_figure).toBe(true)
    expect(normalized.quality.missing_choice).toBe(true)
  })
})
