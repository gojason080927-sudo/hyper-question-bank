import { extractConditionStructure } from './conditionStructure'
import { extractMathFingerprint, inferTypeFromFingerprint } from './mathFingerprint'
import { MODEL_A_CUTS, assignModelC, extractDifficultyV2Features, highComplexityEvidence, scoreRubricV2, type PrimaryBand } from './difficulty813a'
import type { PublisherBadgeNorm } from './publisherBadge'

export const INTRINSIC_ENGINE = 'v2'
export const BASELINE_CUTS = MODEL_A_CUTS
export const CONFIDENCE_REVIEW = 0.55
export const TYPE_RELATIVE_MIN_N = 6
export const TYPE_RELATIVE_MAX_SHIFT = 0.08

export type ObservedFeature = {
  value: number | null
  confidence: number
  evidence: string[]
  missing_reason: string | null
}

export type IntrinsicInput = {
  stem: string
  choice_count: number
  math_count: number
  figure_hint: boolean
  graph_hint: boolean
  table_hint?: boolean
  type_id?: string | null
}

export type FamilyScores = {
  conceptual_load_score: number
  reasoning_strategy_score: number
  execution_load_score: number
  condition_complexity_score: number
  form_complexity_score: number
  type_relative_score: number | null
  conceptual_confidence: number
  reasoning_confidence: number
  execution_confidence: number
  condition_confidence: number
  form_confidence: number
}

export type IntrinsicExtract = {
  type_id: string | null
  features: Record<string, ObservedFeature>
  families: FamilyScores
  intrinsic_difficulty_score: number
  difficulty_confidence: number
  missing_families: string[]
  structural_hard: { flags: string[]; sufficient: boolean }
  publisher_badge_used: false
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function present(value: number, evidence: string[], confidence = 0.82): ObservedFeature {
  return { value: clamp01(value), confidence, evidence, missing_reason: null }
}

function missing(reason: string): ObservedFeature {
  return { value: null, confidence: 0, evidence: [], missing_reason: reason }
}

function familyMean(features: ObservedFeature[]): { score: number; confidence: number; missing: number; observed: number } {
  const observed = features.filter((row) => row.value != null && row.confidence >= 0.35)
  if (!observed.length) return { score: 0, confidence: 0.2, missing: features.length, observed: 0 }
  const values = observed.map((row) => row.value ?? 0)
  const peak = Math.max(...values)
  const activated = observed.filter((row) => (row.value ?? 0) >= 0.35)
  const missingCount = features.length - observed.length
  const confidence = clamp01(observed.reduce((acc, row) => acc + row.confidence, 0) / features.length - missingCount * 0.06)
  if (!activated.length) {
    const baseline = values.reduce((acc, value) => acc + value, 0) / values.length
    return { score: clamp01(baseline * 0.9), confidence, missing: missingCount, observed: observed.length }
  }
  const meanAct = activated.reduce((acc, row) => acc + (row.value ?? 0), 0) / activated.length
  const coverage = activated.length / features.length
  const score = clamp01(0.58 * meanAct + 0.32 * peak + 0.1 * Math.min(1, coverage * 2.2))
  return { score, confidence, missing: missingCount, observed: observed.length }
}

const CONCEPT_FAMILY_TESTS: Array<{ id: string; test: (text: string) => boolean }> = [
  { id: 'poly_ops', test: (t) => /다항식|동류항|오름차순|내림차순|A\s*\+\s*B|전개|곱셈\s*공식/.test(t) },
  { id: 'remainder_factor', test: (t) => /나머지|인수\s*정리|조립제법|나누었을/.test(t) },
  { id: 'identity_coeff', test: (t) => /항등|미정계수|계수\s*비교|값에\s*관계없이/.test(t) },
  { id: 'factoring', test: (t) => /인수분해/.test(t) },
  { id: 'complex', test: (t) => /복소수|허수|켤레/.test(t) },
  { id: 'quadratic_eq', test: (t) => /이차방정식|판별식|근과\s*계수|두\s*근/.test(t) },
  { id: 'quadratic_fn', test: (t) => /이차함수|꼭짓점|최댓|최솟|포물선/.test(t) || (/그래프/.test(t) && /이차|함수/.test(t)) },
  { id: 'inequality', test: (t) => /부등식/.test(t) },
  { id: 'counting', test: (t) => /순열|조합|경우의\s*수/.test(t) },
  { id: 'matrix', test: (t) => /행렬/.test(t) },
  { id: 'cubic', test: (t) => /삼차|사차/.test(t) },
]

function conceptFamilies(text: string, fp: ReturnType<typeof extractMathFingerprint>): string[] {
  const ids = new Set(CONCEPT_FAMILY_TESTS.filter((row) => row.test(text)).map((row) => row.id))
  if (fp.remainder_structure || fp.synthetic_division) ids.add('remainder_factor')
  if (fp.identity_structure || fp.undetermined_coeff) ids.add('identity_coeff')
  if (fp.factorization_structure) ids.add('factoring')
  if (fp.discriminant_structure || fp.root_relation) ids.add('quadratic_eq')
  if (fp.function_relation) ids.add('quadratic_fn')
  if (fp.cubic_quartic) ids.add('cubic')
  if (fp.permutation_combination_structure) ids.add('counting')
  if (fp.matrix_operation || fp.matrix_dimensions) ids.add('matrix')
  if (fp.inequality_structure) ids.add('inequality')
  if (fp.named_polynomial_system) ids.add('poly_ops')
  return [...ids]
}

function isInsufficientStem(stem: string): boolean {
  const compact = stem.replace(/\s+/g, ' ').trim()
  const hangul = (compact.match(/[가-힣]/g) ?? []).length
  const mathSlots = (compact.match(/\$.+?\$/g) ?? []).length
  if (hangul < 8 && mathSlots < 1) return true
  if (hangul < 6) return true
  if (/^(다음(을|의)?\s*)?(구하시오|고르시오)\.?$/.test(compact)) return true
  return compact.length < 12
}

function hasCaseSplitEvidence(stem: string, ganada: number): boolean {
  if (/경우로\s*나누|각각의?\s*경우|다음의?\s*경우/.test(stem)) return true
  if (ganada >= 2 && /경우로|경우에는/.test(stem)) return true
  if (/양수인\s*경우|음수인\s*경우|k\s*[<>≤≥].*k\s*[<>≤≥]/.test(stem)) return true
  return false
}

export function extractIntrinsicFeatures(input: IntrinsicInput): IntrinsicExtract {
  const stem = input.stem.replace(/\s+/g, ' ').trim()
  const fp = extractMathFingerprint(stem)
  const conditions = extractConditionStructure(stem)
  const typeId = input.type_id || inferTypeFromFingerprint(fp)
  const thin = isInsufficientStem(stem)
  const families = conceptFamilies(stem, fp)
  const linker = /이용하여|다음을\s*이용|이로부터|위의|앞에서\s*구한|동시에/.test(stem)
  const reverse =
    /만족시키는|되도록\s*하는|역으로|k의\s*값/.test(stem) ||
    (/실수\s*\$?[kabmn]|자연수\s*\$?[kn]|매개변수/.test(stem) && /값의\s*범위|만족|되도록/.test(stem)) ||
    /가장\s*작(은)?\s*자연수/.test(stem)
  const definedOp = /\*\s*=|연산|새로\s*정의/.test(stem)
  const ganada = (stem.match(/\(가\)|\(나\)|\(다\)/g) ?? []).length
  const bogi = /보기|ㄱ\s*\.|ㄴ\s*\.|ㄷ\s*\./.test(stem)
  const caseSplit = hasCaseSplitEvidence(stem, ganada)
  const subst = /대입|x\s*=|치환/.test(stem)
  const latex = (stem.match(/\$.+?\$/g) ?? []).length
  const fractions = (stem.match(/\\frac|\/\s*\d/g) ?? []).length
  const radicals = (stem.match(/\\sqrt|√/g) ?? []).length
  const terms = (stem.match(/[+-]/g) ?? []).length
  const domain = /정수|자연수|실수|양수|서로\s*다른|단,/.test(stem)
  const param = /실수\s*\$?[kabmn]|자연수\s*\$?[kn]|매개변수/.test(stem)
  const descriptive = /서술형|설명하시오|증명|이유를\s*쓰/.test(stem)
  const diagram = input.figure_hint || /그림/.test(stem)
  const graph = input.graph_hint || /그래프/.test(stem)
  const table = input.table_hint || /표에서|다음\s*표/.test(stem)
  const stemBody = stem.split(/[①-⑤]/)[0] ?? stem
  const givenWhen = /일\s*때|대하여/.test(stemBody)
  const bodyLatex = (stemBody.match(/\$.+?\$/g) ?? []).length
  const linkedEquations = ganada >= 2 || conditions.simultaneous_conditions || (givenWhen && conditions.condition_count >= 2) || (givenWhen && bodyLatex >= 2 && /일\s*때/.test(stemBody))
  const extremumIndex = /가장\s*작|가장\s*큰|번째/.test(stemBody)
  const alwaysHold = /모든\s*실수|항상\s*성립|값에\s*관계없이/.test(stemBody)
  const countingPath = /한\s*번씩\s*사용|여섯\s*자리|만들어지는\s*수/.test(stemBody)

  const features: Record<string, ObservedFeature> = {}
  if (thin) {
    features.concept_count = missing('stem_too_short_or_generic')
    features.concept_dependency_depth = missing('stem_too_short_or_generic')
    features.multi_concept_combo = missing('stem_too_short_or_generic')
  } else {
    features.concept_count = present(
      families.length === 0 ? 0.12 : families.length === 1 ? 0.36 : families.length === 2 ? 0.74 : 1,
      families.length ? families : ['single_or_none'],
      families.length ? 0.86 : 0.55,
    )
    features.concept_dependency_depth = present(
      families.length >= 3 ? 0.88 : families.length === 2 && linker ? 0.7 : families.length === 2 ? 0.48 : 0.18,
      [linker ? 'linker' : 'no_linker', `families=${families.length}`],
    )
    features.multi_concept_combo = present(families.length >= 2 ? (linker ? 0.82 : 0.55) : 0.08, ['not_from_유형_heading', ...families])
  }
  features.cross_subunit_dependency = thin
    ? missing('stem_too_short_or_generic')
    : present(
        Number(families.includes('quadratic_eq') && families.includes('quadratic_fn')) * 0.7 +
          Number(families.includes('poly_ops') && families.includes('remainder_factor')) * 0.45 +
          Number(families.includes('quadratic_eq') && families.includes('inequality')) * 0.75,
        ['cross_subunit_pairs'],
      )
  features.implicit_concept_requirement = /접하|만나도록|실근을\s*갖|중근/.test(stem) || alwaysHold
    ? present(alwaysHold ? 0.78 : 0.72, [alwaysHold ? 'identity_or_always_true' : 'implied_discriminant_or_tangent'])
    : present(0.12, ['no_implicit_theorem_cue'])
  features.theorem_or_property_count = present(
    clamp01(
      (
        ['나머지정리', '인수정리', '근과 계수', '판별식', '곱셈 공식', '조립제법'].filter(
          (name) => stem.includes(name.replace(' ', '')) || new RegExp(name).test(stem),
        ).length + Number(/두\s*근|세\s*근/.test(stem) && /방정식/.test(stem)) + Number(/켤레/.test(stem))
      ) / 3,
    ),
    ['named_theorems'],
  )

  features.strategy_step_count = thin
    ? missing('stem_too_short_or_generic')
    : present(clamp01((fp.requested_quantity.length + ganada + Number(reverse) + Number(bogi) + Number(linkedEquations) + Number(extremumIndex)) / 5), fp.requested_quantity)
  features.strategy_branching = caseSplit ? present(0.78, ['case_or_or']) : present(0.12, ['no_branch'])
  features.strategy_selection_difficulty = bogi || /옳은\s*것|옳지\s*않은/.test(stem) ? present(0.74, ['selection_among_statements']) : present(0.14, ['direct_ask'])
  features.non_routine_transformation =
    definedOp || countingPath || (extremumIndex && families.includes('counting')) || /극형식|편각|치환|새로운/.test(stem)
      ? present(0.8, ['defined_op_or_non_routine_map'])
      : present(0.12, ['routine_form'])
  features.reverse_reasoning = reverse ? present(0.8, ['find_parameter_or_condition']) : present(0.1, ['forward_compute'])
  features.case_split_requirement = caseSplit ? present(0.76, ['case_split']) : present(0.1, ['no_case_split'])
  features.hidden_condition_inference = /단,/.test(stem) || domain ? present(0.58, ['단_or_domain']) : present(0.12, ['no_hidden_constraint'])
  features.constraint_dependency_depth =
    ganada >= 2 || conditions.simultaneous_conditions || linkedEquations
      ? present(0.72, ['linked_conditions'])
      : present(ganada === 1 ? 0.35 : 0.1, ['condition_links'])
  features.intermediate_goal_count = present(clamp01((ganada + Number(/먼저|다음으로/.test(stem)) + Number(linkedEquations)) / 3), ['가나다_or_sequence'])
  features.representation_switch =
    diagram || graph || table
      ? present(diagram && graph ? 0.88 : 0.7, ['figure_graph_table'])
      : present(/문장|다음과\s*같이|극형식|편각/.test(stem) ? 0.45 : 0.1, ['mostly_symbolic'])

  const execObserved = !thin
  features.algebraic_step_depth = execObserved
    ? present(clamp01((Number(fp.factorization_structure) + Number(/전개/.test(stem)) + Number(subst) + Number(fp.remainder_structure) + (fp.polynomial_degree ?? 0) / 4) / 3), ['algebra_ops'])
    : missing('stem_too_short_or_generic')
  features.expression_complexity = present(clamp01(latex / 8 + terms / 24), ['latex_and_terms_capped'], 0.7)
  features.equation_degree_complexity = fp.polynomial_degree != null ? present(clamp01(fp.polynomial_degree / 4), [`degree=${fp.polynomial_degree}`]) : missing('degree_not_observed')
  features.system_size = present(clamp01((fp.number_of_variables + Number(fp.named_polynomial_system) + ganada) / 5), ['vars_and_named'])
  features.term_count = present(clamp01(terms / 18), ['plus_minus_terms'], 0.6)
  features.fraction_complexity = present(clamp01(fractions / 4), ['frac'])
  features.radical_complexity = present(clamp01(radicals / 3), ['sqrt'])
  features.substitution_depth = subst ? present(0.62, ['substitution']) : present(0.08, ['no_subst'])
  features.factorization_depth = fp.factorization_structure ? present(/이차|삼차/.test(stem) ? 0.7 : 0.45, ['factor_structure']) : present(0.08, ['no_factor'])
  features.expansion_depth = /전개/.test(stem) ? present(0.55, ['expand']) : present(0.08, ['no_expand'])
  features.calculation_burden = present(clamp01(input.math_count / 10 + latex / 12), ['math_count_capped'], 0.65)

  features.explicit_condition_count = present(clamp01(conditions.condition_count / 4), conditions.relations)
  features.implicit_condition_count = /접하|만나|갖도록/.test(stem) || alwaysHold ? present(0.64, ['implied_existence_or_always']) : present(0.1, ['no_implicit'])
  features.constraint_density = present(clamp01(((stem.match(/단,|정수|자연수|서로\s*다른|실수|양수/g) ?? []).length) / 4), ['domain_tokens'])
  features.condition_dependency = features.constraint_dependency_depth
  features.redundant_condition = ganada >= 3 ? present(0.4, ['possible_redundant_triple']) : present(0.08, ['not_assessed_as_redundant'])
  features.conditional_branch_count = caseSplit ? present(0.7, ['branches']) : present(0.1, ['one_path'])
  features.range_or_domain_constraint = domain ? present(0.6, ['domain']) : present(0.1, ['unrestricted'])
  features.parameter_dependency = param || (reverse && /값의\s*범위|자연수/.test(stem)) ? present(0.78, ['parameter_search']) : present(0.1, ['no_parameter_search'])
  features.multiple_case_requirement = caseSplit && ganada >= 2 ? present(0.8, ['cases_and_labeled_conditions']) : present(caseSplit ? 0.45 : 0.1, ['partial'])

  features.choice_structure_complexity = present(clamp01(input.choice_count / 5), ['mcq_count'], input.choice_count ? 0.8 : 0.5)
  features.choice_dependency = bogi ? present(0.72, ['ㄱㄴㄷ']) : present(0.1, ['no_bogi'])
  features.bogi_structure = bogi ? present(0.8, ['보기']) : present(0.05, ['no_보기'])
  features.diagram_dependency = diagram
    ? thin
      ? missing('figure_hint_but_stem_insufficient')
      : present(0.7, ['diagram'])
    : present(0.05, ['no_diagram'])
  features.table_dependency = table ? present(0.62, ['table']) : present(0.05, ['no_table'])
  features.graph_dependency = graph ? present(0.68, ['graph']) : present(0.05, ['no_graph'])
  features.proof_or_explanation_requirement = descriptive ? present(0.7, ['explain']) : present(0.08, ['compute'])
  features.answer_form_complexity = present(fp.answer_structure === 'mcq' ? 0.35 : descriptive ? 0.55 : 0.25, [fp.answer_structure])

  const conceptual = familyMean([
    features.concept_count,
    features.concept_dependency_depth,
    features.multi_concept_combo,
    features.cross_subunit_dependency,
    features.implicit_concept_requirement,
    features.theorem_or_property_count,
  ])
  const reasoning = familyMean([
    features.strategy_step_count,
    features.strategy_branching,
    features.strategy_selection_difficulty,
    features.non_routine_transformation,
    features.reverse_reasoning,
    features.case_split_requirement,
    features.hidden_condition_inference,
    features.constraint_dependency_depth,
    features.intermediate_goal_count,
    features.representation_switch,
  ])
  const execution = familyMean([
    features.algebraic_step_depth,
    features.expression_complexity,
    features.equation_degree_complexity,
    features.system_size,
    features.term_count,
    features.fraction_complexity,
    features.radical_complexity,
    features.substitution_depth,
    features.factorization_depth,
    features.expansion_depth,
    features.calculation_burden,
  ])
  const condition = familyMean([
    features.explicit_condition_count,
    features.implicit_condition_count,
    features.constraint_density,
    features.condition_dependency,
    features.conditional_branch_count,
    features.range_or_domain_constraint,
    features.parameter_dependency,
    features.multiple_case_requirement,
  ])
  const form = familyMean([
    features.choice_structure_complexity,
    features.choice_dependency,
    features.bogi_structure,
    features.diagram_dependency,
    features.table_dependency,
    features.graph_dependency,
    features.proof_or_explanation_requirement,
    features.answer_form_complexity,
  ])

  const missingFamilies = [
    conceptual.observed === 0 ? 'conceptual' : null,
    reasoning.observed === 0 ? 'reasoning' : null,
    execution.observed === 0 ? 'execution' : null,
    condition.observed === 0 ? 'condition' : null,
  ].filter((row): row is string => Boolean(row))

  const d1 = scoreModelD1({
    conceptual_load_score: conceptual.score,
    reasoning_strategy_score: reasoning.score,
    execution_load_score: execution.score,
    condition_complexity_score: condition.score,
    form_complexity_score: form.score,
    type_relative_score: null,
    conceptual_confidence: conceptual.confidence,
    reasoning_confidence: reasoning.confidence,
    execution_confidence: execution.confidence,
    condition_confidence: condition.confidence,
    form_confidence: form.confidence,
  })
  const structural = structuralHard(features, { conceptual: conceptual.score, reasoning: reasoning.score, condition: condition.score, execution: execution.score })
  const difficulty_confidence = clamp01(
    0.25 * conceptual.confidence +
      0.3 * reasoning.confidence +
      0.15 * execution.confidence +
      0.2 * condition.confidence +
      0.1 * form.confidence -
      missingFamilies.length * 0.08 -
      (thin ? 0.25 : 0) -
      (diagram && thin ? 0.15 : 0),
  )

  return {
    type_id: typeId,
    features,
    families: {
      conceptual_load_score: conceptual.score,
      reasoning_strategy_score: reasoning.score,
      execution_load_score: execution.score,
      condition_complexity_score: condition.score,
      form_complexity_score: form.score,
      type_relative_score: null,
      conceptual_confidence: conceptual.confidence,
      reasoning_confidence: reasoning.confidence,
      execution_confidence: execution.confidence,
      condition_confidence: condition.confidence,
      form_confidence: form.confidence,
    },
    intrinsic_difficulty_score: d1,
    difficulty_confidence: Number(difficulty_confidence.toFixed(3)),
    missing_families: missingFamilies,
    structural_hard: structural,
    publisher_badge_used: false,
  }
}

export function scoreModelD1(families: FamilyScores): number {
  return clamp01(
    0.26 * families.conceptual_load_score +
      0.32 * families.reasoning_strategy_score +
      0.14 * families.execution_load_score +
      0.22 * families.condition_complexity_score +
      0.06 * families.form_complexity_score,
  )
}

export function scoreModelD2(families: FamilyScores, features: Record<string, ObservedFeature>): number {
  const base = scoreModelD1(families)
  const multi = (features.multi_concept_combo?.value ?? 0) >= 0.5 && families.reasoning_strategy_score >= 0.45
  const condCase = families.condition_complexity_score >= 0.45 && (features.case_split_requirement?.value ?? 0) >= 0.5
  const nonRoutineSwitch = (features.non_routine_transformation?.value ?? 0) >= 0.5 && (features.representation_switch?.value ?? 0) >= 0.5
  const reverseParam = (features.reverse_reasoning?.value ?? 0) >= 0.6 && (features.parameter_dependency?.value ?? 0) >= 0.5
  const bonus = 0.07 * Number(multi) + 0.06 * Number(condCase) + 0.05 * Number(nonRoutineSwitch) + 0.05 * Number(reverseParam)
  return clamp01(base + bonus)
}

export function scoreModelD3(d2: number, typeRelative: number | null): number {
  if (typeRelative == null) return d2
  return clamp01(d2 + TYPE_RELATIVE_MAX_SHIFT * (typeRelative - 0.5) * 2)
}

export function structuralHard(
  features: Record<string, ObservedFeature>,
  scores: { conceptual: number; reasoning: number; condition: number; execution: number },
): { flags: string[]; sufficient: boolean } {
  const flags: string[] = []
  if (scores.conceptual >= 0.45 && (features.multi_concept_combo?.value ?? 0) >= 0.5) flags.push('multi_concept')
  if (scores.reasoning >= 0.5) flags.push('strategy_depth')
  if ((features.case_split_requirement?.value ?? 0) >= 0.5) flags.push('case_split')
  if ((features.reverse_reasoning?.value ?? 0) >= 0.6) flags.push('reverse_reasoning')
  if ((features.non_routine_transformation?.value ?? 0) >= 0.6) flags.push('non_routine')
  if (scores.condition >= 0.5 && (features.condition_dependency?.value ?? 0) >= 0.5) flags.push('condition_dependency')
  if ((features.bogi_structure?.value ?? 0) >= 0.7) flags.push('bogi')
  if ((features.representation_switch?.value ?? 0) >= 0.65 && scores.conceptual >= 0.3) flags.push('representation_switch')
  const calcOnly = scores.execution >= 0.55 && scores.reasoning < 0.35 && scores.conceptual < 0.35
  return { flags, sufficient: flags.length >= 3 && !calcOnly }
}

export function assignBandD(score: number, confidence: number, hard: { sufficient: boolean }, families: FamilyScores): PrimaryBand {
  if (confidence < CONFIDENCE_REVIEW) return 'REVIEW'
  if (score >= BASELINE_CUTS.high && hard.sufficient && families.reasoning_strategy_score >= 0.45) return 'HIGH'
  if (score >= BASELINE_CUTS.high && !hard.sufficient) return 'MID'
  if (
    score >= BASELINE_CUTS.low &&
    (families.reasoning_strategy_score >= 0.28 || families.condition_complexity_score >= 0.28 || families.conceptual_load_score >= 0.32)
  ) {
    return 'MID'
  }
  if (score >= BASELINE_CUTS.low && families.execution_load_score >= 0.5 && families.reasoning_strategy_score < 0.28) return 'LOW'
  if (score < BASELINE_CUTS.low) return 'LOW'
  return 'MID'
}

export function typeRelativeComponent(score: number, typeMedian: number | null, n: number): number | null {
  if (typeMedian == null || n < TYPE_RELATIVE_MIN_N) return null
  return clamp01(0.5 + (score - typeMedian))
}

export function groupedSplit<T extends { identity: string; type_id: string | null; page: number; badge: PublisherBadgeNorm }>(
  rows: T[],
): { train: T[]; holdout: T[] } {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const block = Math.floor(row.page / 4)
    const key = `${row.type_id ?? 'UNKNOWN'}|${block}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  const train: T[] = []
  const holdout: T[] = []
  const keys = [...groups.keys()].sort()
  keys.forEach((key, index) => {
    const list = groups.get(key) ?? []
    if (index % 5 === 0) holdout.push(...list)
    else train.push(...list)
  })
  const holdBadges = new Set(holdout.map((row) => row.badge))
  if (!holdBadges.has('LOW_BADGE') || !holdBadges.has('HIGH_BADGE')) {
    const need: PublisherBadgeNorm[] = ['LOW_BADGE', 'HIGH_BADGE']
    for (const badge of need) {
      if (holdout.some((row) => row.badge === badge)) continue
      const idx = train.findIndex((row) => row.badge === badge)
      if (idx >= 0) holdout.push(...train.splice(idx, 1))
    }
  }
  return { train, holdout }
}

export function leakagePairs(train: Array<{ identity: string }>, holdout: Array<{ identity: string }>): string[] {
  const hold = new Set(holdout.map((row) => row.identity))
  return train.map((row) => row.identity).filter((id) => hold.has(id))
}

export function ocrLengthShouldNotDominate(shortStem: string, longPadding: string, input: Omit<IntrinsicInput, 'stem'>): boolean {
  const a = extractIntrinsicFeatures({ ...input, stem: shortStem })
  const b = extractIntrinsicFeatures({ ...input, stem: `${shortStem} ${longPadding}` })
  return Math.abs(b.intrinsic_difficulty_score - a.intrinsic_difficulty_score) < 0.08
}

export function modelCOnStem(input: IntrinsicInput, confidence: number): { score: number; band: PrimaryBand } {
  const features = extractDifficultyV2Features(input)
  const score = scoreRubricV2(features)
  const evidence = highComplexityEvidence(input.stem, features)
  return { score, band: assignModelC(score, confidence, evidence, input.stem, features) }
}

export const D1_RATIONALE = {
  conceptual: { weight: 0.26, why: 'Knowing more linked ideas raises load, but keyword count is not enough; families and linkers are used.' },
  reasoning: { weight: 0.32, why: 'HYPER HIGH is strategy/case/reverse reasoning, not arithmetic length.' },
  execution: { weight: 0.14, why: 'Long calculation is real work but must not create HIGH by itself.' },
  condition: { weight: 0.22, why: 'Dependent conditions and parameters are a major mid/high separator in this book.' },
  form: { weight: 0.06, why: '보기/diagram are auxiliary evidence, not difficulty itself.' },
}
