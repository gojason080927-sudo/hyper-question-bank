import { describe, expect, it } from 'vitest'
import {
  isFixtureSource,
  looksMergedStem,
  majorPageRange,
  parseTypeMarker,
  sectionForPage,
  sectionPageEnd,
  SSEN_SECTIONS,
} from './ssenToc'

describe('ssenToc', () => {
  it('uses printed TOC page starts and 1:1 PDF mapping', () => {
    expect(SSEN_SECTIONS[0]).toMatchObject({ code: '01', title: '다항식의 연산', pdfStart: 8 })
    expect(sectionPageEnd(SSEN_SECTIONS[0])).toBe(23)
    expect(sectionForPage(24)?.code).toBe('02')
    expect(sectionForPage(174)?.code).toBe('10')
    expect(majorPageRange('I')).toEqual({ start: 8, end: 45 })
    expect(majorPageRange('V').start).toBe(174)
  })

  it('detects fixtures, type markers, and merged stems without inventing titles', () => {
    expect(isFixtureSource({ title: 'STEP 8.35 WYSIWYG fixture (do not use in worksheets)' })).toBe(true)
    expect(isFixtureSource({ title: '쎈수학 공통수학1' })).toBe(false)
    expect(parseTypeMarker('유형 06 곱셈 공식의 변형')).toBe('06')
    expect(looksMergedStem('[1054~1057] 다음을 구하시오. 1054 … 1055 …')).toBe(true)
    expect(looksMergedStem('0011 $A+B=x^3$')).toBe(false)
  })
})
