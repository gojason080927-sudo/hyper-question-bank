import { describe, expect, it } from 'vitest'
import { runStep822 } from './step822Run'
import { FROZEN_DRAFTS, FROZEN_TYPE_AUTO, FROZEN_TYPE_THRESHOLD } from './step817Run'
import { FEATURE_FLAGS } from './adaptiveRouter'

describe('STEP 8.22 visual figure detection validation', () => {
  it('validates visual figure detection without production writes or paid OCR', async () => {
    if (process.env.HQB_BOOK_8_22 !== '1') return
    const argv = (process.env.HQB_8_22_ARGV ?? '--run --cache-only').split(' ').filter(Boolean)
    const result = await runStep822(process.cwd(), argv)
    expect(result.step).toBe('8.22')
    expect(result.paid_api_calls).toEqual({ mistral: 0, mathpix: 0, needs_external_vision: false })
    expect((result.drafts as { ssen_before: number; ssen_after: number }).ssen_before).toBe(FROZEN_DRAFTS)
    expect((result.drafts as { ssen_before: number; ssen_after: number }).ssen_after).toBe(FROZEN_DRAFTS)
    expect(result.false_figure_safe).toBe(0)
    expect(result.critical).toBe(0)
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(FROZEN_TYPE_AUTO).toBe(38)
    expect(FROZEN_TYPE_THRESHOLD).toBe(0.78)
    expect(['STRONG PASS', 'PASS', 'PARTIAL', 'FAIL']).toContain(result.verdict)
    expect(result.verdict).not.toBe('FAIL')
  }, 360_000)
})
