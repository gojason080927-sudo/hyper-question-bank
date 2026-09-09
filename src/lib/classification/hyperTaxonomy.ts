import { BOOK_SUBJECT } from './bookStructure'

export const TAXONOMY_STATUS = ['CANDIDATE', 'REVIEWED', 'ACTIVE', 'DEPRECATED'] as const
export type TaxonomyStatus = (typeof TAXONOMY_STATUS)[number]

export type HyperTypeCandidate = {
  type_id: string
  subject: typeof BOOK_SUBJECT
  unit: string
  subunit: string
  type_name: string
  subtype_name: string | null
  concept_summary: string
  key_tested_point: string
  general_solution_strategy: string[]
  common_mistakes: string[]
  prerequisite_concepts: string[]
  book_aliases: string[]
  example_problem_ids: string[]
  status: TaxonomyStatus
  confidence: number
  evidence: string[]
  duplicate_of: string | null
  review_reasons: string[]
}

const PROFILE: Record<
  string,
  {
    unit: string
    subunit: string
    type_name: string
    subtype_name?: string | null
    concept_summary: string
    key_tested_point: string
    general_solution_strategy: string[]
    common_mistakes: string[]
    prerequisite_concepts: string[]
  }
> = {
  POLY_ADD_SUB: {
    unit: '다항식',
    subunit: '다항식의 연산',
    type_name: '다항식 덧셈·뺄셈과 정리',
    concept_summary: '동류항을 모아 한 문자 기준 오름/내림차순으로 다항식을 정리한다.',
    key_tested_point: '동류항 정리와 부호 처리를 이용해 다항식을 표준 형태로 나타낼 수 있는지 평가',
    general_solution_strategy: ['기준 문자를 정한다', '동류항을 모은다', '오름/내림차순으로 배열한다'],
    common_mistakes: ['부호 처리 오류', '동류항이 아닌 항을 합침', '기준 문자 외 항을 빠뜨림'],
    prerequisite_concepts: ['단항식', '차수', '동류항'],
  },
  POLY_MULTIPLY: {
    unit: '다항식',
    subunit: '다항식의 연산',
    type_name: '다항식 곱셈',
    concept_summary: '분배법칙과 곱셈 공식으로 다항식의 곱을 전개한다.',
    key_tested_point: '곱셈 공식과 분배법칙을 적용해 전개 결과를 구할 수 있는지 평가',
    general_solution_strategy: ['곱의 형태를 확인한다', '분배 또는 공식을 적용한다', '동류항을 정리한다'],
    common_mistakes: ['중간항 누락', '제곱 전개 시 2ab 누락', '부호 오류'],
    prerequisite_concepts: ['분배법칙', '지수법칙'],
  },
  POLY_PRODUCT_TRANSFORM: {
    unit: '다항식',
    subunit: '다항식의 연산',
    type_name: '곱셈 공식의 변형',
    concept_summary: 'a+b, ab 등 대칭량을 이용해 a^n±b^n 값을 구한다.',
    key_tested_point: '곱셈 공식의 변형으로 거듭제곱 합/차를 계산할 수 있는지 평가',
    general_solution_strategy: ['주어진 대칭량을 확인한다', '목표 차수의 공식으로 변형한다', '값을 대입한다'],
    common_mistakes: ['차수 혼동', '2ab 부호 오류', '공식 좌우변 혼용'],
    prerequisite_concepts: ['곱셈 공식'],
  },
  POLY_DIVIDE: {
    unit: '다항식',
    subunit: '다항식의 연산',
    type_name: '다항식 나눗셈',
    concept_summary: '다항식 나눗셈의 몫·나머지와 A=BQ+R 관계를 사용한다.',
    key_tested_point: '나눗셈 알고리즘과 나머지 차수 조건을 적용할 수 있는지 평가',
    general_solution_strategy: ['내림차순으로 정리한다', '나눗셈을 수행한다', 'A=BQ+R로 검산한다'],
    common_mistakes: ['나머지 차수 조건 무시', '음수 나머지 처리 오류', '몫의 항 누락'],
    prerequisite_concepts: ['다항식 차수'],
  },
  IDENTITY_PROPERTY: {
    unit: '다항식',
    subunit: '나머지 정리와 인수분해',
    type_name: '항등식의 성질',
    concept_summary: '문자에 어떤 값을 넣어도 성립하는 등식을 항등식으로 다룬다.',
    key_tested_point: '항등식과 방정식을 구분하고 항등 조건을 사용할 수 있는지 평가',
    general_solution_strategy: ['항등 여부를 확인한다', '특정값 대입 또는 계수 비교를 선택한다', '미지 계수를 결정한다'],
    common_mistakes: ['방정식으로 오인', '특정값 대입 누락', '계수 비교 대상 항 누락'],
    prerequisite_concepts: ['등식', '다항식'],
  },
  UNDETERMINED_COEFF: {
    unit: '다항식',
    subunit: '나머지 정리와 인수분해',
    type_name: '미정계수 결정',
    subtype_name: '계수 비교형',
    concept_summary: '항등식의 대응 계수를 비교하거나 특정값을 대입해 미정계수를 구한다.',
    key_tested_point: '계수 비교 또는 대입으로 미지 계수를 결정할 수 있는지 평가',
    general_solution_strategy: ['양변을 같은 기준으로 전개한다', '계수 비교 또는 대입한다', '연립으로 미지수를 푼다'],
    common_mistakes: ['전개 누락', '대응 항 짝짓기 오류', '상수항 누락'],
    prerequisite_concepts: ['항등식'],
  },
  REMAINDER_FACTOR_THEOREM: {
    unit: '다항식',
    subunit: '나머지 정리와 인수분해',
    type_name: '나머지정리·인수정리',
    concept_summary: 'P(x)를 x-a로 나눈 나머지는 P(a)이고, P(a)=0이면 x-a가 인수이다.',
    key_tested_point: '나머지정리와 인수정리를 구별하여 적용할 수 있는지 평가',
    general_solution_strategy: ['나누는 일차식을 확인한다', 'P(a)를 계산한다', '나머지 또는 인수 여부를 판정한다'],
    common_mistakes: ['나누는 식이 ax+b일 때 보정 누락', '인수 조건과 나머지 조건 혼동'],
    prerequisite_concepts: ['다항식 나눗셈'],
  },
  SYNTHETIC_DIVISION: {
    unit: '다항식',
    subunit: '나머지 정리와 인수분해',
    type_name: '조립제법',
    concept_summary: '일차식 나눗셈을 계수만으로 수행해 몫과 나머지를 구한다.',
    key_tested_point: '조립제법으로 몫과 나머지를 구할 수 있는지 평가',
    general_solution_strategy: ['계수를 배열한다', '조립제법을 수행한다', '몫과 나머지를 읽는다'],
    common_mistakes: ['결손항 0 누락', '나누는 식이 x-a가 아닐 때 보정 오류'],
    prerequisite_concepts: ['나머지정리'],
  },
  POLY_FACTORING: {
    unit: '다항식',
    subunit: '나머지 정리와 인수분해',
    type_name: '다항식 인수분해',
    concept_summary: '공식과 공통인수로 다항식을 인수들의 곱으로 나타낸다.',
    key_tested_point: '적절한 인수분해 공식을 선택해 완전히 인수분해할 수 있는지 평가',
    general_solution_strategy: ['공통인수를 뺀다', '공식을 식별한다', '더 이상 분해되지 않을 때까지 반복한다'],
    common_mistakes: ['공통인수 누락', '공식 오적용', '유리수 범위 밖까지 분해'],
    prerequisite_concepts: ['곱셈 공식'],
  },
  COMPLEX_EQUALITY: {
    unit: '방정식',
    subunit: '복소수',
    type_name: '복소수가 같을 조건',
    concept_summary: '두 복소수가 같으면 실수부·허수부가 각각 같다.',
    key_tested_point: '실수부/허수부 비교로 복소수 등식을 풀 수 있는지 평가',
    general_solution_strategy: ['실수부와 허수부를 분리한다', '두 등식을 세운다', '연립하여 푼다'],
    common_mistakes: ['실수부·허수부 혼동', 'i의 계수 부호 오류'],
    prerequisite_concepts: ['허수단위'],
  },
  COMPLEX_CONJUGATE: {
    unit: '방정식',
    subunit: '복소수',
    type_name: '켤레복소수',
    concept_summary: '켤레복소수의 합·곱이 실수가 되는 성질을 사용한다.',
    key_tested_point: '켤레복소수 성질로 식의 값을 구할 수 있는지 평가',
    general_solution_strategy: ['켤레를 표시한다', '합/곱 성질을 적용한다', '실수 조건을 확인한다'],
    common_mistakes: ['켤레복소수 성질 적용 오류', '허수부 부호 누락'],
    prerequisite_concepts: ['복소수 정의'],
  },
  COMPLEX_ARITHMETIC: {
    unit: '방정식',
    subunit: '복소수',
    type_name: '복소수 사칙연산',
    concept_summary: 'i^2=-1을 이용해 복소수를 계산하고 표준형으로 나타낸다.',
    key_tested_point: '복소수 사칙연산과 거듭제곱 순환을 계산할 수 있는지 평가',
    general_solution_strategy: ['i의 거듭제곱을 정리한다', '연산을 수행한다', 'a+bi 꼴로 나타낸다'],
    common_mistakes: ['지수 계산 오류', '분모 실수화 누락'],
    prerequisite_concepts: ['허수단위'],
  },
  QUADRATIC_SOLVE: {
    unit: '방정식',
    subunit: '이차방정식',
    type_name: '이차방정식 풀이',
    concept_summary: '인수분해, 제곱근, 근의 공식으로 이차방정식의 해를 구한다.',
    key_tested_point: '풀이 방법을 선택해 이차방정식의 해를 구할 수 있는지 평가',
    general_solution_strategy: ['표준형으로 정리한다', '판별 또는 인수분해를 시도한다', '해를 구한다'],
    common_mistakes: ['부호 처리 오류', '중근을 한 근만 셈', '분모 0 해 포함'],
    prerequisite_concepts: ['이차식'],
  },
  QUADRATIC_DISCRIMINANT: {
    unit: '방정식',
    subunit: '이차방정식',
    type_name: '근의 판별',
    concept_summary: '판별식 D로 실근의 개수와 종류를 판정한다.',
    key_tested_point: '판별식으로 근의 성격을 판정할 수 있는지 평가',
    general_solution_strategy: ['표준형 계수를 읽는다', 'D를 계산한다', '근의 개수/종류를 판정한다'],
    common_mistakes: ['D 식 오류', '실근/허근 판정 혼동'],
    prerequisite_concepts: ['이차방정식 표준형'],
  },
  QUADRATIC_VIETAS: {
    unit: '방정식',
    subunit: '이차방정식',
    type_name: '근과 계수의 관계',
    concept_summary: '두 근의 합과 곱을 계수로 나타내 대칭식을 계산한다.',
    key_tested_point: '근과 계수의 관계로 대칭식 값을 구할 수 있는지 평가',
    general_solution_strategy: ['합과 곱을 읽는다', '목표 대칭식을 변형한다', '값을 계산한다'],
    common_mistakes: ['합/곱 부호 오류', '제곱합 공식 누락'],
    prerequisite_concepts: ['이차방정식'],
  },
  QUADRATIC_FACTOR: {
    unit: '방정식',
    subunit: '이차방정식',
    type_name: '이차식 인수분해',
    concept_summary: '이차식을 일차식의 곱으로 인수분해한다.',
    key_tested_point: '근 또는 계수 조건으로 이차식을 인수분해할 수 있는지 평가',
    general_solution_strategy: ['근 또는 계수 조건을 확인한다', '일차 인수를 구성한다', '검산한다'],
    common_mistakes: ['인수 상수배 누락', '허근을 실계수 인수로 강제'],
    prerequisite_concepts: ['이차방정식 근'],
  },
  QUAD_FN_RELATION: {
    unit: '방정식',
    subunit: '이차방정식과 이차함수',
    type_name: '이차함수와 이차방정식의 관계',
    concept_summary: '그래프와 x축의 교점으로 이차방정식의 실근을 해석한다.',
    key_tested_point: '그래프 교점과 근의 관계를 연결할 수 있는지 평가',
    general_solution_strategy: ['함수식을 확인한다', 'x축 교점 조건을 세운다', '근/교점을 대응한다'],
    common_mistakes: ['교점과 근 혼동', '접선/교점 개수 오판'],
    prerequisite_concepts: ['이차함수 그래프'],
  },
  SIMULTANEOUS_QUAD: {
    unit: '방정식',
    subunit: '여러 가지 방정식',
    type_name: '연립이차방정식',
    concept_summary: '두 이차(또는 일차·이차) 방정식을 연립하여 해를 구한다.',
    key_tested_point: '대입·가감으로 연립이차방정식의 해를 구할 수 있는지 평가',
    general_solution_strategy: ['한 문자를 소거한다', '이차방정식을 푼다', '나머지 문자를 구한다'],
    common_mistakes: ['해 쌍 누락', '무연근 미제거'],
    prerequisite_concepts: ['이차방정식', '연립일차방정식'],
  },
  LINEAR_INEQUALITY: {
    unit: '부등식',
    subunit: '일차부등식',
    type_name: '일차부등식 풀이',
    concept_summary: '부등식의 성질로 일차부등식 또는 연립일차부등식의 해집합을 구한다.',
    key_tested_point: '부등식 방향과 연립 교집합을 올바르게 다룰 수 있는지 평가',
    general_solution_strategy: ['항을 정리한다', '계수의 부호에 따라 방향을 정한다', '해집합을 나타낸다'],
    common_mistakes: ['음수 곱할 때 방향 미반전', '연립 교집합/합집합 혼동'],
    prerequisite_concepts: ['부등식의 기본 성질'],
  },
  QUADRATIC_INEQUALITY: {
    unit: '부등식',
    subunit: '이차부등식',
    type_name: '이차부등식 풀이',
    concept_summary: '이차함수 그래프 또는 인수 부호로 이차부등식의 해를 구한다.',
    key_tested_point: '이차식 부호와 해집합을 연결할 수 있는지 평가',
    general_solution_strategy: ['근을 구한다', '그래프 또는 구간 부호를 본다', '부등식 방향에 맞는 구간을 택한다'],
    common_mistakes: ['등호 포함 여부 누락', '볼록 방향 오판'],
    prerequisite_concepts: ['이차함수', '이차방정식'],
  },
  COUNTING_PERM_COMB: {
    unit: '순열과 조합',
    subunit: '순열과 조합',
    type_name: '순열·조합 계산',
    concept_summary: '순서가 있으면 순열, 없으면 조합으로 경우의 수를 센다.',
    key_tested_point: '순열과 조합을 구별하여 경우의 수를 계산할 수 있는지 평가',
    general_solution_strategy: ['순서 유무를 판단한다', '공식을 선택한다', '제한 조건을 반영한다'],
    common_mistakes: ['경우의 수 중복 계산', '순서 유무 오판', '같은 것끼리의 순열 누락'],
    prerequisite_concepts: ['합의 법칙', '곱의 법칙'],
  },
  MATRIX_ARITHMETIC: {
    unit: '행렬',
    subunit: '행렬과 그 연산',
    type_name: '행렬의 연산',
    concept_summary: '행렬의 덧셈·실수배·곱셈과 거듭제곱 규칙을 적용한다.',
    key_tested_point: '행렬 연산의 정의와 교환법칙 성립 여부를 다룰 수 있는지 평가',
    general_solution_strategy: ['꼴을 확인한다', '정의에 따라 연산한다', '성질의 예외를 점검한다'],
    common_mistakes: ['곱셈 교환법칙 오용', 'AB=O이면 A 또는 B가 O라고 단정'],
    prerequisite_concepts: ['행렬의 꼴'],
  },
  TYPE_UNCLEAR: {
    unit: '미정',
    subunit: '미정',
    type_name: '유형 미확정',
    concept_summary: '문제 내용으로 단일 canonical type을 확정하지 못했다.',
    key_tested_point: 'REVIEW',
    general_solution_strategy: ['원문과 교재 heading을 대조한다'],
    common_mistakes: [],
    prerequisite_concepts: [],
  },
}

const BOOK_HEADING_TO_TYPE: Array<{ pattern: RegExp; type_id: string }> = [
  { pattern: /행렬/, type_id: 'MATRIX_ARITHMETIC' },
  { pattern: /순열|조합|경우의\s*수/, type_id: 'COUNTING_PERM_COMB' },
  { pattern: /다항식의\s*덧셈과\s*뺄셈|오름차순|내림차순|동류항/, type_id: 'POLY_ADD_SUB' },
  { pattern: /다항식의\s*곱셈|전개/, type_id: 'POLY_MULTIPLY' },
  { pattern: /곱셈\s*공식의\s*변형/, type_id: 'POLY_PRODUCT_TRANSFORM' },
  { pattern: /다항식의\s*나눗셈/, type_id: 'POLY_DIVIDE' },
  { pattern: /항등식|향등식/, type_id: 'IDENTITY_PROPERTY' },
  { pattern: /미정계수/, type_id: 'UNDETERMINED_COEFF' },
  { pattern: /나머지\s*정리|인수\s*정리/, type_id: 'REMAINDER_FACTOR_THEOREM' },
  { pattern: /조립제법/, type_id: 'SYNTHETIC_DIVISION' },
  { pattern: /복잡한\s*식의\s*인수분해|^인수분해$|다항식\s*인수분해/, type_id: 'POLY_FACTORING' },
  { pattern: /복소수가\s*서로\s*같을/, type_id: 'COMPLEX_EQUALITY' },
  { pattern: /켤레복소수/, type_id: 'COMPLEX_CONJUGATE' },
  { pattern: /복소수의\s*사칙|복소수$/, type_id: 'COMPLEX_ARITHMETIC' },
  { pattern: /이차방정식의\s*풀이/, type_id: 'QUADRATIC_SOLVE' },
  { pattern: /근의\s*판별/, type_id: 'QUADRATIC_DISCRIMINANT' },
  { pattern: /근과\s*계수의\s*관계/, type_id: 'QUADRATIC_VIETAS' },
  { pattern: /이차식의\s*인수분해/, type_id: 'QUADRATIC_FACTOR' },
  { pattern: /이차방정식과\s*이차함수|이차함수와\s*이차방정식/, type_id: 'QUAD_FN_RELATION' },
  { pattern: /연립이차방정식/, type_id: 'SIMULTANEOUS_QUAD' },
  { pattern: /일차부등식|부등식\s*ax|연립일차부등식|부등식의\s*기본/, type_id: 'LINEAR_INEQUALITY' },
  { pattern: /이차부등식/, type_id: 'QUADRATIC_INEQUALITY' },
]

export function normalizeTaxonomyKey(input: { subject: string; unit: string; subunit: string; type_name: string }): string {
  const fold = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/를이용한|을이용한|에서의|에서/g, '')
      .replace(/찾기|결정|비교형/g, '')
  return [input.subject, input.unit, input.subunit, fold(input.type_name)].join('|')
}

export function typeIdFromBookHeading(title: string): string | null {
  for (const row of BOOK_HEADING_TO_TYPE) {
    if (row.pattern.test(title)) return row.type_id
  }
  return null
}

export function makeHyperType(typeId: string, extras: Partial<HyperTypeCandidate> = {}): HyperTypeCandidate {
  const profile = PROFILE[typeId] ?? PROFILE.TYPE_UNCLEAR
  const type_name = extras.type_name ?? profile.type_name
  return {
    type_id: typeId,
    subject: BOOK_SUBJECT,
    unit: extras.unit ?? profile.unit,
    subunit: extras.subunit ?? profile.subunit,
    type_name,
    subtype_name: extras.subtype_name ?? profile.subtype_name ?? null,
    concept_summary: profile.concept_summary,
    key_tested_point: profile.key_tested_point,
    general_solution_strategy: profile.general_solution_strategy,
    common_mistakes: profile.common_mistakes,
    prerequisite_concepts: profile.prerequisite_concepts,
    book_aliases: extras.book_aliases ?? [],
    example_problem_ids: extras.example_problem_ids ?? [],
    status: 'CANDIDATE',
    confidence: extras.confidence ?? 0.8,
    evidence: extras.evidence ?? [],
    duplicate_of: extras.duplicate_of ?? null,
    review_reasons: extras.review_reasons ?? [],
  }
}

export function canonicalizeHyperTypes(types: HyperTypeCandidate[]): HyperTypeCandidate[] {
  const byId = new Map<string, HyperTypeCandidate>()
  const byKey = new Map<string, string>()
  for (const row of types) {
    const key = normalizeTaxonomyKey(row)
    const existingId = byKey.get(key)
    if (existingId && existingId !== row.type_id) {
      const existing = byId.get(existingId)!
      existing.book_aliases = [...new Set([...existing.book_aliases, row.type_name, ...row.book_aliases])]
      existing.example_problem_ids = [...new Set([...existing.example_problem_ids, ...row.example_problem_ids])]
      existing.review_reasons.push('MERGED_EQUIVALENT_LABEL')
      continue
    }
    const current = byId.get(row.type_id)
    if (current) {
      current.book_aliases = [...new Set([...current.book_aliases, ...row.book_aliases])]
      current.example_problem_ids = [...new Set([...current.example_problem_ids, ...row.example_problem_ids])]
      current.evidence = [...new Set([...current.evidence, ...row.evidence])]
      continue
    }
    byId.set(row.type_id, { ...row, book_aliases: [...row.book_aliases], example_problem_ids: [...row.example_problem_ids] })
    byKey.set(key, row.type_id)
  }
  return [...byId.values()].filter((row) => row.type_id !== 'TYPE_UNCLEAR' || row.example_problem_ids.length > 0)
}

export function seedHyperTypesFromHeadings(headings: Array<{ title: string; theory_code: string }>): HyperTypeCandidate[] {
  const out: HyperTypeCandidate[] = []
  for (const heading of headings) {
    const typeId = typeIdFromBookHeading(heading.title) ?? `REVIEW_${heading.theory_code.replace('-', '_')}`
    const seeded = makeHyperType(typeId === `REVIEW_${heading.theory_code.replace('-', '_')}` ? 'TYPE_UNCLEAR' : typeId, {
      type_id: typeId.startsWith('REVIEW_') ? typeId : typeId,
      type_name: typeId.startsWith('REVIEW_') ? heading.title : undefined,
      book_aliases: [heading.title, heading.theory_code],
      evidence: [`book_heading:${heading.theory_code}`],
      review_reasons: typeId.startsWith('REVIEW_') ? ['UNMAPPED_BOOK_HEADING'] : [],
      confidence: typeId.startsWith('REVIEW_') ? 0.4 : 0.86,
    })
    if (typeId.startsWith('REVIEW_')) {
      seeded.type_id = typeId
      seeded.type_name = heading.title
      seeded.concept_summary = '교재 heading은 확인됐으나 HYPER canonical mapping이 없다.'
      seeded.key_tested_point = 'REVIEW'
    }
    out.push(seeded)
  }
  return canonicalizeHyperTypes(out)
}
