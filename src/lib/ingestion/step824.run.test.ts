import { describe, expect, it } from 'vitest'
import { classifyCandidate, loadRemainingCandidates, hasCommittedStem, runStep824 } from './step824Run'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'
import type { PreflightRow } from './figurePersistence'

function row(partial: Partial<PreflightRow>): PreflightRow {
  return {
    id: '1|1',
    pass: false,
    asset_ready: true,
    reasons: [],
    asset: null,
    link: null,
    ...partial,
  }
}

describe('STEP 8.24 candidate classification', () => {
  it('PASS when preflight passes with asset and link', () => {
    const r = row({ pass: true, asset: {} as never, link: {} as never })
    expect(classifyCandidate(r, false).verdict).toBe('PASS')
  })

  it('BLOCKED when problem not ingested and no committed stem (needs paid OCR)', () => {
    const r = row({ reasons: ['PROBLEM_NOT_INGESTED'] })
    const out = classifyCandidate(r, false)
    expect(out.verdict).toBe('BLOCKED')
    expect(out.reasons).toContain('NEEDS_PAID_OCR')
    expect(out.reasons).toContain('NO_COMMITTED_STEM')
  })

  it('REVIEW when problem not ingested but a committed stem exists', () => {
    const r = row({ reasons: ['PROBLEM_NOT_INGESTED'] })
    const out = classifyCandidate(r, true)
    expect(out.verdict).toBe('REVIEW')
    expect(out.reasons).toContain('STEM_AVAILABLE_NEEDS_INGEST')
  })

  it('BLOCKED when projection failed (asset not ready)', () => {
    const r = row({ asset_ready: false, reasons: ['MISSING_CROP'] })
    expect(classifyCandidate(r, false).verdict).toBe('BLOCKED')
  })

  it('REVIEW when asset ready and problem present but link ambiguous', () => {
    const r = row({ reasons: ['NUMBER_MISMATCH'], asset: {} as never })
    expect(classifyCandidate(r, false).verdict).toBe('REVIEW')
  })
})

describe('STEP 8.24 scope', () => {
  it('scopes to exactly the 8 STEP 8.23 unresolved pending candidates', () => {
    const candidates = loadRemainingCandidates(process.cwd())
    expect(candidates.map((c) => c.id).sort()).toEqual([...UNRESOLVED_PENDING_IDS].sort())
  })

  it('none of the 8 candidate pages have a committed GT stem', () => {
    for (const id of UNRESOLVED_PENDING_IDS) {
      const [page, number] = id.split('|')
      expect(hasCommittedStem(process.cwd(), Number(page), number.replace(/^0+/, '') || '0')).toBe(false)
    }
  })
})

describe('STEP 8.24 production run (gated)', () => {
  it('re-evaluates and persists eligible remaining figures without touching prior data', async () => {
    if (process.env.HQB_BOOK_8_24 !== '1') return
    const argv = (process.env.HQB_8_24_ARGV ?? '--cache-only').split(' ').filter(Boolean)
    const result = await runStep824(process.cwd(), argv)
    expect(result.step).toBe('8.24')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.candidates_total).toBe(8)
    expect(result.results.PASS + result.results.REVIEW + result.results.BLOCKED).toBe(8)
    expect(result.orphans).toBe(0)
    expect(result.duplicate_asset_hash).toBe(0)
    expect(result.duplicate_links).toBe(0)
    expect(result.content_changed).toBe(0)
    expect(result.idempotent).toBe(true)
    expect(result.existing_step823_preserved.assets).toBeGreaterThanOrEqual(3)
    expect(result.existing_step823_preserved.links).toBeGreaterThanOrEqual(3)
    expect(result.after.assets).toBe(result.before.assets + result.persisted.new_assets)
    expect(result.after.links).toBe(result.before.links + result.persisted.new_links)
    expect(result.ocr.calls).toBeLessThanOrEqual(result.ocr.max_calls_allowed)
    expect(result.ocr.cost_usd).toBeLessThanOrEqual(result.ocr.budget_usd)
    expect(['PASS', 'PARTIAL', 'BLOCKED']).toContain(result.verdict)
  }, 360_000)
})
