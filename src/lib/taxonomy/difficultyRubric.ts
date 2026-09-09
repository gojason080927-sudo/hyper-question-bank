export type RubricFeatures = {
  concept_count: number
  reasoning_steps: number
  transformation_depth: number
  condition_interaction: number
  case_split: number
  representation_switch: number
  trap_density: number
  computation_load: number
  abstraction: number
  solution_path_obviousness: number
  source_difficulty_label: string | null
}

export type RubricEstimate = {
  difficulty_score: number
  difficulty_level: 1 | 2 | 3 | 4 | 5
  difficulty_confidence: number
  features: RubricFeatures
  difficulty_evidence: string[]
  source_difficulty_label: string | null
  note: string
}

export const RUBRIC_CUTS = [0.3, 0.42, 0.56, 0.72] as const

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function extractRubricFeatures(input: {
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
  table_hint?: boolean
}): RubricFeatures {
  const stem = input.stem.replace(/\s+/g, ' ')
  const concepts = [
    /동류항|오름차순|내림차순/,
    /전개|곱셈\s*공식/,
    /나눗셈|나머지|인수\s*정리|조립제법/,
    /항등식|미정계수/,
    /인수분해/,
    /복소수|허수|켤레/,
    /이차방정식|판별식|근과\s*계수/,
    /이차함수|그래프/,
    /부등식/,
    /순열|조합|경우의\s*수/,
    /행렬/,
    /삼차|사차/,
  ].filter((re) => re.test(stem)).length
  const conditions = (stem.match(/\(가\)|\(나\)|\(다\)|단,/g) ?? []).length
  const steps = conditions + (/유형\s*\d+\s*\+|쪽\s*유형/.test(stem) ? 2 : 0) + (/설명|증명|이유/.test(stem) ? 1 : 0)
  const transform = /전개|인수분해|변형|치환|정리하|표준형|계수\s*비교/.test(stem) ? (/전개.인수분해|인수분해.전개|변형/.test(stem) ? 0.85 : 0.55) : 0.18
  const label = /고난도|실력\s*UP/.test(stem) ? '고난도/실력' : /대표\s*문제/.test(stem) ? '대표 문제' : /기본\s*다잡기/.test(stem) ? '기본' : null
  return {
    concept_count: clamp01(concepts / 3),
    reasoning_steps: clamp01(steps / 4),
    transformation_depth: transform,
    condition_interaction: clamp01(conditions / 3),
    case_split: /경우|또는|각각|나누어/.test(stem) ? 0.7 : 0.12,
    representation_switch: input.figure_hint || input.graph_hint || input.table_hint || /그림|그래프|표/.test(stem) ? 0.82 : 0.08,
    trap_density: /단,|옳지\s*않은|항상|반드시/.test(stem) ? 0.62 : 0.15,
    computation_load: clamp01(input.math_count / 8 + (/제곱|나눗셈|전개/.test(stem) ? 0.25 : 0)),
    abstraction: /항등|관계|성질|설명|증명/.test(stem) ? 0.7 : 0.22,
    solution_path_obviousness: /다음\s*중|구하시오/.test(stem) && stem.length < 180 && conditions === 0 ? 0.85 : 0.35,
    source_difficulty_label: label,
  }
}

export function scoreRubric(features: RubricFeatures): number {
  const discovery = 1 - features.solution_path_obviousness
  return clamp01(
    0.12 * features.concept_count +
      0.12 * features.reasoning_steps +
      0.12 * features.transformation_depth +
      0.12 * features.condition_interaction +
      0.08 * features.case_split +
      0.1 * features.representation_switch +
      0.08 * features.trap_density +
      0.08 * features.computation_load +
      0.1 * features.abstraction +
      0.08 * discovery,
  )
}

export function mapRubricLevel(score: number, cuts: readonly number[] = RUBRIC_CUTS): 1 | 2 | 3 | 4 | 5 {
  if (score < cuts[0]) return 1
  if (score < cuts[1]) return 2
  if (score < cuts[2]) return 3
  if (score < cuts[3]) return 4
  return 5
}

export function rubricConfidence(features: RubricFeatures, stemLength: number): number {
  const fired =
    Number(features.concept_count > 0.2) +
    Number(features.reasoning_steps > 0.2) +
    Number(features.transformation_depth > 0.3) +
    Number(features.condition_interaction > 0.2) +
    Number(features.representation_switch > 0.3)
  if (stemLength < 12) return 0.28
  if (fired <= 1 && stemLength < 80) return 0.58
  if (fired >= 3) return 0.84
  return 0.72
}

export function estimateRubricDifficulty(input: {
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
  table_hint?: boolean
  cuts?: readonly number[]
}): RubricEstimate {
  const features = extractRubricFeatures(input)
  const difficulty_score = Number(scoreRubric(features).toFixed(3))
  const difficulty_level = mapRubricLevel(difficulty_score, input.cuts ?? RUBRIC_CUTS)
  const difficulty_confidence = rubricConfidence(features, input.stem.length)
  const difficulty_evidence = [
    `concept_count=${features.concept_count.toFixed(2)}`,
    `reasoning_steps=${features.reasoning_steps.toFixed(2)}`,
    `transformation_depth=${features.transformation_depth.toFixed(2)}`,
    `condition_interaction=${features.condition_interaction.toFixed(2)}`,
  ]
  if (features.source_difficulty_label) difficulty_evidence.push(`publisher_label=${features.source_difficulty_label}`)
  return {
    difficulty_score,
    difficulty_level,
    difficulty_confidence,
    features,
    difficulty_evidence,
    source_difficulty_label: features.source_difficulty_label,
    note: 'HYPER rubric v1. Publisher badge is evidence only and is not in the score. Level 3 is a mid-complexity band, not a forced quota.',
  }
}

export function step88Level3RootCause(): {
  cause: 'threshold_gap_and_confidence_penalty'
  details: string[]
} {
  return {
    cause: 'threshold_gap_and_confidence_penalty',
    details: [
      'STEP 8.8 mapped scores with percentile cuts [0.25, 0.282, 0.355, 0.518], so level 3 occupied only [0.282, 0.355).',
      'estimateDifficulty set confidence=0.52 whenever raw sat inside that mid band (clustered flag).',
      'difficulty AUTO required confidence >= 0.72, so every true level-3 score became REVIEW.',
      'Histogram counted REVIEW instead of the underlying level, producing difficulty 3 = 0.',
      'Publisher badge had a small weight but was not the main cause. Sample bias (115 vs 265) was secondary.',
    ],
  }
}

export function difficultyHistogram(levels: Array<1 | 2 | 3 | 4 | 5 | null>): Record<string, number> {
  const out: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, REVIEW: 0 }
  for (const level of levels) {
    if (level == null) out.REVIEW += 1
    else out[String(level)] += 1
  }
  return out
}
