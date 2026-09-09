import { canonicalizeProblemNumber } from './draftUpsert'
import type { BookPageKind } from './bookClassify'
import type { LayoutKind, SegmentStatus } from './layoutSegment'
import type { NormalizedBBox } from '../pdf/bbox'

export const BOOK_STEP = '8.6'
export const ORIGINAL_PDF_REL = 'workers/ocr/data/ssen-common-math1.pdf'
export const EXPECTED_PAGE_COUNT = 192
export const PHASE_A_MAX_MISTRAL = 8
export const PHASE_A_MAX_MATHPIX = 0
export const PHASE_B_MAX_PROBLEMS = 10
export const PHASE_B_MAX_MISTRAL = 10
export const PHASE_B_MAX_MATHPIX = 8
export const CACHED_OCR_PAGES = [8, 12, 20, 28, 36, 44, 60, 84, 96, 108, 120, 156, 180] as const

export const REVIEW_REASONS = [
  'CROP_UNSAFE',
  'BODY_INTRUSION',
  'NUMBER_UNCERTAIN',
  'STRUCTURE_INCOMPLETE',
  'CHOICES_INCOMPLETE',
  'FIGURE_CROP_RISK',
  'PAGE_KIND_UNCERTAIN',
  'THEORY_OR_SIDEBAR',
  'OCR_REQUIRED',
  'MATH_CONFLICT',
  'IDENTITY_UNSTABLE',
  'OTHER',
] as const

export type ReviewReason = (typeof REVIEW_REASONS)[number]
export type NumberFlowStatus = 'NORMAL' | 'SUSPICIOUS' | 'REVIEW'
export type DryRunQuality = 'DRAFT_READY' | 'PIPELINE_REVIEW' | 'NEEDS_OCR' | 'BLOCKED_NON_PROBLEM'
export type DryRunRoute = 'WOULD_USE_MISTRAL_ONLY' | 'WOULD_USE_HYBRID' | 'WOULD_REVIEW' | 'NEEDS_OCR' | 'BLOCKED'

export type BookPageInventory = {
  page: number
  page_kind: BookPageKind
  classification_confidence: number
  problem_anchor_count: number
  segmentation_candidate_count: number
  needs_ocr: boolean
  ink_ratio: number | null
  has_ocr_cache: boolean
  warnings: string[]
}

export type ProblemCandidate = {
  page: number
  problem_number: string
  canonical_problem_number: string | null
  bbox: NormalizedBBox
  layout_kind: LayoutKind
  segmentation_status: SegmentStatus
  confidence: number
  warnings: string[]
  review_reasons: ReviewReason[]
  quality: DryRunQuality
  route: DryRunRoute
  figure_hint: boolean
  graph_hint: boolean
  table_hint: boolean
  figure_crop_risk: boolean
  number_flow: NumberFlowStatus
  stem_preview: string
  choice_count: number
  crop: {
    width: number | null
    height: number | null
    blank_ratio: number | null
    bbox_valid: boolean
  }
}

export function mapGateReasons(reasons: string[], extra: ReviewReason[] = []): ReviewReason[] {
  const out = new Set<ReviewReason>(extra)
  for (const reason of reasons) {
    if (reason === 'crop_gate' || reason === 'crop_not_safe' || reason.includes('body_clipped')) out.add('CROP_UNSAFE')
    else if (reason === 'body_intrusion' || reason === 'adjacent_body_intrusion') out.add('BODY_INTRUSION')
    else if (reason.includes('problem_number') || reason === 'segmentation_gate') out.add('NUMBER_UNCERTAIN')
    else if (reason === 'structure_gate' || reason === 'structure_incomplete') out.add('STRUCTURE_INCOMPLETE')
    else if (reason === 'missing_choice') out.add('CHOICES_INCOMPLETE')
    else if (reason.includes('figure') || reason === 'figure_cut_by_bbox') out.add('FIGURE_CROP_RISK')
    else if (reason === 'math_gate' || reason === 'math_conflict') out.add('MATH_CONFLICT')
    else if (reason === 'persistence_gate') out.add('IDENTITY_UNSTABLE')
    else out.add('OTHER')
  }
  return [...out]
}

export function inspectNumberFlow(candidates: Array<{ page: number; problem_number: string }>): {
  rows: Array<{ page: number; problem_number: string; status: NumberFlowStatus; note: string }>
  duplicate: number
  reverse: number
  suspicious_jump: number
  unstable: number
  normal_structure_jumps: number
} {
  const rows: Array<{ page: number; problem_number: string; status: NumberFlowStatus; note: string }> = []
  const seen = new Map<string, number[]>()
  let duplicate = 0
  let reverse = 0
  let suspicious_jump = 0
  let unstable = 0
  let normal_structure_jumps = 0
  const ordered = [...candidates].sort((a, b) => a.page - b.page || a.problem_number.localeCompare(b.problem_number))
  for (const row of ordered) {
    const canonical = canonicalizeProblemNumber(row.problem_number)
    if (!canonical) {
      unstable += 1
      rows.push({ ...row, status: 'REVIEW', note: 'IDENTITY_UNSTABLE' })
      continue
    }
    const pages = seen.get(canonical) ?? []
    pages.push(row.page)
    seen.set(canonical, pages)
    if (pages.length > 1) {
      duplicate += 1
      rows.push({ ...row, status: 'REVIEW', note: `duplicate_on_pages:${pages.join(',')}` })
    } else {
      rows.push({ ...row, status: 'NORMAL', note: 'unique' })
    }
  }
  const numbered = ordered
    .map((row) => ({ ...row, n: Number(canonicalizeProblemNumber(row.problem_number)) }))
    .filter((row) => Number.isFinite(row.n))
  for (let i = 1; i < numbered.length; i += 1) {
    const prev = numbered[i - 1]
    const cur = numbered[i]
    if (cur.page >= prev.page && cur.n < prev.n) {
      reverse += 1
      const target = rows.find((row) => row.page === cur.page && row.problem_number === cur.problem_number)
      if (target) {
        target.status = 'REVIEW'
        target.note = `reverse:${prev.problem_number}->${cur.problem_number}`
      }
    }
    const gap = cur.n - prev.n
    if (gap > 1 && cur.page === prev.page) {
      suspicious_jump += 1
      const target = rows.find((row) => row.page === cur.page && row.problem_number === cur.problem_number)
      if (target && target.status === 'NORMAL') {
        target.status = 'SUSPICIOUS'
        target.note = `same_page_gap:${gap}`
      }
    } else if (gap > 20 && cur.page - prev.page > 1) {
      normal_structure_jumps += 1
    }
  }
  return { rows, duplicate, reverse, suspicious_jump, unstable, normal_structure_jumps }
}

export function pickStratifiedSample(candidates: ProblemCandidate[], target = 20): ProblemCandidate[] {
  const groups: Array<(row: ProblemCandidate) => boolean> = [
    (row) => row.page <= 36,
    (row) => row.page > 36 && row.page < 120,
    (row) => row.page >= 120,
    (row) => row.choice_count >= 5,
    (row) => row.choice_count === 0 && row.quality !== 'BLOCKED_NON_PROBLEM',
    (row) => row.figure_hint,
    (row) => row.graph_hint || row.table_hint,
    (row) => row.stem_preview.length >= 80,
    (row) => row.route === 'WOULD_USE_HYBRID',
    (row) => row.route === 'WOULD_USE_MISTRAL_ONLY',
    (row) => row.quality === 'PIPELINE_REVIEW',
  ]
  const picked: ProblemCandidate[] = []
  const used = new Set<string>()
  const key = (row: ProblemCandidate) => `${row.page}:${row.problem_number}`
  for (const match of groups) {
    const hit = candidates.find((row) => match(row) && !used.has(key(row)))
    if (hit) {
      used.add(key(hit))
      picked.push(hit)
    }
  }
  for (const row of candidates) {
    if (picked.length >= target) break
    if (!used.has(key(row))) {
      used.add(key(row))
      picked.push(row)
    }
  }
  return picked.slice(0, Math.min(25, Math.max(15, target)))
}

export function pickPhaseBPilot(candidates: ProblemCandidate[], max = PHASE_B_MAX_PROBLEMS): ProblemCandidate[] {
  const ready = candidates.filter((row) => row.quality === 'DRAFT_READY' && row.canonical_problem_number)
  const prefer = ['0159', '0274', '0401', '0402', '1092', '0162', '0276', '1091', '0652', '0043']
  const picked: ProblemCandidate[] = []
  const used = new Set<string>()
  const take = (hit: ProblemCandidate | undefined) => {
    if (!hit || used.has(hit.problem_number) || picked.length >= max) return
    used.add(hit.problem_number)
    picked.push(hit)
  }
  for (const number of prefer) take(ready.find((row) => row.problem_number === number))
  take(ready.find((row) => row.page <= 20 && !used.has(row.problem_number)))
  take(ready.find((row) => row.choice_count >= 5 && !used.has(row.problem_number)))
  take(ready.find((row) => row.figure_hint && !used.has(row.problem_number)))
  take(ready.find((row) => row.route === 'WOULD_USE_HYBRID' && !used.has(row.problem_number)))
  take(ready.find((row) => row.page >= 150 && !used.has(row.problem_number)))
  for (const row of ready) take(row)
  return picked.slice(0, max)
}

export function emptyReasonCounts(): Record<ReviewReason, number> {
  return Object.fromEntries(REVIEW_REASONS.map((reason) => [reason, 0])) as Record<ReviewReason, number>
}
