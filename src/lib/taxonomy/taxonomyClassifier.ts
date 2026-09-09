import { contentUnitFromStem, typeIntentFromStem } from '../classification/classifyDraft'
import { sectionForPage, type BookStructure } from '../classification/bookStructure'
import { typeIdFromBookHeading } from '../classification/hyperTaxonomy'
import { headingProximity, headingShouldNotOverrideStem } from './headingProximity'
import { extraAliasMap } from './taxonomyAlias'
import { profileById, TYPE_PROFILES_V1, type TypeProfileV1 } from './typeProfiles'
import type { RubricEstimate } from './difficultyRubric'

export type FieldDecision = 'AUTO' | 'REVIEW'

export type ProblemClassificationV1 = {
  problem_id: string
  page_number: number
  original_problem_number: string
  subject_id: '공통수학1'
  unit_id: string
  unit_confidence: number
  subunit_id: string
  subunit_confidence: number
  type_id: string
  type_confidence: number
  subtype_id: string | null
  subtype_confidence: number
  core_concepts: string[]
  solution_strategy: string[]
  key_test_points: string[]
  difficulty_level: 1 | 2 | 3 | 4 | 5 | null
  difficulty_confidence: number
  difficulty_evidence: string[]
  source_difficulty_label: string | null
  classification_status: FieldDecision
  review_reasons: string[]
  source_heading: string | null
  source_heading_distance: number | null
  source_alias_match: string | null
  decisions: {
    unit: FieldDecision
    subunit: FieldDecision
    type: FieldDecision
    subtype: FieldDecision
    key_point: FieldDecision
    solution_strategy: FieldDecision
    common_mistakes: FieldDecision
    difficulty: FieldDecision
    overall: FieldDecision
  }
  stem_excerpt: string
  evidence_insufficient: boolean
}

export type ClassifierThresholds = {
  unit: number
  subunit: number
  type: number
  difficulty: number
  key_point: number
  solution_strategy: number
}

export const DEFAULT_V1_THRESHOLDS: ClassifierThresholds = {
  unit: 0.9,
  subunit: 0.86,
  type: 0.78,
  difficulty: 0.7,
  key_point: 0.75,
  solution_strategy: 0.75,
}

export function stemTypeIntent(stem: string): { type_id: string | null; reason: string } {
  const base = typeIntentFromStem(stem)
  const text = stem.replace(/\s+/g, ' ')
  if (/삼차방정식|사차방정식|삼차식|사차식/.test(text) && /해|근|인수/.test(text)) {
    return { type_id: 'CUBIC_QUARTIC_EQ', reason: 'higher_degree_eq' }
  }
  return base
}

export function subtypeFromStem(typeId: string, stem: string): { subtype_id: string | null; confidence: number } {
  const text = stem.replace(/\s+/g, ' ')
  if (typeId === 'UNDETERMINED_COEFF') {
    const subst = /대입|특정한\s*값|x\s*=\s*0/.test(text)
    const compare = /계수\s*비교|동류항/.test(text)
    if (subst && !compare) return { subtype_id: 'UNDETERMINED_SUBSTITUTION', confidence: 0.8 }
    if (compare && !subst) return { subtype_id: 'UNDETERMINED_COEFF_COMPARE', confidence: 0.82 }
    if (subst && compare) return { subtype_id: null, confidence: 0.4 }
    return { subtype_id: null, confidence: 0.35 }
  }
  if (typeId === 'COUNTING_PERM_COMB') {
    if (/순열/.test(text) && !/조합/.test(text)) return { subtype_id: 'COUNTING_PERM', confidence: 0.78 }
    if (/조합/.test(text) && !/순열/.test(text)) return { subtype_id: 'COUNTING_COMB', confidence: 0.78 }
    return { subtype_id: null, confidence: 0.4 }
  }
  return { subtype_id: null, confidence: 0 }
}

function headingTypeId(title: string | null): string | null {
  if (!title) return null
  return typeIdFromBookHeading(title) ?? extraAliasMap(title)
}

export function classifyDraftV1(input: {
  problem_id: string
  page: number
  problem_number: string
  stem: string
  structure: BookStructure
  difficulty: RubricEstimate
  thresholds: ClassifierThresholds
}): ProblemClassificationV1 {
  const review_reasons: string[] = []
  const stem = input.stem.trim()
  const evidence_insufficient = stem.length < 8
  if (evidence_insufficient) review_reasons.push('EVIDENCE_INSUFFICIENT')

  const section = sectionForPage(input.structure, input.page)
  const proximity = headingProximity(input.structure, input.page, section)
  const contentUnit = contentUnitFromStem(stem)
  const headingUnit = section?.unit ?? null
  if (headingUnit && contentUnit.unit && headingUnit !== contentUnit.unit) review_reasons.push('UNIT_CONFLICT')

  let unit_id = '미정'
  let unit_confidence = 0.3
  if (contentUnit.unit && headingUnit === contentUnit.unit) {
    unit_id = contentUnit.unit
    unit_confidence = 0.97
  } else if (contentUnit.unit && headingUnit && headingUnit !== contentUnit.unit) {
    unit_id = contentUnit.unit
    unit_confidence = 0.42
  } else if (contentUnit.unit) {
    unit_id = contentUnit.unit
    unit_confidence = 0.8
    review_reasons.push('UNIT_FROM_STEM_ONLY')
  } else if (headingUnit && !headingShouldNotOverrideStem(proximity)) {
    unit_id = headingUnit
    unit_confidence = Math.min(0.88, 0.55 + proximity.proximity_score * 0.35)
  } else if (headingUnit) {
    unit_id = headingUnit
    unit_confidence = 0.4
    review_reasons.push('STALE_HEADING')
  }

  const subunit_id = section?.subunit ?? '미정'
  let subunit_confidence = section ? Math.min(0.93, 0.5 + proximity.proximity_score * 0.45) : 0.3
  if (review_reasons.includes('UNIT_CONFLICT') || proximity.stale_previous_section) {
    subunit_confidence = Math.min(subunit_confidence, 0.45)
    review_reasons.push('SUBUNIT_HEADING_RISK')
  }

  const intent = stemTypeIntent(stem)
  const fromHeading = headingTypeId(proximity.heading)
  let type_id = 'TYPE_UNCLEAR'
  let type_confidence = 0.28
  if (intent.type_id && fromHeading && intent.type_id === fromHeading && !headingShouldNotOverrideStem(proximity)) {
    type_id = intent.type_id
    type_confidence = 0.94
  } else if (intent.type_id && fromHeading && intent.type_id !== fromHeading) {
    type_id = intent.type_id
    type_confidence = 0.5
    review_reasons.push('TYPE_HEADING_STEM_MISMATCH')
  } else if (intent.type_id) {
    type_id = intent.type_id
    type_confidence = 0.72
    review_reasons.push('TYPE_FROM_STEM_ONLY')
  } else if (fromHeading && !headingShouldNotOverrideStem(proximity)) {
    type_id = fromHeading
    type_confidence = 0.7
  } else {
    review_reasons.push('TYPE_UNCLEAR')
  }

  const profile: TypeProfileV1 | undefined = profileById(type_id)
  const subtype = subtypeFromStem(type_id, stem)
  const keyPoints = profile?.key_test_points ?? []
  const strategies = profile?.solution_strategies ?? []
  const mistakes = profile?.common_mistakes ?? []
  if (!profile || type_id === 'TYPE_UNCLEAR') review_reasons.push('TYPE_UNCLEAR')
  if (!keyPoints.length) review_reasons.push('KEY_POINT_REVIEW')
  if (!strategies.length) review_reasons.push('STRATEGY_REVIEW')
  if (profile && !mistakes.length) review_reasons.push('MISTAKE_UNSUPPORTED')

  const keyConf = keyPoints.length ? 0.84 : 0.2
  const stratConf = strategies.length ? 0.84 : 0.2
  const mistakeAuto = mistakes.length > 0 && mistakes.every((row) => row.evidence_basis.trim().length > 8)

  const unitDecision: FieldDecision =
    unit_confidence >= input.thresholds.unit && !review_reasons.includes('UNIT_CONFLICT') ? 'AUTO' : 'REVIEW'
  const subunitDecision: FieldDecision =
    subunit_confidence >= input.thresholds.subunit && !review_reasons.includes('SUBUNIT_HEADING_RISK') ? 'AUTO' : 'REVIEW'
  const typeDecision: FieldDecision =
    type_confidence >= input.thresholds.type && !review_reasons.includes('TYPE_UNCLEAR') && type_id !== 'TYPE_UNCLEAR'
      ? 'AUTO'
      : 'REVIEW'
  const subtypeDecision: FieldDecision = subtype.subtype_id && subtype.confidence >= 0.75 ? 'AUTO' : subtype.subtype_id ? 'REVIEW' : 'REVIEW'
  const keyDecision: FieldDecision = keyConf >= input.thresholds.key_point && typeDecision === 'AUTO' ? 'AUTO' : 'REVIEW'
  const stratDecision: FieldDecision =
    stratConf >= input.thresholds.solution_strategy && typeDecision === 'AUTO' ? 'AUTO' : 'REVIEW'
  const mistakeDecision: FieldDecision = mistakeAuto && typeDecision === 'AUTO' ? 'AUTO' : 'REVIEW'
  const diffDecision: FieldDecision =
    input.difficulty.difficulty_confidence >= input.thresholds.difficulty && !evidence_insufficient ? 'AUTO' : 'REVIEW'
  const overall: FieldDecision =
    unitDecision === 'AUTO' && typeDecision === 'AUTO' && !evidence_insufficient ? 'AUTO' : 'REVIEW'

  return {
    problem_id: input.problem_id,
    page_number: input.page,
    original_problem_number: input.problem_number,
    subject_id: '공통수학1',
    unit_id,
    unit_confidence: Number(unit_confidence.toFixed(3)),
    subunit_id,
    subunit_confidence: Number(subunit_confidence.toFixed(3)),
    type_id,
    type_confidence: Number(type_confidence.toFixed(3)),
    subtype_id: subtype.subtype_id,
    subtype_confidence: Number(subtype.confidence.toFixed(3)),
    core_concepts: profile?.core_concepts ?? [],
    solution_strategy: strategies,
    key_test_points: keyPoints,
    difficulty_level: evidence_insufficient ? null : input.difficulty.difficulty_level,
    difficulty_confidence: Number(input.difficulty.difficulty_confidence.toFixed(3)),
    difficulty_evidence: input.difficulty.difficulty_evidence,
    source_difficulty_label: input.difficulty.source_difficulty_label,
    classification_status: overall,
    review_reasons: [...new Set(review_reasons)],
    source_heading: proximity.heading,
    source_heading_distance: proximity.page_distance,
    source_alias_match: fromHeading && proximity.heading ? proximity.heading : null,
    decisions: {
      unit: unitDecision,
      subunit: subunitDecision,
      type: typeDecision,
      subtype: subtype.subtype_id ? subtypeDecision : 'REVIEW',
      key_point: keyDecision,
      solution_strategy: stratDecision,
      common_mistakes: mistakeDecision,
      difficulty: diffDecision,
      overall,
    },
    stem_excerpt: stem.replace(/\s+/g, ' ').slice(0, 200),
    evidence_insufficient,
  }
}

export function catalogWithAliases(aliases: Array<{ alias: string; canonical_type_id: string | null }>): TypeProfileV1[] {
  const catalog = TYPE_PROFILES_V1.map((row) => ({ ...row, source_aliases: [...row.source_aliases], representative_problem_ids: [...row.representative_problem_ids] }))
  for (const alias of aliases) {
    if (!alias.canonical_type_id) continue
    const profile = catalog.find((row) => row.type_id === alias.canonical_type_id)
    if (profile && !profile.source_aliases.includes(alias.alias)) profile.source_aliases.push(alias.alias)
  }
  return catalog
}
