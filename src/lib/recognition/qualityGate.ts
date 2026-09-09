import {
  assessFigurePreservation,
  classifyAdjacentIntrusion,
  persistIdentityKey,
  type AdjacentIntrusion,
  type FigurePreservation,
} from './draftPersist'
import { routeOcr, type OcrRoute, type RouterDecision } from './ocrRouter'
import { isValidBBox, type NormalizedBBox } from '../pdf/bbox'

export type QualityVerdict = 'DRAFT_READY' | 'PIPELINE_REVIEW'

export type QualityGateResult = {
  verdict: QualityVerdict
  route: OcrRoute
  reasons: string[]
  warnings: string[]
  gates: {
    segmentation: boolean
    crop: boolean
    structure: boolean
    math: boolean
    figure: boolean
    source: boolean
    persistence: boolean
  }
  figures: FigurePreservation
  adjacent: AdjacentIntrusion
  router: RouterDecision
}

export function assessQualityGate(input: {
  problem_number: string
  page_number: number
  document_key: string
  bbox: NormalizedBBox
  segmentation_status: string
  crop_safe: boolean
  stem: string
  markdown?: string
  choices: Array<{ text: string }>
  expected_choices: boolean
  mathpix_required_succeeded?: boolean
  math_conflict: boolean
  critical_conflict?: boolean
  detected_figures: number
  expected_visual_figures?: number | null
  original_crop_present: boolean
  next_problem_number?: string | null
}): QualityGateResult {
  const warnings: string[] = []
  const reasons: string[] = []
  const adjacent = classifyAdjacentIntrusion({
    stem: input.stem,
    next_problem_number: input.next_problem_number,
  })
  const figures = assessFigurePreservation({
    problem_number: input.problem_number,
    detected_figures: input.detected_figures,
    expected_visual_figures: input.expected_visual_figures,
  })
  const structure_complete =
    Boolean(input.problem_number && input.stem.trim().length >= 8) &&
    (!input.expected_choices || input.choices.length >= 5)
  const router = routeOcr({
    stem: input.stem,
    markdown: input.markdown,
    choices: input.choices,
    crop_safe: input.crop_safe,
    structure_complete,
    missing_choice: input.expected_choices && input.choices.length < 5,
    body_intrusion: adjacent.kind === 'BODY_INTRUSION',
    math_conflict: input.math_conflict,
  })

  const segmentation = input.segmentation_status === 'AUTO_OK' && isValidBBox(input.bbox)
  const crop = input.crop_safe && adjacent.kind !== 'BODY_INTRUSION'
  const structure = structure_complete
  const math =
    (router.route !== 'MISTRAL_PLUS_MATHPIX' || input.mathpix_required_succeeded !== false) &&
    !input.math_conflict &&
    !input.critical_conflict
  const figure = input.original_crop_present
  const source = Boolean(input.document_key && input.page_number > 0 && isValidBBox(input.bbox))
  const persistence = Boolean(
    persistIdentityKey({
      document_key: input.document_key,
      page_number: input.page_number,
      problem_number: input.problem_number,
    }),
  )

  if (!segmentation) reasons.push('segmentation_gate')
  if (!crop) reasons.push(adjacent.kind === 'BODY_INTRUSION' ? 'body_intrusion' : 'crop_gate')
  if (!structure) reasons.push('structure_gate')
  if (!math) reasons.push('math_gate')
  if (!figure) reasons.push('figure_crop_missing')
  if (!source) reasons.push('source_gate')
  if (!persistence) reasons.push('persistence_gate')
  if (adjacent.kind === 'HEADER_ONLY') warnings.push('adjacent_header_only')
  if (!figures.figure_detection_complete) warnings.push('figure_detection_incomplete')

  const verdict: QualityVerdict = reasons.length ? 'PIPELINE_REVIEW' : 'DRAFT_READY'
  return {
    verdict,
    route: router.route,
    reasons,
    warnings,
    gates: { segmentation, crop, structure, math, figure, source, persistence },
    figures,
    adjacent,
    router,
  }
}
