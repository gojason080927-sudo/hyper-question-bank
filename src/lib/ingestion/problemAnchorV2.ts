import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { detectPageRegions, regionOfPoint, sidebarOwnership, type PageLayoutClass, type PageRegionMap } from './pageRegionV2'
import {
  buildBoundaryEvidence,
  choiceGroupValid,
  classifyNeighborIntrusion,
  neighborBlocksAutoSafe,
  type LayoutTextBlock,
  type NeighborIntrusionKind,
  type ProblemBoundaryEvidence,
} from './segmentationV3'

export const ANCHOR_ENGINE = 'hqb-problem-anchor-v2'
export const ANCHOR_ENGINE_VERSION = '0.2.0'
export const SEGMENT_V31_VERSION = '0.3.1'

export type NumberStyle =
  | '1_DIGIT'
  | '2_DIGIT'
  | '3_DIGIT'
  | '4_DIGIT'
  | 'CIRCLED'
  | 'NUMBER_PUNCT'
  | 'BOXED'
  | 'PAREN'
  | 'VISUAL_MARKER'

export type AnchorClass =
  | 'PROBLEM_ANCHOR'
  | 'THEORY_LIST'
  | 'CHOICE_MARKER'
  | 'STEP_MARKER'
  | 'PAGE_DECORATION'
  | 'UNKNOWN'

export type EvidenceCell = { value: number | boolean | string; confidence: number; reason: string }

export type DisplayParse = {
  display_number: string | null
  numeric_value: number | null
  style: NumberStyle | null
  rest: string
  glued: boolean
  ambiguous: boolean
  reason: string
}

export type ScoredAnchor = {
  display_number: string
  numeric_value: number | null
  style: NumberStyle
  anchor_class: AnchorClass
  bbox: NormalizedBBox
  preview: string
  body_preview: string
  glued: boolean
  ambiguous_glue: boolean
  score: number
  evidence: Record<string, EvidenceCell>
  block_index: number
  region: ReturnType<typeof regionOfPoint>
}

export type SegmentedV31 = {
  display_number: string
  problem_identity: { page?: number; display_number: string }
  bbox: NormalizedBBox
  column: ReturnType<typeof regionOfPoint>
  layout_class: PageLayoutClass
  anchor_class: AnchorClass
  identity_confidence: number
  boundary: ProblemBoundaryEvidence
  boundary_confidence: number
  body_attached: boolean
  body_preview: string
  ambiguous_glue: boolean
  neighbor: NeighborIntrusionKind
  choice_complete: boolean | null
  figure_complete: boolean | null
  sidebar_ownership_uncertain: boolean
  auto_safe: boolean
  auto_blockers: string[]
  next_anchor_class: AnchorClass | null
}

export const PROBLEM_BODY =
  /구하시오|구하여라|구하라|값은\?|값은\b|고르시오|다음 중|다음중|서술하시오|증명하시오|말하시오|만족시키|고르면/
export const THEORY_HEAD =
  /용어|정의|정리|성질|개념|주의|보기|예제|풀이|설명|항:|상수항|동류항|내림차순|오름차순/
export const STEP_HEAD = /^(?:STEP|Step)\s*\d/i
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'
const LIST_MARK = /[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽㈎㈏㈐]/
const HANGUL_OR_STEM = /^[\uAC00-\uD7A3A-Za-z($\\]/

function clampBox(bbox: NormalizedBBox): NormalizedBBox {
  const x = Math.min(0.98, Math.max(0, bbox.x))
  const y = Math.min(0.98, Math.max(0, bbox.y))
  return validateBBox({
    x,
    y,
    width: Math.min(1 - x, Math.max(0.002, bbox.width)),
    height: Math.min(1 - y, Math.max(0.002, bbox.height)),
    unit: 'normalized',
    origin: bbox.origin,
  })
}

function digitStyle(n: number): NumberStyle {
  if (n === 1) return '1_DIGIT'
  if (n === 2) return '2_DIGIT'
  if (n === 3) return '3_DIGIT'
  return '4_DIGIT'
}

export function parseGluedDisplayNumber(raw: string): DisplayParse {
  const text = (raw ?? '').replace(/\s+/g, '')
  if (!text) return { display_number: null, numeric_value: null, style: null, rest: '', glued: false, ambiguous: false, reason: 'empty' }
  if (STEP_HEAD.test(text)) {
    return { display_number: null, numeric_value: null, style: 'VISUAL_MARKER', rest: text, glued: false, ambiguous: false, reason: 'step_marker' }
  }
  const circled = text.match(new RegExp(`^[${CIRCLED}]`))
  if (circled) {
    return {
      display_number: circled[0],
      numeric_value: CIRCLED.indexOf(circled[0]) + 1,
      style: 'CIRCLED',
      rest: text.slice(1),
      glued: text.length > 1,
      ambiguous: false,
      reason: 'circled_token',
    }
  }
  const boxed = text.match(/^\[(\d{1,4})\]/)
  if (boxed) {
    return {
      display_number: boxed[1],
      numeric_value: Number(boxed[1]),
      style: 'BOXED',
      rest: text.slice(boxed[0].length),
      glued: text.length > boxed[0].length,
      ambiguous: false,
      reason: 'boxed_number',
    }
  }
  const paren = text.match(/^\((\d{1,2})\)/)
  if (paren) {
    return {
      display_number: paren[1],
      numeric_value: Number(paren[1]),
      style: 'PAREN',
      rest: text.slice(paren[0].length),
      glued: text.length > paren[0].length,
      ambiguous: false,
      reason: 'paren_list_or_choice',
    }
  }
  const punct = text.match(/^(\d{1,4})[.)]/)
  if (punct) {
    return {
      display_number: punct[1],
      numeric_value: Number(punct[1]),
      style: 'NUMBER_PUNCT',
      rest: text.slice(punct[0].length),
      glued: text.length > punct[0].length,
      ambiguous: false,
      reason: 'number_punctuation',
    }
  }
  const digits = text.match(/^(\d{1,4})/)
  if (!digits) {
    return { display_number: null, numeric_value: null, style: null, rest: text, glued: false, ambiguous: false, reason: 'no_leading_number' }
  }
  const run = digits[1]
  const rest = text.slice(run.length)
  const glued = rest.length > 0 && HANGUL_OR_STEM.test(rest)
  if (/^\d/.test(rest)) {
    return {
      display_number: run,
      numeric_value: Number(run),
      style: digitStyle(run.length),
      rest,
      glued: true,
      ambiguous: true,
      reason: 'digit_run_continues',
    }
  }
  return {
    display_number: run,
    numeric_value: Number(run),
    style: digitStyle(run.length),
    rest,
    glued,
    ambiguous: false,
    reason: glued ? 'glued_number_plus_stem' : 'plain_leading_digits',
  }
}

export function resolveAmbiguousDigits(input: {
  run: string
  rest: string
  sequence: number[]
}): DisplayParse {
  const run = input.run
  const options: Array<{ n: string; rest: string }> = []
  for (let len = 1; len <= run.length; len += 1) {
    options.push({ n: run.slice(0, len), rest: run.slice(len) + input.rest })
  }
  const fits = options.filter((row) => {
    const value = Number(row.n)
    return input.sequence.some((n) => Math.abs(n - value) === 1)
  })
  if (fits.length === 1 && (!/^\d/.test(fits[0].rest) || /^\d[\uAC00-\uD7A3]/.test(fits[0].rest))) {
    return {
      display_number: fits[0].n,
      numeric_value: Number(fits[0].n),
      style: digitStyle(fits[0].n.length),
      rest: fits[0].rest,
      glued: fits[0].rest.length > 0,
      ambiguous: false,
      reason: 'sequence_resolved_glue',
    }
  }
  if (fits.length !== 1) {
    return {
      display_number: run,
      numeric_value: Number(run),
      style: digitStyle(run.length),
      rest: input.rest,
      glued: true,
      ambiguous: true,
      reason: 'ambiguous_glued_digits',
    }
  }
  return {
    display_number: fits[0].n,
    numeric_value: Number(fits[0].n),
    style: digitStyle(fits[0].n.length),
    rest: fits[0].rest,
    glued: true,
    ambiguous: true,
    reason: 'sequence_fit_but_rest_still_digits',
  }
}

function bodyLooksLikeStem(rest: string, following: string, style?: NumberStyle | null): boolean {
  const blob = `${rest} ${following}`
  if (PROBLEM_BODY.test(blob)) return true
  if (style === '4_DIGIT' && rest.replace(/[|\s#]/g, '').length >= 4) return true
  if (/[=^\\]|frac|sqrt|\d+x/.test(blob) && blob.replace(/\s+/g, '').length >= 8) return true
  if (new RegExp(`[${CIRCLED}]`).test(blob)) return true
  return HANGUL_OR_STEM.test(rest) && rest.length >= 4 && !THEORY_HEAD.test(rest.slice(0, 12))
}

function theoryContext(rest: string, following: string, pageText: string): boolean {
  const blob = `${rest} ${following}`
  if (LIST_MARK.test(blob) && !PROBLEM_BODY.test(blob)) return true
  if (THEORY_HEAD.test(rest) && !PROBLEM_BODY.test(blob)) return true
  if (/보기|예제|정의|정리/.test(pageText.slice(0, 400)) && rest.length < 18 && !PROBLEM_BODY.test(blob)) return true
  return false
}

export function scoreNumberToken(input: {
  parse: DisplayParse
  bbox: NormalizedBBox
  following: string
  pageText: string
  region: ReturnType<typeof regionOfPoint>
  alignedNeighbors: number
  sequenceHit: boolean
}): ScoredAnchor | null {
  const parse = input.parse
  if (!parse.display_number || parse.style == null) return null
  const rest = parse.rest
  const ev: Record<string, EvidenceCell> = {}
  const leftish = input.bbox.x >= 0.05 && input.bbox.x <= 0.36
  ev.POSITION = { value: leftish, confidence: leftish ? 0.8 : 0.35, reason: leftish ? 'left_of_main_band' : 'not_left_aligned' }
  ev.TEXT_FLOW = { value: true, confidence: 0.7, reason: 'token_starts_block' }
  const attached = bodyLooksLikeStem(rest, input.following, parse.style)
  ev.BODY_ATTACHMENT = { value: attached, confidence: attached ? 0.86 : 0.3, reason: attached ? 'stem_or_instruction' : 'no_stem' }
  ev.VERTICAL_SEQUENCE = {
    value: input.sequenceHit,
    confidence: input.sequenceHit ? 0.84 : 0.4,
    reason: input.sequenceHit ? 'neighbor_plus_minus_one' : 'sequence_absent_not_disqualifying',
  }
  ev.HORIZONTAL_ALIGNMENT = {
    value: input.alignedNeighbors,
    confidence: input.alignedNeighbors >= 2 ? 0.8 : 0.4,
    reason: 'same_x_band_count',
  }
  ev.WHITESPACE_BEFORE = { value: input.bbox.y > 0.08, confidence: 0.5, reason: 'below_header' }
  ev.WHITESPACE_AFTER = { value: rest.length > 0, confidence: 0.5, reason: rest.length ? 'inline_rest' : 'empty_rest' }
  ev.FONT_OR_VISUAL_EMPHASIS = { value: input.bbox.height >= 0.012, confidence: 0.35, reason: 'bbox_height_only_no_font' }
  ev.NEIGHBOR_ANCHOR_PATTERN = {
    value: input.alignedNeighbors >= 2 && input.sequenceHit,
    confidence: input.alignedNeighbors >= 2 ? 0.75 : 0.35,
    reason: 'left_index_cluster',
  }
  const isChoice = parse.style === 'CIRCLED' || (parse.style === 'PAREN' && new RegExp(`[${CIRCLED}]`).test(input.following))
  ev.CHOICE_RELATION = { value: isChoice, confidence: isChoice ? 0.9 : 0.4, reason: isChoice ? 'choice_marker' : 'not_choice' }
  ev.MATH_RELATION = { value: /[=^\\]|x\^/.test(rest + input.following), confidence: 0.6, reason: 'math_in_body' }
  ev.FIGURE_RELATION = { value: /그림|그래프|도형|표/.test(rest + input.following), confidence: 0.55, reason: 'figure_word' }
  ev.COLUMN_MEMBERSHIP = {
    value: input.region === 'MAIN_COLUMN_1' || input.region === 'MAIN_COLUMN_2',
    confidence: 0.8,
    reason: input.region,
  }
  const theory = theoryContext(rest, input.following, input.pageText)
  ev.THEORY_CONTEXT = { value: theory, confidence: theory ? 0.82 : 0.4, reason: theory ? 'definition_or_list' : 'not_theory' }
  ev.SIDEBAR_CONTEXT = {
    value: input.region === 'SIDEBAR',
    confidence: input.region === 'SIDEBAR' ? 0.85 : 0.5,
    reason: input.region === 'SIDEBAR' ? 'inside_rail' : 'not_rail',
  }

  let score = 0.15
  if (leftish) score += 0.12
  if (attached) score += 0.18
  if (input.sequenceHit) score += 0.14
  if (input.alignedNeighbors >= 2) score += 0.08
  if (input.region === 'MAIN_COLUMN_1' || input.region === 'MAIN_COLUMN_2') score += 0.08
  if (/[=^\\]/.test(rest + input.following)) score += 0.05
  if (isChoice) score -= 0.45
  if (theory) score -= 0.28
  if (input.region === 'SIDEBAR' || input.region === 'HEADER' || input.region === 'FOOTER') score -= 0.3
  if (parse.ambiguous) score -= 0.2
  if (parse.style === 'NUMBER_PUNCT' && rest.length < 8 && theory) score -= 0.15
  score = Math.max(0, Math.min(1, score))

  let anchor_class: AnchorClass = 'UNKNOWN'
  if (STEP_HEAD.test(input.pageText.slice(0, 20)) && parse.reason === 'step_marker') anchor_class = 'STEP_MARKER'
  else if (isChoice) anchor_class = 'CHOICE_MARKER'
  else if (input.region === 'HEADER' || input.region === 'FOOTER') anchor_class = 'PAGE_DECORATION'
  else if (parse.style === 'PAREN' && !PROBLEM_BODY.test(rest + input.following)) anchor_class = 'THEORY_LIST'
  else if (theory && !PROBLEM_BODY.test(rest + input.following)) anchor_class = 'THEORY_LIST'
  else if (
    parse.style === '1_DIGIT' &&
    rest.length < 28 &&
    !PROBLEM_BODY.test(rest + input.following) &&
    !/[=^\\]/.test(rest)
  ) {
    anchor_class = 'THEORY_LIST'
  }
  else if (attached && (leftish || input.sequenceHit) && !isChoice) anchor_class = 'PROBLEM_ANCHOR'
  else if (parse.style === '4_DIGIT' && leftish && attached) anchor_class = 'PROBLEM_ANCHOR'
  else if (score < 0.35) anchor_class = 'UNKNOWN'

  if (parse.display_number.length >= 2 && parse.display_number.startsWith('0') && parse.style !== '4_DIGIT') {
    anchor_class = 'PAGE_DECORATION'
    score = Math.min(score, 0.3)
  }

  return {
    display_number: parse.display_number,
    numeric_value: parse.numeric_value,
    style: parse.style,
    anchor_class,
    bbox: input.bbox,
    preview: rest.slice(0, 48),
    body_preview: rest.slice(0, 80),
    glued: parse.glued,
    ambiguous_glue: parse.ambiguous,
    score,
    evidence: ev,
    block_index: 0,
    region: input.region,
  }
}

function followingText(blocks: LayoutTextBlock[], index: number): string {
  return blocks
    .slice(index, index + 4)
    .map((block) => block.content ?? '')
    .join('')
}

export function catalogLike(blocks: LayoutTextBlock[]): boolean {
  const titles = blocks.filter((block) => {
    const compact = (block.content ?? '').replace(/\s+/g, '')
    return /^\d{2,4}[\uAC00]/.test(compact) && !PROBLEM_BODY.test(block.content ?? '')
  }).length
  const verbs = blocks.filter((block) => PROBLEM_BODY.test(block.content ?? '')).length
  return titles >= 6 && verbs <= 3
}

export function answerKeyLike(blocks: LayoutTextBlock[]): boolean {
  const body = blocks.filter((block) => block.bbox.y > 0.07 && block.bbox.y < 0.93)
  if (body.length < 8) return false
  const verbs = body.filter((block) => PROBLEM_BODY.test(block.content ?? '')).length
  const numeric = body.filter((block) => /^\d{2,}/.test((block.content ?? '').replace(/\s+/g, ''))).length
  return verbs <= 1 && numeric >= 8
}

export function segmentProblemsV31(
  blocks: LayoutTextBlock[],
  options: { auto_score_min?: number; page?: number } = {},
): {
  engine: typeof ANCHOR_ENGINE
  engine_version: typeof ANCHOR_ENGINE_VERSION
  layout_class: PageLayoutClass
  regions: PageRegionMap
  anchors: ScoredAnchor[]
  problems: SegmentedV31[]
} {
  const autoMin = options.auto_score_min ?? 0.72
  const clamped = blocks.map((block) => ({ ...block, bbox: clampBox(block.bbox) }))
  const regions = detectPageRegions(clamped)
  const pageText = clamped.map((block) => block.content ?? '').join('\n')
  const rawParses = clamped.map((block, index) => ({
    index,
    block,
    parse: parseGluedDisplayNumber(block.content ?? ''),
  }))
  const sequenceSeed = rawParses
    .filter((row) => {
      const n = row.parse.numeric_value
      const style = row.parse.style
      if (n == null || style === 'CIRCLED' || style === 'PAREN') return false
      if (row.block.bbox.x > 0.38) return false
      return style === '4_DIGIT' || n >= 10 || row.parse.glued
    })
    .map((row) => row.parse.numeric_value as number)
  const parses = rawParses.map((row) => {
    const compact = (row.block.content ?? '').replace(/\s+/g, '')
    const run = compact.match(/^(\d{3,4})/)
    const nearby = sequenceSeed.filter((n) => n >= 10 && n <= 999)
    if (run && run[1].length === 4 && nearby.length >= 2) {
      return { ...row, parse: resolveAmbiguousDigits({ run: run[1], rest: compact.slice(run[1].length), sequence: nearby }) }
    }
    if (row.parse.ambiguous && run && sequenceSeed.length >= 2) {
      return { ...row, parse: resolveAmbiguousDigits({ run: run[1], rest: row.parse.rest, sequence: sequenceSeed }) }
    }
    return row
  })

  const draft: ScoredAnchor[] = []
  for (const row of parses) {
    const region = regionOfPoint(regions, row.block.bbox.x, row.block.bbox.y)
    const parse = row.parse
    if (parse.reason === 'step_marker' || (parse.style === 'VISUAL_MARKER' && STEP_HEAD.test((row.block.content ?? '').replace(/\s+/g, '')))) {
      draft.push({
        display_number: 'STEP',
        numeric_value: null,
        style: 'VISUAL_MARKER',
        anchor_class: 'STEP_MARKER',
        bbox: row.block.bbox,
        preview: (row.block.content ?? '').slice(0, 24),
        body_preview: '',
        glued: false,
        ambiguous_glue: false,
        score: 0.1,
        evidence: {},
        block_index: row.index,
        region,
      })
      continue
    }
    if (!parse.display_number) continue
    const sameX = parses.filter(
      (other) => other.parse.display_number && Math.abs(other.block.bbox.x - row.block.bbox.x) < 0.05,
    ).length
    const value = parse.numeric_value
    const sequenceHit =
      value != null &&
      sequenceSeed.some((n) => n !== value && Math.abs(n - value) === 1) &&
      parse.style !== 'CIRCLED'
    const scored = scoreNumberToken({
      parse,
      bbox: row.block.bbox,
      following: followingText(clamped, row.index),
      pageText,
      region,
      alignedNeighbors: sameX,
      sequenceHit,
    })
    if (!scored) continue
    scored.block_index = row.index
    draft.push(scored)
  }

  if (answerKeyLike(clamped) || catalogLike(clamped)) {
    for (const row of draft) {
      if (row.anchor_class === 'PROBLEM_ANCHOR' && !PROBLEM_BODY.test(row.body_preview + followingText(clamped, row.block_index))) {
        row.anchor_class = 'PAGE_DECORATION'
        row.score = Math.min(row.score, 0.25)
      }
    }
  }

  const problemsAnchors = draft
    .filter((row) => row.anchor_class === 'PROBLEM_ANCHOR')
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)

  const problemBoxes = problemsAnchors.map((row) => ({ display_number: row.display_number, bbox: row.bbox }))
  const sideOwn = regions.sidebar ? sidebarOwnership({ sidebar: regions.sidebar, problem_boxes: problemBoxes }) : null
  const keyLike = answerKeyLike(clamped)
  const catalog = catalogLike(clamped)
  const dup = new Map<string, number>()
  for (const row of problemsAnchors) dup.set(row.display_number, (dup.get(row.display_number) ?? 0) + 1)

  const problems: SegmentedV31[] = problemsAnchors.map((anchor, index) => {
    const next = problemsAnchors[index + 1]
    const nextClass = next?.anchor_class ?? null
    const mainRight = regions.sidebar ? regions.main.bbox.x + regions.main.bbox.width : Math.min(0.88, anchor.bbox.x + Math.max(anchor.bbox.width, 0.45))
    const top = Math.max(regions.header.bbox.height, anchor.bbox.y - 0.004)
    const rawBottom = next && nextClass === 'PROBLEM_ANCHOR' ? next.bbox.y - 0.006 : regions.footer.bbox.y - 0.01
    const bottom = Math.min(0.93, Math.max(top + 0.04, rawBottom))
    const widthCap = regions.layout_class === 'TWO_COLUMN' ? 0.48 : 0.62
    const width = Math.max(0.28, Math.min(mainRight - Math.max(0.05, anchor.bbox.x - 0.01), widthCap))
    const bbox = validateBBox({
      x: Math.max(0.05, Math.min(0.5, anchor.bbox.x - 0.012)),
      y: top,
      width,
      height: bottom - top,
      unit: 'normalized',
      origin: 'top-left',
    })
    const untilNext = clamped
      .filter((block) => block.bbox.y >= anchor.bbox.y - 0.002 && (!next || block.bbox.y < next.bbox.y - 0.002))
      .map((block) => block.content ?? '')
      .join('')
    const follow = untilNext
    const hasChoices = new RegExp(`[${CIRCLED}]`).test(untilNext)
    const labels = [...(untilNext.match(new RegExp(`[${CIRCLED}]`, 'g')) ?? [])]
    const choice = hasChoices
      ? choiceGroupValid({
          detected_labels: labels,
          expected_count: 5,
          same_column: true,
          in_candidate: true,
          sequential: true,
        })
      : null
    const hasFigure = /그림|그래프|도형/.test(untilNext)
    const fig = hasFigure ? { auto_associate: false } : null
    const neighbor = classifyNeighborIntrusion({
      stem: anchor.body_preview,
      next_problem_number: next?.display_number ?? null,
      next_bbox: next?.bbox ?? null,
      bbox,
      neighbor_body_in_bbox: Boolean(next && next.bbox.y < bbox.y + bbox.height - 0.02 && nextClass === 'PROBLEM_ANCHOR' && bbox.y + bbox.height > next.bbox.y + 0.03),
    })
    const boundary = buildBoundaryEvidence({
      bbox,
      current_number_y: anchor.bbox.y,
      next_number_y: nextClass === 'PROBLEM_ANCHOR' ? next?.bbox.y ?? null : null,
      page_content_end_y: regions.footer.bbox.y,
      choice_complete: choice?.complete ?? false,
      figure_complete: fig ? fig.auto_associate : !hasFigure,
    })
    const boundary_confidence = Math.min(boundary.top_anchor.confidence, boundary.bottom_anchor.confidence)
    const railMerged = Boolean(regions.sidebar && bbox.x + bbox.width > regions.sidebar.bbox.x + 0.03)
    const sidebarUncertain = Boolean(regions.sidebar && (sideOwn?.ambiguous || railMerged))
    const blockers: string[] = []
    if (anchor.anchor_class !== 'PROBLEM_ANCHOR') blockers.push('not_problem_anchor')
    if (anchor.ambiguous_glue) blockers.push('ambiguous_glue')
    if (!bodyLooksLikeStem(anchor.body_preview, follow, anchor.style)) blockers.push('body_not_attached')
    if (anchor.score < autoMin) blockers.push('score_below_auto')
    if (neighborBlocksAutoSafe(neighbor)) blockers.push('neighbor_body')
    if (hasFigure) blockers.push('figure_unresolved')
    if (hasChoices && (!choice || !choice.complete || choice.confidence < 0.78)) blockers.push('choice_incomplete')
    if (railMerged) blockers.push('sidebar_merged_into_bbox')
    if (sidebarUncertain && railMerged) blockers.push('sidebar_ownership')
    if (boundary_confidence < 0.7) blockers.push('boundary_weak')
    if (keyLike) blockers.push('answer_key_page')
    if (catalog) blockers.push('catalog_page')
    if ((dup.get(anchor.display_number) ?? 0) > 1) blockers.push('duplicate_display_number')
    if (anchor.display_number.length === 1) blockers.push('single_digit_untrusted_auto')
    if (/풀이|설명/.test(untilNext)) blockers.push('worked_example_mix')
    const auto_safe = blockers.length === 0
    return {
      display_number: anchor.display_number,
      problem_identity: { page: options.page, display_number: anchor.display_number },
      bbox,
      column: anchor.region,
      layout_class: regions.layout_class,
      anchor_class: anchor.anchor_class,
      identity_confidence: Math.min(anchor.score, nextClass === 'PROBLEM_ANCHOR' || !next ? 0.9 : 0.7),
      boundary,
      boundary_confidence,
      body_attached: bodyLooksLikeStem(anchor.body_preview, follow, anchor.style),
      body_preview: anchor.body_preview,
      ambiguous_glue: anchor.ambiguous_glue,
      neighbor,
      choice_complete: choice ? choice.complete : null,
      figure_complete: hasFigure ? Boolean(fig?.auto_associate) : null,
      sidebar_ownership_uncertain: sidebarUncertain,
      auto_safe,
      auto_blockers: blockers,
      next_anchor_class: nextClass,
    }
  })

  return {
    engine: ANCHOR_ENGINE,
    engine_version: ANCHOR_ENGINE_VERSION,
    layout_class: regions.layout_class,
    regions,
    anchors: draft,
    problems,
  }
}

export function bboxIsNotIdentity(a: { display_number: string; bbox: NormalizedBBox }, b: { display_number: string; bbox: NormalizedBBox }): boolean {
  return a.display_number !== b.display_number
}
