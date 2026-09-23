import { describe, expect, it } from 'vitest'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { MATH2_DOCUMENT_ID } from './math2Ocr'
import {
  assertMath2SegmentSource,
  attachSharedPrompts,
  extractMath2SectionLabel,
  extractSharedPrompts,
  isPlausibleMath2ProblemNumber,
  nextPageStartsNewSection,
  pagePreamble,
  refusePersist,
  repairMath2NumberSequence,
  splitMarkdownProblems,
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

  it('splits markdown until the next 4-digit or 유형 heading and keeps the rest of #0020', () => {
    const spans = splitMarkdownProblems(
      [
        '0020 • • ④ • 시술점',
        '오른쪽 그림과 같이 원점',
        '![img-12.jpeg](img-12.jpeg)',
        '으로 움직인다. 최솟값을 구하시오.',
        '유형 02 같은 거리에 있는 점',
        '0021 대표 문제',
        '두 점 A(1, -2)',
      ].join('\n'),
    )
    expect(spans.map((row) => row.number)).toEqual(['0020', '0021'])
    expect(spans[0]?.text).toContain('최솟값을 구하시오')
    expect(spans[0]?.text).not.toContain('유형 02')
  })

  it('attaches [0001~0003] shared prompts only to that range', () => {
    const markdown = '[0001~0003] 다음 두 점 사이의 거리를 구하시오.\n0001 A(1), B(6)\n0002 A(-3), B(5)\n0016 대표 문제'
    const attached = attachSharedPrompts(splitMarkdownProblems(markdown), extractSharedPrompts(markdown))
    expect(attached[0]?.text).toContain('다음 두 점 사이의 거리를 구하시오')
    expect(attached[0]?.text).toContain('A(1), B(6)')
    expect(attached.find((row) => row.number === '0016')?.text).not.toContain('0001~0003')
  })

  it('reads **0439 and repairs 0025/0024/0027 → 0026', () => {
    expect(splitMarkdownProblems('# **0439 대표 문제**\n원 $x^2$')[0]?.number).toBe('0439')
    expect(
      repairMath2NumberSequence([
        { number: '0025', text: 'a' },
        { number: '0024', text: 'b' },
        { number: '0027', text: 'c' },
      ]).map((row) => row.number),
    ).toEqual(['0025', '0026', '0027'])
    expect(
      repairMath2NumberSequence([
        { number: '0696', text: 'a' },
        { number: '0695', text: 'b' },
        { number: '0696', text: 'c' },
      ]).map((row) => row.number),
    ).toEqual(['0694', '0695', '0696'])
  })

  it('does not treat a 유형 heading preamble as a stitch body', () => {
    expect(pagePreamble('유형 08\n개념 05-4\n0556 대표 문제\n두 집합')).toBe('')
    expect(nextPageStartsNewSection('정답 및 풀이 • 4쪽\n# 유형 06\n# 0036 대표 문제')).toBe(true)
    expect(splitMarkdownProblems('곁합사\n마음 갤러리\n173 > 41쪽으로 이어집니다.')).toEqual([])
  })
})
