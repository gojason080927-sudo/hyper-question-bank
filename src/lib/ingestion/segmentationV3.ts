import { bboxCenter, bboxCoverage, bboxIoU, expandBBox, validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { CROP_PAD } from '../recognition/problemPipeline'
import { classifyAdjacentIntrusion } from '../recognition/draftPersist'

export const SEGMENT_V3 = 'hqb-page-segment-v3'
export const SEGMENT_V3_VERSION = '0.3.0'

export type ColumnLayoutKind = 'ONE_COLUMN' | 'TWO_COLUMN' | 'MIXED' | 'UNKNOWN'
export type NeighborIntrusionKind =
  | 'NONE'
  | 'NEIGHBOR_HEADER_ONLY'
  | 'NEIGHBOR_BODY_INTRUSION'
  | 'NEIGHBOR_CHOICE_INTRUSION'
  | 'NEIGHBOR_FIGURE_INTRUSION'

export type BoundEvidence = {
  value: number
  confidence: number
  evidence: string[]
}

export type ProblemBoundaryEvidence = {
  top_anchor: BoundEvidence
  bottom_anchor: BoundEvidence
  left_bound: BoundEvidence
  right_bound: BoundEvidence
}

export type FigureOwnership = {
  score: number
  same_column: boolean
  contained: boolean
  crosses_boundary: boolean
  closer_to_current_than_next: boolean
  text_reference: boolean
  auto_associate: boolean
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'

export function detectColumnLayout(input: {
  bbox_width: number
  page_problem_centers_x: number[]
  column_gap_normalized?: number
}): ColumnLayoutKind {
  const centers = [...input.page_problem_centers_x].sort((a, b) => a - b)
  if (centers.length < 2) {
    return input.bbox_width > 0.62 ? 'ONE_COLUMN' : 'UNKNOWN'
  }
  let bestGap = 0
  for (let i = 1; i < centers.length; i += 1) {
    bestGap = Math.max(bestGap, centers[i] - centers[i - 1])
  }
  const gap = input.column_gap_normalized ?? bestGap
  if (gap >= 0.08 && centers.some((x) => x < 0.48) && centers.some((x) => x > 0.52)) {
    if (input.bbox_width > 0.62) return 'MIXED'
    return 'TWO_COLUMN'
  }
  return 'ONE_COLUMN'
}

export function columnIntrusion(input: {
  bbox: NormalizedBBox
  column_count: number
  other_column_boxes: NormalizedBBox[]
}): boolean {
  if (input.column_count >= 2 && input.bbox.width > 0.62) return true
  return input.other_column_boxes.some((box) => bboxCoverage(box, input.bbox) >= 0.2 && bboxIoU(box, input.bbox) > 0.04)
}

export function classifyNeighborIntrusion(input: {
  stem: string
  choices_text?: string
  next_problem_number?: string | null
  next_bbox?: NormalizedBBox | null
  bbox: NormalizedBBox
  neighbor_body_in_bbox?: boolean
  neighbor_choice_in_bbox?: boolean
  neighbor_figure_in_bbox?: boolean
}): NeighborIntrusionKind {
  if (input.neighbor_figure_in_bbox) return 'NEIGHBOR_FIGURE_INTRUSION'
  if (input.neighbor_choice_in_bbox) return 'NEIGHBOR_CHOICE_INTRUSION'
  if (input.neighbor_body_in_bbox) return 'NEIGHBOR_BODY_INTRUSION'
  const adjacent = classifyAdjacentIntrusion({
    stem: input.stem,
    next_problem_number: input.next_problem_number ?? null,
  })
  if (adjacent.kind === 'BODY_INTRUSION') return 'NEIGHBOR_BODY_INTRUSION'
  if (input.next_bbox) {
    const padded = expandBBox(input.bbox, CROP_PAD)
    const header = validateBBox({
      x: input.next_bbox.x,
      y: input.next_bbox.y,
      width: input.next_bbox.width,
      height: Math.min(0.03, input.next_bbox.height),
      unit: 'normalized',
      origin: 'top-left',
    })
    if (bboxCoverage(header, padded) >= 0.4) return 'NEIGHBOR_HEADER_ONLY'
  }
  if (adjacent.kind === 'HEADER_ONLY') return 'NEIGHBOR_HEADER_ONLY'
  const circledInPad = new RegExp(`[${CIRCLED}]`).test(input.choices_text ?? '')
  if (circledInPad && input.neighbor_choice_in_bbox) return 'NEIGHBOR_CHOICE_INTRUSION'
  return 'NONE'
}

export function neighborBlocksAutoSafe(kind: NeighborIntrusionKind): boolean {
  return (
    kind === 'NEIGHBOR_BODY_INTRUSION' ||
    kind === 'NEIGHBOR_CHOICE_INTRUSION' ||
    kind === 'NEIGHBOR_FIGURE_INTRUSION'
  )
}

export function buildBoundaryEvidence(input: {
  bbox: NormalizedBBox
  current_number_y: number
  next_number_y?: number | null
  column_end_y?: number | null
  page_content_end_y?: number
  choice_complete?: boolean
  figure_complete?: boolean
}): ProblemBoundaryEvidence {
  const bottomCandidates: Array<{ value: number; confidence: number; evidence: string }> = []
  if (input.next_number_y != null) {
    bottomCandidates.push({ value: Math.max(input.bbox.y, input.next_number_y - 0.006), confidence: 0.92, evidence: 'next_problem_number' })
  }
  if (input.column_end_y != null) {
    bottomCandidates.push({ value: input.column_end_y, confidence: 0.72, evidence: 'column_end' })
  }
  bottomCandidates.push({
    value: input.bbox.y + input.bbox.height,
    confidence: input.choice_complete || input.figure_complete ? 0.7 : 0.55,
    evidence: input.choice_complete ? 'choice_completion' : input.figure_complete ? 'figure_completion' : 'current_bbox',
  })
  if (input.page_content_end_y != null) {
    bottomCandidates.push({ value: input.page_content_end_y, confidence: 0.4, evidence: 'page_content_end' })
  }
  const bottom = bottomCandidates.sort((a, b) => b.confidence - a.confidence)[0]
  return {
    top_anchor: {
      value: Math.min(input.bbox.y, input.current_number_y),
      confidence: 0.9,
      evidence: ['current_problem_number', 'previous_problem_termination'],
    },
    bottom_anchor: { value: bottom.value, confidence: bottom.confidence, evidence: [bottom.evidence] },
    left_bound: { value: input.bbox.x, confidence: 0.8, evidence: ['column_geometry'] },
    right_bound: { value: input.bbox.x + input.bbox.width, confidence: 0.8, evidence: ['column_geometry'] },
  }
}

export function figureOwnership(input: {
  figure: NormalizedBBox
  stem: NormalizedBBox
  choices?: NormalizedBBox | null
  next?: NormalizedBBox | null
  column: NormalizedBBox
  candidate: NormalizedBBox
  text?: string
}): FigureOwnership {
  const center = bboxCenter(input.figure)
  const same_column =
    center.x >= input.column.x && center.x <= input.column.x + input.column.width
  const contained = bboxCoverage(input.figure, input.candidate) >= 0.7
  const crosses_boundary = bboxCoverage(input.figure, input.candidate) < 0.7 && bboxIoU(input.figure, input.candidate) > 0
  const distCurrent = Math.hypot(center.x - bboxCenter(input.stem).x, center.y - bboxCenter(input.stem).y)
  const distNext = input.next
    ? Math.hypot(center.x - bboxCenter(input.next).x, center.y - bboxCenter(input.next).y)
    : Number.POSITIVE_INFINITY
  const closer_to_current_than_next = distCurrent + 0.02 < distNext
  const text_reference = /그림|그래프|도형|표/.test(input.text ?? '')
  let score = 0
  if (same_column) score += 0.28
  if (contained) score += 0.34
  if (closer_to_current_than_next) score += 0.22
  if (text_reference) score += 0.08
  if (input.choices && bboxCenter(input.figure).y < bboxCenter(input.choices).y) score += 0.08
  if (crosses_boundary) score -= 0.4
  score = Math.max(0, Math.min(1, score))
  return {
    score,
    same_column,
    contained,
    crosses_boundary,
    closer_to_current_than_next,
    text_reference,
    auto_associate: score >= 0.85 && contained && same_column && !crosses_boundary,
  }
}

export function choiceGroupValid(input: {
  detected_labels: string[]
  expected_count: number
  same_column: boolean
  in_candidate: boolean
  sequential?: boolean
}): { complete: boolean; owned: boolean; confidence: number } {
  const unique = [...new Set(input.detected_labels)]
  const complete = unique.length >= input.expected_count && input.expected_count > 0
  const owned = input.same_column && input.in_candidate
  const sequential = input.sequential ?? true
  const confidence = owned && complete && sequential ? 0.9 : owned && unique.length > 0 ? 0.45 : 0.2
  return { complete, owned, confidence }
}

export type LayoutTextBlock = {
  content: string
  bbox: NormalizedBBox
}

export type LeadingIndexAnchor = {
  number: string
  value: number
  bbox: NormalizedBBox
  preview: string
  confidence: number
}

/** Additive generic index: 1–3 digit problem numbers glued to stem, left of a column. Not publisher-specific. */
export function leadingIndexAnchors(blocks: LayoutTextBlock[]): LeadingIndexAnchor[] {
  const found: LeadingIndexAnchor[] = []
  for (const block of blocks) {
    if (block.bbox.y < 0.06 || block.bbox.y > 0.92) continue
    if (block.bbox.x < 0.08 || block.bbox.x > 0.22) continue
    const text = (block.content ?? '').replace(/\s+/g, '')
    const match = text.match(/^(\d{1,3})(?!\d)/)
    if (!match) continue
    if (match[1].length === 2 && match[1].startsWith('0')) continue
    const value = Number(match[1])
    if (!Number.isFinite(value) || value < 1) continue
    found.push({
      number: match[1],
      value,
      bbox: block.bbox,
      preview: text.slice(0, 48),
      confidence: 0.64,
    })
  }
  return found.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
}

export function rightRailPresent(blocks: LayoutTextBlock[]): boolean {
  return blocks.some((block) => block.bbox.x > 0.86 && block.bbox.height > 0.08 && block.bbox.y < 0.9)
}

export function regionsFromLeadingIndexes(anchors: LeadingIndexAnchor[]): Array<{
  detected_problem_number: string
  bbox: NormalizedBBox
  identity_confidence: number
  boundary_confidence: number
  column_wide: boolean
}> {
  return anchors.map((anchor, index) => {
    const next = anchors.slice(index + 1).find((row) => Math.abs(row.bbox.x - anchor.bbox.x) < 0.08)
    const top = Math.max(0.05, anchor.bbox.y - 0.004)
    const rawBottom = next ? next.bbox.y - 0.006 : top + 0.14
    const bottom = Math.min(0.93, Math.max(top + 0.04, rawBottom))
    const width = 0.5
    const bbox = validateBBox({
      x: Math.max(0.08, Math.min(0.45, anchor.bbox.x - 0.02)),
      y: top,
      width,
      height: bottom - top,
      unit: 'normalized',
      origin: 'top-left',
    })
    const sequential =
      next != null ? Math.abs(next.value - anchor.value) <= 4 : index > 0 && Math.abs(anchor.value - anchors[index - 1].value) <= 4
    return {
      detected_problem_number: anchor.number,
      bbox,
      identity_confidence: sequential ? 0.72 : 0.45,
      boundary_confidence: next ? 0.8 : 0.55,
      column_wide: bbox.width > 0.62,
    }
  })
}

export function mathConflictBetween(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  const exp = (latex: string[]) =>
    [...latex.join('\n').matchAll(/([A-Za-z0-9])\s*(?:\^|\^\{)(-?\d+)/g)].map((row) => `${row[1]}^${row[2]}`)
  const left = new Set(exp(a))
  const right = new Set(exp(b))
  const sharedBases = [...left].some((token) => {
    const base = token.split('^')[0]
    return [...right].some((other) => other.split('^')[0] === base && other !== token)
  })
  const joinedL = a.join(' ')
  const joinedR = b.join(' ')
  const ineqConflict =
    (/</.test(joinedL) && />/.test(joinedR)) || (/\\le/.test(joinedL) && /\\ge/.test(joinedR))
  return sharedBases || ineqConflict
}
