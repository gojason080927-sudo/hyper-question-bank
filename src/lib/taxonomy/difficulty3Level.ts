import { extractRubricFeatures, scoreRubric } from './difficultyRubric'
import type { PublisherDifficultyEvidence } from './publisherDifficulty'

export type HyperPrimaryDifficulty = 'LOW' | 'MID' | 'HIGH' | 'REVIEW'
export type SecondaryTercile = 'LOW' | 'MID' | 'HIGH'

export type Difficulty3LevelRow = {
  problem_id: string
  type_id: string
  primary_difficulty: HyperPrimaryDifficulty
  continuous_score: number
  confidence: number
  evidence: string[]
  source_difficulty_label: string | null
  legacy_model_1_5: 1 | 2 | 3 | 4 | 5 | null
  same_type_relative_rank: number | null
  secondary_tercile_candidate: SecondaryTercile | null
  production_write: false
}

/** Collapse internal continuous score to 3 primary bands. Not A=LOW/B=MID/C=HIGH. */
export function primaryFromScore(score: number): Exclude<HyperPrimaryDifficulty, 'REVIEW'> {
  if (score < 0.42) return 'LOW'
  if (score < 0.72) return 'MID'
  return 'HIGH'
}

export function estimate3Level(input: {
  problem_id: string
  type_id: string
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
  publisher: PublisherDifficultyEvidence
  legacy_level: 1 | 2 | 3 | 4 | 5 | null
  legacy_confidence: number
}): Difficulty3LevelRow {
  const features = extractRubricFeatures({
    stem: input.stem,
    choice_count: input.choice_count,
    math_count: input.math_count,
    figure_hint: input.figure_hint,
    graph_hint: input.graph_hint,
  })
  const continuous_score = Number(scoreRubric(features).toFixed(3))
  const confidence = input.legacy_confidence
  const primary = confidence >= 0.7 ? primaryFromScore(continuous_score) : 'REVIEW'
  const evidence = [
    `concept_count=${features.concept_count.toFixed(2)}`,
    `reasoning_steps=${features.reasoning_steps.toFixed(2)}`,
    `transformation_depth=${features.transformation_depth.toFixed(2)}`,
    `condition_interaction=${features.condition_interaction.toFixed(2)}`,
    `same_type_relative_complexity=pending`,
    `publisher_label=${input.publisher.source_difficulty_label ?? 'UNKNOWN'}`,
    'publisher_label_is_not_hyper_primary',
  ]
  return {
    problem_id: input.problem_id,
    type_id: input.type_id,
    primary_difficulty: primary,
    continuous_score,
    confidence: Number(confidence.toFixed(3)),
    evidence,
    source_difficulty_label: input.publisher.source_difficulty_label,
    legacy_model_1_5: input.legacy_level,
    same_type_relative_rank: null,
    secondary_tercile_candidate: null,
    production_write: false,
  }
}

export function attachRelativeRanks(rows: Difficulty3LevelRow[]): Difficulty3LevelRow[] {
  const byType = new Map<string, Difficulty3LevelRow[]>()
  for (const row of rows) {
    const list = byType.get(row.type_id) ?? []
    list.push(row)
    byType.set(row.type_id, list)
  }
  const rank = new Map<string, number>()
  for (const list of byType.values()) {
    const sorted = [...list].sort((a, b) => a.continuous_score - b.continuous_score || a.problem_id.localeCompare(b.problem_id))
    sorted.forEach((row, index) => rank.set(row.problem_id, sorted.length <= 1 ? 0.5 : index / (sorted.length - 1)))
  }
  return rows.map((row) => ({
    ...row,
    same_type_relative_rank: rank.get(row.problem_id) ?? null,
    evidence: row.evidence.map((item) =>
      item.startsWith('same_type_relative_complexity') ? `same_type_relative_complexity=${(rank.get(row.problem_id) ?? 0).toFixed(3)}` : item,
    ),
  }))
}

export function attachPrimaryTerciles(rows: Difficulty3LevelRow[]): Difficulty3LevelRow[] {
  const groups: HyperPrimaryDifficulty[] = ['LOW', 'MID', 'HIGH']
  const tercileOf = new Map<string, SecondaryTercile>()
  for (const primary of groups) {
    const members = rows.filter((row) => row.primary_difficulty === primary).sort((a, b) => a.continuous_score - b.continuous_score)
    members.forEach((row, index) => {
      if (members.length < 3) {
        tercileOf.set(row.problem_id, 'MID')
        return
      }
      const t = index / (members.length - 1)
      tercileOf.set(row.problem_id, t < 1 / 3 ? 'LOW' : t < 2 / 3 ? 'MID' : 'HIGH')
    })
  }
  return rows.map((row) => ({
    ...row,
    secondary_tercile_candidate: row.primary_difficulty === 'REVIEW' ? null : (tercileOf.get(row.problem_id) ?? null),
  }))
}

export type AbcCrosstab = Record<string, Record<string, number>>

export function buildAbcCrosstab(
  rows: Array<{ letter: string | null; korean: string | null; primary: HyperPrimaryDifficulty }>,
): { letter: AbcCrosstab; korean: AbcCrosstab } {
  const primaries = ['LOW', 'MID', 'HIGH', 'REVIEW']
  const letterRows = ['A', 'B', 'C', 'UNKNOWN']
  const koreanRows = ['기본 다잡기', '대표 문제', '실력 UP', '고난도', 'UNKNOWN']
  const empty = (keys: string[]): AbcCrosstab => Object.fromEntries(keys.map((key) => [key, Object.fromEntries(primaries.map((p) => [p, 0]))]))
  const letter = empty(letterRows)
  const korean = empty(koreanRows)
  for (const row of rows) {
    const letterKey = row.letter && ['A', 'B', 'C'].includes(row.letter) ? row.letter : 'UNKNOWN'
    letter[letterKey]![row.primary] += 1
    const koreanKey = koreanRows.includes(row.korean ?? '') ? row.korean! : 'UNKNOWN'
    korean[koreanKey]![row.primary] += 1
  }
  return { letter, korean }
}

export function inversionAnalysis(
  rows: Array<{ letter: string | null; korean: string | null; primary: HyperPrimaryDifficulty; problem_id: string; score: number }>,
): { c_to_low: number; a_to_high: number; cases: Array<{ problem_id: string; source: string; hyper: string; score: number }> } {
  const cases: Array<{ problem_id: string; source: string; hyper: string; score: number }> = []
  let c_to_low = 0
  let a_to_high = 0
  for (const row of rows) {
    const hard = row.letter === 'C' || /고난도|실력\s*UP/.test(row.korean ?? '')
    const easy = row.letter === 'A' || /기본\s*다잡기/.test(row.korean ?? '')
    if (hard && row.primary === 'LOW') {
      c_to_low += 1
      cases.push({ problem_id: row.problem_id, source: row.letter ?? row.korean ?? 'UNKNOWN', hyper: row.primary, score: row.score })
    }
    if (easy && row.primary === 'HIGH') {
      a_to_high += 1
      cases.push({ problem_id: row.problem_id, source: row.letter ?? row.korean ?? 'UNKNOWN', hyper: row.primary, score: row.score })
    }
  }
  return { c_to_low, a_to_high, cases: cases.slice(0, 20) }
}

export function hierarchicalFeasibility(rows: Difficulty3LevelRow[]): {
  LOW: { n: number; score_spread: number; stable: boolean }
  MID: { n: number; score_spread: number; stable: boolean }
  HIGH: { n: number; score_spread: number; stable: boolean }
  second_level_feasibility: 'PASS' | 'PARTIAL' | 'FAIL'
} {
  const band = (primary: Exclude<HyperPrimaryDifficulty, 'REVIEW'>) => {
    const members = rows.filter((row) => row.primary_difficulty === primary)
    const scores = members.map((row) => row.continuous_score)
    const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0
    return { n: members.length, score_spread: Number(spread.toFixed(3)), stable: members.length >= 8 && spread >= 0.04 }
  }
  const LOW = band('LOW')
  const MID = band('MID')
  const HIGH = band('HIGH')
  const stableCount = Number(LOW.stable) + Number(MID.stable) + Number(HIGH.stable)
  return {
    LOW,
    MID,
    HIGH,
    second_level_feasibility: stableCount === 3 ? 'PASS' : stableCount >= 1 ? 'PARTIAL' : 'FAIL',
  }
}
