import { describe, expect, it } from 'vitest'
import {
  BOOK_COMPLETE_STAGES,
  changedPagesFromHashes,
  formatBookCompleteMarkdown,
  genericOutlineAdapter,
  parseIngestBookFlags,
  planBookComplete,
  selectiveOcrPages,
  sourceLockPath,
} from './bookCompletePipeline'

describe('book complete pipeline', () => {
  it('parses ingest:book flags with dry-run default and --apply writes', () => {
    const dry = parseIngestBookFlags(['--source-id=abc', '--mode=complete'])
    expect(dry.apply).toBe(false)
    expect(dry.mode).toBe('complete')
    expect(dry.sourceId).toBe('abc')
    expect(parseIngestBookFlags(['--source-id', 'abc', '--apply']).apply).toBe(true)
    expect(parseIngestBookFlags(['--cost-cap=0.5']).costCapUsd).toBe(0.5)
  })

  it('skips OCR and writes when the PDF hash is unchanged', () => {
    const adapter = genericOutlineAdapter()
    const plan = planBookComplete({
      sourceId: 'book-1',
      title: 'Next book',
      pdfHash: 'aaa',
      previousPdfHash: 'aaa',
      pageCount: 3,
      pageHashes: [
        { page: 1, sha256: '1' },
        { page: 2, sha256: '2' },
        { page: 3, sha256: '3' },
      ],
      previousPageHashes: [
        { page: 1, sha256: '1' },
        { page: 2, sha256: '2' },
        { page: 3, sha256: '3' },
      ],
      cachedOcrKeys: [],
      costCapUsd: 1,
      apply: true,
      lockHeld: true,
      ocrPolicy: 'paid-allowed',
      adapter,
    })
    expect(plan.identical_pdf).toBe(true)
    expect(plan.ocr_new_calls).toBe(0)
    expect(plan.writes).toBe(0)
    expect(plan.extra_writes_on_rerun).toBe(0)
    expect(plan.stages).toEqual([...BOOK_COMPLETE_STAGES])
    expect(formatBookCompleteMarkdown(plan)).toContain('identical PDF true')
  })

  it('OCRs only changed uncached pages and respects the cost cap', () => {
    expect(changedPagesFromHashes([{ page: 1, sha256: 'a' }, { page: 2, sha256: 'b' }], [{ page: 1, sha256: 'a' }, { page: 2, sha256: 'x' }])).toEqual([2])
    expect(selectiveOcrPages({ changedPages: [2], cachedOcrKeys: ['p002-b'], pageHashes: [{ page: 2, sha256: 'b' }] })).toEqual({
      cacheHits: 1,
      ocrPages: [],
    })
    const plan = planBookComplete({
      sourceId: 'book-1',
      title: 'Next book',
      pdfHash: 'bbb',
      previousPdfHash: 'aaa',
      pageCount: 2,
      pageHashes: [
        { page: 1, sha256: '1' },
        { page: 2, sha256: '2' },
      ],
      previousPageHashes: [
        { page: 1, sha256: '1' },
        { page: 2, sha256: 'old' },
      ],
      cachedOcrKeys: [],
      costCapUsd: 0.001,
      apply: false,
      lockHeld: true,
      ocrPolicy: 'paid-allowed',
      adapter: genericOutlineAdapter(),
    })
    expect(plan.ocr_new_calls).toBe(0)
    expect(plan.dry_run).toBe(true)
    expect(sourceLockPath('book-1')).toContain('book-1.lock')
  })

  it('keeps TOC rules in the adapter and does not require 쎈 problem numbers', () => {
    const toc = genericOutlineAdapter().parseToc([{ page: 6, text: 'I. 다항식\n01. 연산' }])
    expect(toc.some((node) => node.level === 'MAJOR')).toBe(true)
    expect(genericOutlineAdapter().assignUnit({ page: 10, stem: '본문' }, toc)?.major).toBe('I')
  })
})
