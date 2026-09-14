/**
 * Content-based HYPER classification + enrichment for 쎈수학 listed items.
 * Reuses heading AUTO cache. Never invents publisher 유형. Never VERIFIED/DELETE.
 */
import { createHash } from 'node:crypto'
import { typeIntentFromStem } from '../classification/classifyDraft'
import { SSEN_MAJORS, SSEN_SOURCE_DOCUMENT_ID, SSEN_TYPES, sectionForPage, type FrozenSection } from '../outline/ssenToc'
import { overallDifficulty, type DifficultyDims } from '../workflow/difficulty'
import { extractDifficultyV2Features } from './difficulty813a'
import { extractRubricFeatures, mapRubricLevel } from './difficultyRubric'
import { extractConditionStructure } from './conditionStructure'
import {
  extractMathFingerprint,
  fingerprintAgreement,
  inferTypeFromFingerprint,
  type MathFingerprint,
} from './mathFingerprint'
import {
  extractTypeMarkers,
  hyperTypeFromSsenTitle,
  looksLikeAnswerKeyLeak,
  unitFromSection,
  type SsenClassifyDecision,
  type SsenClassifyItem,
  type SsenHeadingHit,
} from './ssenFullClassify'
import { UNIT_CODE, SUBUNIT_CODE } from './classificationPersistence'
import { profileById, TYPE_PROFILES_V1 } from './typeProfiles'

export const HYPER_COMPLETE_VERSION = 'ssen-hyper-v1'
export const HYPER_ASSIGNED_BY = 'SSEN_HYPER_COMPLETE'
export const HYPER_ARTIFACT = 'ssen-hyper-complete'
export const COST_CAP_USD = 5

export type Confirmation = 'SOURCE_CONFIRMED' | 'CLUSTER_CONFIRMED' | 'AI_CONFIRMED' | 'LOW_CONFIDENCE_REVIEW'
export type SourceStagePrint = 'A' | 'B' | 'C' | null
export type ItemKind = 'CALC' | 'REASON' | 'PROOF'

export type HyperCompleteItem = SsenClassifyItem & {
  cached_type_id?: string | null
  cached_type_code?: string | null
  cached_verdict?: 'AUTO' | 'HUMAN'
  cached_reasons?: string[]
  cached_confirmation?: Confirmation
}

export type SearchFeature = {
  problem_id: string
  public_code: string
  original_problem_number: string
  major: string | null
  minor: string | null
  concept_ids: string[]
  primary_type: string | null
  secondary_type: string | null
  source_type: string | null
  condition_ids: string[]
  target_ids: string[]
  reasoning_ids: string[]
  strategy_id: string | null
  key_point_ids: string[]
  mistake_ids: string[]
  hyper_dims: DifficultyDims | null
  hyper_overall: string | null
  source_stage: SourceStagePrint
  item_format: 'mcq' | 'descriptive' | 'unknown'
  has_figure: boolean
  has_table: boolean
  has_graph: boolean
  item_kind: ItemKind
  confirmation: Confirmation | null
}

export type HyperCompleteRow = {
  problem_id: string
  public_code: string
  original_problem_number: string
  source_page: number
  section_code: string | null
  unit_id: string | null
  subunit_id: string | null
  type_id: string | null
  secondary_type_id: string | null
  source_type: string | null
  type_title: string | null
  type_code: string | null
  confirmation: Confirmation
  evidence: string[]
  reasons: string[]
  cached: boolean
  leak_stripped: boolean
  cleaned_stem: string
  concept_ids: string[]
  strategy_id: string | null
  key_point_ids: string[]
  mistake_ids: string[]
  condition_ids: string[]
  target_ids: string[]
  reasoning_ids: string[]
  hyper_dims: DifficultyDims | null
  hyper_overall: string | null
  source_stage: SourceStagePrint
  search: SearchFeature
  input_hash: string
  classifier_version: string
  persist_type: boolean
  persist_enrichment: boolean
  clear_needs_review: boolean
}

export function inputHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export function stripAnswerKeyLeak(stem: string): { cleaned: string; changed: boolean } {
  const original = stem.trim()
  let text = original
  text = text.replace(/\n*정답\s*및\s*풀이[\s\S]*$/g, '')
  text = text.replace(/정답\s*:[^\n]*/g, '')
  text = text.replace(/(^|\n)풀이\s*:[^\n]*/g, '$1')
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return { cleaned: text, changed: text !== original }
}

export function allowedHyperTypesForSection(section: FrozenSection): string[] {
  const ids = SSEN_TYPES.filter((row) => row.sectionCode === section.code)
    .map((row) => hyperTypeFromSsenTitle(`유형 ${row.typeCode} ${row.title}`, section.title))
    .filter((id): id is string => Boolean(id && profileById(id)))
  const bySubunit = TYPE_PROFILES_V1.filter((row) => row.subunit_id === section.title).map((row) => row.type_id)
  return [...new Set([...ids, ...bySubunit])]
}

export function sourceTypeRow(stem: string, section: FrozenSection) {
  const allowedCodes = new Set(SSEN_TYPES.filter((row) => row.sectionCode === section.code).map((row) => row.typeCode))
  const markers = [...new Set(extractTypeMarkers(stem).filter((code) => allowedCodes.has(code)))]
  if (markers.length !== 1) return null
  return SSEN_TYPES.find((item) => item.sectionCode === section.code && item.typeCode === markers[0]) ?? null
}

export function sourceTypeFromStem(stem: string, section: FrozenSection): string | null {
  const row = sourceTypeRow(stem, section)
  return row ? `유형 ${row.typeCode}` : null
}

export function sourceStageFromHeadings(page: number, headings: SsenHeadingHit[]): SourceStagePrint {
  const hits = headings.filter((row) => row.page === page)
  if (hits.some((row) => row.kind === 'c_stage')) return 'C'
  if (hits.some((row) => row.kind === 'type_pill')) return 'B'
  if (hits.some((row) => row.kind === 'concept_pill')) return 'A'
  return null
}

export function structureKey(fp: MathFingerprint, subunit: string): string {
  const flags = [
    fp.remainder_structure ? 'rem' : '',
    fp.identity_structure ? 'id' : '',
    fp.undetermined_coeff ? 'uc' : '',
    fp.synthetic_division ? 'syn' : '',
    fp.factorization_structure ? 'fac' : '',
    fp.discriminant_structure ? 'disc' : '',
    fp.root_relation ? 'vieta' : '',
    fp.function_relation ? 'fn' : '',
    fp.cubic_quartic ? 'cubic' : '',
    fp.inequality_structure ?? '',
    fp.permutation_combination_structure ? 'count' : '',
    fp.matrix_operation ? 'mat' : '',
  ].filter(Boolean)
  return [subunit, fp.requested_quantity.slice().sort().join(','), flags.join(',')].join('|')
}

function uniqueAllowed(ids: Array<string | null | undefined>, allowed: Set<string>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id && allowed.has(id))))]
}

const STEM_TYPE_HINTS: Array<[RegExp, string]> = [
  [/삼차방정식|사차방정식|x\s*\^\s*3|x\s*\^\s*4/, 'CUBIC_QUARTIC_EQ'],
  [/조립제법/, 'SYNTHETIC_DIVISION'],
  [/나머지정리|인수정리|나누었을\s*때.*나머지/, 'REMAINDER_FACTOR_THEOREM'],
  [/미정계수/, 'UNDETERMINED_COEFF'],
  [/항등식/, 'IDENTITY_PROPERTY'],
  [/켤레복소수/, 'COMPLEX_CONJUGATE'],
  [/복소수/, 'COMPLEX_ARITHMETIC'],
  [/판별식/, 'QUADRATIC_DISCRIMINANT'],
  [/근과\s*계수/, 'QUADRATIC_VIETAS'],
  [/이차함수/, 'QUAD_FN_RELATION'],
  [/이차부등식/, 'QUADRATIC_INEQUALITY'],
  [/일차부등식|부등식/, 'LINEAR_INEQUALITY'],
  [/순열|조합|경우의\s*수/, 'COUNTING_PERM_COMB'],
  [/행렬/, 'MATRIX_ARITHMETIC'],
  [/내림차순|오름차순|동류항/, 'POLY_ADD_SUB'],
]

export function contentTypeVotes(stem: string, allowed: string[]): { type_id: string | null; secondary: string | null; votes: string[] } {
  const allow = new Set(allowed)
  const fp = extractMathFingerprint(stem)
  const intent = typeIntentFromStem(stem).type_id
  const inferred = inferTypeFromFingerprint(fp)
  const supported = allowed.filter((id) => fingerprintAgreement(id, fp) === 'SUPPORT')
  const hinted = STEM_TYPE_HINTS.find(([pattern, typeId]) => pattern.test(stem) && allow.has(typeId))?.[1] ?? null
  const ranked = uniqueAllowed([inferred, intent, hinted, ...supported], allow)
  if (ranked.length === 1) return { type_id: ranked[0]!, secondary: null, votes: [`content:${ranked[0]}`] }
  if (ranked.length >= 2) return { type_id: ranked[0]!, secondary: ranked[1]!, votes: ranked.map((id) => `content:${id}`) }
  if (intent && allow.has(intent) && fingerprintAgreement(intent, fp) !== 'CONFLICT') {
    return { type_id: intent, secondary: null, votes: [`intent:${intent}`] }
  }
  if (hinted && fingerprintAgreement(hinted, fp) !== 'CONFLICT') {
    return { type_id: hinted, secondary: null, votes: [`hint:${hinted}`] }
  }
  if (supported.length === 1) return { type_id: supported[0]!, secondary: null, votes: [`fp:${supported[0]}`] }
  return { type_id: null, secondary: null, votes: [] }
}

export function confirmType(input: {
  cachedAuto: boolean
  sourceType: string | null
  clusterType: string | null
  contentType: string | null
  aiType: string | null
  fingerprintOk: boolean
  sectionType?: string | null
}): { type_id: string | null; confirmation: Confirmation; evidence: string[] } {
  const sectionType = input.sectionType ?? null
  const evidence: string[] = []
  if (input.cachedAuto) evidence.push('cached_heading_auto')
  if (input.sourceType) evidence.push('source_type')
  if (input.clusterType) evidence.push('cluster')
  if (input.contentType) evidence.push('content')
  if (input.aiType) evidence.push('ai')
  if (sectionType) evidence.push('section_allowed')
  if (input.fingerprintOk) evidence.push('fingerprint')

  if (input.cachedAuto && (input.contentType || input.sourceType || input.clusterType || input.fingerprintOk)) {
    return { type_id: input.contentType ?? input.sourceType ?? input.clusterType, confirmation: 'SOURCE_CONFIRMED', evidence }
  }

  if (
    input.clusterType &&
    sectionType &&
    input.clusterType === sectionType &&
    (!input.contentType || input.contentType === input.clusterType)
  ) {
    return { type_id: input.clusterType, confirmation: 'CLUSTER_CONFIRMED', evidence }
  }

  const clusterVsContent =
    input.clusterType && input.contentType && input.clusterType !== input.contentType
  if (clusterVsContent && input.aiType && (input.aiType === input.contentType || input.aiType === input.clusterType)) {
    return { type_id: input.aiType, confirmation: 'AI_CONFIRMED', evidence }
  }

  const agreed: string[] = []
  if (input.sourceType && input.contentType && input.sourceType === input.contentType) agreed.push(input.contentType)
  if (input.clusterType && input.contentType && input.clusterType === input.contentType) agreed.push(input.contentType)
  if (input.aiType && input.contentType && input.aiType === input.contentType) agreed.push(input.contentType)
  if (sectionType && input.contentType && sectionType === input.contentType) agreed.push(input.contentType)
  if (input.contentType && input.fingerprintOk) agreed.push(input.contentType)
  if (input.clusterType && input.fingerprintOk && (!input.contentType || input.contentType === input.clusterType)) {
    agreed.push(input.clusterType)
  }
  if (sectionType && input.fingerprintOk && (!input.contentType || input.contentType === sectionType)) {
    agreed.push(sectionType)
  }
  if (input.aiType && input.fingerprintOk && (!input.contentType || input.contentType === input.aiType)) {
    agreed.push(input.aiType)
  }
  if (input.clusterType && sectionType && input.clusterType === sectionType) {
    agreed.push(input.clusterType)
  }
  if (input.sourceType && input.clusterType) agreed.push(input.clusterType)

  const unique = [...new Set(agreed)]
  if (unique.length === 1 && evidence.length >= 2) {
    const confirmation: Confirmation = input.sourceType && input.sourceType === unique[0]
      ? 'SOURCE_CONFIRMED'
      : input.aiType && input.aiType === unique[0]
        ? 'AI_CONFIRMED'
        : 'CLUSTER_CONFIRMED'
    return { type_id: unique[0]!, confirmation, evidence }
  }
  if (input.contentType && input.fingerprintOk) {
    return { type_id: input.contentType, confirmation: 'CLUSTER_CONFIRMED', evidence: [...new Set([...evidence, 'fingerprint'])] }
  }
  if (input.clusterType && input.fingerprintOk) {
    return { type_id: input.clusterType, confirmation: 'CLUSTER_CONFIRMED', evidence }
  }
  if (sectionType && input.fingerprintOk) {
    return { type_id: sectionType, confirmation: 'CLUSTER_CONFIRMED', evidence }
  }
  return {
    type_id: input.contentType ?? input.clusterType ?? sectionType ?? input.aiType,
    confirmation: 'LOW_CONFIDENCE_REVIEW',
    evidence,
  }
}

function clampDim(value: number): 1 | 2 | 3 | 4 | 5 {
  return mapRubricLevel(Math.max(0, Math.min(1, value)))
}

export function hyperDimsForStem(stem: string, extras?: { math_count?: number; figure?: boolean; graph?: boolean; table?: boolean }): DifficultyDims {
  const math_count = extras?.math_count ?? (stem.match(/\$.+?\$/g) ?? []).length
  const features = extractDifficultyV2Features({
    stem,
    choice_count: /다음\s*중/.test(stem) ? 5 : 0,
    math_count,
    figure_hint: Boolean(extras?.figure) || /그림|도형/.test(stem),
    graph_hint: Boolean(extras?.graph) || /그래프/.test(stem),
  })
  const rubric = extractRubricFeatures({
    stem,
    choice_count: /다음\s*중/.test(stem) ? 5 : 0,
    math_count,
    figure_hint: Boolean(extras?.figure) || /그림|도형/.test(stem),
    graph_hint: Boolean(extras?.graph) || /그래프/.test(stem),
    table_hint: extras?.table,
  })
  return {
    concept_difficulty: clampDim(0.55 * features.concept_count + 0.45 * features.multi_concept_combo),
    calculation_complexity: clampDim(0.7 * features.computation_load + 0.3 * features.expression_complexity),
    reasoning_depth: clampDim(0.55 * features.reasoning_steps + 0.45 * features.non_routine),
    condition_complexity: clampDim(0.65 * features.condition_interaction + 0.35 * rubric.case_split),
    representation_complexity: clampDim(0.6 * features.representation_switch + 0.4 * features.expression_complexity),
    trap_level: clampDim(features.trap_density),
  }
}

export function blendDims(base: DifficultyDims, item: DifficultyDims): DifficultyDims {
  const mix = (a: number, b: number) => clampDim((a * 0.45 + b * 0.55) / 5)
  return {
    concept_difficulty: mix(base.concept_difficulty, item.concept_difficulty),
    calculation_complexity: mix(base.calculation_complexity, item.calculation_complexity),
    reasoning_depth: mix(base.reasoning_depth, item.reasoning_depth),
    condition_complexity: mix(base.condition_complexity, item.condition_complexity),
    representation_complexity: mix(base.representation_complexity, item.representation_complexity),
    trap_level: mix(base.trap_level, item.trap_level),
  }
}

export function dictionaryForType(typeId: string | null): {
  concept_ids: string[]
  strategy_id: string | null
  key_point_ids: string[]
  mistake_ids: string[]
} {
  const profile = typeId ? profileById(typeId) : undefined
  if (!profile) return { concept_ids: [], strategy_id: null, key_point_ids: [], mistake_ids: [] }
  return {
    concept_ids: profile.core_concepts.map((_, i) => `${typeId}:concept:${i}`),
    strategy_id: `${typeId}:strategy`,
    key_point_ids: profile.key_test_points.map((_, i) => `${typeId}:ktp:${i}`),
    mistake_ids: profile.common_mistakes.map((row) => row.mistake_id),
  }
}

export function conditionTargetReasoning(stem: string, fp: MathFingerprint): {
  condition_ids: string[]
  target_ids: string[]
  reasoning_ids: string[]
} {
  const cond = extractConditionStructure(stem)
  const condition_ids = [
    cond.integer_restriction ? 'NATURAL_NUMBER' : null,
    cond.remainder_after_division ? 'REMAINDER_AFTER_DIVISION' : null,
    cond.p_of_a_zero ? 'P_OF_A_ZERO' : null,
    cond.vieta_sum || cond.vieta_product ? 'VIETA' : null,
    cond.inequality ? 'INEQUALITY' : null,
    cond.distinct_roots ? 'DISTINCT_ROOTS' : null,
  ].filter((id): id is string => Boolean(id))
  const target_ids = [
    fp.requested_quantity.includes('roots') || fp.requested_quantity.includes('solve') ? 'EQUATION_SOLUTION' : null,
    fp.requested_quantity.includes('remainder') ? 'REMAINDER' : null,
    fp.requested_quantity.includes('maxmin') ? 'MAXIMUM' : null,
    fp.requested_quantity.includes('count') ? 'COUNT' : null,
    fp.requested_quantity.includes('factorization') ? 'FACTORIZATION' : null,
    fp.requested_quantity.includes('inequality_range') ? 'SOLUTION_SET' : null,
  ].filter((id): id is string => Boolean(id))
  const reasoning_ids = [
    /대입|x\s*=/.test(stem) ? 'SUBSTITUTION' : null,
    /전개|변형|인수분해/.test(stem) ? 'TRANSFORMATION' : null,
    cond.condition_count >= 2 || /\(가\)/.test(stem) ? 'MULTI_STEP' : null,
    /그림|그래프|도형/.test(stem) ? 'MODELING' : null,
    !condition_ids.length && !/이용하여|따라서/.test(stem) ? 'DIRECT_RECALL' : null,
  ].filter((id): id is string => Boolean(id))
  return {
    condition_ids: [...new Set(condition_ids)],
    target_ids: [...new Set(target_ids.length ? target_ids : ['VALUE'])],
    reasoning_ids: [...new Set(reasoning_ids.length ? reasoning_ids : ['DIRECT_RECALL'])],
  }
}

export function itemKindFromStem(stem: string): ItemKind {
  if (/증명|설명하시오|이유를\s*쓰/.test(stem)) return 'PROOF'
  if (/보기|ㄱ|경우로\s*나누|이용하여/.test(stem)) return 'REASON'
  return 'CALC'
}

function majorityFromVotes(votes: Map<string, Map<string, number>>, minCount = 2) {
  const majority = new Map<string, string>()
  for (const [key, bag] of votes) {
    const top = [...bag.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] >= minCount) majority.set(key, top[0])
  }
  return majority
}

export function planSsenHyperComplete(input: {
  items: HyperCompleteItem[]
  headings?: SsenHeadingHit[]
  aiTypes?: Map<string, string>
  clusterTypeByKey?: Map<string, string>
  clusterTypeByProblem?: Map<string, string>
}): { rows: HyperCompleteRow[]; summary: Record<string, number> } {
  const headings = input.headings ?? []
  const listed = [...input.items].sort((a, b) => a.original_problem_number.localeCompare(b.original_problem_number))
  const labeled = listed.filter((row) => row.cached_verdict === 'AUTO' && row.cached_type_id)
  const clusterVotes = new Map<string, Map<string, number>>()
  const sectionVotes = new Map<string, Map<string, number>>()
  for (const item of labeled) {
    const section = sectionForPage(item.source_page)
    if (!section || !item.cached_type_id) continue
    const key = structureKey(extractMathFingerprint(item.stem), section.title)
    const bag = clusterVotes.get(key) ?? new Map<string, number>()
    bag.set(item.cached_type_id, (bag.get(item.cached_type_id) ?? 0) + 1)
    clusterVotes.set(key, bag)
    const sectionBag = sectionVotes.get(section.code) ?? new Map<string, number>()
    sectionBag.set(item.cached_type_id, (sectionBag.get(item.cached_type_id) ?? 0) + 1)
    sectionVotes.set(section.code, sectionBag)
  }
  const majority = majorityFromVotes(clusterVotes, 2)
  const sectionMajority = majorityFromVotes(sectionVotes, 1)

  const clusterBaseDims = new Map<string, DifficultyDims>()
  for (const item of labeled) {
    const section = sectionForPage(item.source_page)
    if (!section) continue
    const key = structureKey(extractMathFingerprint(item.stem), section.title)
    if (!clusterBaseDims.has(key)) clusterBaseDims.set(key, hyperDimsForStem(item.stem))
  }

  const rows: HyperCompleteRow[] = []
  for (const item of listed) {
    const section = sectionForPage(item.source_page)
    const leak = looksLikeAnswerKeyLeak(item.stem)
    const stripped = leak ? stripAnswerKeyLeak(item.stem) : { cleaned: item.stem.trim(), changed: false }
    const stem = stripped.cleaned
    const hash = inputHash({
      version: HYPER_COMPLETE_VERSION,
      problem_id: item.problem_id,
      stem,
      page: item.source_page,
      number: item.original_problem_number,
    })
    if (!section) {
      rows.push(emptyRow(item, hash, ['NO_SECTION']))
      continue
    }
    const allowed = allowedHyperTypesForSection(section)
    const allow = new Set(allowed)
    const sourceRow = sourceTypeRow(stem, section)
    const sourceType = sourceRow ? `유형 ${sourceRow.typeCode}` : null
    const sourceHyper = sourceRow
      ? hyperTypeFromSsenTitle(`유형 ${sourceRow.typeCode} ${sourceRow.title}`, section.title)
      : null
    const fp = extractMathFingerprint(stem)
    const content = contentTypeVotes(stem, allowed)
    const key = structureKey(fp, section.title)
    const structureCluster = (input.clusterTypeByKey?.get(key) ?? majority.get(key) ?? null)
    const neighborCluster = input.clusterTypeByProblem?.get(item.problem_id) ?? null
    const clusterType = [structureCluster, neighborCluster].find((id) => id && allow.has(id)) ?? null
    const clusterAllowed = clusterType && allow.has(clusterType) ? clusterType : null
    const sectionType = sectionMajority.get(section.code)
    const sectionAllowed = sectionType && allow.has(sectionType) ? sectionType : null
    const aiType = input.aiTypes?.get(item.problem_id)
    const aiAllowed = aiType && allow.has(aiType) ? aiType : null
    const cachedAuto = item.cached_verdict === 'AUTO' && Boolean(item.cached_type_id) && allow.has(item.cached_type_id ?? '')
    const preferred = cachedAuto
      ? item.cached_type_id!
      : content.type_id ?? clusterAllowed ?? sectionAllowed ?? aiAllowed
    const fingerprintOk = preferred ? fingerprintAgreement(preferred, fp) !== 'CONFLICT' : false
    const decided = confirmType({
      cachedAuto,
      sourceType: sourceHyper && allow.has(sourceHyper) ? sourceHyper : null,
      clusterType: clusterAllowed,
      contentType: content.type_id && allow.has(content.type_id) ? content.type_id : null,
      aiType: aiAllowed,
      fingerprintOk,
      sectionType: sectionAllowed,
    })
    let typeId = decided.type_id && allow.has(decided.type_id) ? decided.type_id : null
    if (cachedAuto) {
      typeId = item.cached_type_id!
    } else if (!typeId && preferred && allow.has(preferred)) {
      typeId = preferred
    }
    const secondary =
      content.secondary && content.secondary !== typeId && allow.has(content.secondary) ? content.secondary : null
    const profile = typeId ? profileById(typeId) : undefined
    const dict = dictionaryForType(typeId)
    const terms = conditionTargetReasoning(stem, fp)
    const itemDims = hyperDimsForStem(stem)
    const base = clusterBaseDims.get(key)
    const dims = typeId ? (base ? blendDims(base, itemDims) : itemDims) : null
    const overall = dims ? overallDifficulty(dims) : null
    const stage = sourceStageFromHeadings(item.source_page, headings)
    const figure = /그림|도형/.test(stem)
    const graph = /그래프/.test(stem)
    const table = /표/.test(stem)
    const confirmation = cachedAuto ? 'SOURCE_CONFIRMED' : decided.confirmation
    const persist_type = Boolean(typeId && profile && item.current_version_id && item.origin !== 'TEACHER_EDIT' && item.review_status !== 'VERIFIED')
    const search: SearchFeature = {
      problem_id: item.problem_id,
      public_code: item.public_code,
      original_problem_number: item.original_problem_number,
      major: SSEN_MAJORS.find((row) => row.code === section.majorCode)?.title ?? unitFromSection(section),
      minor: section.title,
      concept_ids: dict.concept_ids,
      primary_type: typeId,
      secondary_type: secondary,
      source_type: sourceType,
      condition_ids: terms.condition_ids,
      target_ids: terms.target_ids,
      reasoning_ids: terms.reasoning_ids,
      strategy_id: dict.strategy_id,
      key_point_ids: dict.key_point_ids,
      mistake_ids: dict.mistake_ids,
      hyper_dims: dims,
      hyper_overall: overall,
      source_stage: stage,
      item_format: fp.answer_structure,
      has_figure: figure,
      has_table: table,
      has_graph: graph,
      item_kind: itemKindFromStem(stem),
      confirmation: typeId ? confirmation : 'LOW_CONFIDENCE_REVIEW',
    }
    const reasons: string[] = []
    if (!typeId) reasons.push('TYPE_UNRESOLVED')
    if (confirmation === 'LOW_CONFIDENCE_REVIEW') reasons.push('LOW_CONFIDENCE_REVIEW')
    if (item.origin === 'TEACHER_EDIT') reasons.push('TEACHER_EDIT')
    if (item.review_status === 'VERIFIED') reasons.push('VERIFIED_BLOCKED')
    if (leak && !stripped.changed) reasons.push('ANSWER_KEY_LEAK')
    rows.push({
      problem_id: item.problem_id,
      public_code: item.public_code,
      original_problem_number: item.original_problem_number,
      source_page: item.source_page,
      section_code: section.code,
      unit_id: unitFromSection(section),
      subunit_id: section.title,
      type_id: typeId,
      secondary_type_id: secondary,
      source_type: sourceType,
      type_title: profile?.canonical_name_ko ?? null,
      type_code: item.cached_type_code ?? null,
      confirmation,
      evidence: [...new Set([...(decided.evidence), cachedAuto ? 'cached_heading_auto' : '', `toc_section:${section.code}`].filter(Boolean))],
      reasons,
      cached: cachedAuto,
      leak_stripped: stripped.changed,
      cleaned_stem: stem,
      concept_ids: dict.concept_ids,
      strategy_id: dict.strategy_id,
      key_point_ids: dict.key_point_ids,
      mistake_ids: dict.mistake_ids,
      condition_ids: terms.condition_ids,
      target_ids: terms.target_ids,
      reasoning_ids: terms.reasoning_ids,
      hyper_dims: dims,
      hyper_overall: overall,
      source_stage: stage,
      search,
      input_hash: hash,
      classifier_version: HYPER_COMPLETE_VERSION,
      persist_type,
      persist_enrichment: persist_type,
      clear_needs_review:
        persist_type &&
        confirmation !== 'LOW_CONFIDENCE_REVIEW' &&
        item.review_status === 'NEEDS_REVIEW' &&
        !looksLikeAnswerKeyLeak(stem),
    })
  }

  const humanNew = rows.filter((row) => !row.cached)
  const byId = Object.fromEntries(rows.map((row) => [row.problem_id, row]))
  const reasonItems = (reason: string) => listed.filter((item) => item.cached_reasons?.includes(reason))
  const reasonTyped = (reason: string) => reasonItems(reason).filter((item) => Boolean(byId[item.problem_id]?.type_id)).length
  const summary = {
    listed: rows.length,
    cached_auto: rows.filter((row) => row.cached).length,
    new_targets: humanNew.length,
    hyper_type: rows.filter((row) => Boolean(row.type_id)).length,
    hyper_type_remaining: rows.filter((row) => !row.type_id).length,
    low_confidence: rows.filter((row) => row.confirmation === 'LOW_CONFIDENCE_REVIEW').length,
    source_confirmed: rows.filter((row) => row.confirmation === 'SOURCE_CONFIRMED').length,
    cluster_confirmed: rows.filter((row) => row.confirmation === 'CLUSTER_CONFIRMED').length,
    ai_confirmed: rows.filter((row) => row.confirmation === 'AI_CONFIRMED').length,
    concept: rows.filter((row) => row.concept_ids.length > 0).length,
    difficulty: rows.filter((row) => Boolean(row.hyper_dims)).length,
    strategy: rows.filter((row) => Boolean(row.strategy_id)).length,
    key_points: rows.filter((row) => row.key_point_ids.length > 0).length,
    mistakes: rows.filter((row) => row.mistake_ids.length > 0).length,
    search_features: rows.filter((row) => Boolean(row.search.primary_type && row.search.strategy_id && row.search.hyper_dims)).length,
    leak_stripped: rows.filter((row) => row.leak_stripped).length,
    persist_type: rows.filter((row) => row.persist_type).length,
    type_marker_missing: reasonItems('TYPE_MARKER_MISSING').length,
    type_marker_missing_typed: reasonTyped('TYPE_MARKER_MISSING'),
    type_marker_ambiguous: reasonItems('TYPE_MARKER_AMBIGUOUS').length,
    type_marker_ambiguous_typed: reasonTyped('TYPE_MARKER_AMBIGUOUS'),
    answer_key_leak: reasonItems('ANSWER_KEY_LEAK').length,
    answer_key_leak_typed: reasonTyped('ANSWER_KEY_LEAK'),
  }
  return { rows, summary }
}

function emptyRow(item: HyperCompleteItem, hash: string, reasons: string[]): HyperCompleteRow {
  const search: SearchFeature = {
    problem_id: item.problem_id,
    public_code: item.public_code,
    original_problem_number: item.original_problem_number,
    major: null,
    minor: null,
    concept_ids: [],
    primary_type: null,
    secondary_type: null,
    source_type: null,
    condition_ids: [],
    target_ids: [],
    reasoning_ids: [],
    strategy_id: null,
    key_point_ids: [],
    mistake_ids: [],
    hyper_dims: null,
    hyper_overall: null,
    source_stage: null,
    item_format: 'unknown',
    has_figure: false,
    has_table: false,
    has_graph: false,
    item_kind: 'CALC',
    confirmation: 'LOW_CONFIDENCE_REVIEW',
  }
  return {
    problem_id: item.problem_id,
    public_code: item.public_code,
    original_problem_number: item.original_problem_number,
    source_page: item.source_page,
    section_code: null,
    unit_id: null,
    subunit_id: null,
    type_id: null,
    secondary_type_id: null,
    source_type: null,
    type_title: null,
    type_code: null,
    confirmation: 'LOW_CONFIDENCE_REVIEW',
    evidence: [],
    reasons,
    cached: false,
    leak_stripped: false,
    cleaned_stem: item.stem,
    concept_ids: [],
    strategy_id: null,
    key_point_ids: [],
    mistake_ids: [],
    condition_ids: [],
    target_ids: [],
    reasoning_ids: [],
    hyper_dims: null,
    hyper_overall: null,
    source_stage: null,
    search,
    input_hash: hash,
    classifier_version: HYPER_COMPLETE_VERSION,
    persist_type: false,
    persist_enrichment: false,
    clear_needs_review: false,
  }
}

export function neighborTypeMatch(sample: Array<{ type_id: string | null; neighbor_types: string[] }>): {
  checked: number
  matched: number
} {
  const usable = sample.filter((row) => row.type_id && row.neighbor_types.length)
  const matched = usable.filter((row) => row.neighbor_types.some((type) => type === row.type_id)).length
  return { checked: usable.length, matched }
}

export type CachedHeadingDecision = Pick<
  SsenClassifyDecision,
  'problem_id' | 'type_id' | 'type_code' | 'verdict' | 'reasons'
>

export function mergeHeadingCache(items: SsenClassifyItem[], cached: CachedHeadingDecision[]): HyperCompleteItem[] {
  const byId = new Map(cached.map((row) => [row.problem_id, row]))
  return items.map((item) => {
    const hit = byId.get(item.problem_id)
    return {
      ...item,
      cached_type_id: hit?.type_id ?? null,
      cached_type_code: hit?.type_code ?? null,
      cached_verdict: hit?.verdict,
      cached_reasons: hit?.reasons,
    }
  })
}

export function classificationPayloadFromHyperRow(
  row: HyperCompleteRow,
  versionId: string,
): Record<string, unknown> {
  const profile = row.type_id ? profileById(row.type_id) : undefined
  return {
    problem_id: row.problem_id,
    expected_version_id: versionId,
    source_document_id: SSEN_SOURCE_DOCUMENT_ID,
    page_number: row.source_page,
    original_problem_number: row.original_problem_number,
    classification_status: 'AUTO',
    type_code: row.type_id,
    unit_code: UNIT_CODE[row.unit_id ?? ''],
    subunit_code: SUBUNIT_CODE[row.subunit_id ?? ''] ?? '',
    subtype_code: '',
    persist_difficulty: false,
    difficulty_level: null,
    key_test_points: profile?.key_test_points ?? [],
    solution_strategies: profile?.solution_strategies ?? [],
    unit_confidence: row.confirmation === 'LOW_CONFIDENCE_REVIEW' ? 0.7 : 0.93,
    type_confidence: row.confirmation === 'SOURCE_CONFIRMED' ? 0.95 : row.confirmation === 'LOW_CONFIDENCE_REVIEW' ? 0.62 : 0.86,
    difficulty_confidence: row.hyper_dims ? 0.8 : 0,
    source_heading: `${row.type_title ?? row.type_id ?? ''} | ${HYPER_COMPLETE_VERSION} | ${row.input_hash.slice(0, 16)}`,
    heading_distance: 0,
    assigned_by: HYPER_ASSIGNED_BY,
    artifact_step: HYPER_ARTIFACT,
  }
}

