import { describe, expect, it } from 'vitest'
import { MATH2_DOCUMENT_ID } from './math2Ocr'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { GANYEOM2_SPEC } from './bookIngestSpec'
import {
  assertBookSegmentSource,
  bookPagePreamble,
  disambiguatePageNumbers,
  isBookProblemStart,
  refuseBookPersist,
  runBookSegment,
  splitBookProblems,
} from './bookSegment'
import { QUESTION_BANK_REF, STUDENT_CARE_REF, assertBookPersistTarget, bookUpsertPayload } from './bookPersist'
import { autoSafePersistItems } from './math2Persist'

describe('generic book segment', () => {
  it('locks the book spec and refuses SSEN / 쎈2 / persist flags', () => {
    expect(() => assertBookSegmentSource(GANYEOM2_SPEC, GANYEOM2_SPEC.sourceId)).not.toThrow()
    expect(() => assertBookSegmentSource(GANYEOM2_SPEC, SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertBookSegmentSource(GANYEOM2_SPEC, MATH2_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => refuseBookPersist(['--persist-auto-safe'])).toThrow(/NO_PERSIST/)
  })

  it('splits 예제/유제 and keeps same printed number unique per page', () => {
    expect(isBookProblemStart('예제 1 다음 함수의 그래프를 그리시오.')).toEqual({ number: '0001', label: '예제' })
    expect(isBookProblemStart('유제 1 다음 값을 구하시오.')).toEqual({ number: '0001', label: '유제' })
    expect(isBookProblemStart('98 다음 두 직선이 평행할 때, 상수 a의 값을 모두 구하시오.')).toEqual({
      number: '0098',
      label: 'numbered',
    })
    expect(isBookProblemStart('1 평면좌표')).toBeNull()
    expect(isBookProblemStart('292')).toBeNull()
    const spans = splitBookProblems(
      ['예제 1 점 A(1, 2)와 B(4, 6) 사이의 거리를 구하시오.', '유제 1 점 C(0, 0)와 D(3, 4) 사이의 거리를 구하시오.'].join('\n'),
    )
    expect(spans.map((row) => row.label)).toEqual(['예제', '유제'])
    expect(disambiguatePageNumbers(spans).map((row) => row.number)).toEqual(['0001', '1001'])
    expect(bookPagePreamble('핵심 개념\n예제 2 다음')).toBe('')
  })

  it('promotes numbered-stem pages to PROBLEM so they are not blocked as UNKNOWN', () => {
    const pages = Array.from({ length: GANYEOM2_SPEC.pageCount }, (_, i) => {
      const page = i + 1
      if (page === 49) {
        return {
          page,
          markdown: [
            '개념원리 익히기',
            '98 다음 두 직선이 평행할 때, 상수 $a$의 값을 모두 구하시오.',
            '① 1',
            '② 2',
            '③ 3',
            '④ 4',
            '⑤ 5',
            '99 다음 두 직선이 일치할 때, 상수 $a, b$의 값을 구하시오.',
            '① 1',
            '② 2',
            '③ 3',
            '④ 4',
            '⑤ 5',
          ].join('\n'),
        }
      }
      return { page, markdown: page === 1 ? '표지' : `본문 ${page}` }
    })
    const report = runBookSegment(GANYEOM2_SPEC, pages)
    expect(report.candidates).toBe(2)
    expect(report.auto_safe).toBe(2)
    expect(report.rows.every((row) => row.page_kind === 'PROBLEM')).toBe(true)
  })

  it('treats the same printed number on different pages as AUTO_SAFE when the stem is complete', () => {
    const pages = Array.from({ length: GANYEOM2_SPEC.pageCount }, (_, i) => {
      const page = i + 1
      if (page === 20 || page === 40) {
        return {
          page,
          markdown: `예제 1 두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오.\n① 3\n② 4\n③ 5\n④ 6\n⑤ 7`,
        }
      }
      return { page, markdown: page === 1 ? '표지' : `본문 ${page}` }
    })
    const report = runBookSegment(GANYEOM2_SPEC, pages)
    expect(report.candidates).toBe(2)
    expect(report.auto_safe).toBe(2)
    expect(report.blocked).toBe(0)
    const items = autoSafePersistItems(report.rows)
    expect(items).toHaveLength(2)
    const payload = bookUpsertPayload(GANYEOM2_SPEC, items[0]!)
    expect(payload.source_document_id).toBe(GANYEOM2_SPEC.sourceId)
    expect(payload.source_document_id).not.toBe(MATH2_DOCUMENT_ID)
    expect(() => assertBookPersistTarget(GANYEOM2_SPEC, GANYEOM2_SPEC.sourceId, `https://${QUESTION_BANK_REF}.supabase.co`)).not.toThrow()
    expect(() => assertBookPersistTarget(GANYEOM2_SPEC, GANYEOM2_SPEC.sourceId, `https://${STUDENT_CARE_REF}.supabase.co`)).toThrow(/student-care/)
  })
})
