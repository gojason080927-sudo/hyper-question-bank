import { describe, expect, it } from 'vitest'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import {
  MATH2_DOCUMENT_ID,
  MATH2_OCR_COST_CAP_USD,
  MATH2_PAGE_COUNT,
  assertMath2Document,
  assertPageRange,
  batchesOf,
  cacheKey,
  estimateMath2BatchUsd,
  estimateMath2OcrUsd,
  MATH2_OCR_RETRY_429_MS,
  nextSegmentationApproach,
  paceMsForPages,
  waitMsFromRetryAfter,
  paidCapAllows,
  pickQaSamples,
  planMath2Ocr,
  summarizeMath2Qa,
  toApiPages,
  analyzeMath2Page,
} from './math2Ocr'

describe('math2 OCR planner', () => {
  it('locks the uploaded 200-page source and refuses SSEN', () => {
    expect(() => assertMath2Document(SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertMath2Document('00000000-0000-0000-0000-000000000000')).toThrow(/SOURCE_LOCK/)
    expect(() => assertMath2Document(MATH2_DOCUMENT_ID)).not.toThrow()
    expect(() => planMath2Ocr({ pageCount: 192 })).toThrow(/PAGE_COUNT/)
    expect(() => assertPageRange([0])).toThrow(/PAGE_RANGE/)
    expect(() => assertPageRange([201])).toThrow(/PAGE_RANGE/)
    expect(() => assertPageRange([1, 1])).toThrow(/DUPLICATE/)
    assertPageRange([1, 192, 200])
  })

  it('prices 200 new pages at $0.80 and refuses work over $1.00', () => {
    const plan = planMath2Ocr({ cachedPages: [] })
    expect(plan.pageCount).toBe(MATH2_PAGE_COUNT)
    expect(plan.missPages).toHaveLength(200)
    expect(plan.estimatedUsd).toBe(0.8)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
    expect(estimateMath2OcrUsd(200)).toBe(0.8)
    expect(estimateMath2BatchUsd(200)).toBe(0.4)
    expect(paidCapAllows(0, 200).ok).toBe(true)
    expect(paidCapAllows(0.8, 51).ok).toBe(false)
    expect(paidCapAllows(MATH2_OCR_COST_CAP_USD, 1).ok).toBe(false)
    expect(planMath2Ocr({ cachedPages: [1, 2] }).estimatedNewCalls).toBe(198)
    expect(planMath2Ocr({ cachedPages: Array.from({ length: 200 }, (_, i) => i + 1) }).estimatedUsd).toBe(0)
  })

  it('keeps cache keys per PDF hash + page and maps API 0-index', () => {
    expect(cacheKey('aaa', 1)).not.toBe(cacheKey('bbb', 1))
    expect(cacheKey('aaa', 1)).not.toBe(cacheKey('aaa', 2))
    expect(toApiPages([1, 200])).toEqual([0, 199])
    expect(paceMsForPages(8)).toBeGreaterThanOrEqual(4000)
    expect(paceMsForPages(125)).toBeGreaterThanOrEqual(60_000)
    expect(waitMsFromRetryAfter('60')).toBeGreaterThanOrEqual(60_000)
    expect(waitMsFromRetryAfter(null)).toBe(MATH2_OCR_RETRY_429_MS)
    expect(waitMsFromRetryAfter('not-a-number')).toBe(MATH2_OCR_RETRY_429_MS)
    expect(batchesOf([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('scores OCR text and does not recommend SSEN complete ingest', () => {
    const page = analyzeMath2Page({
      page: 12,
      markdown: '0007. 다음 중 옳은 것은? 이차방정식의 근과 계수의 관계를 이용하여 구하시오.\n① $x^2+1$\n② $x-3$\n③ 표\n<table><tr><td>1</td></tr></table>',
    })
    expect(page.has_substantial_text).toBe(true)
    expect(page.circled_choices).toBeGreaterThan(0)
    const qa = summarizeMath2Qa([
      page,
      analyzeMath2Page({ page: 1, markdown: '표지', cached: true }),
      analyzeMath2Page({ page: 200, markdown: '', error: 'failed' }),
    ])
    expect(qa.failed).toBe(1)
    expect(qa.cached).toBe(1)
    expect(pickQaSamples([page])).toContain(12)
    const next = nextSegmentationApproach(qa)
    expect(next.do_not_reuse.join(' ')).toContain('ingest:book --mode=complete')
    expect(next.recommended).toMatch(/Repair failed|dry-run page-kind/)
  })
})
