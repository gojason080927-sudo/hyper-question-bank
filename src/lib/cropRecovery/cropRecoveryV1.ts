import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { CROP_PAD } from '../recognition/problemPipeline'
import { isStructureIncomplete } from '../recognition/bookPipeline'
import {
  CROP_GATE_VERSION,
  evaluateCropGateV2,
  findNeighborProblemAnchors,
  findRangeIntrusion,
  type CropGateResult,
  type CropImageFeatures,
} from '../cropGate/cropGateV2'

export const STEP815 = '8.15'
export const STEP815_DIR = 'ocr-tests/taxonomy/step8-15'
export const STEP815_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const CROP_UNSAFE_FROZEN = 150
export const CROP_REVIEW_FROZEN = 823
export const FROZEN_DRAFTS_BEFORE = 265
export const FROZEN_TYPE_AUTO = 38
export const FROZEN_TYPE_THRESHOLD = 0.78
export const FROZEN_SOURCE_DIFFICULTY_ITEM = 62
export const FROZEN_SOURCE_DIFFICULTY_STAGE = 62
export const ASSIGNED_BY = 'STEP_8_15'
export const BATCH_SIZE = 20

/** Frozen CROP GATE v2 thresholds. Recovery must not change these. */
export const FROZEN_CROP_GATE = {
  version: CROP_GATE_VERSION,
  crop_pad: CROP_PAD,
  neighbor_iou_max: 0.12,
  figure_coverage_min: 0.7,
  top_cut_hard: 0.5,
  bottom_cut_hard: 0.5,
  left_cut_hard: 0.55,
  right_cut_hard: 0.5,
  edge_ambiguous: 0.32,
} as const

export const RECOVERY_CLASSES = [
  'A_RECOVERABLE_GEOMETRY',
  'B_RECOVERABLE_NEIGHBOR_CONTEXT',
  'C_RECOVERABLE_FIGURE_CONTEXT',
  'D_RECOVERABLE_NUMBER_IDENTITY',
  'E_RECOVERABLE_STRUCTURE',
  'F_NEEDS_OCR',
  'G_TRUE_AMBIGUOUS',
  'H_TRUE_UNSAFE',
] as const

export type RecoveryClass = (typeof RECOVERY_CLASSES)[number]

const AUTO_SOFT = new Set([
  'neighbor_header_in_pad',
  'neighbor_header_last_line',
  'column_last_bottom_uncertain',
  'top_edge_ambiguous',
  'bottom_edge_ambiguous',
  'left_edge_ambiguous',
  'right_edge_ambiguous',
  'visual_figure_unconfirmed',
  'self_number_from_segment_anchor',
])

const FORBID_BLOCKERS = new Set([
  'STRUCTURE_INCOMPLETE',
  'CHOICES_INCOMPLETE',
  'NUMBER_UNCERTAIN',
  'IDENTITY_UNSTABLE',
  'BODY_INTRUSION',
  'MATH_CONFLICT',
  'FIGURE_CROP_RISK',
  'NEEDS_PAID_OCR',
  'CACHE_MISS_BLOCKED',
  'THEORY_OR_SIDEBAR',
  'OCR_FAILED',
])

export type RecoveryNeighbor = {
  problem_number: string
  bbox: NormalizedBBox
}

export type RecoveryInput = {
  page: number
  problem_number: string
  canonical_problem_number: string | null
  bbox: NormalizedBBox
  stem: string
  markdown?: string
  choice_count: number
  choices: Array<{ index: number; text: string }>
  figure_hint: boolean
  graph_hint: boolean
  table_hint: boolean
  figure_crop_risk: boolean
  segmentation_status: string
  layout_kind: string
  math_conflict: boolean
  mathpix_cache_hit: boolean
  needs_paid_ocr: boolean
  remaining_blockers: string[]
  gate: CropGateResult
  image: CropImageFeatures | null
  next: RecoveryNeighbor | null
  page_problem_numbers: string[]
  already_draft: boolean
}

export type RecoveryConfidence = {
  geometry_confidence: number
  identity_confidence: number
  structure_confidence: number
  figure_confidence: number
  choice_confidence: number
  math_confidence: number
}

export type RecoveryEval = {
  page: number
  problem_number: string
  recovery_class: RecoveryClass
  auto_recover: boolean
  primary_reason: string
  secondary_reasons: string[]
  reject_reasons: string[]
  confidences: RecoveryConfidence
  original_bbox: NormalizedBBox
  recovery_bbox: NormalizedBBox | null
  original_bbox_overwritten: false
}

export function sameColumn(a: NormalizedBBox, b: NormalizedBBox): boolean {
  return Math.abs(a.x - b.x) < 0.08
}

export function findNextInColumn(self: NormalizedBBox, neighbors: RecoveryNeighbor[]): RecoveryNeighbor | null {
  return (
    neighbors
      .filter((row) => sameColumn(self, row.bbox) && row.bbox.y > self.y + 0.01)
      .sort((a, b) => a.bbox.y - b.bbox.y)[0] ?? null
  )
}

export function computeRecoveryBBox(self: NormalizedBBox, next: RecoveryNeighbor | null): NormalizedBBox | null {
  const bottom = self.y + self.height
  let height = self.height
  if (next && next.bbox.y < bottom - 0.002) {
    height = next.bbox.y - 0.006 - self.y
    if (height < 0.035) return null
  }
  try {
    return validateBBox({
      x: self.x,
      y: self.y,
      width: self.width,
      height,
      unit: 'normalized',
      origin: 'top-left',
    })
  } catch {
    return null
  }
}

export function recoveryIncludesNextProblem(bbox: NormalizedBBox, next: RecoveryNeighbor | null): boolean {
  if (!next) return false
  return next.bbox.y + 0.002 < bbox.y + bbox.height
}

export function expectedMcq(stem: string): boolean {
  return /[①-⑤]/.test(stem)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function evaluateRecovery(input: RecoveryInput): RecoveryEval {
  const reject: string[] = []
  const secondary = [...input.gate.soft_features]
  const primary = input.gate.soft_features[0] ?? input.remaining_blockers[0] ?? 'NONE'
  const self = input.canonical_problem_number ?? input.problem_number
  const text = `${input.stem}\n${input.markdown ?? ''}`
  const image = input.image
  const next = input.next
  const recovery_bbox = computeRecoveryBBox(input.bbox, next)
  const neighbors = findNeighborProblemAnchors({
    text,
    self,
    page_problem_numbers: input.page_problem_numbers,
  })
  const rangeHits = findRangeIntrusion(text, self)
  const mcq = expectedMcq(text)
  const incomplete = isStructureIncomplete({ stem: input.stem, choice_count: input.choice_count, expected_choices: mcq })
  const visual = input.figure_hint || input.graph_hint || input.table_hint || input.figure_crop_risk
  const top = image?.top_edge_px_span ?? 0
  const bottom = image?.bottom_edge_px_span ?? 0
  const left = image?.left_edge_px_span ?? 0
  const right = image?.right_edge_px_span ?? 0
  const neighborIou = Number(input.gate.features.neighbor_iou ?? 0)

  if (input.gate.decision === 'CROP_UNSAFE' || input.gate.hard_blockers.length) reject.push('HARD_BLOCKER')
  if (input.gate.decision !== 'CROP_REVIEW') reject.push('NOT_CROP_REVIEW')
  if (!input.canonical_problem_number || !/^\d{4}$/.test(input.canonical_problem_number)) reject.push('IDENTITY_UNSTABLE')
  if (input.segmentation_status !== 'AUTO_OK') reject.push('SEGMENT_NOT_AUTO')
  if (input.layout_kind !== 'PROBLEM') reject.push('NOT_PROBLEM_LAYOUT')
  if (input.already_draft) reject.push('ALREADY_DRAFT')
  if (input.needs_paid_ocr) reject.push('NEEDS_OCR')
  if (input.math_conflict) reject.push('MATH_CONFLICT')
  if (incomplete) reject.push('STRUCTURE_INCOMPLETE')
  if (mcq && input.choice_count < 5) reject.push('CHOICE_INCOMPLETE')
  if (visual) reject.push('FIGURE_NOT_AUTO')
  if (image?.figure_like_blob_edge) reject.push('FIGURE_EDGE')
  if (!image) reject.push('IMAGE_FEATURES_MISSING')
  if (neighbors.neighbors.length && !neighbors.last_line_only) reject.push('NEIGHBOR_BODY')
  if (rangeHits.length) reject.push('RANGE_INTRUSION')
  if (input.gate.evidence.adjacent === 'BODY_INTRUSION') reject.push('BODY_INTRUSION')
  if (neighborIou >= FROZEN_CROP_GATE.neighbor_iou_max) reject.push('NEIGHBOR_IOU')
  if (top >= FROZEN_CROP_GATE.edge_ambiguous) reject.push('TOP_EDGE')
  if (bottom >= 0.45) reject.push('BOTTOM_EDGE')
  if (left >= 0.38) reject.push('LEFT_EDGE')
  if (right >= FROZEN_CROP_GATE.edge_ambiguous) reject.push('RIGHT_EDGE')
  if (!recovery_bbox) reject.push('RECOVERY_BBOX_INVALID')
  if (recovery_bbox && recoveryIncludesNextProblem(recovery_bbox, next)) reject.push('NEXT_PROBLEM_IN_BBOX')
  if (input.gate.soft_features.some((row) => !AUTO_SOFT.has(row))) reject.push('SOFT_NOT_ALLOWLISTED')
  for (const blocker of input.remaining_blockers) {
    if (FORBID_BLOCKERS.has(blocker)) reject.push(blocker)
  }
  if (input.gate.features.is_column_last && bottom >= 0.28) reject.push('COLUMN_LAST_BOTTOM')

  let recovery_class: RecoveryClass = 'G_TRUE_AMBIGUOUS'
  if (input.gate.decision === 'CROP_UNSAFE' || input.gate.hard_blockers.length) recovery_class = 'H_TRUE_UNSAFE'
  else if (input.needs_paid_ocr) recovery_class = 'F_NEEDS_OCR'
  else if (visual || image?.figure_like_blob_edge) recovery_class = 'C_RECOVERABLE_FIGURE_CONTEXT'
  else if (!input.canonical_problem_number || input.segmentation_status !== 'AUTO_OK') {
    recovery_class = 'D_RECOVERABLE_NUMBER_IDENTITY'
  } else if (incomplete) recovery_class = 'E_RECOVERABLE_STRUCTURE'
  else if (input.gate.soft_features.includes('neighbor_header_in_pad') || input.gate.soft_features.includes('neighbor_header_last_line')) {
    recovery_class = 'B_RECOVERABLE_NEIGHBOR_CONTEXT'
  } else if (
    input.gate.soft_features.some((row) =>
      ['column_last_bottom_uncertain', 'top_edge_ambiguous', 'bottom_edge_ambiguous', 'left_edge_ambiguous', 'right_edge_ambiguous'].includes(
        row,
      ),
    )
  ) {
    recovery_class = 'A_RECOVERABLE_GEOMETRY'
  } else if (!image) recovery_class = 'G_TRUE_AMBIGUOUS'

  const confidences: RecoveryConfidence = {
    geometry_confidence:
      top < FROZEN_CROP_GATE.edge_ambiguous && bottom < 0.45 && left < 0.38 && right < FROZEN_CROP_GATE.edge_ambiguous
        ? 0.92
        : clamp01(1 - Math.max(top, bottom, left, right)),
    identity_confidence: input.canonical_problem_number && input.segmentation_status === 'AUTO_OK' ? 0.95 : 0.3,
    structure_confidence: incomplete ? 0.2 : 0.92,
    figure_confidence: visual || image?.figure_like_blob_edge ? 0.2 : 0.95,
    choice_confidence: mcq ? (input.choice_count >= 5 ? 0.92 : 0.2) : 0.9,
    math_confidence: input.math_conflict ? 0.2 : input.needs_paid_ocr ? 0.35 : 0.88,
  }
  const auto_recover =
    reject.length === 0 &&
    (recovery_class === 'A_RECOVERABLE_GEOMETRY' || recovery_class === 'B_RECOVERABLE_NEIGHBOR_CONTEXT') &&
    Object.values(confidences).every((value) => value >= 0.85)

  return {
    page: input.page,
    problem_number: input.problem_number,
    recovery_class,
    auto_recover,
    primary_reason: primary,
    secondary_reasons: secondary,
    reject_reasons: [...new Set(reject)],
    confidences,
    original_bbox: input.bbox,
    recovery_bbox,
    original_bbox_overwritten: false,
  }
}

export function globalGateUnchanged(input: Parameters<typeof evaluateCropGateV2>[0]): CropGateResult {
  return evaluateCropGateV2(input)
}

export function cropGateThresholdsFrozen(): typeof FROZEN_CROP_GATE {
  return FROZEN_CROP_GATE
}

export function pickStratifiedRecoveryQa<T extends { page: number; problem_number: string; recovery_class?: string }>(
  rows: T[],
  max = 100,
): T[] {
  if (rows.length <= max) return [...rows]
  const buckets = new Map<string, T[]>()
  for (const row of rows) {
    const third = row.page <= 64 ? 'front' : row.page <= 128 ? 'mid' : 'back'
    const key = `${third}|${row.recovery_class ?? 'x'}|${row.page % 7}`
    const list = buckets.get(key) ?? []
    list.push(row)
    buckets.set(key, list)
  }
  const picked: T[] = []
  const copies = [...buckets.values()].map((list) => [...list])
  let guard = 0
  while (picked.length < max && guard < 20_000) {
    guard += 1
    let added = false
    for (const list of copies) {
      const next = list.shift()
      if (!next) continue
      picked.push(next)
      added = true
      if (picked.length >= max) break
    }
    if (!added) break
  }
  return picked.slice(0, max)
}

export function qaCategory(evalRow: RecoveryEval): 'CRITICAL' | 'MAJOR' | 'COSMETIC' | 'OK' {
  if (
    evalRow.reject_reasons.some((row) =>
      ['HARD_BLOCKER', 'NEIGHBOR_BODY', 'FIGURE_EDGE', 'NEXT_PROBLEM_IN_BBOX', 'BODY_INTRUSION', 'IDENTITY_UNSTABLE'].includes(row),
    )
  ) {
    return 'CRITICAL'
  }
  if (evalRow.reject_reasons.length) return 'MAJOR'
  return 'OK'
}
