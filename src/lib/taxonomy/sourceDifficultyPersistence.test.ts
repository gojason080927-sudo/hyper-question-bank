import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  identityKey,
  itemPayload,
  migrationIsAdditive814,
  preflightRow,
  SSEN_ITEM_CODE,
  SSEN_STAGE_CODE,
  STEP814_MIGRATION,
  type DbIdentity,
  type ProjectionRow,
} from './sourceDifficultyPersistence'
import { STEP813_TYPE_THRESHOLD } from './typeCoverageV2'
import { STEP811_THRESHOLDS } from './classificationPersistence'
import { hardMapSourceToHyper } from './sourceDifficultySystem'

const ident: DbIdentity = {
  problem_id: '11111111-1111-1111-1111-111111111111',
  problem_source_id: '22222222-2222-2222-2222-222222222222',
  source_document_id: '9ff369b4-5b16-4cb8-bfc3-a6b180c18703',
  page: 12,
  problem_number: '0041',
}

const row: ProjectionRow = {
  problem_identity: '12|0041',
  source_stage: 'B_TYPE',
  source_item_label_raw: '하',
  source_level_order: 0,
  source_level_count: 3,
  source_visual_evidence: { bbox: { x: 0.1 } },
  source_difficulty_confidence: 0.92,
  source_difficulty_origin: ['PUBLISHER_PRINTED', 'VISUAL_DETECTED'],
  evidence_status: 'EXPERT_CONFIRMED',
  hyper_primary: null,
  production_write: false,
}

describe('STEP 8.14 source difficulty persistence contract', () => {
  it('keeps the migration additive and away from HYPER difficulty/type/content', () => {
    const sql = readFileSync(path.join(process.cwd(), STEP814_MIGRATION), 'utf8')
    expect(migrationIsAdditive814(sql)).toEqual({ ok: true, reasons: [] })
    expect(sql).toContain('source_difficulty_systems')
    expect(sql).toContain('problem_source_difficulty')
    expect(sql).toContain('level_scope')
    expect(sql).toContain('HQB_RAW_LABEL_CONFLICT')
    expect(sql).toContain('hqb_require_staff_writer')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.hqb_upsert_problem_source_difficulty(jsonb) FROM PUBLIC, anon')
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.problem_difficulty/i)
  })

  it('separates stage/item, preserves expert evidence, and never hard-maps HYPER bands', () => {
    expect(SSEN_STAGE_CODE).not.toBe(SSEN_ITEM_CODE)
    expect(preflightRow(row, ident, ident.source_document_id).pass).toBe(true)
    expect(preflightRow(row, undefined, ident.source_document_id).pass).toBe(false)
    expect(preflightRow({ ...row, source_item_label_raw: '심화' }, ident, ident.source_document_id).reasons).toContain('INVALID_RAW_LABEL')
    const payload = itemPayload(row, ident)
    expect(payload.system_code).toBe(SSEN_ITEM_CODE)
    expect(payload.metadata.hyper_primary).toBeNull()
    expect(identityKey(12, '0041')).toBe('12|0041')
    expect(hardMapSourceToHyper('상')).toBeNull()
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(STEP811_THRESHOLDS.type).toBe(0.78)
  })
})
