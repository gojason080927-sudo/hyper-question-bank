import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('taxonomy schema audit helpers', () => {
  it('does not make source aliases canonical type codes', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260908220000_hqb_classification_persistence_v1.sql'),
      'utf8',
    )
    expect(sql).toContain("dictionary_status IN ('CANDIDATE', 'VALIDATED', 'REVIEW', 'DEPRECATED')")
    expect(sql).toContain('HQB_SEED_TYPE_PROTECTED')
    expect(sql).toContain("node_type = 'SUBUNIT'")
    expect(sql).toContain('problem_classification_meta')
  })
})
