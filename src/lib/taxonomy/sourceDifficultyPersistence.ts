export const STEP814 = '8.14'
export const STEP814_DIR = 'ocr-tests/taxonomy/step8-14'
export const STEP813D_DIR = 'ocr-tests/taxonomy/step8-13d'
export const STEP814_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const STEP814_MIGRATION = 'supabase/migrations/20260909180000_hqb_source_difficulty_v1.sql'
export const SYSTEM_RPC = 'hqb_upsert_source_difficulty_system'
export const LEVEL_RPC = 'hqb_upsert_source_difficulty_level'
export const EVIDENCE_RPC = 'hqb_upsert_problem_source_difficulty'
export const DELETE_TEST_RPC = 'hqb_delete_test_source_difficulty'
export const ROLLBACK_MARKER = 'STEP_8_14_ROLLBACK_TEST'
export const SSEN_STAGE_CODE = 'ssen-cm1-stage-v1'
export const SSEN_ITEM_CODE = 'ssen-cm1-item-v1'
export const FROZEN_DRAFTS = 265
export const FROZEN_TYPE_AUTO = 38
export const FROZEN_TYPE_THRESHOLD = 0.78
export const FROZEN_NEW_AUTO_ARTIFACT = 59
export const LEGACY_DIFFICULTY_AUTO = 30
export const BATCH_SIZE = 20

export const SSEN_STAGE_LEVELS = [
  { raw_label: 'A_BASIC', normalized_order: 0, description: 'A단계 기본 다잡기', visual_marker: 'red/orange-red number', section_marker: 'A단계 기본 다잡기', item_marker: null, level_scope: 'STAGE' },
  { raw_label: 'B_TYPE', normalized_order: 1, description: 'B단계 유형 뽀개기', visual_marker: 'green number', section_marker: 'B단계 유형 뽀개기', item_marker: null, level_scope: 'STAGE' },
  { raw_label: 'B_SKILL', normalized_order: 2, description: 'B단계 실력 굳히기', visual_marker: 'blue number', section_marker: 'B단계 실력 굳히기', item_marker: null, level_scope: 'STAGE' },
] as const

export const SSEN_ITEM_LEVELS = [
  { raw_label: '하', normalized_order: 0, description: 'B_TYPE item badge 하', visual_marker: 'orange filled circle', section_marker: null, item_marker: '하', level_scope: 'ITEM' },
  { raw_label: '중', normalized_order: 1, description: 'B_TYPE item badge 중', visual_marker: 'blue-violet filled circle', section_marker: null, item_marker: '중', level_scope: 'ITEM' },
  { raw_label: '상', normalized_order: 2, description: 'B_TYPE item badge 상', visual_marker: 'pink/magenta filled circle', section_marker: null, item_marker: '상', level_scope: 'ITEM' },
] as const

export function migrationIsAdditive814(sql: string): { ok: boolean; reasons: string[] } {
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const reasons: string[] = []
  if (/DROP\s+TABLE/i.test(stripped)) reasons.push('DROP_TABLE')
  if (/DROP\s+COLUMN/i.test(stripped)) reasons.push('DROP_COLUMN')
  if (/\bTRUNCATE\b/i.test(stripped)) reasons.push('TRUNCATE')
  if (/INSERT\s+INTO\s+public\.problem_difficulty/i.test(stripped)) reasons.push('WRITES_HYPER_DIFFICULTY')
  if (/INSERT\s+INTO\s+public\.problem_type_assignments/i.test(stripped)) reasons.push('WRITES_TYPE')
  if (/INSERT\s+INTO\s+public\.problems\b/i.test(stripped)) reasons.push('WRITES_PROBLEMS')
  if (!/source_difficulty_systems/.test(sql)) reasons.push('MISSING_SYSTEMS')
  if (!/source_difficulty_levels/.test(sql)) reasons.push('MISSING_LEVELS')
  if (!/problem_source_difficulty/.test(sql)) reasons.push('MISSING_PSD')
  if (!/source_difficulty_calibrations/.test(sql)) reasons.push('MISSING_CALIBRATIONS')
  if (!/hqb_upsert_problem_source_difficulty/.test(sql)) reasons.push('MISSING_EVIDENCE_RPC')
  if (!/hqb_require_staff_writer/.test(sql)) reasons.push('MISSING_STAFF_CHECK')
  if (!/HQB_RAW_LABEL_CONFLICT/.test(sql)) reasons.push('MISSING_RAW_CONFLICT')
  if (!/SET search_path = public/.test(sql)) reasons.push('MISSING_SEARCH_PATH')
  if (!/REVOKE ALL ON FUNCTION public.hqb_upsert_problem_source_difficulty\(jsonb\) FROM PUBLIC, anon/.test(sql)) {
    reasons.push('MISSING_ANON_REVOKE')
  }
  return { ok: reasons.length === 0, reasons }
}

export type ProjectionRow = {
  problem_identity: string
  source_stage: string | null
  source_item_label_raw: string | null
  source_level_order: number | null
  source_level_count: number | null
  source_visual_evidence: unknown
  source_difficulty_confidence: number
  source_difficulty_origin: string[]
  evidence_status: string
  hyper_primary: null
  production_write: false
}

export type DbIdentity = {
  problem_id: string
  problem_source_id: string
  source_document_id: string
  page: number
  problem_number: string
}

export function identityKey(page: number, number: string): string {
  return `${page}|${number}`
}

export function preflightRow(row: ProjectionRow, ident: DbIdentity | undefined, documentId: string): {
  pass: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  if (!ident) reasons.push('MISSING_PROBLEM_OR_SOURCE')
  if (ident && ident.source_document_id !== documentId) reasons.push('WRONG_DOCUMENT')
  if (row.evidence_status !== 'EXPERT_CONFIRMED') reasons.push('STATUS_NOT_EXPERT')
  if (row.source_item_label_raw !== '하' && row.source_item_label_raw !== '중' && row.source_item_label_raw !== '상') {
    reasons.push('INVALID_RAW_LABEL')
  }
  if (row.source_stage === 'C' || row.source_stage === 'C_STAGE') reasons.push('C_STAGE_NOT_CONFIRMED')
  if (!row.source_visual_evidence || (typeof row.source_visual_evidence === 'object' && Object.keys(row.source_visual_evidence as object).length === 0)) {
    reasons.push('MISSING_VISUAL')
  }
  if (!(row.source_difficulty_origin ?? []).includes('PUBLISHER_PRINTED') || !(row.source_difficulty_origin ?? []).includes('VISUAL_DETECTED')) {
    reasons.push('ORIGIN_INCOMPLETE')
  }
  if (row.hyper_primary != null) reasons.push('HYPER_FIELD_NOT_NULL')
  if (typeof row.source_difficulty_confidence !== 'number' || row.source_difficulty_confidence <= 0 || row.source_difficulty_confidence > 1) {
    reasons.push('INVALID_CONFIDENCE')
  }
  return { pass: reasons.length === 0, reasons }
}

export function itemPayload(row: ProjectionRow, ident: DbIdentity) {
  return {
    problem_id: ident.problem_id,
    source_document_id: ident.source_document_id,
    page_number: ident.page,
    original_problem_number: ident.problem_number,
    system_code: SSEN_ITEM_CODE,
    level_scope: 'ITEM',
    source_stage: row.source_stage,
    source_item_label_raw: row.source_item_label_raw,
    source_level_order: row.source_level_order,
    source_level_count: 3,
    evidence_origin: row.source_difficulty_origin,
    confidence: row.source_difficulty_confidence,
    visual_evidence: row.source_visual_evidence,
    evidence_status: 'EXPERT_CONFIRMED',
    assigned_by: 'STEP_8_14',
    metadata: { problem_identity: row.problem_identity, hyper_primary: null },
  }
}

export function stagePayload(row: ProjectionRow, ident: DbIdentity) {
  return {
    problem_id: ident.problem_id,
    source_document_id: ident.source_document_id,
    page_number: ident.page,
    original_problem_number: ident.problem_number,
    system_code: SSEN_STAGE_CODE,
    level_scope: 'STAGE',
    source_stage: row.source_stage,
    source_item_label_raw: row.source_stage,
    source_level_order: SSEN_STAGE_LEVELS.find((level) => level.raw_label === row.source_stage)?.normalized_order ?? 1,
    source_level_count: 3,
    evidence_origin: row.source_difficulty_origin,
    confidence: row.source_difficulty_confidence,
    visual_evidence: row.source_visual_evidence,
    evidence_status: 'EXPERT_CONFIRMED',
    assigned_by: 'STEP_8_14',
    metadata: { problem_identity: row.problem_identity, dimension: 'STAGE' },
  }
}
