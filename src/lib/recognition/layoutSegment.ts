import {
  bboxCenter,
  bboxCoverage,
  bboxIoU,
  expandBBox,
  pixelCornersToNormalized,
  unionBBoxes,
  validateBBox,
  type NormalizedBBox,
} from '../pdf/bbox'
import { extractWorkbookProblemAnchor, type WorkbookAnchorKind } from './structure'

export const SEGMENT_ENGINE = 'hqb-page-segment-v1'
export const SEGMENT_ENGINE_VERSION = '0.2.0'

export type SegmentStatus = 'AUTO_OK' | 'REVIEW'
export type ImageAssignment = 'assigned' | 'review' | 'none' | 'unassigned'
export type LayoutKind = 'PROBLEM' | 'THEORY' | 'SIDEBAR' | 'DECORATION' | 'UNKNOWN'
export type PageLayoutKind = 'PROBLEM_PAGE' | 'THEORY_PAGE' | 'MIXED' | 'UNKNOWN'
export type ContentBottomSource = 'next_anchor' | 'column_content' | 'footer_fallback'

export type LayoutBlock = {
  type?: string
  content?: string
  bbox: NormalizedBBox
  confidence?: number
}

export type LayoutImage = {
  id: string
  bbox: NormalizedBBox
}

export type LayoutPageInput = {
  pageWidth: number
  pageHeight: number
  blocks: LayoutBlock[]
  images: LayoutImage[]
}

export type ProblemAnchor = {
  number: string
  kind: WorkbookAnchorKind
  bbox: NormalizedBBox
  column_index: number
  confidence: number
  evidence: string[]
  preview: string
}

export type ColumnBand = {
  index: number
  bbox: NormalizedBBox
  split_confidence: number
}

export type SegmentedProblem = {
  detected_problem_number: string
  kind: WorkbookAnchorKind
  layout_kind: LayoutKind
  bbox: NormalizedBBox
  column_index: number
  confidence: number
  status: SegmentStatus
  evidence: string[]
  warnings: string[]
  assigned_images: string[]
  image_assignment: ImageAssignment
  preview: string
  content_bottom_source?: ContentBottomSource
}

export type PageSegmentation = {
  engine: typeof SEGMENT_ENGINE
  engine_version: typeof SEGMENT_ENGINE_VERSION
  page_layout_kind: PageLayoutKind
  column_count: number
  columns: ColumnBand[]
  anchors: ProblemAnchor[]
  rejected_reasons: string[]
  regions: SegmentedProblem[]
  unassigned_images: string[]
}

type PixelLike = {
  type?: string
  content?: unknown
  top_left_x?: number
  top_left_y?: number
  bottom_right_x?: number
  bottom_right_y?: number
  id?: string
}

type LayoutLike = {
  blocks?: unknown[]
  images?: unknown[]
  dimensions?: { width?: number; height?: number } | null
}

const HEADER_MAX_Y = 0.055
const FOOTER_MIN_Y = 0.955
const TOP_PAD = 0.01
const BOTTOM_GAP = 0.008
const CONTENT_BOTTOM_PAD = 0.022
const COLUMN_GAP_MIN = 0.08
const SIDE_MARGIN = 0.012
const MIN_HEIGHT = 0.05
const MAX_HEIGHT = 0.62
const OVERLAP_REVIEW = 0.08
const AUTO_OK_MIN = 0.78
const DECORATION_MAX_Y = 0.14
const SIDEBAR_SPLIT = 0.72

export function layoutInputFromProviderLayout(
  layout: LayoutLike,
  fallbackSize?: { width: number; height: number },
): LayoutPageInput {
  const width = layout.dimensions?.width ?? fallbackSize?.width ?? 0
  const height = layout.dimensions?.height ?? fallbackSize?.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new Error('HQB_SEGMENT_NO_PAGE_SIZE: layout dimensions are required')
  }
  const page = { width, height }
  const blocks = (layout.blocks ?? []).flatMap((raw) => {
    const block = asPixelLike(raw)
    if (!block || !hasPixelBox(block)) return []
    const content = typeof block.content === 'string' ? block.content : ''
    return [
      {
        type: block.type,
        content,
        bbox: pixelCornersToNormalized(
          {
            left: block.top_left_x ?? 0,
            top: block.top_left_y ?? 0,
            right: block.bottom_right_x ?? 0,
            bottom: block.bottom_right_y ?? 0,
          },
          page,
        ),
        confidence: typeof (raw as { confidence?: number }).confidence === 'number'
          ? (raw as { confidence: number }).confidence
          : undefined,
      },
    ]
  })
  const seen = new Set<string>()
  const images: LayoutImage[] = []
  for (const raw of [...(layout.images ?? []), ...(layout.blocks ?? [])]) {
    const block = asPixelLike(raw)
    if (!block || !hasPixelBox(block)) continue
    const fromImageList = (layout.images ?? []).includes(raw)
    const looksImage = block.type === 'image' || Boolean(block.id && /img|image/i.test(block.id))
    if (!looksImage && !fromImageList) continue
    const id = block.id ?? `image-${images.length}`
    if (seen.has(id)) continue
    const bbox = pixelCornersToNormalized(
      {
        left: block.top_left_x ?? 0,
        top: block.top_left_y ?? 0,
        right: block.bottom_right_x ?? 0,
        bottom: block.bottom_right_y ?? 0,
      },
      page,
    )
    if (images.some((existing) => bboxIoU(existing.bbox, bbox) > 0.8)) continue
    seen.add(id)
    images.push({ id, bbox })
  }
  return {
    pageWidth: width,
    pageHeight: height,
    blocks: blocks.map(({ type, content, bbox, confidence }) => ({ type, content, bbox, confidence })),
    images,
  }
}

export function segmentPageFromLayout(input: LayoutPageInput): PageSegmentation {
  if (input.pageWidth <= 0 || input.pageHeight <= 0) {
    return emptySegmentation()
  }
  const rejected: string[] = []
  const rawAnchors = collectAnchors(input.blocks, rejected)
  const columns = estimateColumns(input.blocks, rawAnchors)
  const anchors = rawAnchors.map((anchor) => ({
    ...anchor,
    column_index: columnIndexFor(anchor.bbox, columns),
  }))
  const regions = buildRegions(anchors, columns, input)
  assignImages(regions, input.images, columns)
  clampRegionsToFooter(regions, input.blocks)
  finalizeStatus(regions, anchors, columns)

  return {
    engine: SEGMENT_ENGINE,
    engine_version: SEGMENT_ENGINE_VERSION,
    page_layout_kind: pageLayoutKind(regions),
    column_count: columns.length,
    columns,
    anchors,
    rejected_reasons: rejected,
    regions,
    unassigned_images: input.images
      .filter((image) => !regions.some((region) => region.assigned_images.includes(image.id)))
      .filter((image) => !isDecoration(image.bbox))
      .map((image) => image.id),
  }
}

function emptySegmentation(): PageSegmentation {
  return {
    engine: SEGMENT_ENGINE,
    engine_version: SEGMENT_ENGINE_VERSION,
    page_layout_kind: 'UNKNOWN',
    column_count: 0,
    columns: [],
    anchors: [],
    rejected_reasons: [],
    regions: [],
    unassigned_images: [],
  }
}

function collectAnchors(blocks: LayoutBlock[], rejected: string[]): Omit<ProblemAnchor, 'column_index'>[] {
  const found: Omit<ProblemAnchor, 'column_index'>[] = []
  for (const block of blocks) {
    const skip = skipBlock(block)
    if (skip) {
      rejected.push(`${skip}:${clip(block.content)}`)
      continue
    }
    const hit = extractWorkbookProblemAnchor(block.content ?? '')
    if (!hit.number || !hit.kind) {
      if (hit.reason !== 'no_problem_number' && hit.reason !== 'empty') {
        rejected.push(`${hit.reason}:${clip(block.content)}`)
      }
      continue
    }
    if (isFooterOrHeaderNoise(block, hit.number)) {
      rejected.push(`header_footer_number:${clip(block.content)}`)
      continue
    }
    if (found.some((row) => row.number === hit.number && bboxIoU(row.bbox, block.bbox) > 0.4)) continue
    found.push({
      number: hit.number,
      kind: hit.kind,
      bbox: block.bbox,
      confidence: hit.confidence,
      evidence: [hit.reason, block.type ? `block:${block.type}` : 'block:unknown'],
      preview: clip(block.content),
    })
  }
  return found.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
}

function skipBlock(block: LayoutBlock): string | null {
  const type = (block.type ?? '').toLowerCase()
  const text = (block.content ?? '').replace(/\s+/g, ' ').trim()
  if (type === 'footer' || block.bbox.y >= FOOTER_MIN_Y) return 'footer'
  if (type === 'header' && /정답|풀이|쪽/.test(text)) return 'running_header'
  if (type === 'image') return 'image_block'
  if (type === 'caption') return 'caption'
  if (block.bbox.y <= HEADER_MAX_Y && !extractWorkbookProblemAnchor(text).number) return 'page_header'
  return null
}

function isFooterOrHeaderNoise(block: LayoutBlock, number: string): boolean {
  const type = (block.type ?? '').toLowerCase()
  if (type === 'footer' || block.bbox.y >= FOOTER_MIN_Y) return true
  if (type === 'header' && /정답|풀이/.test(block.content ?? '')) return true
  if (/^\d{1,3}$/.test(number) && (type === 'footer' || block.bbox.y >= 0.9)) return true
  return false
}

function estimateColumns(blocks: LayoutBlock[], anchors: Omit<ProblemAnchor, 'column_index'>[]): ColumnBand[] {
  const pageBox = validateBBox({
    x: SIDE_MARGIN,
    y: 0.05,
    width: 1 - SIDE_MARGIN * 2,
    height: 0.9,
    unit: 'normalized',
    origin: 'top-left',
  })
  if (looksLikeSidebarPage(blocks, anchors)) {
    return [
      { index: 0, bbox: clampBand(SIDE_MARGIN, SIDEBAR_SPLIT - 0.01), split_confidence: 0.8 },
      { index: 1, bbox: clampBand(SIDEBAR_SPLIT + 0.01, 1 - SIDE_MARGIN), split_confidence: 0.8 },
    ]
  }
  const leftAnchors = anchors.filter((anchor) => bboxCenter(anchor.bbox).x < 0.48)
  const rightAnchors = anchors.filter((anchor) => bboxCenter(anchor.bbox).x > 0.52)
  if (leftAnchors.length > 0 && rightAnchors.length > 0) {
    return [
      { index: 0, bbox: clampBand(SIDE_MARGIN, 0.492), split_confidence: 0.9 },
      { index: 1, bbox: clampBand(0.508, 1 - SIDE_MARGIN), split_confidence: 0.9 },
    ]
  }
  const seed = anchors.length >= 2 ? anchors : blocks.filter((block) => usableForColumn(block))
  const centers = seed.map((row) => bboxCenter(row.bbox).x).sort((a, b) => a - b)
  if (centers.length < 2) {
    return [{ index: 0, bbox: pageBox, split_confidence: 0.4 }]
  }
  let bestGap = 0
  let split = 0.5
  for (let i = 1; i < centers.length; i += 1) {
    const gap = centers[i] - centers[i - 1]
    const mid = (centers[i] + centers[i - 1]) / 2
    if (gap > bestGap && mid > 0.28 && mid < 0.82) {
      bestGap = gap
      split = mid
    }
  }
  if (bestGap < COLUMN_GAP_MIN) {
    return [{ index: 0, bbox: pageBox, split_confidence: 0.55 }]
  }
  return [
    { index: 0, bbox: clampBand(SIDE_MARGIN, split - 0.008), split_confidence: Math.min(0.95, 0.55 + bestGap) },
    { index: 1, bbox: clampBand(split + 0.008, 1 - SIDE_MARGIN), split_confidence: Math.min(0.95, 0.55 + bestGap) },
  ]
}

function looksLikeSidebarPage(
  blocks: LayoutBlock[],
  anchors: Omit<ProblemAnchor, 'column_index'>[],
): boolean {
  const hasNote = blocks.some((block) => /SSEN\s*NOTE/i.test(block.content ?? ''))
  const sectionOnly = anchors.length > 0 && anchors.every((anchor) => anchor.kind === 'section')
  const rightNotes = blocks.filter(
    (block) =>
      bboxCenter(block.bbox).x > SIDEBAR_SPLIT &&
      block.bbox.width < 0.3 &&
      block.bbox.y > 0.08 &&
      block.bbox.y < 0.93 &&
      !skipBlock(block),
  )
  return hasNote && sectionOnly && rightNotes.length >= 2
}

function usableForColumn(block: LayoutBlock): boolean {
  if (skipBlock(block)) return false
  if (block.bbox.width >= 0.72) return false
  if (block.bbox.y < 0.07 || block.bbox.y > 0.93) return false
  return true
}

function clampBand(left: number, right: number): NormalizedBBox {
  const x = Math.max(0, Math.min(left, 0.9))
  const width = Math.max(0.2, Math.min(right, 1) - x)
  return validateBBox({
    x,
    y: 0.05,
    width,
    height: 0.9,
    unit: 'normalized',
    origin: 'top-left',
  })
}

function columnIndexFor(bbox: NormalizedBBox, columns: ColumnBand[]): number {
  if (columns.length <= 1) return 0
  const cx = bboxCenter(bbox).x
  let best = 0
  let bestDist = Infinity
  for (const column of columns) {
    const mid = bboxCenter(column.bbox).x
    const dist = Math.abs(cx - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = column.index
    }
  }
  return best
}

function buildRegions(
  anchors: ProblemAnchor[],
  columns: ColumnBand[],
  input: LayoutPageInput,
): SegmentedProblem[] {
  const hardBottom = footerTop(input.blocks)
  const regions = anchors.map((anchor, index) => {
    const column = columns[anchor.column_index] ?? columns[0]
    const sameColumn = anchors
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter((item) => item.row.column_index === anchor.column_index && item.rowIndex > index)
    const next = sameColumn[0]?.row
    const top = Math.max(0.04, anchor.bbox.y - TOP_PAD)
    const layoutKind = layoutKindFor(anchor, column, columns)
    let rawBottom = next ? next.bbox.y - BOTTOM_GAP : hardBottom
    let source: ContentBottomSource = next ? 'next_anchor' : 'footer_fallback'
    const warnings: string[] = []
    if (!next) {
      const estimated = estimateColumnContentBottom(input, column, top, hardBottom)
      rawBottom = estimated.bottom
      source = estimated.source
      if (!estimated.confident) warnings.push('last_in_column_bottom_uncertain')
    }
    const bottom = Math.max(top + MIN_HEIGHT, Math.min(hardBottom, rawBottom))
    const bbox = validateBBox({
      x: column.bbox.x,
      y: top,
      width: column.bbox.width,
      height: bottom - top,
      unit: 'normalized',
      origin: 'top-left',
    })
    const evidence = [
      ...anchor.evidence,
      `column:${anchor.column_index}`,
      `layout:${layoutKind}`,
      source,
    ]
    if (anchor.kind !== 'four_digit') warnings.push(`weak_anchor_kind:${anchor.kind}`)
    if (columns.length > 1 && (column.split_confidence ?? 0) < 0.6) warnings.push('column_uncertain')
    if (layoutKind === 'THEORY' || layoutKind === 'SIDEBAR') warnings.push(`not_problem_unit:${layoutKind}`)
    return {
      detected_problem_number: anchor.number,
      kind: anchor.kind,
      layout_kind: layoutKind,
      bbox,
      column_index: anchor.column_index,
      confidence: anchor.confidence,
      status: 'REVIEW' as const,
      evidence,
      warnings,
      assigned_images: [],
      image_assignment: 'none' as const,
      preview: anchor.preview,
      content_bottom_source: source,
    }
  })
  const sidebar = sidebarRegion(input, columns, hardBottom)
  return sidebar ? [...regions, sidebar] : regions
}

function layoutKindFor(anchor: ProblemAnchor, column: ColumnBand, columns: ColumnBand[]): LayoutKind {
  if (anchor.kind === 'section') return 'THEORY'
  if (columns.length > 1 && column.bbox.x >= SIDEBAR_SPLIT - 0.02 && anchor.kind !== 'four_digit') return 'SIDEBAR'
  if (anchor.kind === 'four_digit' || anchor.kind === 'dotted') return 'PROBLEM'
  return 'UNKNOWN'
}

function estimateColumnContentBottom(
  input: LayoutPageInput,
  column: ColumnBand,
  top: number,
  hardBottom: number,
): { bottom: number; source: ContentBottomSource; confident: boolean } {
  const bottoms: number[] = []
  for (const block of input.blocks) {
    if (isNonContent(block)) continue
    if (bboxCenter(block.bbox).x < column.bbox.x || bboxCenter(block.bbox).x > column.bbox.x + column.bbox.width) continue
    const blockBottom = block.bbox.y + block.bbox.height
    if (block.bbox.y < top - 0.01 || block.bbox.y >= hardBottom) continue
    bottoms.push(blockBottom)
  }
  for (const image of input.images) {
    if (isDecoration(image.bbox)) continue
    if (bboxCenter(image.bbox).x < column.bbox.x || bboxCenter(image.bbox).x > column.bbox.x + column.bbox.width) continue
    const imageBottom = image.bbox.y + image.bbox.height
    if (image.bbox.y < top - 0.01 || image.bbox.y >= hardBottom) continue
    bottoms.push(imageBottom)
  }
  if (bottoms.length === 0) {
    return { bottom: hardBottom, source: 'footer_fallback', confident: false }
  }
  const last = Math.max(...bottoms)
  const padded = Math.min(hardBottom, last + CONTENT_BOTTOM_PAD)
  const confident = last > top + 0.045 && last < hardBottom + 0.002
  return { bottom: padded, source: 'column_content', confident }
}

function isNonContent(block: LayoutBlock): boolean {
  if (skipBlock(block)) return true
  const text = (block.content ?? '').replace(/\s+/g, ' ').trim()
  if (/^정답\s*및\s*풀이|^SSEN\s*NOTE$/i.test(text)) return true
  if (/^[IVX]+[.]\s/.test(text) && block.bbox.y > 0.9) return true
  return false
}

function sidebarRegion(
  input: LayoutPageInput,
  columns: ColumnBand[],
  hardBottom: number,
): SegmentedProblem | null {
  const sidebar = columns.find((column) => column.bbox.x >= SIDEBAR_SPLIT - 0.02)
  if (!sidebar) return null
  const blocks = input.blocks.filter(
    (block) =>
      !isNonContent(block) &&
      bboxCenter(block.bbox).x >= sidebar.bbox.x &&
      block.bbox.y > 0.08 &&
      block.bbox.y < hardBottom,
  )
  if (blocks.length < 2) return null
  const union = expandBBox(unionBBoxes(blocks.map((block) => block.bbox)), 0.01)
  return {
    detected_problem_number: 'SIDEBAR',
    kind: 'section',
    layout_kind: 'SIDEBAR',
    bbox: validateBBox({
      x: sidebar.bbox.x,
      y: Math.max(0.08, union.y),
      width: sidebar.bbox.width,
      height: Math.min(hardBottom, union.y + union.height) - Math.max(0.08, union.y),
      unit: 'normalized',
      origin: 'top-left',
    }),
    column_index: sidebar.index,
    confidence: 0.4,
    status: 'REVIEW',
    evidence: ['sidebar_column', 'ssen_note_or_right_rail'],
    warnings: ['not_problem_unit:SIDEBAR', 'sidebar_not_saved_as_problem'],
    assigned_images: [],
    image_assignment: 'none',
    preview: 'SIDEBAR',
    content_bottom_source: 'column_content',
  }
}

function clampRegionsToFooter(regions: SegmentedProblem[], blocks: LayoutBlock[]): void {
  const hardBottom = footerTop(blocks)
  for (const region of regions) {
    const bottom = Math.min(hardBottom, region.bbox.y + region.bbox.height)
    if (bottom <= region.bbox.y + 0.04) continue
    region.bbox = validateBBox({
      ...region.bbox,
      height: bottom - region.bbox.y,
    })
  }
}

function pageLayoutKind(regions: SegmentedProblem[]): PageLayoutKind {
  const kinds = new Set(problemRegions(regions).map((region) => region.layout_kind))
  if (kinds.has('THEORY') && kinds.has('PROBLEM')) return 'MIXED'
  if (kinds.has('THEORY') && !kinds.has('PROBLEM')) return 'THEORY_PAGE'
  if (kinds.has('PROBLEM')) return 'PROBLEM_PAGE'
  return 'UNKNOWN'
}

export function problemRegions(regions: SegmentedProblem[]): SegmentedProblem[] {
  return regions.filter((region) => region.layout_kind === 'PROBLEM' || region.layout_kind === 'THEORY')
}

function footerTop(blocks: LayoutBlock[]): number {
  const footers = blocks.filter(
    (block) => (block.type ?? '').toLowerCase() === 'footer' || block.bbox.y >= FOOTER_MIN_Y,
  )
  if (footers.length === 0) return 0.955
  return Math.max(0.88, Math.min(...footers.map((block) => block.bbox.y)) - 0.01)
}

function assignImages(regions: SegmentedProblem[], images: LayoutImage[], columns: ColumnBand[]): void {
  for (const image of images) {
    if (isDecoration(image.bbox)) continue
    const overlaps = regions
      .map((region) => ({
        region,
        coverage: bboxCoverage(image.bbox, region.bbox),
        iou: bboxIoU(image.bbox, region.bbox),
        sameColumn: columnIndexFor(image.bbox, columns) === region.column_index,
        distance: imageDistance(image.bbox, region.bbox),
      }))
      .filter((row) => row.sameColumn)
      .sort((a, b) => b.coverage - a.coverage || a.distance - b.distance)

    const best = overlaps[0]
    const second = overlaps[1]
    if (!best) {
      const nearest = regions
        .map((region) => ({ region, distance: imageDistance(image.bbox, region.bbox), sameColumn: columnIndexFor(image.bbox, columns) === region.column_index }))
        .filter((row) => row.sameColumn)
        .sort((a, b) => a.distance - b.distance)[0]
      if (nearest && nearest.distance < 0.08) {
        attachImage(nearest.region, image, 'review', 'nearby_same_column_image')
      }
      continue
    }
    if (best.coverage >= 0.45 && (!second || second.coverage < 0.2)) {
      attachImage(best.region, image, 'assigned', 'image_overlap')
      continue
    }
    if (best.sameColumn && best.distance < 0.06 && (!second || second.coverage < best.coverage * 0.6)) {
      attachImage(best.region, image, 'review', 'image_column_ambiguous')
      continue
    }
    attachImage(best.region, image, 'review', 'image_assignment_uncertain')
  }
}

function attachImage(
  region: SegmentedProblem,
  image: LayoutImage,
  assignment: ImageAssignment,
  reason: string,
): void {
  region.assigned_images.push(image.id)
  region.bbox = expandBBox(unionBBoxes([region.bbox, image.bbox]), 0.006)
  region.image_assignment = region.image_assignment === 'review' ? 'review' : assignment
  region.evidence.push(`${reason}:${image.id}`)
  if (assignment === 'review') region.warnings.push(`image_review:${image.id}`)
}

function imageDistance(image: NormalizedBBox, region: NormalizedBBox): number {
  const ic = bboxCenter(image)
  const rc = bboxCenter(region)
  const dx = ic.x < region.x ? region.x - ic.x : ic.x > region.x + region.width ? ic.x - (region.x + region.width) : 0
  const dy = ic.y < region.y ? region.y - ic.y : ic.y > region.y + region.height ? ic.y - (region.y + region.height) : 0
  return Math.hypot(dx, dy) + Math.abs(ic.x - rc.x) * 0.15
}

function isDecoration(bbox: NormalizedBBox): boolean {
  return bbox.y < DECORATION_MAX_Y && bbox.x < 0.28 && bbox.height < 0.12 && bbox.width < 0.22
}

function finalizeStatus(regions: SegmentedProblem[], anchors: ProblemAnchor[], columns: ColumnBand[]): void {
  const numbers = regions
    .filter((region) => region.kind === 'four_digit')
    .map((region) => Number(region.detected_problem_number))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)

  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i]
    const height = region.bbox.height
    if (height < MIN_HEIGHT) region.warnings.push('bbox_too_small')
    if (height > MAX_HEIGHT) region.warnings.push('bbox_too_large')
    for (let j = i + 1; j < regions.length; j += 1) {
      if (bboxIoU(region.bbox, regions[j].bbox) >= OVERLAP_REVIEW) {
        region.warnings.push(`overlap:${regions[j].detected_problem_number}`)
        regions[j].warnings.push(`overlap:${region.detected_problem_number}`)
      }
    }
    const numeric = Number(region.detected_problem_number)
    if (region.kind === 'four_digit' && Number.isFinite(numeric)) {
      const idx = numbers.indexOf(numeric)
      const prev = idx > 0 ? numbers[idx - 1] : null
      const next = idx >= 0 && idx < numbers.length - 1 ? numbers[idx + 1] : null
      if ((prev != null && numeric - prev > 1) || (next != null && next - numeric > 1)) {
        region.warnings.push('number_sequence_gap')
      }
    }
    if (regions.filter((row) => row.detected_problem_number === region.detected_problem_number).length > 1) {
      region.warnings.push('duplicate_number')
    }
    if (columns.length > 1 && columns[0].split_confidence < 0.65) {
      region.warnings.push('column_uncertain')
    }
    if (anchors.length === 0) region.warnings.push('no_anchors')

    let confidence = region.kind === 'four_digit' ? 0.82 : region.kind === 'dotted' ? 0.62 : 0.48
    if (region.warnings.includes('last_in_column_bottom_uncertain')) confidence -= 0.12
    if (region.warnings.some((row) => row.startsWith('overlap'))) confidence -= 0.2
    if (region.warnings.includes('number_sequence_gap')) confidence -= 0.15
    if (region.warnings.includes('bbox_too_small') || region.warnings.includes('bbox_too_large')) confidence -= 0.15
    if (region.image_assignment === 'review') confidence -= 0.08
    if (region.warnings.includes('column_uncertain')) confidence -= 0.1
    if (!region.warnings.includes('last_in_column_bottom_uncertain') && region.kind === 'four_digit') confidence += 0.06
    region.confidence = Math.max(0.15, Math.min(0.96, confidence))

    if (region.layout_kind === 'THEORY' || region.layout_kind === 'SIDEBAR' || region.layout_kind === 'DECORATION') {
      region.status = 'REVIEW'
      continue
    }
    region.status =
      region.kind === 'four_digit' &&
      region.layout_kind === 'PROBLEM' &&
      region.confidence >= AUTO_OK_MIN &&
      !region.warnings.some((row) =>
        row.startsWith('overlap') ||
        row.startsWith('image_review') ||
        row === 'number_sequence_gap' ||
        row === 'duplicate_number' ||
        row === 'bbox_too_small' ||
        row === 'bbox_too_large' ||
        row === 'column_uncertain' ||
        row === 'last_in_column_bottom_uncertain' ||
        row.startsWith('weak_anchor') ||
        row.startsWith('not_problem'),
      )
        ? 'AUTO_OK'
        : 'REVIEW'
  }
}

function asPixelLike(raw: unknown): PixelLike | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as PixelLike
}

function hasPixelBox(block: PixelLike): boolean {
  return (
    Number.isFinite(block.top_left_x) &&
    Number.isFinite(block.top_left_y) &&
    Number.isFinite(block.bottom_right_x) &&
    Number.isFinite(block.bottom_right_y)
  )
}

function clip(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function regionContainsMostly(parent: NormalizedBBox, child: NormalizedBBox, min = 0.8): boolean {
  return bboxCoverage(child, parent) >= min
}
