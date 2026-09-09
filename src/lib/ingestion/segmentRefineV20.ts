import type { LayoutTextBlock } from './segmentationV3'
import {
  PROBLEM_BODY,
  answerKeyLike,
  catalogLike,
  segmentProblemsV31,
  type SegmentedV31,
} from './problemAnchorV2'
import {
  classifyContextRole,
  detectExerciseRegions,
  inExerciseRegion,
  isAnswerKeyHeader,
  mathGraphMention,
  type ContextRole,
  type RoleResult,
} from './contextRoleV2'
import { detectFigureCandidates, requiredLayoutFigure, scoreFigureOwnership, type FigureCandidate, type FigureOwner } from './figureOwnershipV2'

export const SEGMENT_REFINE_V20 = 'hqb-segment-refine-v20'
export const AUTO_SCORE_MIN_V20 = 0.78

export type RefinedProblem = SegmentedV31 & {
  role: ContextRole
  role_confidence: number
  role_evidence: string[]
  identity_v3: number
  identity_evidence: string[]
  figures: FigureCandidate[]
  figure_owner: FigureOwner | null
  cross_page_continuity: boolean
}

export type RefinedPage = {
  engine: typeof SEGMENT_REFINE_V20
  page?: number
  baseline_auto: number
  problems: RefinedProblem[]
  exercise_regions: Array<{ start_y: number; end_y: number; count: number }>
  figures: FigureCandidate[]
}

export function bodyAttachmentV2(input: {
  body: string
  following: string
  next_block?: LayoutTextBlock | null
  bbox_y: number
}): { attached: boolean; evidence: string[]; ambiguous: boolean } {
  const evidence: string[] = []
  const compact = (input.body + input.following).replace(/\s+/g, '')
  if (PROBLEM_BODY.test(compact)) {
    evidence.push('instruction')
    return { attached: true, evidence, ambiguous: false }
  }
  if (compact.length >= 8 && /[=^\\]|[\uAC00-\uD7A3]{4}/.test(compact)) {
    evidence.push('inline_stem')
    return { attached: true, evidence, ambiguous: false }
  }
  const next = input.next_block
  if (next && next.bbox.y - input.bbox_y < 0.05 && next.bbox.x - 0.02 <= 0.36) {
    const nextText = (next.content ?? '').replace(/\s+/g, '')
    if (nextText.length >= 6) {
      evidence.push('vertical_continuation')
      return { attached: true, evidence, ambiguous: false }
    }
  }
  if (compact.length > 0 && compact.length < 4) return { attached: false, evidence: ['too_short'], ambiguous: true }
  return { attached: compact.length >= 4, evidence: ['weak_rest'], ambiguous: compact.length < 8 }
}

export function identityV3(input: {
  display_number: string
  role: RoleResult
  sequence_hit: boolean
  in_exercise_region: boolean
  body_attached: boolean
  column_ok: boolean
  cross_page: boolean
  ambiguous_glue: boolean
}): { score: number; evidence: string[] } {
  const evidence: string[] = [`display_${input.display_number}`]
  let score = 0.22
  if (!input.ambiguous_glue) score += 0.08
  else evidence.push('ambiguous_display')
  if (input.sequence_hit) {
    score += 0.14
    evidence.push('sequence')
  }
  if (input.in_exercise_region) {
    score += 0.14
    evidence.push('exercise_region')
  }
  if (input.body_attached) {
    score += 0.14
    evidence.push('body')
  }
  if (input.column_ok) score += 0.06
  if (input.role.role === 'EXERCISE_PROBLEM') {
    score += 0.16
    evidence.push('role_exercise')
  }
  if (input.cross_page) {
    score += 0.08
    evidence.push('cross_page_continuity')
  }
  if (input.role.role === 'UNKNOWN') score -= 0.2
  if (input.role.role === 'WORKED_EXAMPLE' || input.role.role === 'SOLUTION_STEP') score -= 0.18
  return { score: Math.max(0, Math.min(1, score)), evidence }
}

function denseIndexCatalog(blocks: LayoutTextBlock[]): boolean {
  const titles = blocks
    .filter((block) => {
      const compact = (block.content ?? '').replace(/\s+/g, '')
      return /^\d{2,4}[\uAC00]/.test(compact)
    })
    .sort((a, b) => a.bbox.y - b.bbox.y)
  const unique = new Set(
    blocks
      .map((block) => (block.content ?? '').replace(/\s+/g, '').match(/^(\d{3,4})/)?.[1])
      .filter((row): row is string => Boolean(row)),
  )
  if (unique.size >= 12) return true
  if (unique.size >= 8 && titles.length >= 5) {
    const gaps: number[] = []
    for (let i = 1; i < titles.length; i += 1) gaps.push(titles[i].bbox.y - titles[i - 1].bbox.y)
    if (gaps.length && [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] < 0.12) return true
  }
  if (titles.length < 10) return false
  const gaps: number[] = []
  for (let i = 1; i < titles.length; i += 1) gaps.push(titles[i].bbox.y - titles[i - 1].bbox.y)
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  return median < 0.085
}

export function refineSegmentationV20(
  blocks: LayoutTextBlock[],
  options: { page?: number; auto_score_min?: number; previous_page_last?: number | null } = {},
): RefinedPage {
  const autoMin = options.auto_score_min ?? AUTO_SCORE_MIN_V20
  const baseline = segmentProblemsV31(blocks, { page: options.page, auto_score_min: autoMin })
  const regions = detectExerciseRegions(baseline.problems)
  const figures = detectFigureCandidates(blocks)
  const pageText = blocks.map((block) => block.content ?? '').join('\n')
  const values = baseline.problems.map((row) => Number(row.display_number)).filter((n) => Number.isFinite(n))

  const catalog = catalogLike(blocks)
  const keyLike = answerKeyLike(blocks)
  const problems: RefinedProblem[] = baseline.problems.map((problem, index) => {
    const next = baseline.problems[index + 1]
    const until = blocks
      .filter((block) => block.bbox.y >= problem.bbox.y - 0.002 && (!next || block.bbox.y < next.bbox.y - 0.002))
      .map((block) => block.content ?? '')
      .join('')
    const sequenceHit = values.some((n) => n !== Number(problem.display_number) && Math.abs(n - Number(problem.display_number)) === 1)
    const exercise = inExerciseRegion(problem.bbox.y, regions)
    const role = classifyContextRole({
      display_number: problem.display_number,
      body: problem.body_preview,
      until_next: until,
      bbox: problem.bbox,
      page_blocks: blocks,
      in_exercise_region: exercise,
      sequence_hit: sequenceHit,
      style_length: problem.display_number.length,
      header_or_footer: problem.column === 'HEADER' || problem.column === 'FOOTER',
      circled: /[①②③④⑤]/.test(problem.display_number),
      step: /^STEP$/i.test(problem.display_number),
    })
    const nextBlock = blocks.find((block) => block.bbox.y > problem.bbox.y + 0.002)
    const body = bodyAttachmentV2({
      body: problem.body_preview,
      following: until,
      next_block: nextBlock,
      bbox_y: problem.bbox.y,
    })
    const crossPage =
      options.previous_page_last != null &&
      Number.isFinite(Number(problem.display_number)) &&
      Number(problem.display_number) === options.previous_page_last + 1 &&
      index === 0
    const identity = identityV3({
      display_number: problem.display_number,
      role,
      sequence_hit: sequenceHit,
      in_exercise_region: exercise,
      body_attached: body.attached,
      column_ok: problem.column === 'MAIN_COLUMN_1' || problem.column === 'MAIN_COLUMN_2',
      cross_page: Boolean(crossPage),
      ambiguous_glue: problem.ambiguous_glue,
    })
    const ownersByFigure = figures.map((figure) => ({
      figure,
      owner: scoreFigureOwnership({ figure, problems: baseline.problems, page_text: pageText }),
    }))
    const mineEntry = ownersByFigure.find((row) => row.owner.owner_candidate === problem.display_number)
    const mine = mineEntry?.owner ?? null
    const relatedFigures = ownersByFigure.filter((row) => row.owner.owner_candidate === problem.display_number).map((row) => row.figure)
    const layoutFig = requiredLayoutFigure(until) || requiredLayoutFigure(problem.body_preview)
    const mathOnly = mathGraphMention(until) && !layoutFig
    const headerSolution = blocks.some((block) => isAnswerKeyHeader(block.content ?? '') && (block.bbox.y < 0.1 || block.bbox.x > 0.65))
    const blockers = problem.auto_blockers.filter((row) => {
      if (row === 'score_below_auto' && identity.score >= autoMin && role.role === 'EXERCISE_PROBLEM' && role.confidence >= 0.62) {
        return false
      }
      if (row === 'worked_example_mix') {
        if (headerSolution && !/^(풀이|설명)/.test(problem.body_preview.replace(/\s+/g, ''))) return false
        if (role.role === 'EXERCISE_PROBLEM' && role.confidence >= 0.7 && exercise) return false
        return true
      }
      if (row === 'figure_unresolved') {
        if (mathOnly && !layoutFig) return false
        if (mine?.auto_associate) return false
        return layoutFig || Boolean(mine && (mine.ambiguous || mine.boundary_risk || mine.neighbor_intrusion))
      }
      if (row === 'body_not_attached' && body.attached && !body.ambiguous) return false
      return true
    })
    if (role.role !== 'EXERCISE_PROBLEM' || role.confidence < 0.55) blockers.push('role_not_exercise')
    if (role.role === 'UNKNOWN') blockers.push('role_unknown')
    if (layoutFig && (!mine || !mine.auto_associate)) {
      if (!blockers.includes('figure_unresolved')) blockers.push('figure_unresolved')
    }
    if (mine?.ambiguous) blockers.push('figure_owner_ambiguous')
    if (mine?.neighbor_intrusion) blockers.push('neighbor_figure_intrusion')
    if (mine?.boundary_risk) blockers.push('figure_boundary_risk')
    if (identity.score < autoMin && !blockers.includes('score_below_auto')) blockers.push('identity_v3_below_auto')
    if (problem.display_number.length === 1) blockers.push('single_digit_untrusted_auto')
    if (catalog || denseIndexCatalog(blocks)) blockers.push('catalog_page')
    if (keyLike) blockers.push('answer_key_page')
    const home = regions.find((row) => problem.bbox.y >= row.start_y - 0.02 && problem.bbox.y <= row.end_y + 0.02)
    if (!problem.auto_safe && home && home.start_y > 0.78) blockers.push('late_page_index_cluster')
    let unique = [...new Set(blockers)]
    const keepPriorAuto = problem.auto_safe && role.role === 'EXERCISE_PROBLEM' && role.confidence >= 0.55
    if (keepPriorAuto) {
      unique = unique.filter((row) => !['identity_v3_below_auto'].includes(row))
    }
    const auto_safe =
      unique.length === 0 &&
      (keepPriorAuto || (role.role === 'EXERCISE_PROBLEM' && role.confidence >= 0.55 && identity.score >= autoMin))
    return {
      ...problem,
      body_attached: body.attached,
      role: role.role,
      role_confidence: role.confidence,
      role_evidence: role.evidence,
      identity_v3: identity.score,
      identity_evidence: identity.evidence,
      figures: relatedFigures,
      figure_owner: mine,
      cross_page_continuity: Boolean(crossPage),
      auto_blockers: unique,
      auto_safe,
    }
  })

  return {
    engine: SEGMENT_REFINE_V20,
    page: options.page,
    baseline_auto: baseline.problems.filter((row) => row.auto_safe).length,
    problems,
    exercise_regions: regions,
    figures,
  }
}

export function lastDisplayNumber(problems: RefinedProblem[]): number | null {
  const last = [...problems].reverse().find((row) => row.role === 'EXERCISE_PROBLEM' && Number.isFinite(Number(row.display_number)))
  if (!last) return null
  const n = Number(last.display_number)
  return Number.isFinite(n) ? n : null
}
