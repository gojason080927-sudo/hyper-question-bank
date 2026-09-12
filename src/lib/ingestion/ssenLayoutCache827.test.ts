import { describe, expect, it } from 'vitest'
import { coerceMistralBlock, mistralLayoutFromRaw } from '../ocr/normalizeMistral'
import { MISTRAL_OFFICIAL_OCR_PRICING, mistralOcrUsdForPages } from '../ocr/costModel'
import { MISTRAL_MODEL, MISTRAL_PROVIDER } from '../ocr/mathOcrTypes'
import { compareCacheFileName } from '../ocr/ocrCompare'
import { SECOND_DOCUMENT, SECOND_PDF_SHA256, STEP827_DOCUMENT, STEP827_SSEN_FILE_HASH, STEP827_SSEN_PAGE_COUNT } from './cacheSegment827'
import {
  SSEN_OCR_CACHE_MODEL,
  SSEN_OCR_CACHE_PARSER_VERSION,
  SSEN_OCR_CACHE_PROFILE,
  SSEN_OCR_CACHE_PROVIDER,
  SSEN_OCR_CACHE_USD_CAP,
  SSEN_OCR_FORBIDDEN_SUBSTITUTES,
  SSEN_OCR_PRICING_NOTE,
  SSEN_PILOT_PAGES,
  assertExactSsenOriginal,
  cacheKeyParts,
  compatibleLayoutCacheRecord,
  estimateMistralUsd,
  evaluatePageQuality,
  evaluatePilotGate,
  findDuplicatePages,
  findMissingPages,
  layoutCacheFileName,
  pagesToProcess,
  remainingPages,
  ssenOcrCachePrefix,
  stripImageBase64,
  uniqueCacheKeys,
  wouldExceedUsdCap,
} from './ssenLayoutCache827'

describe('STEP 8.27 SSEN layout OCR cache plan', () => {
  it('locks the Production SSEN original and excludes SECOND / figure-PNG substitutes', () => {
    expect(STEP827_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    expect(STEP827_SSEN_FILE_HASH).toBe('ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292')
    expect(STEP827_SSEN_PAGE_COUNT).toBe(192)
    expect(assertExactSsenOriginal({ sha256: STEP827_SSEN_FILE_HASH, pageCount: 192, sizeBytes: 11365061 }).ok).toBe(true)
    expect(
      assertExactSsenOriginal({ sha256: SECOND_PDF_SHA256, pageCount: 312, sizeBytes: 1 }).blockers,
    ).toEqual(expect.arrayContaining(['SECOND_BOOK_HASH_FORBIDDEN', 'SSEN_SHA256_MISMATCH', 'SSEN_PAGE_COUNT_MISMATCH']))
    expect(SSEN_OCR_FORBIDDEN_SUBSTITUTES).toContain(SECOND_DOCUMENT)
    expect(SSEN_OCR_FORBIDDEN_SUBSTITUTES).toContain(SECOND_PDF_SHA256)
  })

  it('uses official Mistral OCR 4.1 per-page list price and stays under $1 for 192 pages', () => {
    expect(MISTRAL_OFFICIAL_OCR_PRICING.usd_per_1000_pages).toBe(4)
    expect(MISTRAL_OFFICIAL_OCR_PRICING.usd_per_page).toBe(0.004)
    expect(MISTRAL_OFFICIAL_OCR_PRICING.billing_unit).toBe('processed_page')
    expect(mistralOcrUsdForPages(1)).toBe(0.004)
    expect(estimateMistralUsd(5)).toBe(0.02)
    expect(estimateMistralUsd(192)).toBe(0.768)
    expect(SSEN_OCR_PRICING_NOTE.under_cap).toBe(true)
    expect(wouldExceedUsdCap(0, 192)).toBe(false)
    expect(wouldExceedUsdCap(0, 251)).toBe(true)
    expect(wouldExceedUsdCap(0.996, 2)).toBe(true)
    expect(SSEN_OCR_CACHE_USD_CAP).toBe(1)
    expect(SSEN_OCR_CACHE_PROVIDER).toBe(MISTRAL_PROVIDER)
    expect(SSEN_OCR_CACHE_MODEL).toBe(MISTRAL_MODEL)
    expect(SSEN_OCR_CACHE_PROFILE).toBe('ocr-latest+blocks+tables+images')
  })

  it('selects five distinct representative pages and resumes without re-calling completed ones', () => {
    expect(SSEN_PILOT_PAGES.map((row) => row.page)).toEqual([8, 28, 12, 20, 108])
    expect(new Set(SSEN_PILOT_PAGES.map((row) => row.role)).size).toBe(5)
    expect(SSEN_PILOT_PAGES.every((row) => row.page >= 8 && row.page <= 189)).toBe(true)
    expect(pagesToProcess({ phase: 'pilot', completed: [] })).toEqual([8, 28, 12, 20, 108])
    expect(pagesToProcess({ phase: 'pilot', completed: [8, 12] })).toEqual([28, 20, 108])
    expect(pagesToProcess({ phase: 'remainder', completed: [8, 28, 12, 20, 108] })).toHaveLength(187)
    expect(remainingPages([1, 192])).toHaveLength(190)
    expect(findMissingPages([1, 2, 4], 4)).toEqual([3])
    expect(findDuplicatePages([1, 2, 2, 3])).toEqual([2])
  })

  it('builds unique cache keys and the existing 8.27 filename profile', () => {
    const a = cacheKeyParts({
      sourceId: STEP827_DOCUMENT,
      pdfSha256: STEP827_SSEN_FILE_HASH,
      page: 8,
      provider: SSEN_OCR_CACHE_PROVIDER,
      model: SSEN_OCR_CACHE_MODEL,
      profile: SSEN_OCR_CACHE_PROFILE,
      parserVersion: SSEN_OCR_CACHE_PARSER_VERSION,
      pagePngSha256: 'aa'.repeat(32),
    })
    const b = cacheKeyParts({
      sourceId: STEP827_DOCUMENT,
      pdfSha256: STEP827_SSEN_FILE_HASH,
      page: 9,
      provider: SSEN_OCR_CACHE_PROVIDER,
      model: SSEN_OCR_CACHE_MODEL,
      profile: SSEN_OCR_CACHE_PROFILE,
      parserVersion: SSEN_OCR_CACHE_PARSER_VERSION,
      pagePngSha256: 'bb'.repeat(32),
    })
    expect(a).not.toBe(b)
    expect(uniqueCacheKeys([a, b])).toBe(true)
    expect(uniqueCacheKeys([a, a])).toBe(false)
    const file = layoutCacheFileName('abc123def4567890' + 'ff'.repeat(24))
    expect(file).toBe(compareCacheFileName(MISTRAL_PROVIDER, 'abc123def4567890' + 'ff'.repeat(24), SSEN_OCR_CACHE_PROFILE))
    expect(file).toContain('ocr-latest+blocks+tables+images'.replace(/[^a-z0-9+_-]/gi, '_'))
    expect(ssenOcrCachePrefix()).toContain(STEP827_DOCUMENT)
    expect(ssenOcrCachePrefix()).toContain(STEP827_SSEN_FILE_HASH)
    expect(ssenOcrCachePrefix()).not.toContain('original.pdf')
  })

  it('coerces OCR 4.1 blocks into layoutSegment pixel corners', () => {
    const corner = coerceMistralBlock({
      type: 'text',
      content: '0159 | 대표 문제',
      top_left_x: 10,
      top_left_y: 20,
      bottom_right_x: 110,
      bottom_right_y: 40,
    })
    expect(corner).toMatchObject({ top_left_x: 10, top_left_y: 20, bottom_right_x: 110, bottom_right_y: 40 })
    const xy = coerceMistralBlock({ type: 'text', text: '① 10', x: 5, y: 6, width: 20, height: 8 })
    expect(xy).toMatchObject({ top_left_x: 5, top_left_y: 6, bottom_right_x: 25, bottom_right_y: 14 })
    const layout = mistralLayoutFromRaw({
      pages: [
        {
          index: 0,
          markdown: '0159\n① 10',
          dimensions: { width: 200, height: 300, dpi: 200 },
          blocks: [{ type: 'text', content: '0159', x: 1, y: 2, width: 10, height: 5 }],
          images: [{ id: 'img-0', top_left_x: 3, top_left_y: 4, bottom_right_x: 13, bottom_right_y: 14 }],
        },
      ],
    })
    expect(layout.blocks[0]?.top_left_x).toBe(1)
    expect(layout.images[0]?.bbox).toEqual([3, 4, 13, 14])
  })

  it('fails a pilot page when blocks leave the page or numbers cannot be split on an MCQ page', () => {
    const spec = SSEN_PILOT_PAGES.find((row) => row.page === 28)!
    const sha = 'cc'.repeat(32)
    const bad = evaluatePageQuality(
      {
        page: 28,
        ocrPageIndex: 99,
        pageWidth: 100,
        pageHeight: 100,
        blocks: [{ type: 'text', content: 'hello', top_left_x: 0, top_left_y: 0, bottom_right_x: 500, bottom_right_y: 20 }],
        images: [],
        markdown: 'hello',
        hasTable: false,
        pngSha256: sha,
        expectedPngSha256: sha,
        jsonParseable: true,
      },
      spec,
    )
    expect(bad.map((row) => row.code)).toEqual(
      expect.arrayContaining(['BBOX_OUT_OF_PAGE', 'PAGE_INDEX_MISMATCH', 'PROBLEM_NUMBER_NOT_SEPARABLE', 'CHOICES_NOT_SEPARABLE']),
    )
    const good = evaluatePageQuality(
      {
        page: 28,
        ocrPageIndex: 27,
        pageWidth: 200,
        pageHeight: 300,
        blocks: [
          { type: 'text', content: '0159 | 대표 문제', top_left_x: 10, top_left_y: 10, bottom_right_x: 80, bottom_right_y: 24 },
          { type: 'text', content: '① 10', top_left_x: 10, top_left_y: 40, bottom_right_x: 40, bottom_right_y: 52 },
        ],
        images: [],
        markdown: '0159 | 대표 문제\n① 10',
        hasTable: false,
        pngSha256: sha,
        expectedPngSha256: sha,
        jsonParseable: true,
      },
      spec,
    )
    expect(good).toEqual([])
    const gate = evaluatePilotGate({
      pages: SSEN_PILOT_PAGES.map((row) => ({ spec: row, quality: [] })),
      paidCalls: 5,
      usd: 0.02,
      cacheLoadable: true,
    })
    expect(gate.pass).toBe(true)
    expect(evaluatePilotGate({ pages: [], paidCalls: 6, usd: 2, cacheLoadable: false }).blockers).toEqual(
      expect.arrayContaining(['PILOT_PAGE_COUNT', 'PILOT_PAID_CALLS_EXCEEDED', 'USD_CAP', 'CACHE_NOT_LOADABLE_FOR_8_27']),
    )
  })

  it('strips raw image_base64 from durable normalized cache records', () => {
    const record = compatibleLayoutCacheRecord({
      page: 8,
      sourceId: STEP827_DOCUMENT,
      pdfSha256: STEP827_SSEN_FILE_HASH,
      pagePngSha256: 'dd'.repeat(32),
      provider: SSEN_OCR_CACHE_PROVIDER,
      model: SSEN_OCR_CACHE_MODEL,
      profile: SSEN_OCR_CACHE_PROFILE,
      parserVersion: SSEN_OCR_CACHE_PARSER_VERSION,
      createdAt: '2026-09-12T00:00:00.000Z',
      rawOcr: 'text',
      seconds: 1,
      httpStatus: 200,
      rawResponse: { pages: [{ images: [{ image_base64: 'SECRET', id: 'img-0' }] }] },
      blocks: [],
      images: [{ id: 'img-0', bbox: [1, 2, 3, 4] }],
      dimensions: { width: 10, height: 10, dpi: 200 },
      hasTable: false,
    })
    expect(JSON.stringify(record)).not.toContain('SECRET')
    expect(stripImageBase64({ image_base64: 'SECRET', keep: 1 })).toEqual({ keep: 1 })
  })
})
