import { bboxCoverage, bboxIoU, validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { problemRegions, type PageSegmentation, type SegmentedProblem } from './layoutSegment'

export const SEG_CRITICAL = [
  'missing_problem',
  'merged_problems',
  'split_problem',
  'neighbor_body_mix',
  'missing_formula_band',
  'missing_figure',
  'number_mismatch',
] as const

export type SegCriticalKind = (typeof SEG_CRITICAL)[number]

export type SegmentGtProblem = {
  number: string
  column_index: number
  has_choices: boolean
  has_figure: boolean
  bbox: NormalizedBBox
}

export type SegmentGroundTruth = {
  page_number: number
  layout: string
  problems: SegmentGtProblem[]
}

export type SegCriticalHit = {
  kind: SegCriticalKind
  problem?: string
  detail: string
}

export type PageSegmentScore = {
  page_number: number
  actual: number
  detected: number
  number_match: number
  missed: string[]
  false_positive: string[]
  mean_iou: number | null
  body_contained: number
  choice_contained: number
  figure_contained: number
  neighbor_invasion: number
  auto_ok: number
  review: number
  critical: SegCriticalHit[]
}

export function scorePageSegmentation(pageNumber: number, predicted: PageSegmentation, gt: SegmentGroundTruth): PageSegmentScore {
  const gtBoxes = gt.problems.map((problem) => ({
    ...problem,
    bbox: validateBBox(problem.bbox),
  }))
  const scored = problemRegions(predicted.regions)
  const usedPred = new Set<number>()
  const matches: Array<{ gt: SegmentGtProblem; pred: SegmentedProblem; iou: number }> = []

  for (const row of gtBoxes) {
    let best = -1
    let bestScore = -1
    scored.forEach((pred, index) => {
      if (usedPred.has(index)) return
      const numberHit = pred.detected_problem_number === row.number ? 1 : 0
      const iou = bboxIoU(pred.bbox, row.bbox)
      const score = numberHit * 2 + iou
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    })
    if (best >= 0 && (scored[best].detected_problem_number === row.number || bboxIoU(scored[best].bbox, row.bbox) >= 0.3)) {
      usedPred.add(best)
      matches.push({ gt: row, pred: scored[best], iou: bboxIoU(scored[best].bbox, row.bbox) })
    }
  }

  const matchedGt = new Set(matches.map((row) => row.gt.number))
  const missed = gtBoxes.filter((row) => !matchedGt.has(row.number)).map((row) => row.number)
  const falsePositive = scored
    .filter((_, index) => !usedPred.has(index))
    .map((region) => region.detected_problem_number)
  const ious = matches.map((row) => row.iou)
  const critical: SegCriticalHit[] = []

  for (const number of missed) {
    critical.push({ kind: 'missing_problem', problem: number, detail: `GT problem ${number} was not matched` })
  }
  for (const pred of scored) {
    const covering = gtBoxes.filter((row) => bboxCoverage(row.bbox, pred.bbox) >= 0.55)
    if (covering.length >= 2) {
      critical.push({
        kind: 'merged_problems',
        problem: pred.detected_problem_number,
        detail: `${pred.detected_problem_number} covers ${covering.map((row) => row.number).join(', ')}`,
      })
    }
  }
  for (const row of gtBoxes) {
    const parts = scored.filter((pred) => bboxCoverage(pred.bbox, row.bbox) >= 0.45)
    if (parts.length >= 2) {
      critical.push({
        kind: 'split_problem',
        problem: row.number,
        detail: `${row.number} split into ${parts.map((pred) => pred.detected_problem_number).join(', ')}`,
      })
    }
  }
  for (const match of matches) {
    if (match.pred.detected_problem_number !== match.gt.number) {
      critical.push({
        kind: 'number_mismatch',
        problem: match.gt.number,
        detail: `GT ${match.gt.number} linked to ${match.pred.detected_problem_number}`,
      })
    }
    const invaders = gtBoxes.filter(
      (other) =>
        other.number !== match.gt.number &&
        other.column_index === match.gt.column_index &&
        bboxCoverage(other.bbox, match.pred.bbox) >= 0.18,
    )
    if (invaders.length) {
      critical.push({
        kind: 'neighbor_body_mix',
        problem: match.gt.number,
        detail: `${match.pred.detected_problem_number} overlaps ${invaders.map((row) => row.number).join(', ')}`,
      })
    }
    if (match.gt.has_figure && match.iou < 0.35 && match.pred.assigned_images.length === 0) {
      critical.push({
        kind: 'missing_figure',
        problem: match.gt.number,
        detail: `figure expected for ${match.gt.number} but no assigned image and low IoU`,
      })
    }
  }

  let bodyContained = 0
  let choiceContained = 0
  let figureContained = 0
  let neighborInvasion = 0
  for (const match of matches) {
    if (bboxCoverage(match.gt.bbox, match.pred.bbox) >= 0.8) bodyContained += 1
    if (!match.gt.has_choices || bboxCoverage(choiceBand(match.gt.bbox), match.pred.bbox) >= 0.7) choiceContained += 1
    if (!match.gt.has_figure || match.pred.assigned_images.length > 0 || bboxCoverage(match.gt.bbox, match.pred.bbox) >= 0.75) {
      figureContained += 1
    }
    if (
      gtBoxes.some(
        (other) =>
          other.number !== match.gt.number &&
          other.column_index === match.gt.column_index &&
          bboxCoverage(other.bbox, match.pred.bbox) >= 0.18,
      )
    ) {
      neighborInvasion += 1
    }
  }

  return {
    page_number: pageNumber,
    actual: gtBoxes.length,
    detected: scored.length,
    number_match: matches.filter((row) => row.pred.detected_problem_number === row.gt.number).length,
    missed,
    false_positive: falsePositive,
    mean_iou: ious.length ? ious.reduce((sum, value) => sum + value, 0) / ious.length : null,
    body_contained: bodyContained,
    choice_contained: choiceContained,
    figure_contained: figureContained,
    neighbor_invasion: neighborInvasion,
    auto_ok: scored.filter((region) => region.status === 'AUTO_OK').length,
    review: scored.filter((region) => region.status === 'REVIEW').length,
    critical,
  }
}

function choiceBand(bbox: NormalizedBBox): NormalizedBBox {
  const height = Math.min(bbox.height * 0.28, 0.08)
  return validateBBox({
    x: bbox.x,
    y: Math.min(0.97 - height, bbox.y + bbox.height - height),
    width: bbox.width,
    height,
    unit: 'normalized',
    origin: 'top-left',
  })
}
