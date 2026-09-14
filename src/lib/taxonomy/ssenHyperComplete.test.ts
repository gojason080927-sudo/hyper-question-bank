import { describe, expect, it } from 'vitest'
import { sectionForPage } from '../outline/ssenToc'
import {
  allowedHyperTypesForSection,
  confirmType,
  hyperDimsForStem,
  mergeHeadingCache,
  neighborTypeMatch,
  planSsenHyperComplete,
  sourceTypeFromStem,
  stripAnswerKeyLeak,
  type HyperCompleteItem,
} from './ssenHyperComplete'
import type { SsenClassifyItem } from './ssenFullClassify'

function item(
  partial: Partial<HyperCompleteItem> & Pick<SsenClassifyItem, 'problem_id' | 'original_problem_number' | 'source_page' | 'stem'>,
): HyperCompleteItem {
  return {
    public_code: `HQB-${partial.original_problem_number}`,
    review_status: 'UNREVIEWED',
    display_state: 'LISTED',
    current_version_id: 'v1',
    origin: 'OCR',
    bbox_top: 0.2,
    bbox_x: 0.1,
    bbox_h: 0.2,
    existing_type_code: null,
    ...partial,
  }
}

describe('ssen hyper complete', () => {
  it('strips answer-key leak without inventing math', () => {
    const stem = '이차함수 y=f(x)의 최댓값을 구하시오.\n정답 및 풀이 83쪽\n답 4'
    const out = stripAnswerKeyLeak(stem)
    expect(out.changed).toBe(true)
    expect(out.cleaned).toContain('이차함수')
    expect(out.cleaned).not.toMatch(/정답/)
    expect(out.cleaned).not.toContain('답 4')
  })

  it('ignores a leaked 유형 16 that is not in section 06', () => {
    const section = sectionForPage(114)!
    expect(section.code).toBe('06')
    expect(sourceTypeFromStem('110쪽 유형 16\n원 A, B', section)).toBeNull()
    expect(allowedHyperTypesForSection(section)).toContain('CUBIC_QUARTIC_EQ')
    expect(allowedHyperTypesForSection(section)).not.toContain('POLY_ADD_SUB')
  })

  it('classifies C-stage content as HYPER type without a publisher type pill', () => {
    const planned = planSsenHyperComplete({
      items: [
        item({
          problem_id: 'c1',
          original_problem_number: '0097',
          source_page: 20,
          stem: '두 다항식 A, B에 대하여 A+B를 내림차순으로 정리하시오',
        }),
      ],
      headings: [{ page: 20, y_norm: 0.04, x_norm: 0.08, kind: 'c_stage', title_ocr: '실력 굳히기', badge_ocr: 'C' }],
    })
    expect(planned.rows[0]?.source_stage).toBe('C')
    expect(planned.rows[0]?.source_type).toBeNull()
    expect(planned.rows[0]?.type_id).toBe('POLY_ADD_SUB')
    expect(planned.rows[0]?.confirmation).not.toBe('LOW_CONFIDENCE_REVIEW')
  })

  it('reuses heading AUTO cache and still fills difficulty and dictionary ids', () => {
    const planned = planSsenHyperComplete({
      items: mergeHeadingCache(
        [
          item({
            problem_id: 'a',
            original_problem_number: '0040',
            source_page: 12,
            stem: '두 다항식 A, B에 대하여 A+B를 내림차순으로 정리하시오',
          }),
        ],
        [{ problem_id: 'a', type_id: 'POLY_ADD_SUB', type_code: '01', verdict: 'AUTO', reasons: [] }],
      ),
    })
    expect(planned.rows[0]?.cached).toBe(true)
    expect(planned.rows[0]?.type_id).toBe('POLY_ADD_SUB')
    expect(planned.rows[0]?.confirmation).toBe('SOURCE_CONFIRMED')
    expect(planned.rows[0]?.strategy_id).toBe('POLY_ADD_SUB:strategy')
    expect(planned.rows[0]?.hyper_dims).toBeTruthy()
    expect(planned.rows[0]?.search.primary_type).toBe('POLY_ADD_SUB')
  })

  it('does not copy source A/B/C onto HYPER overall', () => {
    const easy = hyperDimsForStem('다음 다항식을 내림차순으로 정리하시오. $x+1$')
    const hard = hyperDimsForStem('보기에서 옳은 것만을 있는 대로 고르시오. (가) (나) (다) 단, 실수 k에 대하여 경우를 나누어 증명하시오. $x^4+ax^3$')
    expect(Number(easy.calculation_complexity)).toBeLessThanOrEqual(hard.calculation_complexity)
    expect(hard.reasoning_depth).toBeGreaterThanOrEqual(easy.reasoning_depth)
  })

  it('needs two agreeing signals before SOURCE/CLUSTER confirm', () => {
    const weak = confirmType({
      cachedAuto: false,
      sourceType: null,
      clusterType: null,
      contentType: null,
      aiType: 'POLY_ADD_SUB',
      fingerprintOk: false,
    })
    expect(weak.confirmation).toBe('LOW_CONFIDENCE_REVIEW')
    const ok = confirmType({
      cachedAuto: false,
      sourceType: null,
      clusterType: 'REMAINDER_FACTOR_THEOREM',
      contentType: 'REMAINDER_FACTOR_THEOREM',
      aiType: null,
      fingerprintOk: true,
    })
    expect(ok.confirmation).toBe('CLUSTER_CONFIRMED')
    expect(ok.type_id).toBe('REMAINDER_FACTOR_THEOREM')
    const sectionOk = confirmType({
      cachedAuto: false,
      sourceType: null,
      clusterType: 'QUADRATIC_INEQUALITY',
      contentType: null,
      aiType: null,
      fingerprintOk: false,
      sectionType: 'QUADRATIC_INEQUALITY',
    })
    expect(sectionOk.confirmation).toBe('CLUSTER_CONFIRMED')
    expect(sectionOk.type_id).toBe('QUADRATIC_INEQUALITY')
  })

  it('classifies section 06 cubic content without inventing publisher type 16', () => {
    const planned = planSsenHyperComplete({
      items: [
        item({
          problem_id: 'p774',
          original_problem_number: '0774',
          source_page: 114,
          stem: '110쪽 유형 16\n삼차방정식 $x^3-6x^2+11x-6=0$의 해를 구하시오',
        }),
      ],
    })
    expect(planned.rows[0]?.source_type).toBeNull()
    expect(planned.rows[0]?.type_id).toBe('CUBIC_QUARTIC_EQ')
  })

  it('propagates a labeled cluster onto an unlabeled neighbor', () => {
    const planned = planSsenHyperComplete({
      items: mergeHeadingCache(
        [
          item({
            problem_id: 'lab',
            original_problem_number: '0259',
            source_page: 41,
            stem: '유형 06 일차식 x-1로 나누었을 때의 나머지를 구하시오',
          }),
          item({
            problem_id: 'lab2',
            original_problem_number: '0260',
            source_page: 41,
            stem: '유형 06 P(x)를 x-2로 나누었을 때의 나머지를 구하시오',
          }),
          item({
            problem_id: 'cstage',
            original_problem_number: '0300',
            source_page: 44,
            stem: 'P(x)를 x-3으로 나누었을 때의 나머지를 구하시오',
          }),
        ],
        [
          { problem_id: 'lab', type_id: 'REMAINDER_FACTOR_THEOREM', type_code: '06', verdict: 'AUTO', reasons: [] },
          { problem_id: 'lab2', type_id: 'REMAINDER_FACTOR_THEOREM', type_code: '06', verdict: 'AUTO', reasons: [] },
        ],
      ),
    })
    const unlabeled = planned.rows.find((row) => row.original_problem_number === '0300')
    expect(unlabeled?.type_id).toBe('REMAINDER_FACTOR_THEOREM')
    expect(unlabeled?.cached).toBe(false)
  })

  it('gives C-stage a HYPER type from section majority without a publisher pill', () => {
    const planned = planSsenHyperComplete({
      items: mergeHeadingCache(
        [
          item({
            problem_id: 'lab-a',
            original_problem_number: '0040',
            source_page: 12,
            stem: '유형 01 두 다항식 A+B를 내림차순으로 정리하시오',
          }),
          item({
            problem_id: 'lab-b',
            original_problem_number: '0041',
            source_page: 12,
            stem: '유형 01 다항식 2A-B를 정리하시오',
          }),
          item({
            problem_id: 'c-no-pill',
            original_problem_number: '0098',
            source_page: 20,
            stem: '두 다항식 A=x^2+1, B=x-3에 대하여 2A-B의 값을 구하시오',
            review_status: 'UNREVIEWED',
          }),
        ],
        [
          { problem_id: 'lab-a', type_id: 'POLY_ADD_SUB', type_code: '01', verdict: 'AUTO', reasons: [] },
          { problem_id: 'lab-b', type_id: 'POLY_ADD_SUB', type_code: '01', verdict: 'AUTO', reasons: [] },
        ],
      ),
      headings: [{ page: 20, y_norm: 0.04, x_norm: 0.08, kind: 'c_stage', title_ocr: '실력 굳히기', badge_ocr: 'C' }],
    })
    const unlabeled = planned.rows.find((row) => row.original_problem_number === '0098')
    expect(unlabeled?.source_type).toBeNull()
    expect(unlabeled?.type_id).toBe('POLY_ADD_SUB')
    expect(unlabeled?.confirmation).not.toBe('LOW_CONFIDENCE_REVIEW')
  })

  it('counts neighbor type matches for twin-search readiness', () => {
    expect(
      neighborTypeMatch([
        { type_id: 'POLY_ADD_SUB', neighbor_types: ['POLY_ADD_SUB', 'POLY_MULTIPLY'] },
        { type_id: 'MATRIX_ARITHMETIC', neighbor_types: ['COUNTING_PERM_COMB'] },
      ]),
    ).toEqual({ checked: 2, matched: 1 })
  })
})
