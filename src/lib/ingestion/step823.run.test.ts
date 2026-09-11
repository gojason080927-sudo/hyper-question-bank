import { describe, expect, it } from 'vitest'
import { runStep823 } from './step823Run'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { FROZEN_TYPE_AUTO, FROZEN_TYPE_THRESHOLD } from './step817Run'

describe('STEP 8.23 figure persistence validation', () => {
  it('persists AUTO figures locally without production problem writes or paid OCR', async () => {
    if (process.env.HQB_BOOK_8_23 !== '1') return
    const argv = (process.env.HQB_8_23_ARGV ?? '--run --cache-only').split(' ').filter(Boolean)
    const result = await runStep823(process.cwd(), argv)
    expect(result.step).toBe('8.23')
    expect(result.paid_api_calls).toEqual({ mistral: 0, mathpix: 0, needs_external_vision: false })
    expect(result.production_problem_writes).toBe(0)
    expect(result.auto).toBeGreaterThanOrEqual(10)
    expect(result.asset_ready).toBe(result.auto)
    expect(result.projected_assets).toBe(result.auto)
    expect(result.preflight_pass).toBeGreaterThanOrEqual(1)
    expect(result.orphans).toBe(0)
    expect(result.idempotent).toBe(true)
    expect(result.dbOk).toBe(true)
    expect(result.hacks).toEqual([])
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(FROZEN_TYPE_AUTO).toBe(38)
    expect(FROZEN_TYPE_THRESHOLD).toBe(0.78)
    expect(['PASS', 'PARTIAL']).toContain(result.verdict)
    expect(result.verdict).not.toBe('FAIL')
  }, 360_000)
})
