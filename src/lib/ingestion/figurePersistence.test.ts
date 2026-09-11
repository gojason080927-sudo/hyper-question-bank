import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIGURE_VALIDATION_FREEZE } from './figureGtFreeze'
import { box } from './visualFigureV1'
import {
  STEP823_MIGRATION,
  attachDetectedBbox,
  cropRelPath,
  dedupeAssets,
  findOrphans,
  figureIdFromHash,
  figurePersistGate,
  migrationIsAdditive823,
  persistBlockReasons,
  preflightFigure,
  productionCompletionVerdict,
  projectAutoFigure,
  replayDoesNotDuplicate,
  type FigureAssetDraft,
  type JudgedFigureRow,
} from './figurePersistence'

const autoRow = (): JudgedFigureRow => ({
  id: '12|0045',
  book: 'SSEN',
  detected: true,
  figure_type: 'GEOMETRY_DIAGRAM',
  quality: 'FULLY_CONTAINED',
  ownership: 'SINGLE_OWNER_HIGH',
  owner: '12|0045',
  owner_correct: true,
  crop: 'FIGURE_CROP_SAFE',
  auto: true,
  false_safe: false,
  review: null,
  detection_confidence: 0.86,
})

describe('STEP 8.23 figure persistence contract', () => {
  it('projects AUTO figures into asset+link drafts without duplicating pixels', () => {
    const crop = Buffer.from('png-bytes-for-hash-crop-body-ok!')
    const first = projectAutoFigure({
      row: autoRow(),
      page: 12,
      displayNumber: '0045',
      sourceDocumentId: 'doc-1',
      bbox: box(0.2, 0.3, 0.4, 0.2),
      cropBytes: crop,
    })
    const second = projectAutoFigure({
      row: autoRow(),
      page: 12,
      displayNumber: '0045',
      sourceDocumentId: 'doc-1',
      bbox: box(0.2, 0.3, 0.4, 0.2),
      cropBytes: crop,
    })
    expect('asset' in first && 'asset' in second).toBe(true)
    if (!('asset' in first) || !('asset' in second)) return
    expect(first.asset.figure_id).toBe(second.asset.figure_id)
    expect(first.asset.figure_id).toBe(figureIdFromHash('doc-1', 12, first.asset.source_hash))
    expect(first.link.figure_id).toBe(first.asset.figure_id)
    expect(dedupeAssets([first.asset, second.asset])).toHaveLength(1)
    expect(cropRelPath('12|0045')).toBe('ocr-tests/taxonomy/step8-22/crops/12-0045.png')
  })

  it('rejects invalid, review, unsafe, and missing-source inputs', () => {
    const review: JudgedFigureRow = { ...autoRow(), auto: false, review: 'FIGURE_CUT_RISK', crop: 'FIGURE_CROP_UNSAFE' }
    expect(persistBlockReasons(review).sort()).toEqual(expect.arrayContaining(['NOT_AUTO', 'REVIEW_BLOCKED', 'CROP_NOT_SAFE']))
    const missingCrop = projectAutoFigure({
      row: autoRow(),
      page: 12,
      displayNumber: '0045',
      sourceDocumentId: 'doc-1',
      bbox: box(0.2, 0.3, 0.4, 0.2),
      cropBytes: null,
    })
    expect('reasons' in missingCrop && missingCrop.reasons.includes('MISSING_CROP')).toBe(true)
    const projected = projectAutoFigure({
      row: autoRow(),
      page: 12,
      displayNumber: '0045',
      sourceDocumentId: 'doc-1',
      bbox: box(0.2, 0.3, 0.4, 0.2),
      cropBytes: Buffer.alloc(64, 7),
    })
    const failed = preflightFigure({
      id: '12|0045',
      projected,
      ident: undefined,
      expectedDocumentId: 'doc-1',
    })
    expect(failed.pass).toBe(false)
    expect(failed.asset_ready).toBe(true)
    expect(failed.reasons).toContain('PROBLEM_NOT_INGESTED')
    expect(failed.asset?.figure_id).toBeTruthy()
  })

  it('keeps replay idempotent and reports orphans', () => {
    const crop = Buffer.from('shared-figure-bytes-shared-figure')
    const a = projectAutoFigure({
      row: autoRow(),
      page: 12,
      displayNumber: '0045',
      sourceDocumentId: 'doc-1',
      bbox: box(0.2, 0.3, 0.4, 0.2),
      cropBytes: crop,
    })
    expect('asset' in a).toBe(true)
    if (!('asset' in a)) return
    const assets = [a.asset, a.asset] as FigureAssetDraft[]
    const ids = dedupeAssets(assets).map((row) => row.figure_id)
    expect(replayDoesNotDuplicate(ids, ids)).toBe(true)
    expect(findOrphans(dedupeAssets(assets), [{ ...a.link, figure_id: 'missing' }])).toEqual(['missing'])
  })

  it('attaches detector bbox and does not invent a match', () => {
    const truth = box(0.2, 0.3, 0.2, 0.2)
    const hit = attachDetectedBbox(truth, [
      {
        figure_id: 'f1',
        page: 12,
        bbox: box(0.21, 0.31, 0.2, 0.2),
        figure_type: 'GEOMETRY_DIAGRAM',
        figure_confidence: 0.8,
        visual_evidence: ['test'],
        text_overlap: 0.1,
        region_membership: 'page_body',
      },
    ], 12)
    expect(hit).not.toBeNull()
    expect(attachDetectedBbox(truth, [], 12)).toBeNull()
  })

  it('freezes 8.22 GT ids and keeps the additive migration', () => {
    expect(FIGURE_VALIDATION_FREEZE).toHaveLength(25)
    const sql = readFileSync(path.join(process.cwd(), STEP823_MIGRATION), 'utf8')
    expect(migrationIsAdditive823(sql)).toEqual({ ok: true, reasons: [] })
    expect(figurePersistGate(true, null, 2).canApply).toBe(true)
    expect(productionCompletionVerdict({
      persistAttempted: false,
      schemaOk: true,
      auto: 11,
      assetsInDb: 2,
      linksInDb: 2,
      pendingAfter: 9,
      ingestCreated: 0,
      reviewPersisted: 0,
      unsafePersisted: 0,
      duplicates: 0,
      orphans: 0,
    })).toBe('PARTIAL')
    const persistSrc = readFileSync(path.join(process.cwd(), 'src/lib/ingestion/figurePersistence.ts'), 'utf8')
    expect(/개념원리 공통수학1\(22개정\)/.test(persistSrc)).toBe(false)
    expect(/page_number\s*===\s*\d+/.test(persistSrc)).toBe(false)
    expect(/#[0-9A-Fa-f]{6}/.test(persistSrc)).toBe(false)
  })
})
