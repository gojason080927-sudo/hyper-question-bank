import { describe, expect, it } from 'vitest'
import { MATH2_DOCUMENT_ID, MATH2_OCR_COST_CAP_USD } from './math2Ocr'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import {
  GANYEOM2_SPEC,
  GOJAENG2_SPEC,
  ILDEUNG2_SPEC,
  LIGHTSSEN2_SPEC,
  MOTHER2_SPEC,
  RPM2_SPEC,
  TYPELEVEL2_SPEC,
  WANJA2_SPEC,
  analyzeBookPage,
  assertBookIngestSource,
  assertBookPageRange,
  planBookOcr,
  specFromBookArg,
  summarizeBookQa,
} from './bookIngestSpec'

describe('generic book ingest spec', () => {
  it('locks 개념원리 and refuses SSEN / 쎈2', () => {
    expect(() => assertBookIngestSource(GANYEOM2_SPEC, GANYEOM2_SPEC.sourceId)).not.toThrow()
    expect(() => assertBookIngestSource(GANYEOM2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(GANYEOM2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(GANYEOM2_SPEC, '00000000-0000-0000-0000-000000000000')).toThrow(/SOURCE_LOCK/)
    expect(() => assertBookPageRange(GANYEOM2_SPEC, [0])).toThrow(/PAGE_RANGE/)
    expect(() => assertBookPageRange(GANYEOM2_SPEC, [305])).toThrow(/PAGE_RANGE/)
    assertBookPageRange(GANYEOM2_SPEC, [1, 200, 304])
  })

  it('prices 304 new pages on batch USD and stays under $1', () => {
    const plan = planBookOcr(GANYEOM2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(304)
    expect(plan.missPages).toHaveLength(304)
    expect(plan.batchUsd).toBe(0.608)
    expect(plan.realtimeUsd).toBe(1.216)
    expect(plan.estimatedUsd).toBe(0.608)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
    expect(plan.capUsd).toBe(MATH2_OCR_COST_CAP_USD)
    expect(planBookOcr(GANYEOM2_SPEC, { cachedPages: [1, 2] }).estimatedNewCalls).toBe(302)
  })

  it('scores OCR text with the book page count', () => {
    const page = analyzeBookPage(GANYEOM2_SPEC, {
      page: 20,
      markdown:
        '예제 1. 다음 중 옳은 것은? 이차방정식의 근과 계수의 관계를 이용하여 다음 값을 구하시오. 실수 전체에서 생각하시오.\n① $x^2+1$\n② $x-3$',
    })
    expect(page.has_substantial_text).toBe(true)
    expect(page.circled_choices).toBeGreaterThan(0)
    const qa = summarizeBookQa(GANYEOM2_SPEC, [
      page,
      analyzeBookPage(GANYEOM2_SPEC, { page: 1, markdown: '표지', cached: true }),
      analyzeBookPage(GANYEOM2_SPEC, { page: 304, markdown: '', error: 'failed' }),
    ])
    expect(qa.failed).toBe(1)
    expect(qa.cached).toBe(1)
    expect(qa.missing_pages).toContain(2)
    expect(qa.missing_pages).not.toContain(20)
  })

  it('registers RPM2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=rpm2']).sourceId).toBe(RPM2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(RPM2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(RPM2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(RPM2_SPEC, GANYEOM2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(RPM2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(168)
    expect(plan.batchUsd).toBe(0.336)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })

  it('registers GOJAENG2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=gojaeng2']).sourceId).toBe(GOJAENG2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(GOJAENG2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(GOJAENG2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(GOJAENG2_SPEC, RPM2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(GOJAENG2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(199)
    expect(plan.batchUsd).toBe(0.398)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })

  it('registers ILDEUNG2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=ildeung2']).sourceId).toBe(ILDEUNG2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(ILDEUNG2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(ILDEUNG2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(ILDEUNG2_SPEC, GOJAENG2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(ILDEUNG2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(150)
    expect(plan.batchUsd).toBe(0.3)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })

  it('registers LIGHTSSEN2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=lightssen2']).sourceId).toBe(LIGHTSSEN2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(LIGHTSSEN2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(LIGHTSSEN2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(LIGHTSSEN2_SPEC, ILDEUNG2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(LIGHTSSEN2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(192)
    expect(plan.batchUsd).toBe(0.384)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })

  it('registers TYPELEVEL2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=typelevel2']).sourceId).toBe(TYPELEVEL2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(TYPELEVEL2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(TYPELEVEL2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(TYPELEVEL2_SPEC, LIGHTSSEN2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(TYPELEVEL2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(196)
    expect(plan.batchUsd).toBe(0.392)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })

  it('registers MOTHER2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=mother2']).sourceId).toBe(MOTHER2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(MOTHER2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(MOTHER2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(MOTHER2_SPEC, TYPELEVEL2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(MOTHER2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(157)
    expect(plan.batchUsd).toBe(0.314)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })

  it('registers WANJA2 on the same generic planner', () => {
    expect(specFromBookArg(['--book=wanja2']).sourceId).toBe(WANJA2_SPEC.sourceId)
    expect(() => specFromBookArg(['--book=unknown'])).toThrow(/UNKNOWN_BOOK/)
    expect(() => assertBookIngestSource(WANJA2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(WANJA2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookIngestSource(WANJA2_SPEC, MOTHER2_SPEC.sourceId)).toThrow(/SOURCE_LOCK/)
    const plan = planBookOcr(WANJA2_SPEC, { cachedPages: [] })
    expect(plan.pageCount).toBe(228)
    expect(plan.batchUsd).toBe(0.456)
    expect(plan.underCap).toBe(true)
    expect(plan.persistProblems).toBe(false)
  })
})
