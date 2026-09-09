import { PILOT_DOCUMENT_KEY } from '../recognition/problemPipeline'
import { assessQualityGate } from '../recognition/qualityGate'
import { isStructureIncomplete, shouldCallMathpix, type PipelineCandidate, type PipelineReviewReason } from '../recognition/bookPipeline'
import { nextProblemHint } from '../recognition/draftPersist'
import type { CropGateInput, CropGateResult, CropImageFeatures } from './cropGateV2'

export type ReplayFinal = 'DRAFT_READY' | 'PIPELINE_REVIEW' | 'BLOCKED_NON_PROBLEM' | 'NEEDS_PAID_OCR'

export type ReplayRow = {
  page: number
  problem_number: string
  old_quality: PipelineCandidate['quality']
  old_reasons: string[]
  crop_gate_v2: CropGateResult
  final: ReplayFinal
  route: PipelineCandidate['route']
  remaining_blockers: string[]
  mathpix_eligible: boolean
  mathpix_cache_hit: boolean
  cache_miss_blocked: boolean
  needs_paid_ocr: boolean
}

export function inferColumnCount(bboxWidth: number): number {
  return bboxWidth <= 0.56 ? 2 : 1
}

export function buildCropGateInput(
  candidate: PipelineCandidate,
  pageNumbers: string[],
  image: CropImageFeatures | null,
  neighbors: PipelineCandidate[],
): CropGateInput {
  const sameColumn = neighbors.filter(
    (row) => Math.abs(row.bbox.x - candidate.bbox.x) < 0.08 && row.problem_number !== candidate.problem_number,
  )
  const columnLast = sameColumn.every((row) => row.bbox.y <= candidate.bbox.y)
  const next = sameColumn.filter((row) => row.bbox.y > candidate.bbox.y + 0.01).sort((a, b) => a.bbox.y - b.bbox.y)[0]
  return {
    problem_number: candidate.problem_number,
    canonical_problem_number: candidate.canonical_problem_number,
    bbox: candidate.bbox,
    crop: candidate.crop,
    image,
    stem: candidate.stem_text || candidate.stem_markdown,
    markdown: candidate.stem_markdown,
    page_problem_numbers: pageNumbers,
    next_problem_number: next?.problem_number ?? nextProblemHint(candidate.problem_number),
    next_bbox: next?.bbox ?? null,
    neighbor_bboxes: neighbors.map((row) => row.bbox),
    assigned_images: [],
    known_blocks: [],
    column_count: inferColumnCount(candidate.bbox.width),
    is_column_last: columnLast,
    figure_hint: candidate.figure_hint,
    graph_hint: candidate.graph_hint,
    table_hint: candidate.table_hint,
    identity_unstable: candidate.review_reasons.includes('IDENTITY_UNSTABLE') || !candidate.canonical_problem_number,
    number_uncertain: candidate.review_reasons.includes('NUMBER_UNCERTAIN'),
    segmentation_status: candidate.segmentation_status,
    layout_kind: candidate.layout_kind,
  }
}

export function replayCandidate(input: {
  candidate: PipelineCandidate
  gate: CropGateResult
  cropPresent: boolean
  mathpixCacheHit: boolean
}): ReplayRow {
  const row = input.candidate
  const reasons: PipelineReviewReason[] = row.review_reasons.filter((reason) => reason !== 'CROP_UNSAFE')
  if (input.gate.decision === 'CROP_UNSAFE') reasons.push('CROP_UNSAFE')
  if (input.gate.hard_blockers.includes('BODY_INTRUSION') && !reasons.includes('BODY_INTRUSION')) reasons.push('BODY_INTRUSION')
  const crop_safe = input.gate.decision === 'CROP_SAFE'
  const expectedChoices = /[①-⑤]/.test(`${row.stem_markdown}\n${row.stem_text}`)
  const incomplete = isStructureIncomplete({
    stem: row.stem_text || row.stem_markdown,
    choice_count: row.choice_count,
    expected_choices: expectedChoices,
  })
  if (incomplete && !reasons.includes('STRUCTURE_INCOMPLETE')) reasons.push('STRUCTURE_INCOMPLETE')
  if (row.layout_kind !== 'PROBLEM' || reasons.includes('THEORY_OR_SIDEBAR')) {
    return {
      page: row.page,
      problem_number: row.problem_number,
      old_quality: row.quality,
      old_reasons: row.review_reasons,
      crop_gate_v2: input.gate,
      final: 'BLOCKED_NON_PROBLEM',
      route: 'PIPELINE_REVIEW',
      remaining_blockers: ['THEORY_OR_SIDEBAR'],
      mathpix_eligible: false,
      mathpix_cache_hit: false,
      cache_miss_blocked: false,
      needs_paid_ocr: false,
    }
  }

  const quality = assessQualityGate({
    problem_number: row.problem_number,
    page_number: row.page,
    document_key: PILOT_DOCUMENT_KEY,
    bbox: row.bbox,
    segmentation_status: row.segmentation_status,
    crop_safe,
    stem: row.stem_text || row.stem_markdown,
    markdown: row.stem_markdown,
    choices: row.choices,
    expected_choices: expectedChoices,
    mathpix_required_succeeded: true,
    math_conflict: false,
    detected_figures: row.figure_hint ? 1 : 0,
    original_crop_present: input.cropPresent,
    next_problem_number: nextProblemHint(row.problem_number),
  })

  const patched: PipelineCandidate = {
    ...row,
    review_reasons: reasons,
    quality: quality.verdict,
    route: quality.route,
    crop_gate_v2: input.gate.decision,
    mathpix_planned: quality.verdict === 'DRAFT_READY' && quality.route === 'MISTRAL_PLUS_MATHPIX',
  }
  const eligibility = shouldCallMathpix(patched)
  const remaining = [...new Set([...quality.reasons, ...input.gate.hard_blockers, ...eligibility.blockedBy])]
  if (!crop_safe || quality.verdict !== 'DRAFT_READY') {
    return {
      page: row.page,
      problem_number: row.problem_number,
      old_quality: row.quality,
      old_reasons: row.review_reasons,
      crop_gate_v2: input.gate,
      final: 'PIPELINE_REVIEW',
      route: 'PIPELINE_REVIEW',
      remaining_blockers: remaining,
      mathpix_eligible: false,
      mathpix_cache_hit: false,
      cache_miss_blocked: false,
      needs_paid_ocr: false,
    }
  }
  if (quality.route === 'MISTRAL_PLUS_MATHPIX') {
    if (!eligibility.eligible) {
      return {
        page: row.page,
        problem_number: row.problem_number,
        old_quality: row.quality,
        old_reasons: row.review_reasons,
        crop_gate_v2: input.gate,
        final: 'PIPELINE_REVIEW',
        route: quality.route,
        remaining_blockers: eligibility.blockedBy,
        mathpix_eligible: false,
        mathpix_cache_hit: false,
        cache_miss_blocked: false,
        needs_paid_ocr: false,
      }
    }
    if (!input.mathpixCacheHit) {
      return {
        page: row.page,
        problem_number: row.problem_number,
        old_quality: row.quality,
        old_reasons: row.review_reasons,
        crop_gate_v2: input.gate,
        final: 'NEEDS_PAID_OCR',
        route: quality.route,
        remaining_blockers: ['CACHE_MISS_BLOCKED', 'NEEDS_PAID_OCR'],
        mathpix_eligible: true,
        mathpix_cache_hit: false,
        cache_miss_blocked: true,
        needs_paid_ocr: true,
      }
    }
  }
  return {
    page: row.page,
    problem_number: row.problem_number,
    old_quality: row.quality,
    old_reasons: row.review_reasons,
    crop_gate_v2: input.gate,
    final: 'DRAFT_READY',
    route: quality.route,
    remaining_blockers: [],
    mathpix_eligible: eligibility.eligible,
    mathpix_cache_hit: input.mathpixCacheHit,
    cache_miss_blocked: false,
    needs_paid_ocr: false,
  }
}
