import { describe, expect, it } from 'vitest'
import { buildBookStructure } from '../classification/bookStructure'
import { estimateRubricDifficulty } from './difficultyRubric'
import { classifyDraftV1, DEFAULT_V1_THRESHOLDS, stemTypeIntent } from './taxonomyClassifier'
import { profileById } from './typeProfiles'

const toc = `# I 다항식
01 다항식의 연산 8
# V 행렬
10 행렬과 그 연산 174
`
const theory = `### 01-1 다항식의 덧셈과 뺄셈
유형 01
`

const structure = buildBookStructure({
  pageTexts: [
    { page: 6, text: toc },
    { page: 8, text: theory },
    { page: 174, text: '### 10-1 행렬의 덧셈과 뺄셈\n유형 01' },
  ],
  lastPage: 192,
})

describe('taxonomy classifier v1', () => {
  it('prefers stem unit/type when heading conflicts', () => {
    const row = classifyDraftV1({
      problem_id: 'p-matrix',
      page: 9,
      problem_number: '0012',
      stem: '두 행렬 A, B의 곱 AB를 구하시오',
      structure,
      difficulty: estimateRubricDifficulty({ stem: '두 행렬 A, B의 곱 AB를 구하시오', choice_count: 0, math_count: 1, figure_hint: false, graph_hint: false }),
      thresholds: DEFAULT_V1_THRESHOLDS,
    })
    expect(row.unit_id).toBe('행렬')
    expect(row.type_id).toBe('MATRIX_ARITHMETIC')
    expect(row.review_reasons).toContain('UNIT_CONFLICT')
    expect(row.decisions.unit).toBe('REVIEW')
    expect(row.decisions.overall).toBe('REVIEW')
  })

  it('merges equivalent aliases to one canonical type and splits strategy into subtype', () => {
    expect(stemTypeIntent('$x$의 값에 관계없이 등식이 항상 성립할 때 계수를 구하시오').type_id).toBe('UNDETERMINED_COEFF')
    const compare = classifyDraftV1({
      problem_id: 'p-coeff',
      page: 27,
      problem_number: '0171',
      stem: '항등식에서 계수 비교를 하여 미정계수 a, b를 구하시오',
      structure,
      difficulty: estimateRubricDifficulty({
        stem: '항등식에서 계수 비교를 하여 미정계수 a, b를 구하시오',
        choice_count: 0,
        math_count: 2,
        figure_hint: false,
        graph_hint: false,
      }),
      thresholds: DEFAULT_V1_THRESHOLDS,
    })
    expect(compare.type_id).toBe('UNDETERMINED_COEFF')
    expect(compare.subtype_id).toBe('UNDETERMINED_COEFF_COMPARE')
    const factor = stemTypeIntent('다항식 $x^3-y^3$를 인수분해하시오')
    expect(factor.type_id).toBe('POLY_FACTORING')
    expect(factor.type_id).not.toBe('QUADRATIC_FACTOR')
  })

  it('sends low confidence and unsupported mistakes to REVIEW', () => {
    const unclear = classifyDraftV1({
      problem_id: 'p-short',
      page: 9,
      problem_number: '0001',
      stem: '다음',
      structure,
      difficulty: estimateRubricDifficulty({ stem: '다음', choice_count: 0, math_count: 0, figure_hint: false, graph_hint: false }),
      thresholds: DEFAULT_V1_THRESHOLDS,
    })
    expect(unclear.decisions.overall).toBe('REVIEW')
    expect(unclear.review_reasons).toContain('EVIDENCE_INSUFFICIENT')
    const profile = profileById('MATRIX_ARITHMETIC')
    expect(profile?.common_mistakes.every((row) => row.evidence_basis.length > 8)).toBe(true)
  })
})
