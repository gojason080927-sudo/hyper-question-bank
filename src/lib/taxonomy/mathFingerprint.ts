export type InequalityKind = 'linear' | 'quadratic' | 'other' | null

export type MathFingerprint = {
  polynomial_degree: number | null
  equation_degree: number | null
  number_of_variables: number
  number_of_conditions: number
  factorization_structure: boolean
  remainder_structure: boolean
  root_relation: boolean
  inequality_structure: InequalityKind
  case_split: boolean
  permutation_combination_structure: boolean
  matrix_dimensions: string | null
  matrix_operation: string | null
  function_relation: boolean
  named_polynomial_system: boolean
  identity_structure: boolean
  undetermined_coeff: boolean
  synthetic_division: boolean
  discriminant_structure: boolean
  cubic_quartic: boolean
  requested_quantity: string[]
  answer_structure: 'mcq' | 'descriptive' | 'unknown'
  features_present: string[]
}

export type FingerprintAgreement = 'SUPPORT' | 'WEAK' | 'CONFLICT'

const TYPE_REQUESTS: Record<string, string[]> = {
  POLY_ADD_SUB: ['simplified_poly', 'named_poly'],
  POLY_MULTIPLY: ['product', 'expansion'],
  POLY_PRODUCT_TRANSFORM: ['value', 'substitution'],
  POLY_DIVIDE: ['quotient', 'remainder'],
  IDENTITY_PROPERTY: ['identity', 'always'],
  UNDETERMINED_COEFF: ['undetermined', 'coeff'],
  REMAINDER_FACTOR_THEOREM: ['remainder', 'p_of_a', 'factor'],
  SYNTHETIC_DIVISION: ['synthetic', 'remainder', 'quotient'],
  POLY_FACTORING: ['factorization'],
  COMPLEX_EQUALITY: ['equality', 'real_imag'],
  COMPLEX_CONJUGATE: ['conjugate'],
  COMPLEX_ARITHMETIC: ['complex_value', 'simplify'],
  QUADRATIC_SOLVE: ['roots', 'solve'],
  QUADRATIC_DISCRIMINANT: ['discriminant', 'root_count'],
  QUADRATIC_VIETAS: ['vieta_sum', 'vieta_product', 'symmetric'],
  QUADRATIC_FACTOR: ['factorization', 'roots'],
  QUAD_FN_RELATION: ['maxmin', 'graph', 'function_value'],
  SIMULTANEOUS_QUAD: ['simultaneous'],
  CUBIC_QUARTIC_EQ: ['roots', 'factor', 'solve'],
  LINEAR_INEQUALITY: ['inequality_range'],
  QUADRATIC_INEQUALITY: ['inequality_range'],
  COUNTING_PERM_COMB: ['count'],
  MATRIX_ARITHMETIC: ['matrix'],
}

function compact(stem: string): string {
  return stem.replace(/\s+/g, ' ')
}

function maxDegree(stem: string): number | null {
  const found: number[] = []
  for (const match of stem.matchAll(/(?:x|y)\s*(?:\^|\*\*)\s*\{?(\d+)/gi)) {
    found.push(Number(match[1]))
  }
  for (const match of stem.matchAll(/\^(\d+)/g)) found.push(Number(match[1]))
  if (/삼차/.test(stem)) found.push(3)
  if (/사차/.test(stem)) found.push(4)
  if (/이차/.test(stem)) found.push(2)
  if (/일차/.test(stem)) found.push(1)
  if (!found.length) return null
  return Math.max(...found)
}

function countVariables(stem: string): number {
  const names = ['x', 'y', 'z', 'k', 'n', 't']
  return names.filter((name) => new RegExp(`(^|[^A-Za-z])${name}([^A-Za-z]|$)`).test(stem)).length
}

function requestedQuantity(stem: string): string[] {
  const out: string[] = []
  if (/나머지/.test(stem)) out.push('remainder')
  if (/P\s*\(|f\s*\(/.test(stem) && /=\s*0/.test(stem)) out.push('p_of_a')
  if (/인수\s*정리|인수가\s*되기/.test(stem)) out.push('factor')
  if (/조립제법/.test(stem)) out.push('synthetic')
  if (/인수분해/.test(stem)) out.push('factorization')
  if (/전개/.test(stem)) out.push('expansion')
  if (/곱셈\s*공식|곱을\s*구/.test(stem)) out.push('product')
  if (/오름차순|내림차순|동류항|간단히/.test(stem)) out.push('simplified_poly')
  if (/항등|값에\s*관계없이|항상\s*성립/.test(stem)) out.push('identity', 'always')
  if (/계수\s*비교|미정계수/.test(stem)) out.push('undetermined', 'coeff')
  if (/켤레/.test(stem)) out.push('conjugate')
  if (/실수부|허수부|서로\s*같/.test(stem)) out.push('equality', 'real_imag')
  if (/복소수/.test(stem) && /값|간단히|계산/.test(stem)) out.push('complex_value', 'simplify')
  if (/판별식/.test(stem)) out.push('discriminant')
  if (/근의\s*개수/.test(stem)) out.push('root_count')
  if (/두\s*근의\s*합|α\s*\+\s*β|근과\s*계수/.test(stem)) out.push('vieta_sum', 'symmetric')
  if (/두\s*근의\s*곱|αβ|α\\beta/.test(stem)) out.push('vieta_product', 'symmetric')
  if (/해|근을\s*구|실근/.test(stem)) out.push('roots', 'solve')
  if (/최댓|최솟|꼭짓점|그래프/.test(stem)) out.push('maxmin', 'graph', 'function_value')
  if (/연립/.test(stem)) out.push('simultaneous')
  if (/부등식|해의\s*범위/.test(stem)) out.push('inequality_range')
  if (/순열|조합|경우의\s*수/.test(stem)) out.push('count')
  if (/행렬/.test(stem)) out.push('matrix')
  if (/A\s*\+\s*B|2A\s*-\s*B|A\s*-\s*B/.test(stem)) out.push('named_poly')
  if (/값/.test(stem) && /x\s*=/.test(stem)) out.push('value', 'substitution')
  if (/몫/.test(stem)) out.push('quotient')
  return [...new Set(out)]
}

export function extractMathFingerprint(stem: string): MathFingerprint {
  const text = compact(stem)
  const polynomial_degree = maxDegree(text)
  const remainder_structure = /나누었을\s*때.*나머지|나머지를\s*구|나머지정리|P\s*\([^)]+\)\s*=\s*0/.test(text)
  const factorization_structure = /인수분해|\(x\s*[+-]|\(2x|\(ax/.test(text)
  const root_relation = /근과\s*계수|두\s*근|α|β/.test(text)
  const inequality = /이차부등식/.test(text) ? 'quadratic' : /부등식|\\le|\\ge|[≤≥]/.test(text) ? (/이차/.test(text) ? 'quadratic' : 'linear') : null
  const matrix_dimensions_match = text.match(/(\d+)\s*[×x]\s*(\d+)/)
  const matrix_operation = /행렬/.test(text)
    ? /곱|AB|BA/.test(text)
      ? 'multiply'
      : /덧셈|뺄셈|\+|-/.test(text)
        ? 'add_sub'
        : 'present'
    : null
  const named_polynomial_system = /A\s*\+\s*B\s*=/.test(text) || /2A\s*-\s*B\s*=/.test(text) || /A\s*-\s*B\s*=/.test(text)
  const identity_structure = /항등|값에\s*관계없이|항상\s*성립/.test(text)
  const undetermined_coeff = /미정계수|계수\s*비교/.test(text)
  const synthetic_division = /조립제법/.test(text)
  const discriminant_structure = /판별식|근의\s*개수/.test(text)
  const cubic_quartic = /삼차|사차/.test(text)
  const function_relation = /이차함수|f\s*\(x\)|그래프와\s*직선/.test(text)
  const permutation_combination_structure = /순열|조합|경우의\s*수/.test(text)
  const case_split = /경우|또는|각각|나누어/.test(text)
  const number_of_conditions = (text.match(/\(가\)|\(나\)|\(다\)|단,/g) ?? []).length
  const answer_structure = /[①-⑤]/.test(text) ? 'mcq' : /구하시오|하시오/.test(text) ? 'descriptive' : 'unknown'
  const requested = requestedQuantity(text)
  const features_present = [
    remainder_structure ? 'remainder_structure' : null,
    factorization_structure ? 'factorization_structure' : null,
    root_relation ? 'root_relation' : null,
    inequality ? 'inequality_structure' : null,
    permutation_combination_structure ? 'permutation_combination_structure' : null,
    matrix_operation ? 'matrix_operation' : null,
    function_relation ? 'function_relation' : null,
    named_polynomial_system ? 'named_polynomial_system' : null,
    identity_structure ? 'identity_structure' : null,
    undetermined_coeff ? 'undetermined_coeff' : null,
    synthetic_division ? 'synthetic_division' : null,
    discriminant_structure ? 'discriminant_structure' : null,
    cubic_quartic ? 'cubic_quartic' : null,
    case_split ? 'case_split' : null,
  ].filter((row): row is string => Boolean(row))

  return {
    polynomial_degree,
    equation_degree: polynomial_degree,
    number_of_variables: countVariables(text),
    number_of_conditions,
    factorization_structure,
    remainder_structure,
    root_relation,
    inequality_structure: inequality,
    case_split,
    permutation_combination_structure,
    matrix_dimensions: matrix_dimensions_match ? `${matrix_dimensions_match[1]}x${matrix_dimensions_match[2]}` : null,
    matrix_operation,
    function_relation,
    named_polynomial_system,
    identity_structure,
    undetermined_coeff,
    synthetic_division,
    discriminant_structure,
    cubic_quartic,
    requested_quantity: requested,
    answer_structure,
    features_present,
  }
}

function hasAny(requested: string[], keys: string[]): boolean {
  return keys.some((key) => requested.includes(key))
}

export function fingerprintAgreement(typeId: string, fp: MathFingerprint): FingerprintAgreement {
  const req = fp.requested_quantity
  const foreign =
    Boolean(fp.matrix_operation && typeId !== 'MATRIX_ARITHMETIC') ||
    Boolean(fp.permutation_combination_structure && typeId !== 'COUNTING_PERM_COMB')

  const checks: Record<string, () => FingerprintAgreement> = {
    POLY_ADD_SUB: () =>
      fp.named_polynomial_system || hasAny(req, ['simplified_poly', 'named_poly']) ? 'SUPPORT' : fp.polynomial_degree != null ? 'WEAK' : 'WEAK',
    POLY_MULTIPLY: () => (hasAny(req, ['product', 'expansion']) ? 'SUPPORT' : 'WEAK'),
    POLY_PRODUCT_TRANSFORM: () => (hasAny(req, ['value', 'substitution']) ? 'SUPPORT' : 'WEAK'),
    POLY_DIVIDE: () => (fp.remainder_structure || hasAny(req, ['quotient', 'remainder']) ? (fp.synthetic_division ? 'WEAK' : 'SUPPORT') : 'WEAK'),
    IDENTITY_PROPERTY: () => (fp.identity_structure && !fp.undetermined_coeff ? 'SUPPORT' : fp.identity_structure ? 'WEAK' : 'WEAK'),
    UNDETERMINED_COEFF: () => (fp.undetermined_coeff || (fp.identity_structure && hasAny(req, ['coeff', 'undetermined'])) ? 'SUPPORT' : 'WEAK'),
    REMAINDER_FACTOR_THEOREM: () => (fp.remainder_structure || hasAny(req, ['remainder', 'p_of_a', 'factor']) ? (fp.synthetic_division ? 'WEAK' : 'SUPPORT') : 'WEAK'),
    SYNTHETIC_DIVISION: () => (fp.synthetic_division ? 'SUPPORT' : 'WEAK'),
    POLY_FACTORING: () => (fp.factorization_structure && !/quadratic/.test(fp.features_present.join('')) ? 'SUPPORT' : fp.factorization_structure ? 'WEAK' : 'WEAK'),
    COMPLEX_EQUALITY: () => (hasAny(req, ['equality', 'real_imag']) ? 'SUPPORT' : 'WEAK'),
    COMPLEX_CONJUGATE: () => (hasAny(req, ['conjugate']) ? 'SUPPORT' : 'WEAK'),
    COMPLEX_ARITHMETIC: () => (hasAny(req, ['complex_value', 'simplify']) && !hasAny(req, ['conjugate', 'equality']) ? 'SUPPORT' : hasAny(req, ['complex_value']) ? 'WEAK' : 'WEAK'),
    QUADRATIC_SOLVE: () => (hasAny(req, ['roots', 'solve']) && !fp.root_relation && !fp.discriminant_structure && !fp.function_relation ? 'SUPPORT' : 'WEAK'),
    QUADRATIC_DISCRIMINANT: () => (fp.discriminant_structure || hasAny(req, ['discriminant', 'root_count']) ? 'SUPPORT' : 'WEAK'),
    QUADRATIC_VIETAS: () => (fp.root_relation || hasAny(req, ['vieta_sum', 'vieta_product', 'symmetric']) ? 'SUPPORT' : 'WEAK'),
    QUADRATIC_FACTOR: () => (fp.factorization_structure && hasAny(req, ['factorization', 'roots']) ? 'SUPPORT' : 'WEAK'),
    QUAD_FN_RELATION: () => (fp.function_relation || hasAny(req, ['maxmin', 'graph', 'function_value']) ? 'SUPPORT' : 'WEAK'),
    SIMULTANEOUS_QUAD: () => (hasAny(req, ['simultaneous']) ? 'SUPPORT' : 'WEAK'),
    CUBIC_QUARTIC_EQ: () => (fp.cubic_quartic ? 'SUPPORT' : 'WEAK'),
    LINEAR_INEQUALITY: () => (fp.inequality_structure === 'linear' ? 'SUPPORT' : fp.inequality_structure ? 'CONFLICT' : 'WEAK'),
    QUADRATIC_INEQUALITY: () => (fp.inequality_structure === 'quadratic' ? 'SUPPORT' : fp.inequality_structure === 'linear' ? 'CONFLICT' : 'WEAK'),
    COUNTING_PERM_COMB: () => (fp.permutation_combination_structure ? 'SUPPORT' : 'WEAK'),
    MATRIX_ARITHMETIC: () => (fp.matrix_operation || fp.matrix_dimensions ? 'SUPPORT' : 'WEAK'),
  }

  const local = checks[typeId]?.() ?? 'WEAK'
  if (typeId === 'TYPE_UNCLEAR') return 'WEAK'
  if (foreign && local !== 'SUPPORT') return 'CONFLICT'
  if (fp.matrix_operation && typeId !== 'MATRIX_ARITHMETIC' && local === 'SUPPORT') return 'CONFLICT'
  if (fp.permutation_combination_structure && typeId !== 'COUNTING_PERM_COMB' && local === 'SUPPORT') return 'CONFLICT'
  return local
}

export function requestedQuantityMatches(typeId: string, fp: MathFingerprint): boolean {
  const expected = TYPE_REQUESTS[typeId] ?? []
  if (!expected.length || !fp.requested_quantity.length) return false
  return expected.some((key) => fp.requested_quantity.includes(key))
}

export function inferTypeFromFingerprint(fp: MathFingerprint): string | null {
  const ranked = [
    'SYNTHETIC_DIVISION',
    'REMAINDER_FACTOR_THEOREM',
    'UNDETERMINED_COEFF',
    'IDENTITY_PROPERTY',
    'QUADRATIC_VIETAS',
    'QUADRATIC_DISCRIMINANT',
    'QUADRATIC_INEQUALITY',
    'LINEAR_INEQUALITY',
    'COUNTING_PERM_COMB',
    'MATRIX_ARITHMETIC',
    'COMPLEX_CONJUGATE',
    'COMPLEX_EQUALITY',
    'CUBIC_QUARTIC_EQ',
    'QUAD_FN_RELATION',
    'SIMULTANEOUS_QUAD',
    'QUADRATIC_FACTOR',
    'POLY_FACTORING',
    'POLY_DIVIDE',
    'POLY_ADD_SUB',
    'COMPLEX_ARITHMETIC',
    'QUADRATIC_SOLVE',
    'POLY_MULTIPLY',
    'POLY_PRODUCT_TRANSFORM',
  ]
  const supported = ranked.filter((typeId) => fingerprintAgreement(typeId, fp) === 'SUPPORT')
  if (supported.length === 1) return supported[0]
  return null
}
