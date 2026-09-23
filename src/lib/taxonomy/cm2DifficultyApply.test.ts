import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIFFICULTY_DIMS_RPC } from './classificationPersistence'
import { distributionLooksSane, typeForDifficulty } from './cm2DifficultyApply'

describe('cm2 difficulty apply path', () => {
  it('uses stored CM2 types and ignores unknown/missing codes', () => {
    expect(typeForDifficulty('DISTANCE_TWO_POINTS')).toBe('DISTANCE_TWO_POINTS')
    expect(typeForDifficulty(null)).toBeNull()
    expect(typeForDifficulty('TYPE_UNCLEAR')).toBeNull()
    expect(typeForDifficulty('NOT_A_CM2_TYPE')).toBeNull()
  })

  it('rejects a D1 pile or D5 pile and accepts a mixed corpus', () => {
    const books = {
      lightssen2: { 1: 80, 2: 20, 3: 5, 4: 1, 5: 0 },
      gojaeng2: { 1: 10, 2: 15, 3: 20, 4: 10, 5: 5 },
    }
    const ok = distributionLooksSane({
      total: 166,
      overall: { 1: 90, 2: 35, 3: 25, 4: 11, 5: 5 },
      books,
    })
    expect(ok.ok).toBe(true)
    expect(distributionLooksSane({ total: 200, overall: { 1: 190, 2: 10, 3: 0, 4: 0, 5: 0 }, books }).ok).toBe(false)
    expect(distributionLooksSane({ total: 200, overall: { 1: 10, 2: 10, 3: 10, 4: 20, 5: 150 }, books }).reasons).toContain('D5_PILE')
  })

  it('adds a difficulty-only RPC that does not rewrite types', () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20260923130000_hqb_cm2_difficulty_dims_v1.sql'), 'utf8')
    expect(DIFFICULTY_DIMS_RPC).toBe('hqb_upsert_problem_difficulty_dims')
    expect(sql).toContain('hqb_upsert_problem_difficulty_dims')
    expect(sql).toContain('hqb_require_staff_writer')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.hqb_upsert_problem_difficulty_dims(jsonb) FROM PUBLIC, anon')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_difficulty_dims(jsonb) TO authenticated')
    expect(sql).toContain('types_mutated')
    expect(sql).not.toContain('problem_type_assignments')
    expect(sql).not.toContain('key_test_points')
    expect(sql).toContain('HQB_FORBIDDEN_DOCUMENT')
    expect(sql).toContain('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
  })
})
