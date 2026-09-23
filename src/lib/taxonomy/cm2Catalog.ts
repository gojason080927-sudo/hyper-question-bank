/**
 * 공통수학2 catalog for the existing HYPER taxonomy tables / RPC.
 * Does not replace 공통수학1 profiles or UNIT_CODE.
 */
export const CM2_SUBJECT = '공통수학2'
export const CM2_ASSIGNED_BY = 'BOOK_CLASSIFY_CM2'
export const CM2_ARTIFACT = 'book-classify-cm2'

export const CM2_UNIT_CODE: Record<string, string> = {
  '도형의 방정식': 'CM2_UNIT_FIGURE',
  '집합과 명제': 'CM2_UNIT_SET',
  '함수와 그래프': 'CM2_UNIT_FN',
}

export const CM2_SUBUNIT_CODE: Record<string, string> = {
  평면좌표: 'CM2_SUB_PLANE',
  '직선의 방정식': 'CM2_SUB_LINE',
  '원의 방정식': 'CM2_SUB_CIRCLE',
  '도형의 이동': 'CM2_SUB_TRANSFORM',
  집합: 'CM2_SUB_SET',
  명제: 'CM2_SUB_PROP',
  함수: 'CM2_SUB_FN',
  '유리함수와 무리함수': 'CM2_SUB_RATIONAL',
}

export const CM2_SUBUNIT_PARENT: Record<string, string> = {
  CM2_SUB_PLANE: 'CM2_UNIT_FIGURE',
  CM2_SUB_LINE: 'CM2_UNIT_FIGURE',
  CM2_SUB_CIRCLE: 'CM2_UNIT_FIGURE',
  CM2_SUB_TRANSFORM: 'CM2_UNIT_FIGURE',
  CM2_SUB_SET: 'CM2_UNIT_SET',
  CM2_SUB_PROP: 'CM2_UNIT_SET',
  CM2_SUB_FN: 'CM2_UNIT_FN',
  CM2_SUB_RATIONAL: 'CM2_UNIT_FN',
}

export type Cm2TypeProfile = {
  type_id: string
  canonical_name_ko: string
  unit_id: string
  subunit_id: string
  description: string
  core_concepts: string[]
  solution_strategies: string[]
  key_test_points: string[]
  aliases: string[]
}

function p(
  type_id: string,
  canonical_name_ko: string,
  unit_id: string,
  subunit_id: string,
  description: string,
  key: string,
  aliases: string[],
): Cm2TypeProfile {
  return {
    type_id,
    canonical_name_ko,
    unit_id,
    subunit_id,
    description,
    core_concepts: [canonical_name_ko],
    solution_strategies: ['조건을 좌표·식으로 옮긴다', '해당 단원 공식을 적용한다', '구한 값이 조건을 만족하는지 확인한다'],
    key_test_points: [key],
    aliases,
  }
}

export const CM2_TYPE_PROFILES: Cm2TypeProfile[] = [
  p('DISTANCE_TWO_POINTS', '두 점 사이의 거리', '도형의 방정식', '평면좌표', '좌표평면에서 두 점 사이 거리를 구한다.', '두 점 사이의 거리 공식을 적용할 수 있는가', ['두 점 사이의 거리', '같은 거리에 있는 점']),
  p('SEGMENT_DIVISION', '선분의 내분과 외분', '도형의 방정식', '평면좌표', '내분점·외분점·중점 좌표를 구한다.', '선분을 주어진 비로 내분·외분하는 점의 좌표를 구할 수 있는가', ['내분', '외분', '중점', '선분의 내분점']),
  p('LINE_EQUATION', '직선의 방정식', '도형의 방정식', '직선의 방정식', '한 점과 기울기 또는 두 점으로 직선의 방정식을 세운다.', '주어진 조건으로 직선의 방정식을 구할 수 있는가', ['직선의 방정식', '기울기', '절편']),
  p('LINE_PARALLEL_PERP', '두 직선의 위치 관계', '도형의 방정식', '직선의 방정식', '평행·수직·일치 조건을 이용한다.', '두 직선의 평행·수직 조건을 이용하여 미지수를 구할 수 있는가', ['평행', '수직', '두 직선의 위치']),
  p('POINT_LINE_DISTANCE', '점과 직선 사이의 거리', '도형의 방정식', '직선의 방정식', '점에서 직선에 내린 수선의 길이를 구한다.', '점과 직선 사이의 거리 공식을 적용할 수 있는가', ['점과 직선 사이의 거리']),
  p('CIRCLE_EQUATION', '원의 방정식', '도형의 방정식', '원의 방정식', '중심과 반지름으로 원의 방정식을 구한다.', '원의 중심과 반지름을 읽어 원의 방정식을 구할 수 있는가', ['원의 방정식', '반지름', '중심']),
  p('CIRCLE_LINE', '원과 직선의 위치 관계', '도형의 방정식', '원의 방정식', '접선·교점·판별 조건을 다룬다.', '원과 직선의 위치 관계 또는 접선의 방정식을 구할 수 있는가', ['접선', '원과 직선', '원 위의 점과 직선']),
  p('TRANSLATION', '평행이동', '도형의 방정식', '도형의 이동', '점·직선·원을 평행이동한다.', '주어진 방향으로 도형을 평행이동한 식을 구할 수 있는가', ['평행이동']),
  p('REFLECTION', '대칭이동', '도형의 방정식', '도형의 이동', '점·직선·원을 축 또는 원점에 대하여 대칭이동한다.', '축 또는 원점에 대한 대칭이동을 할 수 있는가', ['대칭이동']),
  p('SET_BASIC', '집합의 뜻과 표현', '집합과 명제', '집합', '원소나열·조건제시법과 포함 관계를 다룬다.', '집합의 원소와 포함 관계를 올바르게 표현할 수 있는가', ['집합의 뜻', '포함 관계', '원소나열', '조건제시']),
  p('SET_OPS', '집합의 연산', '집합과 명제', '집합', '합·교·여·차집합과 연산 법칙을 다룬다.', '합집합·교집합·여집합·차집합을 구할 수 있는가', ['합집합', '교집합', '여집합', '차집합', '집합의 연산']),
  p('SET_COUNT', '집합의 원소의 개수', '집합과 명제', '집합', '포함·배제와 부분집합의 개수를 구한다.', '집합의 원소의 개수 또는 부분집합의 개수를 구할 수 있는가', ['원소의 개수', '부분집합의 개수', 'n(']),
  p('PROPOSITION_LOGIC', '명제와 조건', '집합과 명제', '명제', '참·거짓, 부정, 역·이·대우를 판별한다.', '명제의 참거짓과 역·이·대우를 판별할 수 있는가', ['명제와 조건', '명제', '역', '대우']),
  p('PROPOSITION_CONDITION', '필요조건과 충분조건', '집합과 명제', '명제', '충분·필요·필요충분과 삼단논법을 다룬다.', '충분조건·필요조건·필요충분조건을 판별할 수 있는가', ['충분조건', '필요조건', '필요충분조건', '삼단논법']),
  p('FUNCTION_BASIC', '함수의 뜻과 그래프', '함수와 그래프', '함수', '정의역·치역·그래프로 함수인지 판별한다.', '함수의 뜻과 정의역·치역·그래프를 구할 수 있는가', ['함수의 뜻', '정의역', '치역', '함수값']),
  p('COMPOSITE_INVERSE', '합성함수와 역함수', '함수와 그래프', '함수', '합성함수와 역함수의 존재·식을 구한다.', '합성함수 또는 역함수를 구할 수 있는가', ['합성함수', '역함수']),
  p('RATIONAL_FN', '유리함수', '함수와 그래프', '유리함수와 무리함수', '유리함수의 그래프와 점근선을 다룬다.', '유리함수의 그래프와 점근선을 이해할 수 있는가', ['유리함수', '점근선']),
  p('IRRATIONAL_FN', '무리함수', '함수와 그래프', '유리함수와 무리함수', '무리함수의 그래프와 정의역을 다룬다.', '무리함수의 그래프와 정의역을 구할 수 있는가', ['무리함수']),
]

export function cm2ProfileById(typeId: string): Cm2TypeProfile | undefined {
  return CM2_TYPE_PROFILES.find((row) => row.type_id === typeId)
}

export function cm2DictionaryPayload(type: Cm2TypeProfile): Record<string, unknown> {
  return {
    code: type.type_id,
    name: type.canonical_name_ko,
    description: type.description,
    parent_code: '',
    canonical_name_ko: type.canonical_name_ko,
    unit_code: CM2_UNIT_CODE[type.unit_id] ?? '',
    subunit_code: CM2_SUBUNIT_CODE[type.subunit_id] ?? '',
    core_concepts: type.core_concepts,
    solution_strategies: type.solution_strategies,
    key_test_points: type.key_test_points,
    common_mistakes: [],
    prerequisite_types: [],
    source_aliases: type.aliases.map((alias) => ({ alias, source: 'cm2-generic', universal: true })),
    dictionary_status: 'CANDIDATE',
  }
}

export const CM2_CURRICULUM_SEED = {
  grade: { code: 'CM2_G10', name: '고1', node_type: 'GRADE' as const },
  subject: { code: 'CM2_SUBJECT', name: '공통수학2', node_type: 'SUBJECT' as const },
  units: [
    { code: 'CM2_UNIT_FIGURE', name: '도형의 방정식', sort: 1 },
    { code: 'CM2_UNIT_SET', name: '집합과 명제', sort: 2 },
    { code: 'CM2_UNIT_FN', name: '함수와 그래프', sort: 3 },
  ],
  subunits: [
    { code: 'CM2_SUB_PLANE', name: '평면좌표', unit: 'CM2_UNIT_FIGURE', sort: 1 },
    { code: 'CM2_SUB_LINE', name: '직선의 방정식', unit: 'CM2_UNIT_FIGURE', sort: 2 },
    { code: 'CM2_SUB_CIRCLE', name: '원의 방정식', unit: 'CM2_UNIT_FIGURE', sort: 3 },
    { code: 'CM2_SUB_TRANSFORM', name: '도형의 이동', unit: 'CM2_UNIT_FIGURE', sort: 4 },
    { code: 'CM2_SUB_SET', name: '집합', unit: 'CM2_UNIT_SET', sort: 1 },
    { code: 'CM2_SUB_PROP', name: '명제', unit: 'CM2_UNIT_SET', sort: 2 },
    { code: 'CM2_SUB_FN', name: '함수', unit: 'CM2_UNIT_FN', sort: 1 },
    { code: 'CM2_SUB_RATIONAL', name: '유리함수와 무리함수', unit: 'CM2_UNIT_FN', sort: 2 },
  ],
}
