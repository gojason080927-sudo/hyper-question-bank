import { extractRubricFeatures, type RubricFeatures } from './difficultyRubric'
import { extractMathFingerprint } from './mathFingerprint'

export const MODEL_A_CUTS = { low: 0.42, high: 0.72 } as const

export type DifficultyV2Features = RubricFeatures & {
  algebraic_degree: number
  multi_concept_combo: number
  non_routine: number
  constraint_density: number
  expression_complexity: number
}

export const FEATURE_WEIGHTS_V1: Array<{ name: keyof RubricFeatures; weight: number }> = [
  { name: 'concept_count', weight: 0.12 },
  { name: 'reasoning_steps', weight: 0.12 },
  { name: 'transformation_depth', weight: 0.12 },
  { name: 'condition_interaction', weight: 0.12 },
  { name: 'case_split', weight: 0.08 },
  { name: 'representation_switch', weight: 0.1 },
  { name: 'trap_density', weight: 0.08 },
  { name: 'computation_load', weight: 0.08 },
  { name: 'abstraction', weight: 0.1 },
  { name: 'solution_path_obviousness', weight: -0.08 },
]

export const FEATURE_WEIGHTS_V2: Array<{ name: keyof DifficultyV2Features; weight: number }> = [
  { name: 'concept_count', weight: 0.1 },
  { name: 'reasoning_steps', weight: 0.1 },
  { name: 'transformation_depth', weight: 0.1 },
  { name: 'condition_interaction', weight: 0.1 },
  { name: 'case_split', weight: 0.08 },
  { name: 'representation_switch', weight: 0.08 },
  { name: 'trap_density', weight: 0.06 },
  { name: 'computation_load', weight: 0.06 },
  { name: 'abstraction', weight: 0.08 },
  { name: 'solution_path_obviousness', weight: -0.06 },
  { name: 'algebraic_degree', weight: 0.06 },
  { name: 'multi_concept_combo', weight: 0.08 },
  { name: 'non_routine', weight: 0.06 },
  { name: 'constraint_density', weight: 0.04 },
  { name: 'expression_complexity', weight: 0.06 },
]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function extractDifficultyV2Features(input: {
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
}): DifficultyV2Features {
  const base = extractRubricFeatures(input)
  const stem = input.stem.replace(/\s+/g, ' ')
  const fp = extractMathFingerprint(stem)
  const degree = fp.polynomial_degree ?? 0
  const multi = /유형\s*\d+\s*\+|쪽\s*유형/.test(stem) ? 0.85 : /유형\s*\d+/.test(stem) ? 0.35 : 0.08
  const nonRoutine = /사고력|사고의\s*기술|보기|ㄱ|증명|설명하시오/.test(stem) ? 0.82 : 0.1
  const constraints = (stem.match(/단,|정수|자연수|서로\s*다른|실수|양수/g) ?? []).length
  const latexRuns = (stem.match(/\$.+?\$/g) ?? []).length
  return {
    ...base,
    algebraic_degree: clamp01(degree / 4),
    multi_concept_combo: multi,
    non_routine: nonRoutine,
    constraint_density: clamp01(constraints / 3),
    expression_complexity: clamp01(latexRuns / 6 + (fp.number_of_variables > 2 ? 0.2 : 0)),
  }
}

export function scoreRubricV2(features: DifficultyV2Features): number {
  const discovery = 1 - features.solution_path_obviousness
  return clamp01(
    0.1 * features.concept_count +
      0.1 * features.reasoning_steps +
      0.1 * features.transformation_depth +
      0.1 * features.condition_interaction +
      0.08 * features.case_split +
      0.08 * features.representation_switch +
      0.06 * features.trap_density +
      0.06 * features.computation_load +
      0.08 * features.abstraction +
      0.06 * discovery +
      0.06 * features.algebraic_degree +
      0.08 * features.multi_concept_combo +
      0.06 * features.non_routine +
      0.04 * features.constraint_density +
      0.06 * features.expression_complexity,
  )
}

export type HighEvidence = {
  count: number
  flags: string[]
  sufficient: boolean
}

export function highComplexityEvidence(stem: string, features: DifficultyV2Features): HighEvidence {
  const text = stem.replace(/\s+/g, ' ')
  const flags: string[] = []
  if (features.case_split >= 0.5) flags.push('case_split')
  if (features.condition_interaction >= 0.5) flags.push('multiple_condition_dependency')
  if (features.transformation_depth >= 0.85) flags.push('non_routine_transformation')
  if (features.multi_concept_combo >= 0.8) flags.push('multiple_concepts_combined')
  if (features.algebraic_degree >= 0.75) flags.push('high_algebraic_complexity')
  if (features.representation_switch >= 0.8 && features.concept_count >= 0.3) flags.push('diagram_plus_algebra')
  if (features.non_routine >= 0.8) flags.push('non_routine_reasoning')
  if (/\(가\).*\(나\)/.test(text)) flags.push('structurally_difficult_conditions')
  return { count: flags.length, flags, sufficient: flags.length >= 3 }
}

export function longTextAloneIsNotHigh(stem: string, features: DifficultyV2Features, evidence: HighEvidence): boolean {
  return stem.length > 400 && evidence.count === 0 && features.algebraic_degree < 0.5 && features.multi_concept_combo < 0.5
}

export type PrimaryBand = 'LOW' | 'MID' | 'HIGH' | 'REVIEW'

export function assignModelA(score: number, confidence: number): PrimaryBand {
  if (confidence < 0.7) return 'REVIEW'
  if (score < MODEL_A_CUTS.low) return 'LOW'
  if (score < MODEL_A_CUTS.high) return 'MID'
  return 'HIGH'
}

export function assignModelB(scoreV2: number, confidence: number): PrimaryBand {
  if (confidence < 0.7) return 'REVIEW'
  if (scoreV2 < MODEL_A_CUTS.low) return 'LOW'
  if (scoreV2 < MODEL_A_CUTS.high) return 'MID'
  return 'HIGH'
}

export function assignModelC(scoreV2: number, confidence: number, evidence: HighEvidence, stem: string, features: DifficultyV2Features): PrimaryBand {
  if (confidence < 0.7) return 'REVIEW'
  if (longTextAloneIsNotHigh(stem, features, evidence) && scoreV2 < MODEL_A_CUTS.high) {
    return scoreV2 < MODEL_A_CUTS.low ? 'LOW' : 'MID'
  }
  if (scoreV2 >= MODEL_A_CUTS.high && evidence.sufficient) return 'HIGH'
  if (scoreV2 >= MODEL_A_CUTS.high && !evidence.sufficient) return 'MID'
  if (scoreV2 < MODEL_A_CUTS.low) return 'LOW'
  return 'MID'
}

