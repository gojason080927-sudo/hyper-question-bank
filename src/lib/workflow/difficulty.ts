export type DifficultyDims = {
  concept_difficulty: number
  calculation_complexity: number
  reasoning_depth: number
  condition_complexity: number
  representation_complexity: number
  trap_level: number
}

export const DIFFICULTY_FIELDS = [
  {
    key: 'concept_difficulty',
    label: '개념 난이도',
    low: '한 개념의 직접 적용',
    high: '선행 지식이 깊고 여러 개념이 얽힘',
  },
  {
    key: 'calculation_complexity',
    label: '계산 복잡도',
    low: '단순 계산',
    high: '계산 단계가 많고 오류 가능성이 높음',
  },
  {
    key: 'reasoning_depth',
    label: '추론 깊이',
    low: '직접 적용, 분기 없음',
    high: '비약이 큰 다단계 추론',
  },
  {
    key: 'condition_complexity',
    label: '조건 복잡도',
    low: '추가 제약 없음',
    high: '제약이 많고 서로 영향',
  },
  {
    key: 'representation_complexity',
    label: '표현 복잡도',
    low: '한 줄 식/문장',
    high: '식·표·그래프·기하 전환 부담이 큼',
  },
  {
    key: 'trap_level',
    label: '함정 수준',
    low: '함정 없음',
    high: '오개념·부호 함정이 강함',
  },
] as const

export function overallDifficulty(dims: DifficultyDims): string {
  const values = [
    dims.concept_difficulty,
    dims.calculation_complexity,
    dims.reasoning_depth,
    dims.condition_complexity,
    dims.representation_complexity,
    dims.trap_level,
  ]
  const mean = values.reduce((sum, value) => sum + value, 0) / 6
  return (Math.round(mean * 100) / 100).toFixed(2)
}

export function isDifficultyLevel(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5
}

const DIM_KEYS: Array<keyof DifficultyDims> = [
  'concept_difficulty',
  'calculation_complexity',
  'reasoning_depth',
  'condition_complexity',
  'representation_complexity',
  'trap_level',
]

export function extractDifficultyDims(row: unknown): DifficultyDims | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const dims = {
    concept_difficulty: Number(record.concept_difficulty),
    calculation_complexity: Number(record.calculation_complexity),
    reasoning_depth: Number(record.reasoning_depth),
    condition_complexity: Number(record.condition_complexity),
    representation_complexity: Number(record.representation_complexity),
    trap_level: Number(record.trap_level),
  }
  if (DIM_KEYS.some((key) => !isDifficultyLevel(dims[key]))) return null
  return dims
}

export function defaultHumanDifficulty(): DifficultyDims {
  return {
    concept_difficulty: 1,
    calculation_complexity: 1,
    reasoning_depth: 1,
    condition_complexity: 1,
    representation_complexity: 1,
    trap_level: 1,
  }
}
