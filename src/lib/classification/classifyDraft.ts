import { nearestTheoryHeading, sectionForPage, type BookStructure } from './bookStructure'
import { typeIdFromBookHeading, type HyperTypeCandidate } from './hyperTaxonomy'

export type ClassificationDecision = 'CLASSIFICATION_AUTO' | 'CLASSIFICATION_REVIEW'

export type FieldConfidence = {
  unit: number
  type: number
  difficulty: number
  key_point: number
}

export type ClassificationCandidate = {
  problem_id: string | null
  page: number
  problem_number: string
  subject: '공통수학1'
  unit_candidate: string
  subunit_candidate: string
  type_candidate: string
  subtype_candidate: string | null
  type_id: string
  difficulty_candidate: 1 | 2 | 3 | 4 | 5 | null
  key_point_candidate: string
  common_mistakes_candidate: string[]
  book_type_evidence: {
    heading: string | null
    theory_code: string | null
    book_type_numbers: string[]
    page_section: string | null
  }
  confidence: FieldConfidence
  decision: {
    unit: ClassificationDecision
    type: ClassificationDecision
    difficulty: ClassificationDecision
    overall: ClassificationDecision
  }
  review_reasons: string[]
  stem_excerpt: string
}

export type ClassificationThresholds = {
  unit: number
  type: number
  difficulty: number
  key_point: number
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  unit: 0.86,
  type: 0.78,
  difficulty: 0.58,
  key_point: 0.7,
}

export function contentUnitFromStem(stem: string): { unit: string | null; reason: string } {
  const text = stem.replace(/\s+/g, ' ')
  if (/행렬|정사각행렬|성분/.test(text) && !/행렬식/.test(text)) return { unit: '행렬', reason: 'matrix_vocab' }
  if (/순열|조합|경우의\s*수/.test(text)) return { unit: '순열과 조합', reason: 'counting_vocab' }
  if (/이차부등식/.test(text)) return { unit: '부등식', reason: 'quadratic_inequality' }
  if (/일차부등식|부등식/.test(text) && !/방정식/.test(text)) return { unit: '부등식', reason: 'inequality_vocab' }
  if (/복소수|허수단위|켤레복소수/.test(text) && !/켤레근/.test(text)) return { unit: '방정식', reason: 'complex_vocab' }
  if (/이차함수/.test(text) || /이차방정식/.test(text) || /판별식|근과\s*계수/.test(text)) {
    return { unit: '방정식', reason: 'quadratic_vocab' }
  }
  if (/항등식|나머지\s*정리|인수분해|조립제법|미정계수/.test(text) || /다항식/.test(text)) {
    return { unit: '다항식', reason: 'polynomial_vocab' }
  }
  return { unit: null, reason: 'insufficient' }
}

export function typeIntentFromStem(stem: string): { type_id: string | null; reason: string } {
  const text = stem.replace(/\s+/g, ' ')
  if ((/=/.test(text) || /등식/.test(text)) && /항등|값에\s*관계없이|항상\s*성립/.test(text) && !/부등식/.test(text)) {
    return { type_id: /계수|a_0|미지/.test(text) ? 'UNDETERMINED_COEFF' : 'IDENTITY_PROPERTY', reason: 'identity_structure' }
  }
  if (/나누었을\s*때.*나머지|나머지를\s*구|나머지정리/.test(text)) {
    return { type_id: /조립/.test(text) ? 'SYNTHETIC_DIVISION' : 'REMAINDER_FACTOR_THEOREM', reason: 'remainder_structure' }
  }
  if (/인수분해/.test(text) && /이차/.test(text)) return { type_id: 'QUADRATIC_FACTOR', reason: 'quadratic_factor' }
  if (/인수분해/.test(text)) return { type_id: 'POLY_FACTORING', reason: 'factoring_structure' }
  if (/오름차순|내림차순|동류항/.test(text)) return { type_id: 'POLY_ADD_SUB', reason: 'ordering_structure' }
  if (/나눗셈|몫과\s*나머지/.test(text)) return { type_id: 'POLY_DIVIDE', reason: 'division_structure' }
  if (/x\^n|1\/x|곱셈\s*공식/.test(text) && /값/.test(text)) return { type_id: 'POLY_PRODUCT_TRANSFORM', reason: 'product_transform' }
  if (/켤레복소수/.test(text)) return { type_id: 'COMPLEX_CONJUGATE', reason: 'conjugate' }
  if (/복소수/.test(text) && /같/.test(text)) return { type_id: 'COMPLEX_EQUALITY', reason: 'complex_equal' }
  if (/허수|복소수/.test(text)) return { type_id: 'COMPLEX_ARITHMETIC', reason: 'complex_ops' }
  if (/판별식|근의\s*개수/.test(text)) return { type_id: 'QUADRATIC_DISCRIMINANT', reason: 'discriminant' }
  if (/근과\s*계수|두\s*근의\s*합|두\s*근의\s*곱/.test(text)) return { type_id: 'QUADRATIC_VIETAS', reason: 'vietas' }
  if (/이차부등식/.test(text)) return { type_id: 'QUADRATIC_INEQUALITY', reason: 'quad_ineq' }
  if (/부등식/.test(text)) return { type_id: 'LINEAR_INEQUALITY', reason: 'lin_ineq' }
  if (/순열|조합/.test(text)) return { type_id: 'COUNTING_PERM_COMB', reason: 'counting' }
  if (/행렬/.test(text)) return { type_id: 'MATRIX_ARITHMETIC', reason: 'matrix' }
  if (/연립/.test(text) && /이차/.test(text)) return { type_id: 'SIMULTANEOUS_QUAD', reason: 'simultaneous' }
  if (/이차함수/.test(text)) return { type_id: 'QUAD_FN_RELATION', reason: 'quad_fn' }
  if (/이차방정식/.test(text) || /해를\s*구/.test(text) && /x\^2/.test(text)) return { type_id: 'QUADRATIC_SOLVE', reason: 'quad_solve' }
  if (/\(.*\)\(.*\)/.test(text) && /전개|곱/.test(text)) return { type_id: 'POLY_MULTIPLY', reason: 'multiply' }
  return { type_id: null, reason: 'no_forced_keyword' }
}

export function chooseThresholds(values: number[], floor: number, ceil: number): number {
  if (!values.length) return floor
  const sorted = [...values].sort((a, b) => a - b)
  const p40 = sorted[Math.floor((sorted.length - 1) * 0.4)] ?? floor
  return Math.min(ceil, Math.max(floor, Number(p40.toFixed(2))))
}

export function applyDecisions(
  confidence: FieldConfidence,
  thresholds: ClassificationThresholds,
  reviewReasons: string[],
): ClassificationCandidate['decision'] {
  const unit = confidence.unit >= thresholds.unit && !reviewReasons.includes('UNIT_CONFLICT') ? 'CLASSIFICATION_AUTO' : 'CLASSIFICATION_REVIEW'
  const type = confidence.type >= thresholds.type && !reviewReasons.includes('TYPE_UNCLEAR') ? 'CLASSIFICATION_AUTO' : 'CLASSIFICATION_REVIEW'
  const difficulty = confidence.difficulty >= thresholds.difficulty ? 'CLASSIFICATION_AUTO' : 'CLASSIFICATION_REVIEW'
  const overall =
    unit === 'CLASSIFICATION_AUTO' && type === 'CLASSIFICATION_AUTO' ? 'CLASSIFICATION_AUTO' : 'CLASSIFICATION_REVIEW'
  return { unit, type, difficulty, overall }
}

export function classifyProblem(input: {
  problem_id: string | null
  page: number
  problem_number: string
  stem: string
  structure: BookStructure
  typeCatalog: HyperTypeCandidate[]
  difficulty: { score: 1 | 2 | 3 | 4 | 5 | null; confidence: number }
  thresholds: ClassificationThresholds
}): ClassificationCandidate {
  const review_reasons: string[] = []
  const section = sectionForPage(input.structure, input.page)
  const headingUnit = section?.unit ?? null
  const content = contentUnitFromStem(input.stem)
  if (headingUnit && content.unit && headingUnit !== content.unit) {
    review_reasons.push('UNIT_CONFLICT')
  }
  const unit_candidate = headingUnit && (!content.unit || content.unit === headingUnit) ? headingUnit : content.unit ?? headingUnit ?? '미정'
  let unitConf = headingUnit && content.unit === headingUnit ? 0.96 : headingUnit && !content.unit ? 0.88 : content.unit && !headingUnit ? 0.55 : 0.35
  if (review_reasons.includes('UNIT_CONFLICT')) unitConf = 0.2

  const localTheory = nearestTheoryHeading(input.structure, input.page, section?.section_code)

  const headingTypeId = localTheory ? typeIdFromBookHeading(localTheory.title) : null
  const intent = typeIntentFromStem(input.stem)
  let type_id = 'TYPE_UNCLEAR'
  let typeConf = 0.3
  if (headingTypeId && intent.type_id && headingTypeId === intent.type_id) {
    type_id = headingTypeId
    typeConf = 0.92
  } else if (headingTypeId && !intent.type_id) {
    type_id = headingTypeId
    typeConf = 0.8
  } else if (intent.type_id && !headingTypeId) {
    type_id = intent.type_id
    typeConf = 0.62
    review_reasons.push('TYPE_FROM_STEM_ONLY')
  } else if (headingTypeId && intent.type_id && headingTypeId !== intent.type_id) {
    type_id = intent.type_id
    typeConf = 0.48
    review_reasons.push('TYPE_HEADING_STEM_MISMATCH')
  } else {
    review_reasons.push('TYPE_UNCLEAR')
  }

  const catalog = input.typeCatalog.find((row) => row.type_id === type_id)
  const key_point = catalog && catalog.key_tested_point !== 'REVIEW' ? catalog.key_tested_point : 'REVIEW'
  const keyConf = key_point === 'REVIEW' ? 0.2 : 0.82
  if (key_point === 'REVIEW') review_reasons.push('KEY_POINT_REVIEW')

  const confidence: FieldConfidence = {
    unit: unitConf,
    type: typeConf,
    difficulty: input.difficulty.confidence,
    key_point: keyConf,
  }
  const decision = applyDecisions(confidence, input.thresholds, review_reasons)
  return {
    problem_id: input.problem_id,
    page: input.page,
    problem_number: input.problem_number,
    subject: '공통수학1',
    unit_candidate,
    subunit_candidate: section?.subunit ?? '미정',
    type_candidate: catalog?.type_name ?? '유형 미확정',
    subtype_candidate: catalog?.subtype_name ?? null,
    type_id,
    difficulty_candidate: input.difficulty.score,
    key_point_candidate: key_point,
    common_mistakes_candidate: catalog?.common_mistakes ?? [],
    book_type_evidence: {
      heading: localTheory?.title ?? null,
      theory_code: localTheory?.theory_code ?? null,
      book_type_numbers: localTheory?.book_type_numbers ?? [],
      page_section: section ? `${section.subunit} p.${section.page_start}-${section.page_end}` : null,
    },
    confidence,
    decision,
    review_reasons,
    stem_excerpt: input.stem.replace(/\s+/g, ' ').slice(0, 180),
  }
}
