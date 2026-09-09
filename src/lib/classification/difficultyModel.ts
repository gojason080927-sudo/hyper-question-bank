export type DifficultyFeatureVector = {
  step_estimate: number
  concept_combo: number
  expression_density: number
  condition_count: number
  choice_structure: number
  calculation_load: number
  reasoning_depth: number
  figure_or_graph: number
  trap_hint: number
  constructed_response: number
  book_marker: number | null
}

export type DifficultyEstimate = {
  score: 1 | 2 | 3 | 4 | 5
  raw: number
  confidence: number
  features: DifficultyFeatureVector
  book_marker: string | null
  note: string
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function extractDifficultyFeatures(input: {
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
}): DifficultyFeatureVector {
  const stem = input.stem
  const conditions = (stem.match(/\(가\)|\(나\)|\(다\)|단,/g) ?? []).length
  const combinedTypes = /유형\s*\d+\s*\+|쪽\s*유형/.test(stem) ? 1 : 0
  const long = stem.length > 420 ? 1 : stem.length > 220 ? 0.5 : 0.15
  const math = Math.min(1, input.math_count / 8)
  return {
    step_estimate: combinedTypes ? 0.75 : conditions >= 2 ? 0.7 : long,
    concept_combo: combinedTypes ? 0.85 : /그리고|또한|이때/.test(stem) ? 0.45 : 0.2,
    expression_density: math,
    condition_count: Math.min(1, conditions / 3),
    choice_structure: input.choice_count >= 5 ? 0.35 : input.choice_count > 0 ? 0.25 : 0.55,
    calculation_load: /전개|인수분해|제곱|나눗셈|나머지/.test(stem) ? 0.55 : 0.3,
    reasoning_depth: /\(가\)|\(나\)|증명|설명/.test(stem) ? 0.7 : 0.3,
    figure_or_graph: input.figure_hint || input.graph_hint || /그림|그래프/.test(stem) ? 0.8 : 0.1,
    trap_hint: /단,|옳지\s*않은|항상/.test(stem) ? 0.55 : 0.2,
    constructed_response: input.choice_count === 0 ? 0.65 : 0.2,
    book_marker: /고난도|실력/.test(stem) ? 0.9 : /대표\s*문제/.test(stem) ? 0.55 : null,
  }
}

export function scoreDifficulty(features: DifficultyFeatureVector): number {
  const book = features.book_marker ?? 0.4
  return clamp01(
    0.16 * features.step_estimate +
      0.14 * features.concept_combo +
      0.1 * features.expression_density +
      0.1 * features.condition_count +
      0.08 * features.choice_structure +
      0.1 * features.calculation_load +
      0.1 * features.reasoning_depth +
      0.1 * features.figure_or_graph +
      0.06 * features.trap_hint +
      0.06 * features.constructed_response +
      0.1 * book * 0.5,
  )
}

export function mapDifficultyScore(raw: number, cuts: [number, number, number, number]): 1 | 2 | 3 | 4 | 5 {
  if (raw < cuts[0]) return 1
  if (raw < cuts[1]) return 2
  if (raw < cuts[2]) return 3
  if (raw < cuts[3]) return 4
  return 5
}

export function calibrateCuts(rawScores: number[]): [number, number, number, number] {
  if (rawScores.length < 10) return [0.22, 0.36, 0.5, 0.66]
  const sorted = [...rawScores].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]
  const cuts: [number, number, number, number] = [at(0.18), at(0.38), at(0.62), at(0.82)]
  if (cuts[0] === cuts[3]) return [0.22, 0.36, 0.5, 0.66]
  return cuts
}

export function estimateDifficulty(input: {
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
  cuts?: [number, number, number, number]
}): DifficultyEstimate {
  const features = extractDifficultyFeatures(input)
  const raw = scoreDifficulty(features)
  const cuts = input.cuts ?? [0.22, 0.36, 0.5, 0.66]
  const score = mapDifficultyScore(raw, cuts)
  const marker = /고난도|실력/.exec(input.stem)?.[0] ?? (/대표\s*문제/.test(input.stem) ? '대표 문제' : null)
  const clustered = raw > cuts[1] && raw < cuts[2]
  return {
    score,
    raw: Number(raw.toFixed(3)),
    confidence: clustered ? 0.52 : 0.74,
    features,
    book_marker: marker,
    note: '정답률 없음. 추정 feature 점수이며 체감 난이도가 아니다. 교재 marker는 evidence일 뿐 HYPER 난이도와 동일시하지 않는다.',
  }
}

export function difficultyHistogram(scores: Array<1 | 2 | 3 | 4 | 5 | null>): Record<string, number> {
  const out: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, REVIEW: 0 }
  for (const score of scores) {
    if (score == null) out.REVIEW += 1
    else out[String(score)] += 1
  }
  return out
}

export function difficultyCollapsed(hist: Record<string, number>, total: number): boolean {
  if (total < 1) return true
  return [1, 2, 3, 4, 5].some((grade) => (hist[String(grade)] ?? 0) / total >= 0.55)
}
