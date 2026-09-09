import type { PipelineCandidate } from '../recognition/bookPipeline'

export const CROP_UNSAFE_DETAIL = [
  'BLANK_RATIO_HIGH',
  'HEIGHT_TOO_SMALL',
  'WIDTH_TOO_SMALL',
  'CONTENT_BOUNDARY_RISK',
  'BOTTOM_CUT_RISK',
  'TOP_CUT_RISK',
  'FIGURE_BOUNDARY_RISK',
  'OTHER',
] as const

export type CropUnsafeDetail = (typeof CROP_UNSAFE_DETAIL)[number]
export type CropQaLabel = 'TRUE_UNSAFE' | 'FALSE_POSITIVE_GATE' | 'AMBIGUOUS'

export type CropStatsRow = {
  page?: number
  problem_number?: string
  width: number | null
  height: number | null
  blank_ratio: number | null
  ink_ratio?: number | null
}

export type CropUnsafeAnalysis = {
  problem_number: string
  page: number
  reasons: CropUnsafeDetail[]
  blank_ratio: number | null
  ink_ratio: number | null
  width: number | null
  height: number | null
  bbox_height: number
  bbox_width: number
  figure_hint: boolean
  review_reasons: string[]
}

export const BLANK_RATIO_OLD = 0.92
const HEIGHT_PX_MIN = 48
const WIDTH_PX_MIN = 64
const INK_EMPTY = 0.012
const INK_HAS_CONTENT = 0.02

export function blankRatioBucket(value: number | null): string {
  if (value == null) return 'null'
  if (value < 0.8) return '<0.80'
  if (value < 0.85) return '0.80-0.85'
  if (value < 0.88) return '0.85-0.88'
  if (value < 0.9) return '0.88-0.90'
  if (value < 0.92) return '0.90-0.92'
  return '>=0.92'
}

export function cropUnsafeDetails(candidate: PipelineCandidate, stats?: CropStatsRow | null): CropUnsafeDetail[] {
  const reasons: CropUnsafeDetail[] = []
  const blank = stats?.blank_ratio ?? candidate.crop.blank_ratio
  const width = stats?.width ?? candidate.crop.width
  const height = stats?.height ?? candidate.crop.height
  const ink = stats?.ink_ratio ?? null
  if (blank != null && blank >= BLANK_RATIO_OLD) reasons.push('BLANK_RATIO_HIGH')
  if (height != null && height < HEIGHT_PX_MIN) reasons.push('HEIGHT_TOO_SMALL')
  if (width != null && width < WIDTH_PX_MIN) reasons.push('WIDTH_TOO_SMALL')
  if (candidate.bbox.y < 0.02) reasons.push('TOP_CUT_RISK')
  if (candidate.bbox.y + candidate.bbox.height > 0.98) reasons.push('BOTTOM_CUT_RISK')
  const otherNumbers = (candidate.stem_text.match(/\b\d{4}\b/g) ?? []).filter((n) => n !== candidate.problem_number)
  if (otherNumbers.length >= 1) reasons.push('CONTENT_BOUNDARY_RISK')
  if (candidate.bbox.x < 0.01 || candidate.bbox.x + candidate.bbox.width > 0.995 || candidate.bbox.width > 0.62) {
    reasons.push('CONTENT_BOUNDARY_RISK')
  }
  if (candidate.figure_hint && (candidate.figure_crop_risk || candidate.bbox.height < 0.08)) reasons.push('FIGURE_BOUNDARY_RISK')
  if (!candidate.crop.bbox_valid) reasons.push('OTHER')
  if (ink != null && ink < INK_EMPTY && !reasons.includes('OTHER')) reasons.push('OTHER')
  if (!reasons.length) reasons.push('OTHER')
  return [...new Set(reasons)]
}

export function analyzeCropUnsafe(candidate: PipelineCandidate, stats?: CropStatsRow | null): CropUnsafeAnalysis {
  return {
    problem_number: candidate.problem_number,
    page: candidate.page,
    reasons: cropUnsafeDetails(candidate, stats),
    blank_ratio: stats?.blank_ratio ?? candidate.crop.blank_ratio,
    ink_ratio: stats?.ink_ratio ?? null,
    width: stats?.width ?? candidate.crop.width,
    height: stats?.height ?? candidate.crop.height,
    bbox_height: candidate.bbox.height,
    bbox_width: candidate.bbox.width,
    figure_hint: candidate.figure_hint,
    review_reasons: candidate.review_reasons,
  }
}

export function labelCropSample(row: CropUnsafeAnalysis): CropQaLabel {
  const empty = (row.ink_ratio != null && row.ink_ratio < INK_EMPTY) || (row.height != null && row.height < HEIGHT_PX_MIN)
  const tiny = (row.width != null && row.width < WIDTH_PX_MIN) || row.bbox_height < 0.025
  const intrusion = row.review_reasons.includes('BODY_INTRUSION')
  const figureCut = row.reasons.includes('FIGURE_BOUNDARY_RISK') && row.figure_hint
  if (empty || tiny || intrusion || figureCut) return 'TRUE_UNSAFE'
  if (row.reasons.includes('CONTENT_BOUNDARY_RISK')) return 'TRUE_UNSAFE'
  const hasInk = row.ink_ratio != null && row.ink_ratio >= INK_HAS_CONTENT
  const tallEnough = row.height != null && row.height >= 80
  if (row.reasons.includes('BLANK_RATIO_HIGH') && hasInk && tallEnough && !intrusion) return 'FALSE_POSITIVE_GATE'
  return 'AMBIGUOUS'
}

export function oldCropGateBlocks(row: CropUnsafeAnalysis): boolean {
  return !!(row.blank_ratio != null && row.blank_ratio >= BLANK_RATIO_OLD)
}

export function candidateCropGateBlocks(row: CropUnsafeAnalysis): boolean {
  if (row.reasons.includes('CONTENT_BOUNDARY_RISK')) return true
  if (row.review_reasons.includes('BODY_INTRUSION')) return true
  if (row.height != null && row.height < HEIGHT_PX_MIN) return true
  if (row.width != null && row.width < WIDTH_PX_MIN) return true
  if (row.ink_ratio != null && row.ink_ratio < INK_EMPTY) return true
  if (row.reasons.includes('FIGURE_BOUNDARY_RISK')) return true
  if (row.bbox_height < 0.025) return true
  return false
}

export function simulateCropGates(rows: CropUnsafeAnalysis[]): {
  old: { AUTO: number; REVIEW: number; unsafe_auto_pass: number }
  candidate: { AUTO: number; REVIEW: number; unsafe_auto_pass: number }
  expected_review_reduction: number
} {
  let oldReview = 0
  let candReview = 0
  let oldUnsafePass = 0
  let candUnsafePass = 0
  for (const row of rows) {
    const truth = labelCropSample(row)
    const oldBlock = oldCropGateBlocks(row)
    const candBlock = candidateCropGateBlocks(row)
    if (oldBlock) oldReview += 1
    if (candBlock) candReview += 1
    if (!oldBlock && truth === 'TRUE_UNSAFE') oldUnsafePass += 1
    if (!candBlock && truth === 'TRUE_UNSAFE') candUnsafePass += 1
  }
  return {
    old: { AUTO: rows.length - oldReview, REVIEW: oldReview, unsafe_auto_pass: oldUnsafePass },
    candidate: { AUTO: rows.length - candReview, REVIEW: candReview, unsafe_auto_pass: candUnsafePass },
    expected_review_reduction: oldReview - candReview,
  }
}

export function pickStratifiedCropSample<T extends { page: number; blank_ratio: number | null; bbox_height: number; figure_hint: boolean }>(
  rows: T[],
  target = 60,
): T[] {
  if (rows.length <= target) return rows
  const buckets = new Map<string, T[]>()
  for (const row of rows) {
    const third = row.page <= 64 ? 'front' : row.page <= 128 ? 'mid' : 'back'
    const blank = blankRatioBucket(row.blank_ratio)
    const height = row.bbox_height < 0.06 ? 'short' : row.bbox_height < 0.14 ? 'med' : 'tall'
    const fig = row.figure_hint ? 'fig' : 'text'
    const key = `${third}|${blank}|${height}|${fig}`
    const list = buckets.get(key) ?? []
    list.push(row)
    buckets.set(key, list)
  }
  const picked: T[] = []
  const keys = [...buckets.keys()].sort()
  while (picked.length < target) {
    let added = false
    for (const key of keys) {
      const list = buckets.get(key)
      if (!list?.length) continue
      picked.push(list.shift()!)
      added = true
      if (picked.length >= target) break
    }
    if (!added) break
  }
  return picked
}

export function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const id = key(row)
    out[id] = (out[id] ?? 0) + 1
  }
  return out
}
