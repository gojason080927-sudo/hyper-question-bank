import type { ProblemClassificationV1 } from './taxonomyClassifier'

export const STEP812 = '8.12'
export const STEP812_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const STEP812_DIR = 'ocr-tests/taxonomy/step8-12'
export const STEP811_DIR = 'ocr-tests/taxonomy/step8-11'
export const STEP812_EXPECTED_DRAFTS = 265
export const CLASSIFICATION_RPC = 'hqb_upsert_problem_classification'
export const TYPE_DICTIONARY_RPC = 'hqb_upsert_hyper_type_dictionary_entry'
export const CURRICULUM_RPC = 'hqb_ensure_cm1_curriculum'
export const DELETE_TEST_RPC = 'hqb_delete_test_classification'
export const ASSIGNED_BY = 'STEP_8_12'
export const ROLLBACK_ASSIGNED_BY = 'STEP_8_12_ROLLBACK_TEST'
export const BATCH_SIZES = [10, 10, 10, 8] as const

/** Frozen STEP 8.11 calibrated thresholds. Do not relax in 8.12. */
export const STEP811_THRESHOLDS = {
  unit: 0.86,
  subunit: 0.86,
  type: 0.78,
  difficulty: 0.7,
  key_point: 0.75,
  solution_strategy: 0.75,
} as const

export const UNIT_CODE: Record<string, string> = {
  다항식: 'CM1_UNIT_POLY',
  방정식: 'CM1_UNIT_EQ',
  부등식: 'CM1_UNIT_INEQ',
  '순열과 조합': 'CM1_UNIT_COUNT',
  행렬: 'CM1_UNIT_MATRIX',
}

export const SUBUNIT_CODE: Record<string, string> = {
  '다항식의 연산': 'CM1_SUB_POLY_OPS',
  '나머지 정리와 인수분해': 'CM1_SUB_POLY_REMAINDER',
  복소수: 'CM1_SUB_COMPLEX',
  이차방정식: 'CM1_SUB_QUAD',
  '이차방정식과 이차함수': 'CM1_SUB_QUAD_FN',
  '여러 가지 방정식': 'CM1_SUB_VARIOUS_EQ',
  일차부등식: 'CM1_SUB_LIN_INEQ',
  이차부등식: 'CM1_SUB_QUAD_INEQ',
  '순열과 조합': 'CM1_SUB_PERMCOMB',
  '행렬과 그 연산': 'CM1_SUB_MATRIX',
}

export const SUBUNIT_PARENT_UNIT: Record<string, string> = {
  CM1_SUB_POLY_OPS: 'CM1_UNIT_POLY',
  CM1_SUB_POLY_REMAINDER: 'CM1_UNIT_POLY',
  CM1_SUB_COMPLEX: 'CM1_UNIT_EQ',
  CM1_SUB_QUAD: 'CM1_UNIT_EQ',
  CM1_SUB_QUAD_FN: 'CM1_UNIT_EQ',
  CM1_SUB_VARIOUS_EQ: 'CM1_UNIT_EQ',
  CM1_SUB_LIN_INEQ: 'CM1_UNIT_INEQ',
  CM1_SUB_QUAD_INEQ: 'CM1_UNIT_INEQ',
  CM1_SUB_PERMCOMB: 'CM1_UNIT_COUNT',
  CM1_SUB_MATRIX: 'CM1_UNIT_MATRIX',
}

export type AutoPreflightResult = {
  problem_id: string
  page_number: number
  original_problem_number: string
  pass: boolean
  reasons: string[]
  persist_subunit: boolean
  persist_difficulty: boolean
}

export function isOverallAuto(row: ProblemClassificationV1): boolean {
  return row.decisions.overall === 'AUTO' && row.classification_status === 'AUTO'
}

export function loadOverallAuto(rows: ProblemClassificationV1[]): ProblemClassificationV1[] {
  return rows.filter(isOverallAuto)
}

export function splitBatches<T>(rows: T[], sizes: readonly number[] = BATCH_SIZES): T[][] {
  const batches: T[][] = []
  let offset = 0
  for (const size of sizes) {
    if (offset >= rows.length) break
    batches.push(rows.slice(offset, offset + size))
    offset += size
  }
  if (offset < rows.length) batches.push(rows.slice(offset))
  return batches
}

export function preflightAuto(input: {
  row: ProblemClassificationV1
  problem: { id: string; review_status: string; current_version_id: string | null } | undefined
  source: { source_document_id: string; page: number; problem_number: string } | undefined
  profile: { unit_id: string; subunit_id: string; type_id: string } | undefined
  expectedDocument: string
}): AutoPreflightResult {
  const { row } = input
  const reasons: string[] = []
  if (!isOverallAuto(row)) reasons.push('NOT_OVERALL_AUTO')
  if (row.decisions.unit !== 'AUTO') reasons.push('UNIT_NOT_AUTO')
  if (row.decisions.type !== 'AUTO') reasons.push('TYPE_NOT_AUTO')
  if (row.decisions.key_point !== 'AUTO') reasons.push('KEY_POINT_NOT_AUTO')
  if (row.decisions.solution_strategy !== 'AUTO') reasons.push('STRATEGY_NOT_AUTO')
  if (row.review_reasons.length) reasons.push('HAS_REVIEW_REASON')
  if (row.type_id === 'TYPE_UNCLEAR' || !row.type_id) reasons.push('TYPE_UNCLEAR')
  if (!row.unit_id || row.unit_id === '미정') reasons.push('UNIT_UNCLEAR')
  if (!UNIT_CODE[row.unit_id]) reasons.push('UNIT_CODE_MISSING')
  if (!input.problem) reasons.push('PROBLEM_MISSING')
  if (input.problem && input.problem.id !== row.problem_id) reasons.push('PROBLEM_ID_MISMATCH')
  if (input.problem && !input.problem.current_version_id) reasons.push('DRAFT_VERSION_MISSING')
  if (input.problem && input.problem.review_status === 'VERIFIED') reasons.push('VERIFIED_BLOCKED')
  if (!input.source) reasons.push('SOURCE_MISSING')
  if (input.source && input.source.source_document_id !== input.expectedDocument) reasons.push('WRONG_DOCUMENT')
  if (input.source && input.source.page !== row.page_number) reasons.push('PAGE_MISMATCH')
  if (input.source && input.source.problem_number !== row.original_problem_number) reasons.push('NUMBER_MISMATCH')
  if (!input.profile) reasons.push('TYPE_PROFILE_MISSING')
  if (input.profile && input.profile.type_id !== row.type_id) reasons.push('PROFILE_TYPE_MISMATCH')
  if (input.profile && input.profile.unit_id !== row.unit_id) reasons.push('UNIT_TYPE_INCONSISTENT')
  const persist_subunit = row.decisions.subunit === 'AUTO' && Boolean(SUBUNIT_CODE[row.subunit_id])
  if (persist_subunit) {
    const subunitCode = SUBUNIT_CODE[row.subunit_id]
    const unitCode = UNIT_CODE[row.unit_id]
    if (SUBUNIT_PARENT_UNIT[subunitCode] !== unitCode) reasons.push('SUBUNIT_UNIT_MISMATCH')
    if (input.profile && input.profile.subunit_id !== row.subunit_id) reasons.push('SUBUNIT_TYPE_INCONSISTENT')
  }
  const persist_difficulty =
    row.decisions.difficulty === 'AUTO' &&
    row.difficulty_level != null &&
    row.difficulty_level >= 1 &&
    row.difficulty_level <= 5
  if (row.evidence_insufficient) reasons.push('EVIDENCE_INSUFFICIENT')
  return {
    problem_id: row.problem_id,
    page_number: row.page_number,
    original_problem_number: row.original_problem_number,
    pass: reasons.length === 0,
    reasons,
    persist_subunit,
    persist_difficulty,
  }
}

export function classificationPayload(input: {
  row: ProblemClassificationV1
  versionId: string
  preflight: AutoPreflightResult
  assignedBy?: string
}): Record<string, unknown> {
  const subunitCode = input.preflight.persist_subunit ? SUBUNIT_CODE[input.row.subunit_id] : undefined
  return {
    problem_id: input.row.problem_id,
    expected_version_id: input.versionId,
    source_document_id: STEP812_DOCUMENT,
    page_number: input.row.page_number,
    original_problem_number: input.row.original_problem_number,
    classification_status: 'AUTO',
    type_code: input.row.type_id,
    unit_code: UNIT_CODE[input.row.unit_id],
    subunit_code: subunitCode ?? '',
    subtype_code: '',
    persist_difficulty: input.preflight.persist_difficulty,
    difficulty_level: input.preflight.persist_difficulty ? input.row.difficulty_level : null,
    key_test_points: input.row.key_test_points,
    solution_strategies: input.row.solution_strategy,
    unit_confidence: input.row.unit_confidence,
    type_confidence: input.row.type_confidence,
    difficulty_confidence: input.row.difficulty_confidence,
    source_heading: input.row.source_heading,
    heading_distance: input.row.source_heading_distance,
    assigned_by: input.assignedBy ?? ASSIGNED_BY,
    artifact_step: STEP812,
  }
}

export function dictionaryPayload(type: {
  type_id: string
  canonical_name_ko: string
  description: string
  unit_id: string
  subunit_id: string
  core_concepts: string[]
  solution_strategies: string[]
  key_test_points: string[]
  common_mistakes: unknown[]
  prerequisite_types: string[]
  source_aliases: string[]
  status: string
  subtypes?: Array<{ subtype_id: string; name: string }>
  parent_code?: string
}): Record<string, unknown> {
  const status = type.type_id === 'CUBIC_QUARTIC_EQ' && type.status === 'VALIDATED' ? 'CANDIDATE' : type.status
  return {
    code: type.type_id,
    name: type.canonical_name_ko,
    description: type.description,
    parent_code: type.parent_code ?? '',
    canonical_name_ko: type.canonical_name_ko,
    unit_code: UNIT_CODE[type.unit_id] ?? '',
    subunit_code: SUBUNIT_CODE[type.subunit_id] ?? '',
    core_concepts: type.core_concepts,
    solution_strategies: type.solution_strategies,
    key_test_points: type.key_test_points,
    common_mistakes: type.common_mistakes,
    prerequisite_types: type.prerequisite_types,
    source_aliases: type.source_aliases.map((alias) => ({
      alias,
      source: 'ssen-common-math1',
      universal: false,
    })),
    dictionary_status: status === 'VALIDATED' || status === 'CANDIDATE' || status === 'REVIEW' || status === 'DEPRECATED' ? status : 'CANDIDATE',
  }
}

export function migrationIsAdditive(sql: string): { ok: boolean; reasons: string[] } {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const reasons: string[] = []
  if (/DROP\s+TABLE/i.test(stripped)) reasons.push('DROP_TABLE')
  if (/DROP\s+COLUMN/i.test(stripped)) reasons.push('DROP_COLUMN')
  if (/\bTRUNCATE\b/i.test(stripped)) reasons.push('TRUNCATE')
  if (!/SUBUNIT/.test(sql)) reasons.push('MISSING_SUBUNIT')
  if (!/hyper_type_profiles/.test(sql)) reasons.push('MISSING_PROFILES')
  if (!/hqb_upsert_problem_classification/.test(sql)) reasons.push('MISSING_RPC')
  if (!/SET search_path = public/.test(sql)) reasons.push('MISSING_SEARCH_PATH')
  if (!/hqb_require_staff_writer/.test(sql)) reasons.push('MISSING_STAFF_CHECK')
  if (!/HQB_REVIEW_REJECTED/.test(sql)) reasons.push('MISSING_REVIEW_REJECT')
  return { ok: reasons.length === 0, reasons }
}
