import { describe, expect, it } from 'vitest'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { MATH2_DOCUMENT_ID } from './math2Ocr'
import {
  assertMath2SegmentSource,
  extractMath2SectionLabel,
  isPlausibleMath2ProblemNumber,
  refusePersist,
  verdictForCandidate,
} from './math2Segment'

describe('math2 segment dry-run', () => {
  it('locks math2 and refuses SSEN or persist flags', () => {
    expect(() => assertMath2SegmentSource(SSEN_SOURCE_DOCUMENT_ID)).toThrow(/FORBIDDEN/)
    expect(() => assertMath2SegmentSource(MATH2_DOCUMENT_ID)).not.toThrow()
    expect(() => refusePersist(['--persist-problems'])).toThrow(/NO_PERSIST/)
    expect(() => refusePersist(['--cache-only'])).not.toThrow()
  })

  it('treats 부설 headings as 유형 only in heading context', () => {
    expect(extractMath2SectionLabel('# 부설 10')).toBe('유형 10')
    expect(extractMath2SectionLabel('유형 01 두 점 사이의 거리')).toBe('유형 01')
    expect(extractMath2SectionLabel('0007 부설물을 구하시오')).toBe(null)
  })

  it('rejects cover ratio numbers and keeps workbook numbers', () => {
    expect(isPlausibleMath2ProblemNumber('1500', '1500 : 1, 1000 : 1의 경쟁률', 1)).toBe(false)
    expect(isPlausibleMath2ProblemNumber('0016', '0016 대로 문제', 10)).toBe(true)
    expect(isPlausibleMath2ProblemNumber('0001', '0001 A(1), B(6)', 9)).toBe(true)
  })

  it('does not inflate AUTO_SAFE', () => {
    expect(
      verdictForCandidate({
        page_kind: 'PROBLEM',
        plausible: true,
        unique: true,
        flow_ok: true,
        segment_status: 'AUTO_OK',
        stem: '두 점 A(3, 3), B(a+1, -2) 사이의 거리가 5일 때 a의 값은?',
        choice_count: 5,
        incomplete: false,
        stitched: false,
      }).verdict,
    ).toBe('AUTO_SAFE')
    expect(
      verdictForCandidate({
        page_kind: 'PROBLEM',
        plausible: true,
        unique: true,
        flow_ok: true,
        segment_status: 'AUTO_OK',
        stem: '오른쪽 그림과 같이 원점 O와 점 B(5, -1)을 꼭짓점으로 하는 정사각형의 넓이를 구하시오',
        choice_count: 2,
        incomplete: true,
        stitched: true,
        page_tail: true,
      }).verdict,
    ).toBe('NEEDS_REVIEW')
    expect(
      verdictForCandidate({
        page_kind: 'COVER',
        plausible: false,
        unique: true,
        flow_ok: true,
        segment_status: 'REVIEW',
        stem: '1500 : 1',
        choice_count: 0,
        incomplete: false,
        stitched: false,
      }).verdict,
    ).toBe('BLOCKED')
  })
})
