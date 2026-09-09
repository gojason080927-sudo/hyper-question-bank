import { mathConflictBetween, neighborBlocksAutoSafe, type NeighborIntrusionKind } from './segmentationV3'

export const STEP817 = '8.17'
export const SHADOW_ROUTING_ENABLED = true
export const PAID_OCR_ROUTING_ENABLED = false

export const UNCERTAINTY_CLASSES = [
  'NONE',
  'TEXT_UNCERTAIN',
  'CHOICE_UNCERTAIN',
  'MATH_UNCERTAIN',
  'LAYOUT_UNCERTAIN',
  'BOUNDARY_UNCERTAIN',
  'FIGURE_UNCERTAIN',
  'IDENTITY_UNCERTAIN',
  'MULTI_UNCERTAIN',
] as const

export type UncertaintyClass = (typeof UNCERTAINTY_CLASSES)[number]

export const SHADOW_ROUTES = [
  'CURRENT_ONLY',
  'MISTRAL_STRUCTURE',
  'MATHPIX_MATH',
  'HYBRID_SELECTIVE',
  'SEGMENTATION_RECOVERY',
  'HUMAN_REVIEW',
] as const

export type ShadowRoute = (typeof SHADOW_ROUTES)[number]

export const ROUTER_EXECUTION_ORDER = [
  'IDENTITY',
  'SEGMENTATION',
  'BOUNDARY',
  'CURRENT',
  'UNCERTAINTY_CLASSIFY',
  'ROUTE_ONLY_IF_NEEDED',
  'FINAL_SAFETY',
] as const

export const FEATURE_FLAGS = {
  paidOcrRoutingEnabled: PAID_OCR_ROUTING_ENABLED,
  shadowRoutingEnabled: SHADOW_ROUTING_ENABLED,
  productionActivationForbidden: true,
} as const

export type RouterFeatures = {
  identity_confidence: number
  boundary_confidence: number
  neighbor_intrusion_risk: NeighborIntrusionKind
  column_confidence: number
  stem_completeness: number
  choice_completeness: number
  choice_ownership_confidence: number
  math_confidence: number
  math_conflict: boolean
  math_density: 'low' | 'medium' | 'high'
  has_figure: boolean
  figure_boundary_confidence: number
  figure_ownership_confidence: number
  structure_confidence: number
  current_ocr_available: boolean
  mistral_cache_available: boolean
  mathpix_cache_available: boolean
  crop_unsafe: boolean
  hard_blockers: string[]
  provider_math_conflict?: boolean
}

export type UncertaintyResult = {
  primary: UncertaintyClass
  secondary: UncertaintyClass[]
}

export type ShadowRouting = {
  recommended_route: ShadowRoute
  route_reason: string[]
  estimated_paid_calls: { mistral: number; mathpix: number }
  would_auto_safe: boolean
  false_safe: boolean
  uncertainty: UncertaintyResult
}

const HIGH = 0.78

export function classifyUncertainty(features: RouterFeatures): UncertaintyResult {
  const flags: UncertaintyClass[] = []
  if (features.identity_confidence < HIGH) flags.push('IDENTITY_UNCERTAIN')
  if (features.crop_unsafe || features.boundary_confidence < HIGH) flags.push('BOUNDARY_UNCERTAIN')
  if (features.has_figure && features.figure_ownership_confidence < 0.85) flags.push('FIGURE_UNCERTAIN')
  if (neighborBlocksAutoSafe(features.neighbor_intrusion_risk) || features.column_confidence < HIGH) {
    flags.push('LAYOUT_UNCERTAIN')
  }
  if (features.choice_completeness < HIGH || features.choice_ownership_confidence < HIGH) flags.push('CHOICE_UNCERTAIN')
  if (features.stem_completeness < HIGH || features.structure_confidence < HIGH) flags.push('TEXT_UNCERTAIN')
  if (features.math_conflict || features.provider_math_conflict || features.math_confidence < HIGH) {
    flags.push('MATH_UNCERTAIN')
  }
  if (flags.length === 0) return { primary: 'NONE', secondary: [] }
  if (flags.length >= 3) return { primary: 'MULTI_UNCERTAIN', secondary: flags }
  return { primary: flags[0], secondary: flags.slice(1) }
}

export function pureBoundaryFailure(uncertainty: UncertaintyResult, features: RouterFeatures): boolean {
  const set = new Set([uncertainty.primary, ...uncertainty.secondary])
  const ocrClasses = ['TEXT_UNCERTAIN', 'CHOICE_UNCERTAIN', 'MATH_UNCERTAIN']
  const geo =
    set.has('BOUNDARY_UNCERTAIN') ||
    set.has('FIGURE_UNCERTAIN') ||
    set.has('LAYOUT_UNCERTAIN') ||
    features.crop_unsafe
  const ocr = ocrClasses.some((row) => set.has(row as UncertaintyClass))
  return geo && !ocr
}

export function routeShadow(features: RouterFeatures): ShadowRouting {
  const uncertainty = classifyUncertainty(features)
  const reasons: string[] = []
  const blockedAuto = neighborBlocksAutoSafe(features.neighbor_intrusion_risk)
  if (features.provider_math_conflict || features.math_conflict) {
    reasons.push('provider_or_math_conflict')
    return finish('HUMAN_REVIEW', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }
  if (features.identity_confidence < 0.5 || features.hard_blockers.includes('IDENTITY_UNSTABLE')) {
    reasons.push('identity_unstable')
    return finish('HUMAN_REVIEW', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }
  if (features.crop_unsafe) {
    reasons.push('crop_unsafe_geometry')
    return finish('HUMAN_REVIEW', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }
  if (blockedAuto) {
    reasons.push(`neighbor_${features.neighbor_intrusion_risk}`)
    return finish('HUMAN_REVIEW', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }
  if (features.has_figure && features.figure_ownership_confidence < 0.85) {
    reasons.push('figure_ownership_unresolved')
    return finish('HUMAN_REVIEW', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }
  if (features.boundary_confidence < HIGH) {
    reasons.push('boundary_before_paid_ocr')
    return finish('SEGMENTATION_RECOVERY', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }
  if (pureBoundaryFailure(uncertainty, features)) {
    reasons.push('pure_boundary_or_figure_use_segmentation')
    return finish('SEGMENTATION_RECOVERY', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
  }

  const choiceGap = uncertainty.primary === 'CHOICE_UNCERTAIN' || uncertainty.secondary.includes('CHOICE_UNCERTAIN') || uncertainty.primary === 'TEXT_UNCERTAIN'
  const mathGap = uncertainty.primary === 'MATH_UNCERTAIN' || uncertainty.secondary.includes('MATH_UNCERTAIN')
  const layoutText = uncertainty.primary === 'LAYOUT_UNCERTAIN' && features.neighbor_intrusion_risk === 'NEIGHBOR_HEADER_ONLY'

  if (choiceGap && mathGap) {
    reasons.push('structure_and_math_uncertain')
    return finish('HYBRID_SELECTIVE', reasons, { mistral: 1, mathpix: 1 }, features, uncertainty, false)
  }
  if (mathGap && features.math_density !== 'low') {
    reasons.push('math_uncertain_formula_route')
    return finish('MATHPIX_MATH', reasons, { mistral: 0, mathpix: 1 }, features, uncertainty, false)
  }
  if (choiceGap || layoutText) {
    reasons.push('choice_or_text_structure_route')
    return finish('MISTRAL_STRUCTURE', reasons, { mistral: 1, mathpix: 0 }, features, uncertainty, false)
  }
  if (uncertainty.primary === 'NONE' || (uncertainty.primary === 'LAYOUT_UNCERTAIN' && features.neighbor_intrusion_risk === 'NEIGHBOR_HEADER_ONLY' && features.boundary_confidence >= HIGH)) {
    reasons.push('current_stable_or_header_only_pad')
    return finish('CURRENT_ONLY', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, true)
  }
  reasons.push('unresolved_review')
  return finish('HUMAN_REVIEW', reasons, { mistral: 0, mathpix: 0 }, features, uncertainty, false)
}

function finish(
  route: ShadowRoute,
  reasons: string[],
  paid: { mistral: number; mathpix: number },
  features: RouterFeatures,
  uncertainty: UncertaintyResult,
  allowAuto: boolean,
): ShadowRouting {
  if (PAID_OCR_ROUTING_ENABLED) {
    throw new Error('production paid routing must stay false in STEP 8.17')
  }
  const would_auto_safe =
    allowAuto &&
    route === 'CURRENT_ONLY' &&
    !features.crop_unsafe &&
    !neighborBlocksAutoSafe(features.neighbor_intrusion_risk) &&
    features.identity_confidence >= HIGH &&
    (!features.has_figure || features.figure_ownership_confidence >= 0.85)
  const false_safe =
    would_auto_safe &&
    (features.crop_unsafe || neighborBlocksAutoSafe(features.neighbor_intrusion_risk) || features.identity_confidence < 0.5)
  return {
    recommended_route: route,
    route_reason: reasons,
    estimated_paid_calls: paid,
    would_auto_safe,
    false_safe,
    uncertainty,
  }
}

export function paidRouteJustified(route: ShadowRoute): boolean {
  return route === 'MISTRAL_STRUCTURE' || route === 'MATHPIX_MATH' || route === 'HYBRID_SELECTIVE'
}

export function conflictNeverMerged(a: string[], b: string[]): boolean {
  return mathConflictBetween(a, b)
}

export const REVIEW_UX_REASONS: Record<string, string> = {
  NEIGHBOR_BODY_INTRUSION: '다음 문제 본문이 포함됐을 가능성이 있습니다.',
  FIGURE_UNCERTAIN: '이 그림이 현재 문제에 속하는지 확인이 필요합니다.',
  CHOICE_UNCERTAIN: '선택지 5개 중 일부가 확인되지 않습니다.',
  MATH_CONFLICT: '수식의 지수가 OCR 결과끼리 다릅니다.',
  IDENTITY_UNCERTAIN: '문제 번호가 불확실합니다.',
  BOUNDARY_UNCERTAIN: '문제 경계가 불확실합니다.',
}

export const REVIEW_UX_ACTIONS = [
  'CONFIRM_BOUNDARY',
  'ASSIGN_FIGURE',
  'CONFIRM_CHOICES',
  'CONFIRM_MATH',
  'KEEP_REVIEW',
] as const

export function featuresFromCandidate(input: {
  status: 'CROP_REVIEW' | 'CROP_UNSAFE'
  reject_reasons: string[]
  hard_blockers: string[]
  has_choices: boolean
  choice_count: number
  has_figure: boolean
  figure_crop_risk?: boolean
  math_density: 'low' | 'medium' | 'high'
  math_conflict: boolean
  stem_length: number
  canonical_ok: boolean
  neighbor: NeighborIntrusionKind
  two_column: boolean
  current_ocr_available?: boolean
  mistral_cache_available?: boolean
  mathpix_cache_available?: boolean
  provider_math_conflict?: boolean
}): RouterFeatures {
  const reasons = input.reject_reasons.join(' ')
  const identity_ok = input.canonical_ok && !/IDENTITY|NUMBER_UNCERTAIN/.test(reasons) && !input.hard_blockers.includes('IDENTITY_UNSTABLE')
  const choiceNeed = input.has_choices || /CHOICE/.test(reasons)
  const choice_completeness = choiceNeed ? (input.choice_count >= 5 ? 0.9 : 0.3) : 0.95
  const math_confidence = input.math_conflict || /MATH_CONFLICT/.test(reasons) ? 0.25 : input.math_density === 'high' ? 0.7 : 0.88
  const figure_own = input.has_figure ? (input.figure_crop_risk ? 0.2 : 0.5) : 1
  const boundary =
    input.status === 'CROP_UNSAFE' || input.hard_blockers.length > 0 || /TOP_EDGE|BOTTOM_EDGE|LEFT_EDGE|RIGHT_EDGE/.test(reasons)
      ? 0.4
      : 0.86
  const stem = input.stem_length >= 24 && !/STRUCTURE_INCOMPLETE/.test(reasons) ? 0.88 : 0.35
  return {
    identity_confidence: identity_ok ? 0.92 : 0.3,
    boundary_confidence: boundary,
    neighbor_intrusion_risk: input.neighbor,
    column_confidence: input.two_column ? 0.84 : 0.8,
    stem_completeness: stem,
    choice_completeness,
    choice_ownership_confidence: choice_completeness,
    math_confidence,
    math_conflict: input.math_conflict,
    math_density: input.math_density,
    has_figure: input.has_figure,
    figure_boundary_confidence: figure_own,
    figure_ownership_confidence: figure_own,
    structure_confidence: stem,
    current_ocr_available: input.current_ocr_available ?? true,
    mistral_cache_available: Boolean(input.mistral_cache_available),
    mathpix_cache_available: Boolean(input.mathpix_cache_available),
    crop_unsafe: input.status === 'CROP_UNSAFE',
    hard_blockers: input.hard_blockers,
    provider_math_conflict: input.provider_math_conflict,
  }
}

