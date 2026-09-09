import { MODEL_A_CUTS, type PrimaryBand } from './difficulty813a'

/** Publisher 하/중/상 is never HYPER LOW/MID/HIGH. */
export type PublisherBadgeNorm = 'LOW_BADGE' | 'MID_BADGE' | 'HIGH_BADGE' | 'UNKNOWN'
export type BadgeGate = 'CONFIRMED' | 'REVIEW' | 'UNKNOWN'
export type PipelineStatus = 'DRAFT' | 'CROP_REVIEW' | 'CROP_UNSAFE' | 'OTHER'

export const BADGE_IS_NOT_HYPER = true
export const FROZEN_MODEL_C_CUTS = MODEL_A_CUTS
export const OCR_TEXT_ALONE_CANNOT_CONFIRM = true

export const VISUAL_BADGE_PROFILE = {
  edition: '쎈 공통수학1',
  observed_on_pages: [12, 15, 16, 68, 83, 87, 88],
  layout: '[4-digit problem number] [small colored dots] [filled circle with Hangul] [small colored dots]',
  number_color: {
    A_BASIC: 'red/orange-red, no 하/중/상 circle',
    B_TYPE: 'green',
    B_TYPE_REPRESENTATIVE: 'orange number + rectangular 대표 문제 label',
    B_SKILL: 'blue number + 교육청 기출 / 유형 refs, no 하/중/상 circle',
  },
  circles: {
    하: { fill: 'orange', glyph: '하', dots: 'orange', normalized: 'LOW_BADGE' },
    중: { fill: 'blue-violet', glyph: '중', dots: 'blue', normalized: 'MID_BADGE' },
    상: { fill: 'pink/magenta', glyph: '상', dots: 'pink', normalized: 'HIGH_BADGE' },
  },
  extras: {
    서술형: 'gold/brown rounded rectangle, not a difficulty badge',
    대표_문제: 'orange-bordered rectangle, not 하/중/상',
  },
  note: 'Colors and layout were read from original page PNGs. Not inferred from OCR.',
} as const

export function normalizePublisherBadge(raw: string | null | undefined): PublisherBadgeNorm {
  if (raw === '하') return 'LOW_BADGE'
  if (raw === '중') return 'MID_BADGE'
  if (raw === '상') return 'HIGH_BADGE'
  return 'UNKNOWN'
}

export function publisherBadgeIsNotHyper(
  badge: PublisherBadgeNorm,
  hyper: PrimaryBand | 'LOW' | 'MID' | 'HIGH' | 'REVIEW',
): boolean {
  return String(badge) !== String(hyper)
}

export function publisherBadgeDoesNotForceHyper(
  badge: PublisherBadgeNorm,
  hyper: PrimaryBand,
): boolean {
  if (badge === 'LOW_BADGE' && hyper === 'LOW') return true
  if (badge === 'MID_BADGE' && hyper === 'MID') return true
  if (badge === 'HIGH_BADGE' && hyper === 'HIGH') return true
  return publisherBadgeIsNotHyper(badge, hyper)
}

export function ocrTextCannotConfirmBadge(ocrOnly: boolean, visualCircle: boolean): BadgeGate {
  if (ocrOnly && !visualCircle) return 'REVIEW'
  if (!visualCircle) return 'UNKNOWN'
  return 'CONFIRMED'
}

export function associationMismatchGate(input: {
  visualCircle: boolean
  problemNumberInHeader: boolean
  multipleCirclesConflict: boolean
}): { gate: BadgeGate; reason: string | null } {
  if (input.multipleCirclesConflict) return { gate: 'REVIEW', reason: 'multiple_colored_circles_conflict' }
  if (input.visualCircle && !input.problemNumberInHeader) return { gate: 'REVIEW', reason: 'badge_problem_association_unambiguous_fail' }
  if (!input.visualCircle) return { gate: 'UNKNOWN', reason: 'no_visual_circle' }
  return { gate: 'CONFIRMED', reason: null }
}

export function decideBadgeGate(input: {
  visual_class: '하' | '중' | '상' | null
  circular: boolean
  expected_position: boolean
  number_color: 'green' | 'red' | 'blue' | 'orange' | 'unknown'
  extras: string[]
  ocr_raw: string | null
  conflict: boolean
  header_clipped: boolean
}): { gate: BadgeGate; reason: string | null; raw: string | null } {
  if (input.conflict) return { gate: 'REVIEW', reason: 'ambiguous_multi_class', raw: input.visual_class }
  if (input.header_clipped && !input.visual_class) {
    return { gate: 'REVIEW', reason: 'header_may_be_clipped', raw: null }
  }
  if (input.visual_class && input.circular && input.expected_position && input.number_color === 'green') {
    return { gate: 'CONFIRMED', reason: null, raw: input.visual_class }
  }
  if (input.visual_class && input.circular && input.expected_position && input.number_color === 'orange' && !input.extras.includes('대표 문제')) {
    return { gate: 'CONFIRMED', reason: null, raw: input.visual_class }
  }
  if (input.visual_class && (!input.circular || !input.expected_position)) {
    return { gate: 'REVIEW', reason: 'shape_or_position_ambiguous', raw: input.visual_class }
  }
  if (input.ocr_raw && !input.visual_class) {
    return { gate: 'REVIEW', reason: 'ocr_text_alone_cannot_confirm', raw: input.ocr_raw }
  }
  if (input.number_color === 'red' || input.number_color === 'blue') {
    return { gate: 'UNKNOWN', reason: 'stage_without_item_badge', raw: null }
  }
  return { gate: 'UNKNOWN', reason: 'no_badge', raw: null }
}

export function extractOcrBadgeHint(text: string): { raw: string | null; extras: string[] } {
  const compact = text.replace(/\s+/g, ' ')
  const extras: string[] = []
  if (/대표\s*문제/.test(compact)) extras.push('대표 문제')
  if (/서술형/.test(compact)) extras.push('서술형')
  if (/집중\s*공략/.test(compact)) extras.push('집중 공략')
  if (/교육청\s*기출/.test(compact)) extras.push('교육청 기출')
  if (/사고력의\s*기술|사고의\s*기술/.test(compact)) extras.push('사고력의 기술')
  const raw = /(?:^|[^\w가-힣])(하|중|상)(?:[^\w가-힣]|$)/.test(compact)
    ? compact.match(/(?:^|[^\w가-힣])(하|중|상)(?:[^\w가-힣]|$)/)?.[1] ?? null
    : null
  return { raw, extras }
}

export function extractTypeHeading(text: string): string | null {
  const match = text.replace(/\s+/g, ' ').match(/유형\s*(\d{1,2})(?:\s*([가-힣]{2,16}))?/)
  if (!match) return null
  return match[2] ? `유형 ${match[1]} ${match[2]}` : `유형 ${match[1]}`
}

export function percentileStats(values: number[]) {
  if (!values.length) return { n: 0, min: 0, q1: 0, median: 0, mean: 0, q3: 0, max: 0, std: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => {
    const index = (sorted.length - 1) * p
    const lo = Math.floor(index)
    const hi = Math.ceil(index)
    if (lo === hi) return sorted[lo] ?? 0
    return (sorted[lo] ?? 0) * (hi - index) + (sorted[hi] ?? 0) * (index - lo)
  }
  const mean = sorted.reduce((acc, item) => acc + item, 0) / sorted.length
  const variance = sorted.reduce((acc, item) => acc + (item - mean) ** 2, 0) / sorted.length
  return {
    n: sorted.length,
    min: Number(sorted[0]!.toFixed(3)),
    q1: Number(q(0.25).toFixed(3)),
    median: Number(q(0.5).toFixed(3)),
    mean: Number(mean.toFixed(3)),
    q3: Number(q(0.75).toFixed(3)),
    max: Number(sorted[sorted.length - 1]!.toFixed(3)),
    std: Number(Math.sqrt(variance).toFixed(3)),
  }
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null
  const rank = (values: number[]) => {
    const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
    const ranks = Array(values.length).fill(0)
    let i = 0
    while (i < sorted.length) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1]!.value === sorted[i]!.value) j += 1
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k += 1) ranks[sorted[k]!.index] = avg
      i = j + 1
    }
    return ranks
  }
  const rx = rank(xs)
  const ry = rank(ys)
  const n = xs.length
  const mx = rx.reduce((acc, item) => acc + item, 0) / n
  const my = ry.reduce((acc, item) => acc + item, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    const a = rx[i]! - mx
    const b = ry[i]! - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  if (dx === 0 || dy === 0) return null
  return Number((num / Math.sqrt(dx * dy)).toFixed(3))
}

export function ordinalRank(badge: PublisherBadgeNorm): number | null {
  if (badge === 'LOW_BADGE') return 1
  if (badge === 'MID_BADGE') return 2
  if (badge === 'HIGH_BADGE') return 3
  return null
}
