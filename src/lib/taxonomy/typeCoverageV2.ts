import { STEP811_THRESHOLDS } from './classificationPersistence'
import { stemTypeIntent, subtypeFromStem, type FieldDecision, type ProblemClassificationV1 } from './taxonomyClassifier'
import {
  fingerprintAgreement,
  inferTypeFromFingerprint,
  requestedQuantityMatches,
  type MathFingerprint,
} from './mathFingerprint'
import type { ConditionStructure } from './conditionStructure'
import { keyPointConsistent, strategyConsistent } from './strategyEvidence'
import { extraAliasMap } from './taxonomyAlias'
import { typeIdFromBookHeading } from '../classification/hyperTaxonomy'

/** Frozen STEP 8.11 type AUTO threshold. Never lower this in 8.13. */
export const STEP813_TYPE_THRESHOLD = STEP811_THRESHOLDS.type

export type ReviewReasonV2 =
  | 'MATH_STRUCTURE_AMBIGUOUS'
  | 'STRATEGY_AMBIGUOUS'
  | 'HEADING_CONFLICT'
  | 'MULTI_TYPE'
  | 'OCR_INSUFFICIENT'
  | 'CONDITION_UNCLEAR'
  | 'SUBUNIT_UNCERTAIN'
  | 'TYPE_PROFILE_INSUFFICIENT'
  | 'NO_ANCHOR'
  | 'NEW_TYPE_SUSPECTED'
  | 'TYPE_UNCLEAR'
  | 'UNIT_CONFLICT'
  | 'HEADING_ONLY'
  | 'NEIGHBOR_ONLY'

export type CoverageSource = 'OLD_AUTO' | 'NEW_AUTO' | 'REVIEW'

export type TypeEvidenceV2 = {
  stem_intent: string | null
  heading_type: string | null
  fingerprint_inferred: string | null
  math_agreement: 'SUPPORT' | 'WEAK' | 'CONFLICT'
  strategy_consistent: boolean
  key_point_consistent: boolean
  heading_agrees: boolean
  neighbor_same_type: boolean
  neighbor_conflict: boolean
  requested_matches: boolean
  heading_only: boolean
  neighbor_only: boolean
  conflicts: string[]
  boosts: string[]
  type_confidence_v1: number
  type_confidence_v2: number
}

export type ClassificationV2 = ProblemClassificationV1 & {
  coverage_source: CoverageSource
  type_confidence_v2: number
  type_evidence: TypeEvidenceV2
  review_reason_v2: ReviewReasonV2 | null
  subtype_candidate: string | null
  production_write: false
}

function headingTypeId(title: string | null): string | null {
  if (!title) return null
  return typeIdFromBookHeading(title) ?? extraAliasMap(title)
}

export function headingOnlyCannotAuto(evidence: Pick<TypeEvidenceV2, 'heading_only' | 'math_agreement' | 'stem_intent'>): boolean {
  return evidence.heading_only || (!evidence.stem_intent && evidence.math_agreement !== 'SUPPORT')
}

export function neighborOnlyCannotAuto(evidence: Pick<TypeEvidenceV2, 'neighbor_only' | 'math_agreement' | 'strategy_consistent'>): boolean {
  return evidence.neighbor_only || (evidence.math_agreement !== 'SUPPORT' && !evidence.strategy_consistent)
}

export function classifyReviewReason(input: {
  row: ProblemClassificationV1
  evidence: TypeEvidenceV2
  condition: ConditionStructure
  hasAnchor: boolean
}): ReviewReasonV2 {
  const { row, evidence, condition } = input
  if (row.evidence_insufficient || row.stem_excerpt.length < 12) return 'OCR_INSUFFICIENT'
  if (evidence.heading_only) return 'HEADING_ONLY'
  if (evidence.neighbor_only) return 'NEIGHBOR_ONLY'
  if (evidence.conflicts.length) return 'HEADING_CONFLICT'
  if (row.review_reasons.includes('UNIT_CONFLICT')) return 'UNIT_CONFLICT'
  if (row.type_id === 'CUBIC_QUARTIC_EQ' || evidence.stem_intent === 'CUBIC_QUARTIC_EQ') return 'NEW_TYPE_SUSPECTED'
  if (
    evidence.stem_intent &&
    evidence.fingerprint_inferred &&
    evidence.stem_intent !== evidence.fingerprint_inferred &&
    evidence.math_agreement === 'CONFLICT'
  ) {
    return 'MULTI_TYPE'
  }
  if (row.type_id === 'TYPE_UNCLEAR' && evidence.math_agreement !== 'SUPPORT') return 'TYPE_UNCLEAR'
  if (evidence.math_agreement !== 'SUPPORT') return 'MATH_STRUCTURE_AMBIGUOUS'
  if (!evidence.strategy_consistent) return 'STRATEGY_AMBIGUOUS'
  if (row.review_reasons.includes('SUBUNIT_HEADING_RISK')) return 'SUBUNIT_UNCERTAIN'
  if (condition.condition_count === 0 && /단,|\(가\)/.test(row.stem_excerpt) === false && evidence.requested_matches === false) {
    return 'CONDITION_UNCLEAR'
  }
  if (!input.hasAnchor) return 'NO_ANCHOR'
  if (row.type_id === 'TYPE_UNCLEAR') return 'TYPE_PROFILE_INSUFFICIENT'
  return 'TYPE_PROFILE_INSUFFICIENT'
}

export function strengthenOne(input: {
  row: ProblemClassificationV1
  stem: string
  fingerprint: MathFingerprint
  condition: ConditionStructure
  prev?: ProblemClassificationV1
  next?: ProblemClassificationV1
  hasAnchor: boolean
  oldAuto: boolean
}): ClassificationV2 {
  const { row, stem, fingerprint, condition } = input
  const stemIntent = stemTypeIntent(stem).type_id
  const heading = headingTypeId(row.source_heading)
  const inferred = inferTypeFromFingerprint(fingerprint)
  const inferredSupport = inferred ? fingerprintAgreement(inferred, fingerprint) === 'SUPPORT' : false
  const candidateType = stemIntent ?? (inferredSupport ? inferred : null) ?? (row.type_id !== 'TYPE_UNCLEAR' ? row.type_id : null)
  const mathForCandidate = candidateType ? fingerprintAgreement(candidateType, fingerprint) : 'WEAK'
  const headingAgrees = Boolean(heading && candidateType && heading === candidateType)
  const headingConflicts = Boolean(heading && candidateType && heading !== candidateType && mathForCandidate === 'SUPPORT')
  const requestedDiffers = Boolean(heading && candidateType && heading === candidateType ? false : heading && inferred && heading !== inferred && requestedQuantityMatches(inferred, fingerprint))
  const strategy = candidateType ? strategyConsistent(candidateType, stem) : false
  const keyPoint = candidateType ? keyPointConsistent(candidateType, stem, fingerprint.requested_quantity) || mathForCandidate === 'SUPPORT' : false
  const neighborType = input.prev?.decisions.type === 'AUTO' && input.next?.decisions.type === 'AUTO' && input.prev.type_id === input.next.type_id ? input.prev.type_id : null
  const neighborSame = Boolean(neighborType && candidateType && neighborType === candidateType)
  const neighborConflict = Boolean(neighborType && candidateType && neighborType !== candidateType && strategy)
  const headingOnly = Boolean(heading && !stemIntent && mathForCandidate !== 'SUPPORT')
  const neighborOnly = Boolean(neighborSame && mathForCandidate !== 'SUPPORT' && !stemIntent)

  const conflicts: string[] = []
  if (headingConflicts || row.review_reasons.includes('TYPE_HEADING_STEM_MISMATCH')) conflicts.push('heading_vs_math')
  if (neighborConflict) conflicts.push('neighbor_vs_strategy')
  if (requestedDiffers && heading && inferred && heading !== inferred) conflicts.push('alias_vs_requested_quantity')
  if (row.review_reasons.includes('UNIT_CONFLICT')) conflicts.push('unit_conflict')
  if (mathForCandidate === 'CONFLICT') conflicts.push('math_conflict')

  const boosts: string[] = []
  let confidence = row.type_confidence
  if (mathForCandidate === 'SUPPORT') {
    confidence += 0.1
    boosts.push('math_structure+0.10')
  }
  if (strategy) {
    confidence += 0.08
    boosts.push('strategy+0.08')
  }
  if (keyPoint && mathForCandidate === 'SUPPORT') {
    confidence += 0.04
    boosts.push('key_point+0.04')
  }
  if (headingAgrees && mathForCandidate === 'SUPPORT' && strategy) {
    confidence += 0.04
    boosts.push('heading_alias+0.04')
  }
  if (neighborSame && headingAgrees && mathForCandidate === 'SUPPORT' && strategy) {
    confidence += 0.03
    boosts.push('neighbor_cluster+0.03')
  }
  confidence = Math.min(0.93, Number(confidence.toFixed(3)))

  const evidence: TypeEvidenceV2 = {
    stem_intent: stemIntent,
    heading_type: heading,
    fingerprint_inferred: inferred,
    math_agreement: mathForCandidate,
    strategy_consistent: strategy,
    key_point_consistent: keyPoint,
    heading_agrees: headingAgrees,
    neighbor_same_type: neighborSame,
    neighbor_conflict: neighborConflict,
    requested_matches: candidateType ? requestedQuantityMatches(candidateType, fingerprint) : false,
    heading_only: headingOnly,
    neighbor_only: neighborOnly,
    conflicts,
    boosts,
    type_confidence_v1: row.type_confidence,
    type_confidence_v2: confidence,
  }

  if (input.oldAuto) {
    return {
      ...row,
      coverage_source: 'OLD_AUTO',
      type_confidence_v2: row.type_confidence,
      type_evidence: { ...evidence, type_confidence_v2: row.type_confidence, boosts: [] },
      review_reason_v2: null,
      subtype_candidate: subtypeFromStem(row.type_id, stem).subtype_id,
      production_write: false,
    }
  }

  const canStrengthen =
    Boolean(candidateType) &&
    candidateType !== 'TYPE_UNCLEAR' &&
    candidateType !== 'CUBIC_QUARTIC_EQ' &&
    mathForCandidate === 'SUPPORT' &&
    strategy &&
    keyPoint &&
    !conflicts.length &&
    !headingOnly &&
    !neighborOnly &&
    confidence >= STEP813_TYPE_THRESHOLD &&
    STEP813_TYPE_THRESHOLD === 0.78

  const typeId = canStrengthen ? candidateType! : row.type_id
  const typeDecision: FieldDecision = canStrengthen ? 'AUTO' : 'REVIEW'
  const typeConfidence = canStrengthen ? confidence : row.type_confidence
  const unitAuto = row.decisions.unit === 'AUTO'
  const overall: FieldDecision = unitAuto && typeDecision === 'AUTO' && !row.evidence_insufficient ? 'AUTO' : 'REVIEW'
  const coverage_source: CoverageSource = typeDecision === 'AUTO' ? 'NEW_AUTO' : 'REVIEW'

  const nextReasons = canStrengthen
    ? row.review_reasons.filter((reason) => reason !== 'TYPE_FROM_STEM_ONLY')
    : row.review_reasons

  const review_reason_v2 =
    typeDecision === 'AUTO'
      ? null
      : classifyReviewReason({
          row,
          evidence,
          condition,
          hasAnchor: input.hasAnchor,
        })

  return {
    ...row,
    type_id: typeId,
    type_confidence: typeConfidence,
    classification_status: overall,
    review_reasons: nextReasons,
    decisions: {
      ...row.decisions,
      type: typeDecision,
      key_point: typeDecision === 'AUTO' ? 'AUTO' : row.decisions.key_point,
      solution_strategy: typeDecision === 'AUTO' ? 'AUTO' : row.decisions.solution_strategy,
      common_mistakes: typeDecision === 'AUTO' ? 'AUTO' : row.decisions.common_mistakes,
      overall,
    },
    coverage_source,
    type_confidence_v2: confidence,
    type_evidence: evidence,
    review_reason_v2,
    subtype_id: null,
    subtype_candidate: subtypeFromStem(typeId, stem).subtype_id,
    production_write: false,
  }
}

export function strengthenCorpus(input: {
  rows: ProblemClassificationV1[]
  stems: Map<string, string>
  fingerprints: Map<string, MathFingerprint>
  conditions: Map<string, ConditionStructure>
}): ClassificationV2[] {
  const oldAutoIds = new Set(input.rows.filter((row) => row.decisions.overall === 'AUTO' && row.classification_status === 'AUTO').map((row) => row.problem_id))
  const ordered = [...input.rows].sort((a, b) => a.page_number - b.page_number || a.original_problem_number.localeCompare(b.original_problem_number))
  const anchorsByType = new Map<string, number>()
  for (const row of ordered) {
    if (!oldAutoIds.has(row.problem_id)) continue
    anchorsByType.set(row.type_id, (anchorsByType.get(row.type_id) ?? 0) + 1)
  }
  return ordered.map((row, index) => {
    const stem = input.stems.get(row.problem_id) ?? row.stem_excerpt
    const fingerprint = input.fingerprints.get(row.problem_id)!
    const condition = input.conditions.get(row.problem_id)!
    const prev = ordered[index - 1]
    const next = ordered[index + 1]
    const sameSectionPrev = prev && prev.subunit_id === row.subunit_id
    const sameSectionNext = next && next.subunit_id === row.subunit_id
    return strengthenOne({
      row,
      stem,
      fingerprint,
      condition,
      prev: sameSectionPrev ? prev : undefined,
      next: sameSectionNext ? next : undefined,
      hasAnchor: (anchorsByType.get(row.type_id) ?? 0) > 0,
      oldAuto: oldAutoIds.has(row.problem_id),
    })
  })
}
