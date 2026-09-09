import { describe, expect, it } from 'vitest'
import { buildBookStructure, extractHeadingsFromPage, extractBookTypeNumbers } from './bookStructure'
import { classifyProblem, contentUnitFromStem, typeIntentFromStem, DEFAULT_THRESHOLDS } from './classifyDraft'
import { calibrateCuts, estimateDifficulty, mapDifficultyScore } from './difficultyModel'
import { canonicalizeHyperTypes, makeHyperType, normalizeTaxonomyKey, typeIdFromBookHeading } from './hyperTaxonomy'

const toc = `# 차례
# 공통수학1
# I 다항식
01 다항식의 연산 8
02 나머지 정리와 인수분해 24
# IV 순열과 조합
09 순열과 조합 150
# V 행렬
10 행렬과 그 연산 174
`

const theory = `### 01-1 다항식의 덧셈과 뺄셈
유형 01
### 02-1 항등식
유형 01-05
`

describe('STEP 8.8 TRACK A book structure', () => {
  it('extracts 대단원/중단원 from TOC OCR without inventing titles', () => {
    const hits = extractHeadingsFromPage(6, toc)
    expect(hits.some((row) => row.kind === 'MAJOR_UNIT' && row.major_unit === 'I 다항식')).toBe(true)
    expect(hits.some((row) => row.section_title === '다항식의 연산' && row.page_start_hint === 8)).toBe(true)
    const structure = buildBookStructure({
      pageTexts: [
        { page: 6, text: toc },
        { page: 8, text: theory },
      ],
      lastPage: 192,
    })
    expect(structure.sections.map((row) => row.subunit)).toContain('다항식의 연산')
    expect(structure.major_units.map((row) => row.title)).toContain('순열과 조합')
    expect(structure.theory_headings.some((row) => row.title === '다항식의 덧셈과 뺄셈')).toBe(true)
    expect(extractBookTypeNumbers('유형 15, 16')).toEqual(['15', '16'])
  })
})

describe('STEP 8.8 TRACK A taxonomy', () => {
  it('canonicalizes equivalent labels and keeps distinct math types apart', () => {
    const merged = canonicalizeHyperTypes([
      makeHyperType('UNDETERMINED_COEFF', { type_name: '항등식 계수 비교', book_aliases: ['계수 비교형'] }),
      makeHyperType('UNDETERMINED_COEFF', { type_name: '계수 비교를 이용한 항등식' }),
    ])
    expect(merged).toHaveLength(1)
    expect(typeIdFromBookHeading('나머지 정리와 인수 정리')).toBe('REMAINDER_FACTOR_THEOREM')
    expect(typeIdFromBookHeading('이차식의 인수분해')).toBe('QUADRATIC_FACTOR')
    expect(typeIdFromBookHeading('다항식 인수분해')).toBe('POLY_FACTORING')
    expect(normalizeTaxonomyKey({ subject: '공통수학1', unit: '다항식', subunit: '항등식', type_name: '계수 비교형' })).toContain('다항식')
  })
})

describe('STEP 8.8 TRACK A classification confidence', () => {
  it('does not treat a variable x as an equation type', () => {
    expect(typeIntentFromStem('다항식 $x^3-y^3$를 인수분해하시오').type_id).toBe('POLY_FACTORING')
    expect(typeIntentFromStem('$x$의 값에 관계없이 등식이 항상 성립할 때 계수를 구하시오').type_id).toBe('UNDETERMINED_COEFF')
    expect(contentUnitFromStem('두 행렬 A, B에 대하여 AB를 구하시오').unit).toBe('행렬')
  })

  it('flags unit conflict when heading and stem disagree', () => {
    const structure = buildBookStructure({
      pageTexts: [
        { page: 6, text: toc },
        { page: 8, text: theory },
      ],
      lastPage: 192,
    })
    const row = classifyProblem({
      problem_id: 'p1',
      page: 9,
      problem_number: '0012',
      stem: '두 행렬 A, B의 곱 AB를 구하시오',
      structure,
      typeCatalog: [makeHyperType('MATRIX_ARITHMETIC'), makeHyperType('POLY_ADD_SUB')],
      difficulty: { score: 2, confidence: 0.7 },
      thresholds: DEFAULT_THRESHOLDS,
    })
    expect(row.review_reasons).toContain('UNIT_CONFLICT')
    expect(row.decision.unit).toBe('CLASSIFICATION_REVIEW')
    expect(row.decision.overall).toBe('CLASSIFICATION_REVIEW')
  })
})

describe('STEP 8.8 TRACK A difficulty features', () => {
  it('scores constructed + figure higher than short MCQ and maps 1-5', () => {
    const easy = estimateDifficulty({ stem: '다음을 계산하시오 $1+1$', choice_count: 5, math_count: 1, figure_hint: false, graph_hint: false })
    const hard = estimateDifficulty({
      stem: '(가) (나) 단, 그림과 같이 고난도 유형 01 + 19쪽 유형 12 서술형으로 설명하시오',
      choice_count: 0,
      math_count: 8,
      figure_hint: true,
      graph_hint: true,
    })
    expect(hard.raw).toBeGreaterThan(easy.raw)
    expect(mapDifficultyScore(0.1, [0.22, 0.36, 0.5, 0.66])).toBe(1)
    expect(mapDifficultyScore(0.9, [0.22, 0.36, 0.5, 0.66])).toBe(5)
    const cuts = calibrateCuts([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(cuts[0]).toBeLessThan(cuts[3])
  })
})
