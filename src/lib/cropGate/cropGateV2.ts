import { bboxCoverage, bboxIoU, expandBBox, isValidBBox, validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { classifyAdjacentIntrusion } from '../recognition/draftPersist'
import { CROP_PAD } from '../recognition/problemPipeline'

export const CROP_GATE_VERSION = 'v2'
export const CROP_GATE_STEP = '8.9'

export type CropGateDecision = 'CROP_SAFE' | 'CROP_REVIEW' | 'CROP_UNSAFE'

export const CROP_GATE_HARD_BLOCKERS = [
  'INVALID_BBOX',
  'EMPTY_CROP',
  'NO_CONTENT',
  'SELF_NUMBER_MISSING',
  'NEIGHBOR_NUMBER_INTRUSION',
  'BODY_INTRUSION',
  'TOP_CUT_RISK',
  'BOTTOM_CUT_RISK',
  'LEFT_CUT_RISK',
  'RIGHT_CUT_RISK',
  'FIGURE_BOUNDARY_RISK',
  'KNOWN_BLOCK_OUTSIDE_CROP',
  'COLUMN_INTRUSION',
  'IDENTITY_UNSTABLE',
  'NUMBER_UNCERTAIN',
] as const

export type CropGateHardBlocker = (typeof CROP_GATE_HARD_BLOCKERS)[number]

export type CropImageFeatures = {
  width: number
  height: number
  blank_ratio: number
  ink_ratio: number
  connected_components: number
  largest_component_area_frac: number
  ink_bbox: { x: number; y: number; width: number; height: number } | null
  edge_touch: { top: number; bottom: number; left: number; right: number }
  top_band_span: number
  bottom_band_span: number
  left_band_span: number
  right_band_span: number
  top_span_excluding_number_zone: number
  left_span_excluding_number_zone: number
  top_edge_px_span: number
  bottom_edge_px_span: number
  left_edge_px_span: number
  right_edge_px_span: number
  left_top_ink: boolean
  figure_like_blob_edge: boolean
  figure_like_blob_area_frac: number
}

export type CropGateInput = {
  problem_number: string
  canonical_problem_number: string | null
  bbox: NormalizedBBox
  crop: { width: number | null; height: number | null; blank_ratio: number | null; bbox_valid: boolean }
  image?: CropImageFeatures | null
  stem: string
  markdown?: string
  page_problem_numbers: string[]
  next_problem_number?: string | null
  next_bbox?: NormalizedBBox | null
  neighbor_bboxes?: NormalizedBBox[]
  assigned_images?: Array<{ bbox: NormalizedBBox }>
  known_blocks?: Array<{ bbox: NormalizedBBox; content?: string }>
  column_count?: number
  is_column_last?: boolean
  figure_hint?: boolean
  graph_hint?: boolean
  table_hint?: boolean
  identity_unstable?: boolean
  number_uncertain?: boolean
  segmentation_status?: string
  layout_kind?: string
}

export type CropGateResult = {
  crop_gate_version: typeof CROP_GATE_VERSION
  decision: CropGateDecision
  reasons: CropGateHardBlocker[]
  hard_blockers: CropGateHardBlocker[]
  soft_features: string[]
  features: Record<string, unknown>
  evidence: Record<string, unknown>
}

const MIN_WIDTH_PX = 64
const MIN_HEIGHT_PX = 48
const INK_EMPTY = 0.008
const FIGURE_COVERAGE_MIN = 0.7
const NEIGHBOR_IOU_MAX = 0.12
const MATH_STRIP = /\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g

export function stripMathRegions(text: string): string {
  return text.replace(MATH_STRIP, ' ')
}

export function isProblemNumberAnchorLine(line: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^(?:#{1,3}\\s*)?${escaped}(?:\\s*(?:[|•.]|대표)|\\s|$)`).test(line.trim())
}

export function findRangeIntrusion(text: string, self: string): string[] {
  const hits: string[] = []
  const re = /\[(\d{4})\s*[~\-–]\s*(\d{4})\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match[1] !== self) hits.push(match[1])
    if (match[2] !== self) hits.push(match[2])
  }
  return [...new Set(hits)]
}

export function findNeighborProblemAnchors(input: {
  text: string
  self: string
  page_problem_numbers: string[]
}): { neighbors: string[]; last_line_only: boolean } {
  const known = new Set(
    input.page_problem_numbers.filter((row) => row !== input.self && /^\d{4}$/.test(row)),
  )
  const stripped = stripMathRegions(input.text)
  const lines = stripped.split(/\n/).map((line) => line.trim()).filter(Boolean)
  const hits: Array<{ number: string; index: number }> = []
  for (const [index, line] of lines.entries()) {
    for (const number of known) {
      if (isProblemNumberAnchorLine(line, number)) hits.push({ number, index })
    }
  }
  const neighbors = [...new Set(hits.map((row) => row.number))]
  const last_line_only =
    neighbors.length > 0 && hits.every((row) => row.index >= Math.max(0, lines.length - 1))
  return { neighbors, last_line_only }
}

export function selfNumberPresentInOcr(text: string, self: string): boolean {
  if (!/^\d{4}$/.test(self)) return false
  const stripped = stripMathRegions(text)
  return stripped.split(/\n/).some((line) => isProblemNumberAnchorLine(line, self)) || stripped.includes(self)
}

export function evaluateCropGateV2(input: CropGateInput): CropGateResult {
  const hard = new Set<CropGateHardBlocker>()
  const soft: string[] = []
  const image = input.image ?? null
  const width = image?.width ?? input.crop.width
  const height = image?.height ?? input.crop.height
  const blank = image?.blank_ratio ?? input.crop.blank_ratio
  const ink = image?.ink_ratio ?? null
  const bbox_valid = input.crop.bbox_valid && isValidBBox(input.bbox)
  const text = `${input.stem}\n${input.markdown ?? ''}`
  const self = input.canonical_problem_number ?? input.problem_number
  const neighborHits = findNeighborProblemAnchors({
    text,
    self,
    page_problem_numbers: input.page_problem_numbers,
  })
  const adjacent = classifyAdjacentIntrusion({
    stem: input.stem,
    next_problem_number: input.next_problem_number ?? null,
  })
  const neighborIou = (input.neighbor_bboxes ?? []).reduce(
    (max, neighbor) => Math.max(max, bboxIoU(input.bbox, neighbor)),
    0,
  )

  if (!bbox_valid) hard.add('INVALID_BBOX')
  if ((width != null && width < 8) || (height != null && height < 8)) hard.add('EMPTY_CROP')
  if ((width != null && width < MIN_WIDTH_PX) || (height != null && height < MIN_HEIGHT_PX)) hard.add('EMPTY_CROP')
  if ((ink != null && ink < INK_EMPTY) || (image && image.connected_components === 0 && (ink == null || ink < 0.012))) {
    hard.add('NO_CONTENT')
  }

  if (input.identity_unstable || !input.canonical_problem_number) hard.add('IDENTITY_UNSTABLE')
  if (input.number_uncertain) hard.add('NUMBER_UNCERTAIN')

  const ocrHasSelf = selfNumberPresentInOcr(text, self)
  const anchorManagedOutsideOcr = input.segmentation_status === 'AUTO_OK' && Boolean(input.canonical_problem_number)
  if (!ocrHasSelf && !anchorManagedOutsideOcr && !(image?.left_top_ink)) hard.add('SELF_NUMBER_MISSING')
  else if (!ocrHasSelf && anchorManagedOutsideOcr) soft.push('self_number_from_segment_anchor')

  if (adjacent.kind === 'BODY_INTRUSION') hard.add('BODY_INTRUSION')
  if (findRangeIntrusion(text, self).length) hard.add('NEIGHBOR_NUMBER_INTRUSION')
  if (neighborHits.neighbors.length && !neighborHits.last_line_only) hard.add('NEIGHBOR_NUMBER_INTRUSION')
  else if (neighborHits.neighbors.length && neighborHits.last_line_only) soft.push('neighbor_header_last_line')
  if (input.next_bbox) {
    const padded = expandBBox(input.bbox, CROP_PAD)
    const headerHeight = Math.min(0.03, input.next_bbox.height)
    const header = validateBBox({
      x: input.next_bbox.x,
      y: input.next_bbox.y,
      width: input.next_bbox.width,
      height: headerHeight,
      unit: 'normalized',
      origin: 'top-left',
    })
    if (bboxCoverage(header, padded) >= 0.4) soft.push('neighbor_header_in_pad')
  }
  if (neighborIou >= NEIGHBOR_IOU_MAX) hard.add('NEIGHBOR_NUMBER_INTRUSION')

  if ((input.column_count ?? 1) >= 2 && input.bbox.width > 0.62) hard.add('COLUMN_INTRUSION')

  for (const block of input.known_blocks ?? []) {
    if ((block.content ?? '').trim().length < 4) continue
    if (bboxCoverage(block.bbox, input.bbox) < 0.45) {
      hard.add('KNOWN_BLOCK_OUTSIDE_CROP')
      break
    }
  }

  for (const imageBox of input.assigned_images ?? []) {
    if (bboxCoverage(imageBox.bbox, input.bbox) < FIGURE_COVERAGE_MIN) {
      hard.add('FIGURE_BOUNDARY_RISK')
      break
    }
  }

  if (image) {
    const topEdge = image.top_edge_px_span ?? 0
    const bottomEdge = image.bottom_edge_px_span ?? 0
    const leftEdge = image.left_edge_px_span ?? 0
    const rightEdge = image.right_edge_px_span ?? 0
    if (topEdge >= 0.5) hard.add('TOP_CUT_RISK')
    else if (topEdge >= 0.32) soft.push('top_edge_ambiguous')
    if (bottomEdge >= 0.5) hard.add('BOTTOM_CUT_RISK')
    else if (bottomEdge >= 0.32) soft.push('bottom_edge_ambiguous')
    if (leftEdge >= 0.55) hard.add('LEFT_CUT_RISK')
    else if (leftEdge >= 0.38) soft.push('left_edge_ambiguous')
    if (rightEdge >= 0.5) hard.add('RIGHT_CUT_RISK')
    else if (rightEdge >= 0.32) soft.push('right_edge_ambiguous')
    if (image.figure_like_blob_edge && image.figure_like_blob_area_frac >= 0.08) hard.add('FIGURE_BOUNDARY_RISK')
    if ((input.figure_hint || input.graph_hint || input.table_hint) && !image.figure_like_blob_edge && (input.assigned_images ?? []).length === 0) {
      soft.push('visual_figure_unconfirmed')
    }
  } else {
    soft.push('image_features_missing')
  }

  if (input.is_column_last && (image?.bottom_edge_px_span ?? 0) >= 0.22 && (image?.bottom_edge_px_span ?? 0) < 0.5) {
    soft.push('column_last_bottom_uncertain')
  }

  const reviewSoft = new Set([
    'top_edge_ambiguous',
    'bottom_edge_ambiguous',
    'left_edge_ambiguous',
    'right_edge_ambiguous',
    'image_features_missing',
    'column_last_bottom_uncertain',
    'neighbor_header_last_line',
    'neighbor_header_in_pad',
  ])
  const blockingSoft = soft.filter((row) => reviewSoft.has(row))
  const decision: CropGateDecision = hard.size
    ? 'CROP_UNSAFE'
    : blockingSoft.length
      ? 'CROP_REVIEW'
      : 'CROP_SAFE'

  return {
    crop_gate_version: CROP_GATE_VERSION,
    decision,
    reasons: [...hard],
    hard_blockers: [...hard],
    soft_features: soft,
    features: {
      blank_ratio: blank,
      ink_ratio: ink,
      width,
      height,
      bbox_height: input.bbox.height,
      bbox_width: input.bbox.width,
      neighbor_iou: neighborIou,
      figure_hint: Boolean(input.figure_hint),
      graph_hint: Boolean(input.graph_hint),
      table_hint: Boolean(input.table_hint),
      is_column_last: Boolean(input.is_column_last),
      blank_ratio_hard_blocker: false,
    },
    evidence: {
      self_number_ocr: ocrHasSelf,
      self_number_from_anchor: anchorManagedOutsideOcr,
      neighbor_anchors: neighborHits.neighbors,
      neighbor_last_line_only: neighborHits.last_line_only,
      adjacent: adjacent.kind,
      image_edge: image
        ? {
            top: image.top_edge_px_span,
            bottom: image.bottom_edge_px_span,
            left: image.left_edge_px_span,
            right: image.right_edge_px_span,
            figure_blob_edge: image.figure_like_blob_edge,
          }
        : null,
    },
  }
}

export function cropGateV2AllowsAuto(result: CropGateResult): boolean {
  return result.decision === 'CROP_SAFE'
}

export type GoldenLabel = 'SAFE' | 'UNSAFE' | 'AMBIGUOUS'
export type GoldenUnsafeReason =
  | 'TOP_CUT'
  | 'BOTTOM_CUT'
  | 'LEFT_CUT'
  | 'RIGHT_CUT'
  | 'NEIGHBOR_INTRUSION'
  | 'MISSING_STEM'
  | 'MISSING_CHOICE'
  | 'FIGURE_CUT'
  | 'WRONG_COLUMN'
  | 'EMPTY'
  | 'OTHER'

export function cropGateMetrics(
  rows: Array<{ label: GoldenLabel; predicted: CropGateDecision }>,
): {
  sample: number
  SAFE: number
  UNSAFE: number
  AMBIGUOUS: number
  predicted_SAFE: number
  predicted_REVIEW: number
  predicted_UNSAFE: number
  FALSE_SAFE: number
  SAFE_precision: number
  SAFE_recall: number
  UNSAFE_recall: number
  AMBIGUOUS_rate: number
} {
  const sample = rows.length
  const SAFE = rows.filter((row) => row.label === 'SAFE').length
  const UNSAFE = rows.filter((row) => row.label === 'UNSAFE').length
  const AMBIGUOUS = rows.filter((row) => row.label === 'AMBIGUOUS').length
  const predicted_SAFE = rows.filter((row) => row.predicted === 'CROP_SAFE').length
  const predicted_REVIEW = rows.filter((row) => row.predicted === 'CROP_REVIEW').length
  const predicted_UNSAFE = rows.filter((row) => row.predicted === 'CROP_UNSAFE').length
  const falseSafe = rows.filter((row) => row.label === 'UNSAFE' && row.predicted === 'CROP_SAFE').length
  const trueSafe = rows.filter((row) => row.label === 'SAFE' && row.predicted === 'CROP_SAFE').length
  const trueUnsafe = rows.filter((row) => row.label === 'UNSAFE' && row.predicted === 'CROP_UNSAFE').length
  return {
    sample,
    SAFE,
    UNSAFE,
    AMBIGUOUS,
    predicted_SAFE,
    predicted_REVIEW,
    predicted_UNSAFE,
    FALSE_SAFE: falseSafe,
    SAFE_precision: predicted_SAFE ? trueSafe / predicted_SAFE : 1,
    SAFE_recall: SAFE ? trueSafe / SAFE : 1,
    UNSAFE_recall: UNSAFE ? trueUnsafe / UNSAFE : 1,
    AMBIGUOUS_rate: sample ? AMBIGUOUS / sample : 0,
  }
}

export function pickStratifiedGolden<
  T extends {
    page: number
    problem_number: string
    quality?: string
    review_reasons?: string[]
    figure_hint?: boolean
    graph_hint?: boolean
    table_hint?: boolean
    blank_ratio?: number | null
    bbox_height?: number
    choice_count?: number
    column_count?: number
  },
>(rows: T[], target = 150): T[] {
  const keyOf = (row: T) => `${row.page}|${row.problem_number}`
  const picked: T[] = []
  const used = new Set<string>()
  const take = (row: T | undefined) => {
    if (!row || picked.length >= target) return
    const key = keyOf(row)
    if (used.has(key)) return
    used.add(key)
    picked.push(row)
  }
  const drafts = rows.filter((row) => row.quality === 'DRAFT_READY')
  const figures = rows.filter((row) => row.figure_hint || row.graph_hint || row.table_hint)
  const unsafe = rows.filter((row) => row.review_reasons?.includes('CROP_UNSAFE'))
  const buckets = (list: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of list) {
      const third = row.page <= 64 ? 'front' : row.page <= 128 ? 'mid' : 'back'
      const blank =
        row.blank_ratio == null ? 'null' : row.blank_ratio >= 0.92 ? 'high' : row.blank_ratio >= 0.85 ? 'mid' : 'low'
      const height = (row.bbox_height ?? 0) < 0.06 ? 'short' : (row.bbox_height ?? 0) < 0.14 ? 'med' : 'tall'
      const col = (row.column_count ?? 1) >= 2 ? '2col' : '1col'
      const mcq = (row.choice_count ?? 0) >= 5 ? 'mcq' : 'open'
      const key = `${third}|${blank}|${height}|${col}|${mcq}`
      const bucket = map.get(key) ?? []
      bucket.push(row)
      map.set(key, bucket)
    }
    return [...map.values()]
  }
  const roundRobin = (lists: T[][], count: number) => {
    const copies = lists.map((list) => [...list])
    let guard = 0
    while (picked.length < count && guard < 20_000) {
      guard += 1
      let added = false
      for (const list of copies) {
        const next = list.shift()
        if (!next) continue
        const before = picked.length
        take(next)
        if (picked.length > before) added = true
        if (picked.length >= count) break
      }
      if (!added) break
    }
  }
  roundRobin(buckets(drafts), Math.min(30, drafts.length))
  const figureOnly = figures.filter((row) => !used.has(keyOf(row)))
  roundRobin(buckets(figureOnly), Math.min(picked.length + 20, target))
  const unsafeOnly = unsafe.filter((row) => !used.has(keyOf(row)))
  roundRobin(buckets(unsafeOnly), Math.min(picked.length + 100, target))
  if (picked.length < target) roundRobin(buckets(rows.filter((row) => !used.has(keyOf(row)))), target)
  return picked.slice(0, target)
}
