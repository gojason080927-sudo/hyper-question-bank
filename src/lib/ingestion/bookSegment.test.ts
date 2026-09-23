import { describe, expect, it } from 'vitest'
import { MATH2_DOCUMENT_ID } from './math2Ocr'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { GANYEOM2_SPEC } from './bookIngestSpec'
import {
  assertBookSegmentSource,
  bookEffectivePageKind,
  bookPagePreamble,
  disambiguatePageNumbers,
  isBookProblemStart,
  looksLikeAnswerKeyPage,
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

  it('does not treat 하십시오 drill pages as answer keys', () => {
    const markdown = [
      '정답 및 풀이 42쪽',
      '[0311~0314] 다음 점을 평행이동한 점의 좌표를 구하십시오.',
      '0311 (-1, 0)',
      '0312 (3, 2)',
      '0313 (2, -2)',
      '0314 (-3, -5)',
      '[0315~0318] 다음 점이 옮겨지는 점의 좌표를 구하십시오.',
      '0315 (3, 1)',
      '0316 (-1, 5)',
      '0317 (6, -2)',
      '0318 (10, 7)',
    ].join('\n')
    expect(looksLikeAnswerKeyPage(markdown)).toBe(false)
    expect(bookEffectivePageKind('ANSWER', markdown)).toBe('PROBLEM')
  })

  it('treats 하십시오 endings as finished stems', () => {
    const pages = Array.from({ length: GANYEOM2_SPEC.pageCount }, (_, i) => {
      const page = i + 1
      if (page === 11) {
        return {
          page,
          markdown: [
            '1 두 점 A(a, 3), B(1, 2-a) 사이의 거리가 2√3일 때, 양수 a의 값을 구하십시오.',
            '① 1',
            '② 2',
            '③ 3',
            '④ 4',
            '⑤ 5',
            '2 세 점 A(4, -5), B(10, 1), C(a, 4)에 대하여 AB=2BC일 때, a의 값을 모두 구하십시오.',
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
    expect(report.auto_safe).toBe(2)
    expect(report.rows.map((row) => row.problem_number)).toEqual(['0001', '0002'])
  })

  it('splits 예제/유제 and keeps same printed number unique per page', () => {
    expect(isBookProblemStart('예제 1 다음 함수의 그래프를 그리시오.')).toEqual({ number: '0001', label: '예제' })
    expect(isBookProblemStart('유제 1 다음 값을 구하시오.')).toEqual({ number: '0001', label: '유제' })
    expect(isBookProblemStart('98 다음 두 직선이 평행할 때, 상수 a의 값을 모두 구하시오.')).toEqual({
      number: '0098',
      label: 'numbered',
    })
    expect(isBookProblemStart('1 평면좌표')).toBeNull()
    expect(isBookProblemStart('3 표준형과 일반형으로 표현된 두 직선의 위치 관계')).toBeNull()
    expect(isBookProblemStart('1 두 점 A(a, 3), B(1, 2-a) 사이의 거리가 2√3일 때, 양수 a의 값을 구하십시오.')).toEqual({
      number: '0001',
      label: 'numbered',
    })
    expect(isBookProblemStart('292')).toBeNull()
    expect(isBookProblemStart('001 번호')).toEqual({ number: '0001', label: 'numbered' })
    expect(isBookProblemStart('003 번호, 서술형')).toEqual({ number: '0003', label: 'numbered' })
    expect(isBookProblemStart('006')).toBeNull()
    expect(isBookProblemStart('006', '두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오.')).toEqual({
      number: '0006',
      label: 'numbered',
    })
    expect(
      splitBookProblems(
        ['# 006', '두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오.', '① 3', '② 4', '③ 5', '④ 6', '⑤ 7', '# 007', '다음 값을 고르시오.', '① 1', '② 2', '③ 3', '④ 4', '⑤ 5'].join(
          '\n',
        ),
      ).map((row) => row.number),
    ).toEqual(['0006', '0007'])
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
          markdown: `예제 1 두 점 A(1, 2), B(4, 6) 사이의 거리를 구하십시오.\n① 3\n② 4\n③ 5\n④ 6\n⑤ 7`,
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
