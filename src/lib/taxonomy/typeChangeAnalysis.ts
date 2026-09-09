import { TYPE_PROFILES_V1 } from './typeProfiles'

export type TypeChange = {
  type_id: string
  action: 'KEEP' | 'MERGE' | 'SPLIT' | 'RENAME' | 'REVIEW'
  reason: string
  evidence_problem_ids: string[]
}

const PREVIOUS_22 = [
  'POLY_ADD_SUB',
  'POLY_MULTIPLY',
  'POLY_PRODUCT_TRANSFORM',
  'POLY_DIVIDE',
  'IDENTITY_PROPERTY',
  'UNDETERMINED_COEFF',
  'REMAINDER_FACTOR_THEOREM',
  'SYNTHETIC_DIVISION',
  'POLY_FACTORING',
  'COMPLEX_EQUALITY',
  'COMPLEX_CONJUGATE',
  'COMPLEX_ARITHMETIC',
  'QUADRATIC_SOLVE',
  'QUADRATIC_DISCRIMINANT',
  'QUADRATIC_VIETAS',
  'QUADRATIC_FACTOR',
  'QUAD_FN_RELATION',
  'SIMULTANEOUS_QUAD',
  'LINEAR_INEQUALITY',
  'QUADRATIC_INEQUALITY',
  'COUNTING_PERM_COMB',
  'MATRIX_ARITHMETIC',
] as const

export function analyzeTypeChanges(exampleIds: Map<string, string[]>): TypeChange[] {
  const out: TypeChange[] = PREVIOUS_22.map((type_id) => ({
    type_id,
    action: type_id === 'UNDETERMINED_COEFF' ? ('SPLIT' as const) : ('KEEP' as const),
    reason:
      type_id === 'UNDETERMINED_COEFF'
        ? 'TYPE은 유지하고 계수 비교형/수치 대입형만 SUBTYPE으로 분리한다. 단순 숫자 변경은 SUBTYPE이 아니다.'
        : type_id === 'IDENTITY_PROPERTY'
          ? '미정계수와 이름이 비슷해도 항등 여부 판정과 계수 결정은 다른 질문이라 MERGE하지 않는다.'
          : '풀이 전략과 핵심 개념이 8.8과 265 재검증에서 구분된다.',
    evidence_problem_ids: (exampleIds.get(type_id) ?? []).slice(0, 5),
  }))
  out.push({
    type_id: 'CUBIC_QUARTIC_EQ',
    action: 'REVIEW',
    reason: '8.8 미매핑 heading(삼차·사차방정식). 이차 풀이와 전략이 달라 CANDIDATE TYPE으로 추가. VALIDATED 아님.',
    evidence_problem_ids: (exampleIds.get('CUBIC_QUARTIC_EQ') ?? []).slice(0, 5),
  })
  return out
}

export function previousTypeCount(): number {
  return PREVIOUS_22.length
}

export function currentTypeIds(): string[] {
  return TYPE_PROFILES_V1.map((row) => row.type_id)
}
