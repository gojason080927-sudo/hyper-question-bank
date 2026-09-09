import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('classification RLS', () => {
  it('denies anon/authenticated table writes and requires staff writer on RPC', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260908220000_hqb_classification_persistence_v1.sql'),
      'utf8',
    )
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('hqb_require_staff_writer')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.hqb_upsert_problem_classification(jsonb) FROM PUBLIC, anon')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.hqb_delete_test_classification(uuid) FROM PUBLIC, anon')
    expect(sql).toContain('USING (public.hqb_is_staff())')
    expect(sql).toContain('HQB_REVIEW_REJECTED')
    expect(sql).toContain('HQB_INVALID_DIFFICULTY')
    expect(sql).toContain('HQB_INVALID_TYPE')
    expect(sql).toContain('HQB_UNIT_SUBUNIT_MISMATCH')
  })
})
