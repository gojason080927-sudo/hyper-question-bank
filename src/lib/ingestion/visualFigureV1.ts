import { bboxArea, bboxCenter, bboxCoverage, bboxIntersectionArea, bboxIoU, expandBBox, validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { layoutFigureReference, sharedFigureCue } from './contextRoleV2'

export const STEP822 = '8.22'
export const STEP822_DIR = 'ocr-tests/taxonomy/step8-22'
export const DETECTOR_SCRIPT = 'scripts/visual-figure-detect.py'

export const DEFAULT_THRESHOLDS = {
  detection_confidence_min: 0.62,
  auto_detection_min: 0.7,
  owner_high: 0.78,
  owner_gap: 0.15,
  owner_review_gap: 0.12,
  shared_both: 0.58,
  match_iou: 0.28,
  contained_full: 0.9,
  contained_minor: 0.75,
  crop_pad: 0.012,
  neighbor_overlap: 0.08,
  text_ref_bonus: 0.06,
}

export const AFTER_THRESHOLDS = {
  ...DEFAULT_THRESHOLDS,
  detection_confidence_min: 0.58,
}

export type FigureType =
  | 'GRAPH'
  | 'COORDINATE_PLANE'
  | 'GEOMETRY_DIAGRAM'
  | 'NUMBER_LINE'
  | 'VENN_DIAGRAM'
  | 'TREE_DIAGRAM'
  | 'TABLE'
  | 'GRID'
  | 'MATRIX_VISUAL'
  | 'FLOW_DIAGRAM'
  | 'ILLUSTRATION'
  | 'COMPOSITE_FIGURE'
  | 'GRAPHICAL_FIGURE'
  | 'UNKNOWN_VISUAL'

export type VisualFigureCandidate = {
  figure_id: string
  page: number
  bbox: NormalizedBBox
  figure_type: FigureType | string
  figure_confidence: number
  visual_evidence: string[]
  text_overlap: number
  region_membership: string
}

export type ProblemRef = {
  id: string
  display_number: string
  bbox: NormalizedBBox
  stem: string
}

export type OwnershipStatus =
  | 'SINGLE_OWNER_HIGH'
  | 'SINGLE_OWNER_REVIEW'
  | 'SHARED_OWNER_HIGH'
  | 'SHARED_OWNER_REVIEW'
  | 'UNRESOLVED'

export type FigureOwnershipV3 = {
  owner_problem_id_candidate: string | null
  owner_score: number
  owner_confidence: number
  alternative_owner_candidates: Array<{ id: string; score: number }>
  shared_candidate: boolean
  ownership_evidence: string[]
  status: OwnershipStatus
}

export type CropSafety = 'FIGURE_CROP_SAFE' | 'FIGURE_CROP_REVIEW' | 'FIGURE_CROP_UNSAFE'
export type BBoxQuality = 'FULLY_CONTAINED' | 'MINOR_EDGE_ERROR' | 'MAJOR_CUT' | 'WRONG_REGION'

export function box(x: number, y: number, width: number, height: number): NormalizedBBox {
  return validateBBox({ x, y, width, height, unit: 'normalized', origin: 'top-left' })
}

export function originalPageIsSourceOfTruth(input: { crop_from_original_render: boolean; generated: boolean; redrawn: boolean }): boolean {
  return input.crop_from_original_render && !input.generated && !input.redrawn
}

export function textReferenceIsSupportingOnly(): number {
  return DEFAULT_THRESHOLDS.text_ref_bonus
}

export function genericizeType(kind: string): FigureType | string {
  if (kind === 'GRAPH' || kind === 'COORDINATE_PLANE') return 'GRAPHICAL_FIGURE'
  return kind
}

export function bboxQuality(detected: NormalizedBBox, truth: NormalizedBBox): BBoxQuality {
  const contained = bboxCoverage(truth, detected)
  const extra = bboxCoverage(detected, expandBBox(truth, 0.08))
  const scale = bboxArea(detected) / Math.max(1e-6, bboxArea(truth))
  if (scale > 3.2) return 'WRONG_REGION'
  if (contained >= 0.9 && extra >= 0.55 && scale <= 2.4) return 'FULLY_CONTAINED'
  if (contained >= 0.75 && scale <= 2.8) return 'MINOR_EDGE_ERROR'
  if (contained >= 0.4) return 'MAJOR_CUT'
  return 'WRONG_REGION'
}

function sameColumn(figure: NormalizedBBox, problem: NormalizedBBox): boolean {
  const cx = bboxCenter(figure).x
  return cx >= problem.x - 0.05 && cx <= problem.x + problem.width + 0.05
}

function verticalMembership(figure: NormalizedBBox, problem: NormalizedBBox, next?: NormalizedBBox): boolean {
  const top = problem.y - 0.02
  const bottom = next ? next.y - 0.004 : problem.y + problem.height + 0.1
  const fy = bboxCenter(figure).y
  return fy >= top && fy <= bottom
}

export function scoreFigureOwnershipV3(input: {
  figure: VisualFigureCandidate
  problems: ProblemRef[]
  page_text: string
  thresholds?: typeof DEFAULT_THRESHOLDS
}): FigureOwnershipV3 {
  const thr = input.thresholds ?? DEFAULT_THRESHOLDS
  const center = bboxCenter(input.figure.bbox)
  const sorted = [...input.problems].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
  const scored = sorted.map((problem, index) => {
    const next = sorted.slice(index + 1).find((row) => Math.abs(row.bbox.x - problem.bbox.x) < 0.28)
    const contained = bboxCoverage(input.figure.bbox, expandBBox(problem.bbox, 0.05))
    const dist = Math.hypot(center.x - bboxCenter(problem.bbox).x, center.y - bboxCenter(problem.bbox).y)
    const nextDist = next ? Math.hypot(center.x - bboxCenter(next.bbox).x, center.y - bboxCenter(next.bbox).y) : 9
    const col = sameColumn(input.figure.bbox, problem.bbox)
    const vert = verticalMembership(input.figure.bbox, problem.bbox, next?.bbox)
    const rightOfStem = input.figure.bbox.x >= problem.bbox.x + Math.min(0.12, problem.bbox.width * 0.25)
    const ref = layoutFigureReference(problem.stem)
    let score = 0
    const evidence: string[] = []
    if (col) {
      score += 0.28
      evidence.push('same_column')
    }
    if (vert) {
      score += 0.2
      evidence.push('vertical_region')
    }
    if (contained >= 0.65) {
      score += 0.32
      evidence.push('inside_problem_region')
    } else if (contained > 0.2) {
      score += 0.12
      evidence.push('partial_region')
    }
    if (rightOfStem && vert) {
      score += 0.1
      evidence.push('right_of_stem')
    }
    if (dist < 0.2) {
      score += 0.08
      evidence.push('near_stem')
    }
    if (ref) {
      score += thr.text_ref_bonus
      evidence.push('text_reference_supporting')
    }
    if (next && nextDist + 0.04 < dist && !contained) {
      score -= 0.22
      evidence.push('closer_to_next_not_sufficient')
    }
    if (bboxIoU(input.figure.bbox, problem.bbox) > 0 && contained < 0.45) {
      score -= 0.08
      evidence.push('boundary_overlap')
    }
    return { problem, score: Math.max(0, Math.min(1, score)), contained, dist, evidence }
  })
  scored.sort((a, b) => b.score - a.score || a.dist - b.dist)
  const best = scored[0]
  const second = scored[1]
  const sharedCue = sharedFigureCue(input.page_text)
  const close = Boolean(best && second && Math.abs(best.score - second.score) < thr.owner_review_gap && second.score >= 0.45)
  const bothHigh = Boolean(best && second && best.score >= thr.shared_both && second.score >= thr.shared_both)
  const nearestOnly = Boolean(best && second && best.dist <= second.dist && best.score < 0.55)
  if (!best || best.score < 0.42 || nearestOnly) {
    return {
      owner_problem_id_candidate: best && best.score >= 0.42 ? best.problem.id : null,
      owner_score: best?.score ?? 0,
      owner_confidence: 0.2,
      alternative_owner_candidates: scored.slice(1, 3).map((row) => ({ id: row.problem.id, score: Number(row.score.toFixed(3)) })),
      shared_candidate: bothHigh || sharedCue,
      ownership_evidence: ['unresolved', nearestOnly ? 'nearest_not_hard_rule' : 'low_score'],
      status: 'UNRESOLVED',
    }
  }
  if (bothHigh || (sharedCue && close)) {
    const high = best.score >= thr.owner_high && second!.score >= thr.shared_both && sharedCue
    return {
      owner_problem_id_candidate: best.problem.id,
      owner_score: best.score,
      owner_confidence: high ? 0.84 : 0.48,
      alternative_owner_candidates: scored.slice(1, 3).map((row) => ({ id: row.problem.id, score: Number(row.score.toFixed(3)) })),
      shared_candidate: true,
      ownership_evidence: [...best.evidence, sharedCue ? 'shared_cue' : 'two_high_scores', 'shared_explicit'],
      status: high ? 'SHARED_OWNER_HIGH' : 'SHARED_OWNER_REVIEW',
    }
  }
  if (close || best.score < thr.owner_high) {
    return {
      owner_problem_id_candidate: best.problem.id,
      owner_score: best.score,
      owner_confidence: 0.52,
      alternative_owner_candidates: scored.slice(1, 3).map((row) => ({ id: row.problem.id, score: Number(row.score.toFixed(3)) })),
      shared_candidate: false,
      ownership_evidence: [...best.evidence, close ? 'owner_gap_small' : 'score_below_high'],
      status: 'SINGLE_OWNER_REVIEW',
    }
  }
  return {
    owner_problem_id_candidate: best.problem.id,
    owner_score: best.score,
    owner_confidence: 0.88,
    alternative_owner_candidates: scored.slice(1, 3).map((row) => ({ id: row.problem.id, score: Number(row.score.toFixed(3)) })),
    shared_candidate: false,
    ownership_evidence: [...best.evidence, `gap_${((best.score - (second?.score ?? 0)).toFixed(2))}`],
    status: 'SINGLE_OWNER_HIGH',
  }
}

export function cropSafety(input: {
  figure: NormalizedBBox
  page?: { width?: number; height?: number }
  owner?: NormalizedBBox
  neighbor_bodies: NormalizedBBox[]
  neighbor_figures: NormalizedBBox[]
  truth?: NormalizedBBox
}): { class: CropSafety; reasons: string[] } {
  const reasons: string[] = []
  const padded = expandBBox(input.figure, DEFAULT_THRESHOLDS.crop_pad)
  if (input.figure.x < 0.004) reasons.push('left_cut')
  if (input.figure.y < 0.004) reasons.push('top_cut')
  if (input.figure.x + input.figure.width > 0.996) reasons.push('right_cut')
  if (input.figure.y + input.figure.height > 0.996) reasons.push('bottom_cut')
  if (input.truth) {
    const q = bboxQuality(input.figure, input.truth)
    if (q === 'MAJOR_CUT' || q === 'WRONG_REGION') reasons.push('required_figure_cut')
  }
  for (const body of input.neighbor_bodies) {
    const overlap = bboxIntersectionArea(padded, body)
    const figureFrac = overlap / Math.max(1e-6, input.figure.width * input.figure.height)
    const bodyFrac = overlap / Math.max(1e-6, body.width * body.height)
    if (figureFrac > 0.35 && bodyFrac > 0.12) reasons.push('neighbor_body_intrusion')
  }
  for (const other of input.neighbor_figures) {
    if (bboxIoU(padded, other) > DEFAULT_THRESHOLDS.neighbor_overlap) reasons.push('neighbor_figure_intrusion')
  }
  const unique = [...new Set(reasons)]
  if (unique.includes('required_figure_cut') || unique.includes('neighbor_figure_intrusion') || unique.includes('neighbor_body_intrusion')) {
    return { class: unique.includes('required_figure_cut') ? 'FIGURE_CROP_UNSAFE' : 'FIGURE_CROP_REVIEW', reasons: unique }
  }
  if (unique.length) return { class: 'FIGURE_CROP_REVIEW', reasons: unique }
  return { class: 'FIGURE_CROP_SAFE', reasons: [] }
}

export function autoFigureSafe(input: {
  identity_stable: boolean
  boundary_safe: boolean
  detection_confidence: number
  crop: CropSafety
  ownership: OwnershipStatus
  required_complete: boolean
  neighbor_figure: boolean
  shared_unresolved: boolean
  choices_safe: boolean
  bbox_quality: BBoxQuality
  owner_correct: boolean
}): boolean {
  if (!input.identity_stable) return false
  if (!input.boundary_safe) return false
  if (input.detection_confidence < DEFAULT_THRESHOLDS.auto_detection_min) return false
  if (input.crop !== 'FIGURE_CROP_SAFE') return false
  if (input.ownership !== 'SINGLE_OWNER_HIGH' && input.ownership !== 'SHARED_OWNER_HIGH') return false
  if (!input.required_complete) return false
  if (input.neighbor_figure) return false
  if (input.shared_unresolved) return false
  if (!input.choices_safe) return false
  if (input.bbox_quality === 'MAJOR_CUT' || input.bbox_quality === 'WRONG_REGION') return false
  if (!input.owner_correct) return false
  return true
}

export function falseFigureSafe(auto: boolean, faults: string[]): boolean {
  return auto && faults.length > 0
}

export function matchDetectedToTruth(detected: VisualFigureCandidate[], truth: NormalizedBBox, minIou = DEFAULT_THRESHOLDS.match_iou): VisualFigureCandidate | null {
  let best: VisualFigureCandidate | null = null
  let score = 0
  for (const cand of detected) {
    const scale = bboxArea(cand.bbox) / Math.max(1e-6, bboxArea(truth))
    if (scale > 3.2) continue
    const iou = bboxIoU(cand.bbox, truth)
    const contained = bboxCoverage(truth, cand.bbox)
    const hit = iou + 0.35 * contained
    if ((iou >= minIou || contained >= 0.7) && hit > score) {
      best = cand
      score = hit
    }
  }
  return best
}

export function reviewReason(input: {
  detected: boolean
  quality?: BBoxQuality
  ownership?: OwnershipStatus
  crop?: CropSafety
  formula_fp?: boolean
  table_confusion?: boolean
  sidebar?: boolean
}): string {
  if (!input.detected) return 'FIGURE_NOT_DETECTED'
  if (input.formula_fp) return 'FORMULA_FALSE_POSITIVE'
  if (input.table_confusion) return 'TABLE_CONFUSION'
  if (input.quality === 'WRONG_REGION') return 'FIGURE_BBOX_UNCERTAIN'
  if (input.quality === 'MAJOR_CUT') return 'FIGURE_CUT_RISK'
  if (input.crop === 'FIGURE_CROP_REVIEW' || input.crop === 'FIGURE_CROP_UNSAFE') {
    if (input.crop === 'FIGURE_CROP_UNSAFE') return 'FIGURE_CUT_RISK'
    return 'LABEL_CUT_RISK'
  }
  if (input.ownership === 'UNRESOLVED') return 'FIGURE_OWNER_AMBIGUOUS'
  if (input.ownership === 'SHARED_OWNER_REVIEW') return 'SHARED_OWNER_AMBIGUOUS'
  if (input.ownership === 'SINGLE_OWNER_REVIEW') return 'FIGURE_OWNER_AMBIGUOUS'
  if (input.sidebar) return 'SIDEBAR_FIGURE'
  return 'OTHER'
}

export const FIGURE_DB_CONTRACT = {
  problem_figure_assets: [
    'figure_id',
    'source_document_id',
    'page_number',
    'bbox',
    'figure_type',
    'original_crop_path',
    'source_hash',
    'detection_confidence',
    'review_status',
  ],
  problem_figure_links: ['problem_id', 'figure_id', 'ownership_type', 'ownership_confidence', 'display_order', 'required'],
  note: 'proposal only; no production migration in 8.22',
}

export const MULTIMODAL_TWIN_CONTRACT = {
  implement: false,
  features: ['text_math', 'figure_type', 'figure_structural_features', 'problem_type', 'strategy', 'difficulty'],
  forbidden: 'original image pixels alone must not define semantic similarity',
}

export const PRINT_EDIT_CONTRACT = {
  implement: false,
  figure_as: 'movable/resizable visual asset linked to problem',
  preserve_aspect_ratio: true,
  retain_original_resolution: true,
  allow_spacing_adjustment: true,
  never_silently_detach: true,
}
