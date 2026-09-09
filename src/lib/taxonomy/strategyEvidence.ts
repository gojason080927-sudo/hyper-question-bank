import { profileById } from './typeProfiles'

const STRATEGY_CUES: Record<string, RegExp> = {
  POLY_ADD_SUB: /동류항|오름차순|내림차순|A\s*\+\s*B|2A\s*-\s*B/,
  POLY_MULTIPLY: /전개|곱셈\s*공식|\(.*\)\s*\(/,
  POLY_PRODUCT_TRANSFORM: /x\s*=|대입|1\/x/,
  POLY_DIVIDE: /나눗셈|몫|나머지/,
  IDENTITY_PROPERTY: /항등|값에\s*관계없이|항상\s*성립/,
  UNDETERMINED_COEFF: /계수\s*비교|대입|미정계수/,
  REMAINDER_FACTOR_THEOREM: /나머지정리|대입|P\s*\(|인수\s*정리/,
  SYNTHETIC_DIVISION: /조립제법/,
  POLY_FACTORING: /인수분해|공통인수/,
  COMPLEX_EQUALITY: /실수부|허수부|서로\s*같/,
  COMPLEX_CONJUGATE: /켤레/,
  COMPLEX_ARITHMETIC: /허수|i\^|복소수/,
  QUADRATIC_SOLVE: /이차방정식|근의\s*공식|해를\s*구/,
  QUADRATIC_DISCRIMINANT: /판별식|D\s*=/,
  QUADRATIC_VIETAS: /근과\s*계수|두\s*근의\s*합|두\s*근의\s*곱|α/,
  QUADRATIC_FACTOR: /인수분해|이차방정식/,
  QUAD_FN_RELATION: /이차함수|최댓|최솟|꼭짓점|그래프/,
  SIMULTANEOUS_QUAD: /연립/,
  CUBIC_QUARTIC_EQ: /삼차|사차|인수정리/,
  LINEAR_INEQUALITY: /일차부등식|부등식|부호를\s*바꾸/,
  QUADRATIC_INEQUALITY: /이차부등식|부호를\s*바꾸/,
  COUNTING_PERM_COMB: /순열|조합|경우의\s*수/,
  MATRIX_ARITHMETIC: /행렬|성분|곱/,
}

export function strategyConsistent(typeId: string, stem: string): boolean {
  const cue = STRATEGY_CUES[typeId]
  if (!cue) return false
  return cue.test(stem.replace(/\s+/g, ' '))
}

export function keyPointConsistent(typeId: string, stem: string, requestedQuantity: string[]): boolean {
  const profile = profileById(typeId)
  if (!profile?.key_test_points.length) return false
  if (requestedQuantity.length > 0) return true
  const text = stem.replace(/\s+/g, ' ')
  if (text.length < 24 || /^(다음|구하시오)/.test(text)) return false
  return STRATEGY_CUES[typeId]?.test(text) ?? false
}

export function strategyEvidenceRecord(typeId: string, stem: string): {
  type_id: string
  strategy_cues_hit: boolean
  profile_strategies: string[]
  stem_has_generic_only: boolean
} {
  const text = stem.replace(/\s+/g, ' ')
  return {
    type_id: typeId,
    strategy_cues_hit: strategyConsistent(typeId, text),
    profile_strategies: profileById(typeId)?.solution_strategies ?? [],
    stem_has_generic_only: text.length < 24 || /^(다음|구하시오)/.test(text),
  }
}
