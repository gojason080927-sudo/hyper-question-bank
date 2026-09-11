import { describe, expect, it } from 'vitest'
import { FIGURE_VALIDATION_FREEZE } from './figureGtFreeze'
import {
  DO_NOT_RECREATE_IDS,
  UNRESOLVED_PENDING_IDS,
  VERIFIED_PENDING_ALLOWLIST,
  loadVerifiedPendingProblems,
  pendingDraftPayload,
  pendingPaidOcrEstimate,
  unresolvedPendingReport,
} from './step823VerifiedPending'
import { figurePersistGate, productionCompletionVerdict } from './figurePersistence'

describe('STEP 8.23 verified pending ingest', () => {
  it('restores only 20|0097 from committed human-read GT', () => {
    const verified = loadVerifiedPendingProblems(process.cwd())
    expect(VERIFIED_PENDING_ALLOWLIST).toEqual(['20|0097'])
    expect(verified).toHaveLength(1)
    expect(verified[0]?.id).toBe('20|0097')
    expect(verified[0]?.page).toBe(20)
    expect(verified[0]?.original_problem_number).toBe('0097')
    expect(verified[0]?.problem_text.includes('그림과 같이')).toBe(true)
    expect(verified[0]?.problem_text.includes('반원')).toBe(true)
    expect(verified[0]?.provenance.ground_truth_sample_id).toBe('S07')
    const freeze = FIGURE_VALIDATION_FREEZE.find((row) => row.id === '20|0097')
    expect(verified[0]?.bbox).toEqual(freeze?.problem_bbox)
    const payload = pendingDraftPayload(verified[0]!)
    expect((payload.version as { problem_text: string }).problem_text.length).toBeGreaterThan(40)
    expect(DO_NOT_RECREATE_IDS).toEqual(['12|0045', '114|0773'])
    expect(UNRESOLVED_PENDING_IDS).toHaveLength(8)
    expect(unresolvedPendingReport().every((row) => row.reason.includes('Paid OCR not authorized'))).toBe(true)
    const ocr = pendingPaidOcrEstimate()
    expect(ocr.problem_count).toBe(8)
    expect(ocr.unique_page_count).toBe(5)
    expect(ocr.paid_ocr_authorized).toBe(false)
    expect(ocr.mathpix.typical_usd).toBeGreaterThan(0)
    expect(ocr.mistral.typical_usd).toBeGreaterThan(0)
  })

  it('persists the link-ready subset and does not require 11/11 to apply', () => {
    expect(figurePersistGate(false, 'PGRST205', 3)).toEqual({ canApply: false, reason: 'PGRST205' })
    expect(figurePersistGate(true, null, 0)).toEqual({ canApply: false, reason: 'no-link-ready-auto' })
    expect(figurePersistGate(true, null, 3)).toEqual({ canApply: true, reason: null })
    expect(
      productionCompletionVerdict({
        persistAttempted: true,
        schemaOk: false,
        auto: 11,
        assetsInDb: 0,
        linksInDb: 0,
        pendingAfter: 8,
        ingestCreated: 1,
        verifiedIdentitiesPresent: 1,
        reviewPersisted: 0,
        unsafePersisted: 0,
        duplicates: 0,
        orphans: 0,
      }),
    ).toBe('PARTIAL')
    expect(
      productionCompletionVerdict({
        persistAttempted: true,
        schemaOk: false,
        auto: 11,
        assetsInDb: 0,
        linksInDb: 0,
        pendingAfter: 9,
        ingestCreated: 0,
        verifiedIdentitiesPresent: 0,
        reviewPersisted: 0,
        unsafePersisted: 0,
        duplicates: 0,
        orphans: 0,
      }),
    ).toBe('BLOCKED')
    expect(
      productionCompletionVerdict({
        persistAttempted: true,
        schemaOk: false,
        auto: 11,
        assetsInDb: 0,
        linksInDb: 0,
        pendingAfter: 8,
        ingestCreated: 0,
        verifiedIdentitiesPresent: 1,
        reviewPersisted: 0,
        unsafePersisted: 0,
        duplicates: 0,
        orphans: 0,
      }),
    ).toBe('PARTIAL')
    expect(
      productionCompletionVerdict({
        persistAttempted: true,
        schemaOk: true,
        auto: 11,
        assetsInDb: 11,
        linksInDb: 11,
        pendingAfter: 0,
        ingestCreated: 9,
        verifiedIdentitiesPresent: 11,
        reviewPersisted: 0,
        unsafePersisted: 0,
        duplicates: 0,
        orphans: 0,
      }),
    ).toBe('PASS')
    expect(
      productionCompletionVerdict({
        persistAttempted: false,
        schemaOk: false,
        auto: 11,
        assetsInDb: 0,
        linksInDb: 0,
        pendingAfter: 9,
        ingestCreated: 0,
        verifiedIdentitiesPresent: 0,
        reviewPersisted: 0,
        unsafePersisted: 0,
        duplicates: 0,
        orphans: 0,
      }),
    ).toBe('PARTIAL')
  })
})
