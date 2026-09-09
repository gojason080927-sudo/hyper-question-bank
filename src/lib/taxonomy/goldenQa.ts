import { contentUnitFromStem } from '../classification/classifyDraft'
import { stemTypeIntent, type ProblemClassificationV1 } from './taxonomyClassifier'

export type QaJudgement = 'CORRECT' | 'WRONG' | 'AMBIGUOUS'
export type DiffJudgement = 'PLAUSIBLE' | 'QUESTIONABLE' | 'CLEARLY_WRONG'
export type TextJudgement = 'GOOD' | 'GENERIC' | 'WRONG' | 'INCOMPLETE'
export type MistakeJudgement = 'SUPPORTED' | 'TOO_GENERIC' | 'UNSUPPORTED'

export type GoldenRow = {
  problem_id: string
  page_number: number
  original_problem_number: string
  unit: QaJudgement
  subunit: QaJudgement
  type: QaJudgement
  difficulty: DiffJudgement
  key_point: TextJudgement
  solution_strategy: TextJudgement
  common_mistake: MistakeJudgement
  auto_unit: boolean
  auto_subunit: boolean
  auto_type: boolean
  auto_difficulty: boolean
  auto_key: boolean
  auto_strategy: boolean
  strata: string
}

export function evaluateClassification(row: ProblemClassificationV1): Omit<GoldenRow, 'strata'> {
  const stemUnit = contentUnitFromStem(row.stem_excerpt).unit
  const stemType = stemTypeIntent(row.stem_excerpt).type_id
  const auto_unit = row.decisions.unit === 'AUTO'
  const auto_type = row.decisions.type === 'AUTO'

  let unit: QaJudgement = 'AMBIGUOUS'
  if (stemUnit && row.unit_id === stemUnit) unit = 'CORRECT'
  else if (auto_unit && stemUnit && row.unit_id !== stemUnit) unit = 'WRONG'
  else unit = 'AMBIGUOUS'

  let type: QaJudgement = 'AMBIGUOUS'
  if (stemType && row.type_id === stemType) type = 'CORRECT'
  else if (auto_type && stemType && row.type_id !== stemType) type = 'WRONG'
  else if (auto_type && row.type_id === 'TYPE_UNCLEAR') type = 'WRONG'
  else if (!stemType) type = 'AMBIGUOUS'
  else type = 'AMBIGUOUS'

  const subunit: QaJudgement = row.review_reasons.includes('UNIT_CONFLICT')
    ? row.decisions.subunit === 'AUTO'
      ? 'WRONG'
      : 'AMBIGUOUS'
    : row.subunit_id !== '미정'
      ? 'CORRECT'
      : 'AMBIGUOUS'

  let difficulty: DiffJudgement = 'PLAUSIBLE'
  const hardShape = /\(가\)|\(나\)/.test(row.stem_excerpt) && row.difficulty_evidence.some((item) => item.includes('transformation'))
  if (row.decisions.difficulty === 'AUTO' && row.difficulty_level === 1 && hardShape && /그림|그래프/.test(row.stem_excerpt)) {
    difficulty = 'CLEARLY_WRONG'
  } else if (row.decisions.difficulty === 'AUTO' && row.difficulty_level === 5 && row.stem_excerpt.length < 48) {
    difficulty = 'CLEARLY_WRONG'
  } else if (row.decisions.difficulty === 'AUTO' && row.difficulty_level === 1 && row.source_difficulty_label === '고난도/실력') {
    difficulty = 'QUESTIONABLE'
  }

  const keyJoined = row.key_test_points.join(' ')
  let key_point: TextJudgement = 'GOOD'
  if (!row.key_test_points.length || keyJoined === 'REVIEW') key_point = 'WRONG'
  else if (keyJoined === row.stem_excerpt) key_point = 'WRONG'
  else if (/이해한다|구할 수 있다$/.test(keyJoined) && keyJoined.length < 18) key_point = 'GENERIC'

  let solution_strategy: TextJudgement = 'GOOD'
  if (!row.solution_strategy.length) solution_strategy = row.decisions.solution_strategy === 'AUTO' ? 'WRONG' : 'INCOMPLETE'
  else if (row.solution_strategy.join('') === row.stem_excerpt) solution_strategy = 'WRONG'

  let common_mistake: MistakeJudgement = 'SUPPORTED'
  if (row.decisions.common_mistakes === 'AUTO' && row.review_reasons.includes('MISTAKE_UNSUPPORTED')) common_mistake = 'UNSUPPORTED'
  else if (!row.type_id || row.type_id === 'TYPE_UNCLEAR') common_mistake = 'UNSUPPORTED'
  else if (row.decisions.common_mistakes === 'REVIEW') common_mistake = 'TOO_GENERIC'

  if (row.decisions.unit === 'AUTO' && row.review_reasons.includes('UNIT_CONFLICT')) unit = 'WRONG'
  if (row.decisions.type === 'AUTO' && /항등식|값에 관계없이/.test(row.stem_excerpt) && row.type_id === 'QUADRATIC_SOLVE') type = 'WRONG'

  return {
    problem_id: row.problem_id,
    page_number: row.page_number,
    original_problem_number: row.original_problem_number,
    unit,
    subunit,
    type,
    difficulty,
    key_point,
    solution_strategy,
    common_mistake,
    auto_unit,
    auto_subunit: row.decisions.subunit === 'AUTO',
    auto_type,
    auto_difficulty: row.decisions.difficulty === 'AUTO',
    auto_key: row.decisions.key_point === 'AUTO',
    auto_strategy: row.decisions.solution_strategy === 'AUTO',
  }
}

export function pickGoldenSample(rows: ProblemClassificationV1[], target = 80): ProblemClassificationV1[] {
  const buckets = new Map<string, ProblemClassificationV1[]>()
  for (const row of rows) {
    const third = row.page_number <= 64 ? 'front' : row.page_number <= 128 ? 'mid' : 'back'
    const fig = /그림|그래프|표/.test(row.stem_excerpt) ? 'fig' : 'text'
    const mcq = /[①-⑤]/.test(row.stem_excerpt) ? 'mcq' : 'open'
    const mismatch = row.review_reasons.includes('TYPE_HEADING_STEM_MISMATCH') || row.review_reasons.includes('UNIT_CONFLICT') ? 'mis' : 'ok'
    const key = `${row.unit_id}|${row.type_id}|${row.difficulty_level ?? 'R'}|${third}|${fig}|${mcq}|${mismatch}|${row.classification_status}`
    const list = buckets.get(key) ?? []
    list.push(row)
    buckets.set(key, list)
  }
  const picked: ProblemClassificationV1[] = []
  const keys = [...buckets.keys()].sort()
  while (picked.length < Math.min(target, rows.length)) {
    let added = false
    for (const key of keys) {
      const list = buckets.get(key)
      if (!list?.length) continue
      picked.push(list.shift()!)
      added = true
      if (picked.length >= target) break
    }
    if (!added) break
  }
  return picked
}

export function precision(rows: GoldenRow[], field: 'unit' | 'subunit' | 'type', autoKey: 'auto_unit' | 'auto_subunit' | 'auto_type'): number {
  const auto = rows.filter((row) => row[autoKey])
  const decided = auto.filter((row) => row[field] === 'CORRECT' || row[field] === 'WRONG')
  if (!decided.length) return 1
  return decided.filter((row) => row[field] === 'CORRECT').length / decided.length
}

export type ThresholdCandidate = {
  unit: number
  subunit: number
  type: number
  difficulty: number
  key_point: number
  solution_strategy: number
}

export function chooseThresholdsFromQa(
  classified: ProblemClassificationV1[],
  evaluate: (row: ProblemClassificationV1) => Omit<GoldenRow, 'strata'>,
): { picked: ThresholdCandidate; grid: Array<Record<string, unknown>> } {
  const typeCuts = [0.7, 0.78, 0.86, 0.92]
  const unitCuts = [0.86, 0.9, 0.94]
  const grid: Array<Record<string, unknown>> = []
  let picked: ThresholdCandidate = {
    unit: 0.9,
    subunit: 0.86,
    type: 0.78,
    difficulty: 0.7,
    key_point: 0.75,
    solution_strategy: 0.75,
  }
  let best = { errors: Infinity, auto: -1 }
  for (const unit of unitCuts) {
    for (const type of typeCuts) {
      const simulated = classified.map((row) => {
        const unitAuto = row.unit_confidence >= unit && !row.review_reasons.includes('UNIT_CONFLICT')
        const typeAuto = row.type_confidence >= type && row.type_id !== 'TYPE_UNCLEAR'
        const copy = {
          ...row,
          decisions: {
            ...row.decisions,
            unit: unitAuto ? 'AUTO' : 'REVIEW',
            type: typeAuto ? 'AUTO' : 'REVIEW',
            overall: unitAuto && typeAuto ? 'AUTO' : 'REVIEW',
          },
        } as ProblemClassificationV1
        return evaluate(copy)
      })
      const typeAuto = simulated.filter((row) => row.auto_type)
      const typeWrong = typeAuto.filter((row) => row.type === 'WRONG').length
      const unitWrong = simulated.filter((row) => row.auto_unit && row.unit === 'WRONG').length
      const errors = typeWrong + unitWrong
      const auto = simulated.filter((row) => row.auto_unit && row.auto_type).length
      grid.push({ unit, type, AUTO: auto, REVIEW: classified.length - auto, type_wrong: typeWrong, unit_wrong: unitWrong })
      if (errors < best.errors || (errors === best.errors && auto > best.auto)) {
        best = { errors, auto }
        picked = { ...picked, unit, type }
      }
    }
  }
  return { picked, grid }
}
