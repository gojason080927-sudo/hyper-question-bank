import { describe, expect, it } from 'vitest'
import { classifyBookPage, emptyKindCounts, assertKindSum } from './bookClassify'
import {
  inspectNumberFlow,
  mapGateReasons,
  pickPhaseBPilot,
  pickStratifiedSample,
  EXPECTED_PAGE_COUNT,
  PHASE_B_MAX_PROBLEMS,
  type ProblemCandidate,
} from './bookDryRun'
import { validateBBox } from '../pdf/bbox'

const bbox = validateBBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.2, unit: 'normalized', origin: 'top-left' })

function candidate(partial: Partial<ProblemCandidate>): ProblemCandidate {
  return {
    page: 28,
    problem_number: '0159',
    canonical_problem_number: '0159',
    bbox,
    layout_kind: 'PROBLEM',
    segmentation_status: 'AUTO_OK',
    confidence: 0.9,
    warnings: [],
    review_reasons: [],
    quality: 'DRAFT_READY',
    route: 'WOULD_USE_HYBRID',
    figure_hint: false,
    graph_hint: false,
    table_hint: false,
    figure_crop_risk: false,
    number_flow: 'NORMAL',
    stem_preview: 'x의 값을 구하시오',
    choice_count: 5,
    crop: { width: 100, height: 80, blank_ratio: 0.2, bbox_valid: true },
    ...partial,
  }
}

describe('STEP 8.6 book classify', () => {
  it('does not invent PROBLEM pages without OCR cache', () => {
    const unknown = classifyBookPage({
      page_number: 70,
      ink_ratio: 0.22,
      has_ocr_cache: false,
      four_digit_count: 0,
      section_count: 0,
    })
    expect(unknown.page_kind).toBe('UNKNOWN')
    expect(unknown.needs_ocr).toBe(true)

    const blank = classifyBookPage({
      page_number: 191,
      ink_ratio: 0.01,
      has_ocr_cache: false,
      four_digit_count: 0,
      section_count: 0,
    })
    expect(blank.page_kind).toBe('BLANK')
    expect(blank.needs_ocr).toBe(false)

    const problem = classifyBookPage({
      page_number: 28,
      ink_ratio: 0.3,
      has_ocr_cache: true,
      page_layout_kind: 'PROBLEM_PAGE',
      four_digit_count: 7,
      section_count: 0,
      cache_text: '0159 다음 중',
    })
    expect(problem.page_kind).toBe('PROBLEM')
    expect(problem.needs_ocr).toBe(false)
  })

  it('keeps page_kind totals at 192', () => {
    const counts = emptyKindCounts()
    counts.UNKNOWN = 170
    counts.PROBLEM = 12
    counts.THEORY = 1
    counts.BLANK = 9
    expect(() => assertKindSum(counts, EXPECTED_PAGE_COUNT)).not.toThrow()
  })
})

describe('STEP 8.6 number flow and sampling', () => {
  it('marks same-page duplicates and treats uncached gaps as workbook structure', () => {
    const flow = inspectNumberFlow([
      { page: 28, problem_number: '0159' },
      { page: 28, problem_number: '0159' },
      { page: 44, problem_number: '0274' },
    ])
    expect(flow.duplicate).toBe(1)
    expect(flow.normal_structure_jumps).toBe(1)
  })

  it('maps gate reasons and never picks more than 10 PHASE B drafts', () => {
    expect(mapGateReasons(['crop_gate', 'body_intrusion'])).toEqual(['CROP_UNSAFE', 'BODY_INTRUSION'])
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ problem_number: String(159 + i).padStart(4, '0'), canonical_problem_number: String(159 + i).padStart(4, '0') }),
    )
    const picked = pickPhaseBPilot(many)
    expect(picked).toHaveLength(PHASE_B_MAX_PROBLEMS)
    expect(new Set(picked.map((row) => row.problem_number)).size).toBe(PHASE_B_MAX_PROBLEMS)
    expect(pickStratifiedSample(many, 20).length).toBeGreaterThanOrEqual(15)
    const dupReady = [
      candidate({ page: 8, problem_number: '0043', canonical_problem_number: '0043' }),
      candidate({ page: 12, problem_number: '0043', canonical_problem_number: '0043' }),
      candidate({ page: 156, problem_number: '1092', canonical_problem_number: '1092', choice_count: 0, route: 'WOULD_USE_MISTRAL_ONLY' }),
    ]
    const unique = pickPhaseBPilot(dupReady)
    expect(unique.filter((row) => row.problem_number === '0043')).toHaveLength(1)
    expect(unique.some((row) => row.problem_number === '1092')).toBe(true)
  })
})
