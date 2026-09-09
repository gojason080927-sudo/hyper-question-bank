import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import type { LayoutTextBlock } from './segmentationV3'

export type LogicalRegionKind = 'HEADER' | 'FOOTER' | 'MAIN_COLUMN_1' | 'MAIN_COLUMN_2' | 'SIDEBAR' | 'OTHER'
export type PageLayoutClass = 'ONE_COLUMN' | 'TWO_COLUMN' | 'MAIN_PLUS_SIDEBAR' | 'MIXED' | 'UNKNOWN'

export type LogicalRegion = {
  kind: LogicalRegionKind
  bbox: NormalizedBBox
  confidence: number
  evidence: string[]
}

export type PageRegionMap = {
  layout_class: PageLayoutClass
  regions: LogicalRegion[]
  main: LogicalRegion
  sidebar: LogicalRegion | null
  header: LogicalRegion
  footer: LogicalRegion
}

export type SidebarOwnership = {
  nearest_problem_display: string | null
  vertical_overlap: number
  ambiguous: boolean
  merge_into_stem: false
  auto_allowed: boolean
  evidence: string[]
}

const HEADER_Y = 0.07
const FOOTER_Y = 0.93

function box(x: number, y: number, width: number, height: number): NormalizedBBox {
  return validateBBox({
    x: Math.min(0.98, Math.max(0, x)),
    y: Math.min(0.98, Math.max(0, y)),
    width: Math.min(1, Math.max(0.01, width)),
    height: Math.min(1, Math.max(0.01, height)),
    unit: 'normalized',
    origin: 'top-left',
  })
}

function inPage(block: LayoutTextBlock): boolean {
  return block.bbox.x >= 0 && block.bbox.x <= 1 && block.bbox.y >= 0 && block.bbox.y <= 1
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function largestGap(values: number[], minX: number, maxX: number): { gap: number; cut: number } {
  const xs = [...new Set(values.filter((x) => x >= minX && x <= maxX))].sort((a, b) => a - b)
  let gap = 0
  let cut = 0.5
  for (let i = 1; i < xs.length; i += 1) {
    const d = xs[i] - xs[i - 1]
    if (d > gap) {
      gap = d
      cut = (xs[i] + xs[i - 1]) / 2
    }
  }
  return { gap, cut }
}

export function detectPageRegions(blocks: LayoutTextBlock[]): PageRegionMap {
  const header = box(0, 0, 1, HEADER_Y)
  const footer = box(0, FOOTER_Y, 1, 1 - FOOTER_Y)
  const body = blocks.filter((block) => inPage(block) && block.bbox.y > HEADER_Y && block.bbox.y < FOOTER_Y)
  const lefts = body.map((block) => block.bbox.x)
  const { gap, cut } = largestGap(lefts, 0.18, 0.88)
  const left = body.filter((block) => block.bbox.x + block.bbox.width / 2 < cut)
  const right = body.filter((block) => block.bbox.x + block.bbox.width / 2 >= cut)
  const leftWidth = median(left.map((block) => block.bbox.width))
  const rightWidth = median(right.map((block) => block.bbox.width))
  const rightX = median(right.map((block) => block.bbox.x))
  const leftChars = left.reduce((sum, block) => sum + (block.content?.length ?? 0), 0)
  const rightChars = right.reduce((sum, block) => sum + (block.content?.length ?? 0), 0)
  const narrowRight = rightWidth > 0 && rightWidth < 0.32 && rightX >= 0.62 && rightWidth / Math.max(leftWidth, 0.2) < 0.62
  const twoMain =
    gap >= 0.08 &&
    left.length >= 2 &&
    right.length >= 2 &&
    rightWidth >= 0.28 &&
    leftWidth >= 0.28 &&
    cut > 0.38 &&
    cut < 0.62

  let layout_class: PageLayoutClass = 'ONE_COLUMN'
  let sidebar: LogicalRegion | null = null
  const regions: LogicalRegion[] = [
    { kind: 'HEADER', bbox: header, confidence: 0.9, evidence: ['top_band'] },
    { kind: 'FOOTER', bbox: footer, confidence: 0.9, evidence: ['bottom_band'] },
  ]

  if (gap >= 0.08 && narrowRight && right.length >= 1 && leftChars > rightChars) {
    layout_class = 'MAIN_PLUS_SIDEBAR'
    const mainBox = box(0.06, HEADER_Y, Math.max(0.4, cut - 0.08), FOOTER_Y - HEADER_Y)
    const sideBox = box(Math.min(0.92, cut), HEADER_Y, Math.max(0.08, 0.98 - cut), FOOTER_Y - HEADER_Y)
    regions.push({
      kind: 'MAIN_COLUMN_1',
      bbox: mainBox,
      confidence: 0.78,
      evidence: ['left_text_cluster', 'width_ratio_narrow_right', `gap_${gap.toFixed(3)}`],
    })
    sidebar = {
      kind: 'SIDEBAR',
      bbox: sideBox,
      confidence: 0.74,
      evidence: ['narrow_right_cluster', 'repeated_alignment', 'density_lower_than_main'],
    }
    regions.push(sidebar)
  } else if (twoMain) {
    layout_class = 'TWO_COLUMN'
    regions.push({
      kind: 'MAIN_COLUMN_1',
      bbox: box(0.04, HEADER_Y, cut - 0.06, FOOTER_Y - HEADER_Y),
      confidence: 0.8,
      evidence: ['column_gap', 'similar_widths'],
    })
    regions.push({
      kind: 'MAIN_COLUMN_2',
      bbox: box(cut, HEADER_Y, 0.96 - cut, FOOTER_Y - HEADER_Y),
      confidence: 0.8,
      evidence: ['column_gap', 'similar_widths'],
    })
  } else if (gap >= 0.08 && left.length && right.length) {
    layout_class = 'MIXED'
    regions.push({
      kind: 'MAIN_COLUMN_1',
      bbox: box(0.06, HEADER_Y, 0.88, FOOTER_Y - HEADER_Y),
      confidence: 0.55,
      evidence: ['gap_present_widths_unbalanced'],
    })
  } else {
    regions.push({
      kind: 'MAIN_COLUMN_1',
      bbox: box(0.06, HEADER_Y, 0.88, FOOTER_Y - HEADER_Y),
      confidence: body.length ? 0.7 : 0.4,
      evidence: ['single_left_cluster'],
    })
  }

  const main = regions.find((row) => row.kind === 'MAIN_COLUMN_1') ?? regions[0]
  if (!body.length) layout_class = 'UNKNOWN'
  return {
    layout_class,
    regions,
    main,
    sidebar,
    header: regions[0],
    footer: regions[1],
  }
}

export function regionOfPoint(map: PageRegionMap, x: number, y: number): LogicalRegionKind {
  if (y <= map.header.bbox.y + map.header.bbox.height) return 'HEADER'
  if (y >= map.footer.bbox.y) return 'FOOTER'
  if (map.sidebar) {
    const side = map.sidebar.bbox
    if (x >= side.x && x <= side.x + side.width) return 'SIDEBAR'
  }
  const col2 = map.regions.find((row) => row.kind === 'MAIN_COLUMN_2')
  if (col2 && x >= col2.bbox.x) return 'MAIN_COLUMN_2'
  return 'MAIN_COLUMN_1'
}

export function sidebarOwnership(input: {
  sidebar: LogicalRegion
  problem_boxes: Array<{ display_number: string; bbox: NormalizedBBox }>
}): SidebarOwnership {
  const side = input.sidebar.bbox
  const overlaps = input.problem_boxes
    .map((row) => {
      const top = Math.max(side.y, row.bbox.y)
      const bottom = Math.min(side.y + side.height, row.bbox.y + row.bbox.height)
      const vertical_overlap = Math.max(0, bottom - top)
      return { display_number: row.display_number, vertical_overlap }
    })
    .filter((row) => row.vertical_overlap > 0.02)
    .sort((a, b) => b.vertical_overlap - a.vertical_overlap)
  const best = overlaps[0]
  const second = overlaps[1]
  const ambiguous = Boolean(best && second && second.vertical_overlap > best.vertical_overlap * 0.7)
  return {
    nearest_problem_display: best?.display_number ?? null,
    vertical_overlap: best?.vertical_overlap ?? 0,
    ambiguous,
    merge_into_stem: false,
    auto_allowed: Boolean(best) && !ambiguous && best.vertical_overlap >= 0.08,
    evidence: ambiguous ? ['two_problems_overlap_rail'] : best ? ['nearest_vertical_overlap'] : ['no_problem_overlap'],
  }
}
