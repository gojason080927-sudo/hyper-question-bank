import type { NormalizedBBox } from '../pdf/bbox'
import { PROBLEM_BODY, type SegmentedV31 } from './problemAnchorV2'
import type { LayoutTextBlock } from './segmentationV3'

export const CONTEXT_ROLES = [
  'EXERCISE_PROBLEM',
  'WORKED_EXAMPLE',
  'EXAMPLE_SUBSTEP',
  'THEORY_LIST',
  'DEFINITION_ITEM',
  'SOLUTION_STEP',
  'CHOICE_MARKER',
  'STEP_MARKER',
  'SECTION_NUMBER',
  'PAGE_DECORATION',
  'UNKNOWN',
] as const

export type ContextRole = (typeof CONTEXT_ROLES)[number]

export type RoleResult = {
  role: ContextRole
  score: number
  confidence: number
  evidence: string[]
}

const EXAMPLE_HEAD = /예제|보기|Example|EXAMPLE/
const SOLUTION_HEAD = /(?:^|[^\uAC00-\uD7A3])(풀이|해답|Solution)(?:$|[^\uAC00-\uD7A3])/
const EXPLAIN_HEAD = /(?:^|[●•])설명(?:$|주어진|[:：])/
const ANSWER_HEADER = /정답및풀이|정답\s*및\s*풀이/
const SECTIONISH = /단원|활용-|연산$|정리$|공식$|추정$/
const EQUALS_CHAIN = /(=|∴|이므로|따라서).{0,40}(=|∴)/

export function isAnswerKeyHeader(text: string): boolean {
  return ANSWER_HEADER.test(text.replace(/\s+/g, ''))
}

export function layoutFigureReference(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  return /오른쪽그림|다음그림|아래그림|그림과같이|그림을보고|다음표를보고/.test(compact)
}

export function mathGraphMention(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (layoutFigureReference(compact)) return false
  return /그래프의|의그래프|그래프가|그래프를|그래프와/.test(compact)
}

export function sharedFigureCue(text: string): boolean {
  return /다음\s*그림을?\s*보고|아래\s*그림을?\s*보고|그림을?\s*보고\s*\d+\s*[~～-]\s*\d/.test(text)
}

export function detectExerciseRegions(problems: SegmentedV31[]): Array<{ start_y: number; end_y: number; count: number }> {
  const sorted = [...problems].sort((a, b) => a.bbox.y - b.bbox.y)
  const regions: Array<{ start_y: number; end_y: number; count: number }> = []
  let cluster: SegmentedV31[] = []
  const flush = () => {
    if (cluster.length >= 2) {
      regions.push({
        start_y: cluster[0].bbox.y,
        end_y: cluster[cluster.length - 1].bbox.y + cluster[cluster.length - 1].bbox.height,
        count: cluster.length,
      })
    }
    cluster = []
  }
  for (const row of sorted) {
    const prev = cluster[cluster.length - 1]
    const sequential =
      prev &&
      Math.abs(Number(row.display_number) - Number(prev.display_number)) <= 2 &&
      Math.abs(row.bbox.x - prev.bbox.x) < 0.08
    if (!prev || sequential) cluster.push(row)
    else {
      flush()
      cluster.push(row)
    }
  }
  flush()
  return regions
}

export function inExerciseRegion(
  y: number,
  regions: Array<{ start_y: number; end_y: number; count: number }>,
): boolean {
  return regions.some((row) => y >= row.start_y - 0.02 && y <= row.end_y + 0.02 && row.count >= 2)
}

export function classifyContextRole(input: {
  display_number: string
  body: string
  until_next: string
  bbox: NormalizedBBox
  page_blocks: LayoutTextBlock[]
  in_exercise_region: boolean
  sequence_hit: boolean
  style_length: number
  header_or_footer: boolean
  circled: boolean
  step: boolean
}): RoleResult {
  const evidence: string[] = []
  const body = input.body.replace(/\s+/g, '')
  const until = input.until_next.replace(/\s+/g, '')
  const nearby = input.page_blocks.filter(
    (block) => Math.abs(block.bbox.y - input.bbox.y) < 0.08 && Math.abs(block.bbox.x - input.bbox.x) < 0.25,
  )
  const nearbyText = nearby.map((block) => block.content ?? '').join('')

  if (input.header_or_footer) {
    return { role: 'PAGE_DECORATION', score: 0.2, confidence: 0.9, evidence: ['header_or_footer'] }
  }
  if (input.step) return { role: 'STEP_MARKER', score: 0.15, confidence: 0.92, evidence: ['step_token'] }
  if (input.circled) return { role: 'CHOICE_MARKER', score: 0.15, confidence: 0.9, evidence: ['circled_choice'] }

  const exampleNear = EXAMPLE_HEAD.test(nearbyText) || EXAMPLE_HEAD.test(body.slice(0, 12))
  const solutionNear = SOLUTION_HEAD.test(until) && !isAnswerKeyHeader(until)
  const explainNear = EXPLAIN_HEAD.test(until)
  const derivation = EQUALS_CHAIN.test(until)
  const instruction = PROBLEM_BODY.test(until) || PROBLEM_BODY.test(body)
  const localSolutionHeading = input.page_blocks.some((block) => {
    const text = (block.content ?? '').replace(/\s+/g, '')
    if (isAnswerKeyHeader(text)) return false
    if (block.bbox.y < input.bbox.y - 0.01 || block.bbox.y > input.bbox.y + input.bbox.height) return false
    if (block.bbox.x > 0.55) return false
    return /^(풀이|설명|해답)/.test(text) || SOLUTION_HEAD.test(text)
  })

  let exercise = 0
  let example = 0
  let theory = 0
  let solution = 0
  if (input.in_exercise_region) {
    exercise += 0.28
    evidence.push('exercise_region')
  }
  if (input.sequence_hit) {
    exercise += 0.18
    evidence.push('peer_sequence')
  }
  if (instruction) {
    exercise += 0.22
    evidence.push('instruction_syntax')
  }
  if (/[①②③④⑤]/.test(until)) {
    exercise += 0.12
    evidence.push('choice_group')
  }
  if (exampleNear) {
    example += 0.34
    evidence.push('example_heading_nearby')
  }
  if (explainNear || localSolutionHeading) {
    example += 0.22
    evidence.push('worked_explain_or_solution_heading')
  }
  if (localSolutionHeading) {
    example += 0.5
    evidence.push('in_worked_solution_container')
  }
  if (solutionNear && derivation) {
    example += 0.18
    solution += 0.2
    evidence.push('derivation_after_solution_head')
  }
  if (SECTIONISH.test(body) && !instruction && input.style_length <= 2) {
    theory += 0.35
    evidence.push('section_title_pattern')
  }
  if (/항:|정의|용어/.test(body) && !instruction) {
    theory += 0.4
    evidence.push('definition_item')
  }
  if (input.style_length === 1 && !instruction && !input.in_exercise_region) {
    solution += 0.25
    evidence.push('single_digit_outside_exercise')
  }

  const scores: Array<{ role: ContextRole; score: number }> = [
    { role: 'EXERCISE_PROBLEM', score: exercise },
    { role: 'WORKED_EXAMPLE', score: example },
    { role: 'THEORY_LIST', score: theory },
    { role: 'SOLUTION_STEP', score: solution },
  ]
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const second = scores[1]
  if (best.score < 0.28) {
    return { role: 'UNKNOWN', score: best.score, confidence: 0.35, evidence: [...evidence, 'low_role_score'] }
  }
  if (second && best.score - second.score < 0.08) {
    return { role: 'UNKNOWN', score: best.score, confidence: 0.4, evidence: [...evidence, 'role_tie'] }
  }
  const confidence = Math.min(0.95, 0.45 + best.score)
  if (best.role === 'WORKED_EXAMPLE' && instruction && input.in_exercise_region && input.sequence_hit && !localSolutionHeading) {
    return { role: 'EXERCISE_PROBLEM', score: exercise, confidence: Math.min(0.9, 0.5 + exercise), evidence: [...evidence, 'exercise_overrides_weak_example'] }
  }
  return { role: best.role, score: best.score, confidence, evidence }
}
