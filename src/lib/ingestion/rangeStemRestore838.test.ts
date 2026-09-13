import { describe, expect, it } from 'vitest'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { splitMathForDisplay } from '../math/splitMathForDisplay'
import { safeRenderKatex } from '../math/safeKatex'
import {
  buildRangeRestorePlan,
  composeTargetStem,
  dryRunSafety838,
  parseRangeTokens,
  splitDonorAtLaterRange,
  stemHash838,
  withAppliedStems,
  type CatalogProblem838,
} from './rangeStemRestore838'
import { worksheetItemHasSharedCondition } from '../questions/sharedPromptDisplay'

function problem(partial: Partial<CatalogProblem838> & Pick<CatalogProblem838, 'id' | 'problem_number' | 'stem'>): CatalogProblem838 {
  const n = partial.problem_number
  return {
    public_code: `HQB-${partial.id}`,
    display_state: 'LISTED',
    review_status: 'AUTO_CLASSIFIED',
    current_version_id: `v-${partial.id}`,
    origin: 'OCR',
    version_no: 1,
    parent_version_id: null,
    original_problem_number: String(n).padStart(4, '0'),
    source_page: 9,
    section_code: '01',
    instruction: null,
    source_document_id: SSEN_SOURCE_DOCUMENT_ID,
    step832_preview: partial.stem,
    crop_present: true,
    has_page_image: false,
    page_ocr_chars: 0,
    ...partial,
  }
}

function catalog0002(): CatalogProblem838[] {
  return [
    problem({
      id: 'p0002',
      problem_number: 2,
      stem: '0002 $x$에 대한 오름차순\n[0003~0004] 다항식 $2x^2+3xy-y^2+x-10y+1$을 다음과 같이 정리하시오.',
    }),
    problem({ id: 'p0003', problem_number: 3, stem: '$x$에 대한 내림차순' }),
    problem({ id: 'p0004', problem_number: 4, stem: '0004 $y$에 대한 오름차순\n[0005~0007] 다음을 계산하시오.' }),
    problem({ id: 'p0005', problem_number: 5, stem: '$(2x^3+x^2-1)+(-x^3+x-3)$' }),
    problem({ id: 'p0006', problem_number: 6, stem: '$(x-1)^2$' }),
    problem({ id: 'p0007', problem_number: 7, stem: '$x+y$' }),
  ]
}

describe('range token parsing', () => {
  it('parses four-digit and one-digit ranges', () => {
    const four = parseRangeTokens('[0003~0004] 다음')
    expect(four).toEqual([expect.objectContaining({ start: 3, end: 4, raw: '[0003~0004]' })])
    const one = parseRangeTokens('[3~4] 다음을 구하시오')
    expect(one).toEqual([expect.objectContaining({ start: 3, end: 4, raw: '[3~4]' })])
  })

  it('does not treat normal math brackets as a problem range', () => {
    expect(parseRangeTokens('구간 $[0,1]$ 에서 $\\frac{1}{2}$')).toEqual([])
    expect(parseRangeTokens('\\sqrt[3]{8}')).toEqual([])
    expect(parseRangeTokens('\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}')).toEqual([])
    const inside = parseRangeTokens('값 $$[3~4]$$')
    expect(inside).toHaveLength(1)
    const split = splitDonorAtLaterRange('값 $$[3~4]$$', 2)
    expect(split).toBeNull()
  })
})

describe('donor / target split and compose', () => {
  it('splits the leaked [0003~0004] prompt off 0002', () => {
    const stem = catalog0002()[0]!.stem
    const split = splitDonorAtLaterRange(stem, 2)
    expect(split?.keep).toContain('오름차순')
    expect(split?.keep).not.toContain('[0003~0004]')
    expect(split?.shared).toMatch(/^\[0003~0004\]/)
    expect(split?.shared).toContain('정리하시오')
  })

  it('composes a standalone target stem without duplicating 0003.', () => {
    const shared = '[0003~0004] 다항식 $2x^2+3xy-y^2+x-10y+1$을 다음과 같이 정리하시오.'
    const composed = composeTargetStem(shared, '$x$에 대한 내림차순', 3)
    expect(composed.startsWith('[0003~0004]')).toBe(true)
    expect(composed).toContain('$x$에 대한 내림차순')
    expect(composed).not.toMatch(/0003\./)
    expect(worksheetItemHasSharedCondition(composed)).toBe(true)
  })

  it('does not insert the shared prompt twice', () => {
    const shared = '[0003~0004] 다음을 정리하시오.'
    const once = composeTargetStem(shared, '$x$', 3)
    const twice = composeTargetStem(shared, once, 3)
    expect(twice).toBe(once)
  })
})

describe('buildRangeRestorePlan', () => {
  it('marks the 0002 leak AUTO_SAFE and plans donor + target versions', () => {
    const plan = buildRangeRestorePlan(catalog0002())
    const donor = plan.candidates.find((row) => row.current_number === '0002')
    expect(donor?.verdict).toBe('AUTO_SAFE')
    expect(plan.summary.problems_deleted).toBe(0)
    expect(plan.summary.problems_added).toBe(0)
    expect(plan.applies.some((row) => row.role === 'donor' && row.problem_id === 'p0002')).toBe(true)
    const target3 = plan.applies.find((row) => row.problem_id === 'p0003')
    expect(target3?.to_stem).toContain('[0003~0004]')
    expect(target3?.to_stem).toContain('내림차순')
    const safety = dryRunSafety838(plan)
    expect(safety.ok).toBe(true)
  })

  it('keeps listed count and is idempotent after apply', () => {
    const first = buildRangeRestorePlan(catalog0002())
    const second = buildRangeRestorePlan(withAppliedStems(catalog0002(), first.applies))
    expect(second.applies).toEqual([])
    expect(second.summary.new_versions).toBe(0)
    expect(first.summary.expected_listed).toBe(1242)
  })

  it('blocks section-boundary collisions', () => {
    const rows = catalog0002().map((row) => (row.problem_number === 3 ? { ...row, section_code: '02' } : row))
    const donor = buildRangeRestorePlan(rows).candidates.find((row) => row.current_number === '0002')
    expect(donor?.verdict).toBe('REVIEW_REQUIRED')
    expect(donor?.verdict_reason).toMatch(/소단원/)
  })

  it('protects TEACHER_EDIT current versions', () => {
    const rows = catalog0002().map((row) => (row.problem_number === 3 ? { ...row, origin: 'TEACHER_EDIT' } : row))
    const plan = buildRangeRestorePlan(rows)
    const donor = plan.candidates.find((row) => row.current_number === '0002')
    expect(donor?.verdict).toBe('REVIEW_REQUIRED')
    expect(donor?.teacher_edit).toBe(true)
    expect(plan.applies.some((row) => row.problem_id === 'p0003')).toBe(false)
    expect(plan.applies.some((row) => row.problem_id === 'p0002')).toBe(false)
  })

  it('protects VERIFIED problems', () => {
    const rows = catalog0002().map((row) => (row.id === 'p0002' ? { ...row, review_status: 'VERIFIED' } : row))
    const plan = buildRangeRestorePlan(rows)
    const donor = plan.candidates.find((row) => row.current_number === '0002')
    expect(donor?.verdict).toBe('REVIEW_REQUIRED')
    expect(donor?.verified).toBe(true)
    expect(plan.applies.some((row) => row.problem_id === 'p0002' || row.problem_id === 'p0003')).toBe(false)
  })

  it('does not auto-split an own-range header that still contains sibling bodies', () => {
    const rows = [
      problem({
        id: 'p0313',
        problem_number: 313,
        source_page: 49,
        section_code: '03',
        stem: '[0313~0318] 다음을 계산하시오.\n0313 $$i^{50}$$\n0314 $$(-i)^{65}$$',
      }),
      problem({ id: 'p0315', problem_number: 315, source_page: 49, section_code: '03', stem: '$$i$$' }),
    ]
    const plan = buildRangeRestorePlan(rows)
    const own = plan.candidates.find((row) => row.current_number === '0313')
    expect(own?.kind).toBe('OWN_RANGE_HEADER')
    expect(own?.verdict).toBe('REVIEW_REQUIRED')
    expect(plan.applies).toEqual([])
  })

  it('blocks hidden duplicates instead of writing them', () => {
    const rows = [
      ...catalog0002(),
      problem({
        id: 'hidden-314',
        problem_number: 314,
        display_state: 'HIDDEN_DUPLICATE',
        source_page: 49,
        section_code: '03',
        stem: '[0313~0318] 다음을 계산하시오.',
      }),
    ]
    const hidden = buildRangeRestorePlan(rows).candidates.find((row) => row.problem_id === 'hidden-314')
    expect(hidden?.verdict).toBe('BLOCKED')
    expect(hidden?.kind).toBe('HIDDEN_DUPLICATE')
  })

  it('reviews when a listed target is missing', () => {
    const rows = catalog0002().filter((row) => row.problem_number !== 3)
    const donor = buildRangeRestorePlan(rows).candidates.find((row) => row.current_number === '0002')
    expect(donor?.verdict).toBe('REVIEW_REQUIRED')
    expect(donor?.verdict_reason).toMatch(/listed/)
  })

  it('keeps hashes stable for the same stem', () => {
    const stem = catalog0002()[0]!.stem
    expect(stemHash838(stem)).toBe(stemHash838(stem))
    expect(stemHash838(stem)).not.toBe(stemHash838('other'))
  })
})

describe('STEP 8.37 math regression on restored stems', () => {
  it('still renders restored latex and falls back on broken latex', () => {
    const composed = composeTargetStem(
      '[0003~0004] 다항식 $2x^2+3xy-y^2+x-10y+1$을 다음과 같이 정리하시오.',
      '$x$에 대한 내림차순',
      3,
    )
    const parts = splitMathForDisplay(composed)
    expect(parts.some((part) => part.kind === 'math' && part.value.includes('2x^2'))).toBe(true)
    expect(safeRenderKatex('2x^2+3xy-y^2+x-10y+1', false).ok).toBe(true)
    const broken = safeRenderKatex('\\begin{pmatrix', true)
    expect(broken.ok).toBe(false)
    expect(broken.fallback).toBe('\\begin{pmatrix')
  })
})
