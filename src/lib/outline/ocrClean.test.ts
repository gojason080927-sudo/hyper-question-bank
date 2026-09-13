import { describe, expect, it } from 'vitest'
import { cleanOcrStem, normalizeDupText, problemNumberSortKey } from './ocrClean'
import { SSEN_TYPES } from './ssenToc'

describe('ocrClean', () => {
  it('strips repeated numbers, type headers, bullets, and OCR typos with evidence', () => {
    const result = cleanOcrStem('0011 0011 유형 01 다항식\n다음을 구하시오. • 시술항')
    expect(result.changed).toBe(true)
    expect(result.rules).toEqual(expect.arrayContaining(['repeated_number', 'type_header', 'bullet_mark', 'ocr_시술항']))
    expect(result.cleaned).toContain('서술형')
    expect(result.cleaned).not.toContain('유형 01')
  })

  it('leaves a clean stem unchanged', () => {
    const result = cleanOcrStem('0011 $A+B=x^3$ 일 때 다음을 구하시오.')
    expect(result.changed).toBe(false)
  })

  it('normalizes duplicate text and sorts problem numbers numerically', () => {
    expect(normalizeDupText('0011  •  Hello')).toBe('0011 hello')
    expect(problemNumberSortKey('0011')).toBe(11)
    expect(problemNumberSortKey('a')).toBe(999999)
  })

  it('keeps printed type titles from PDF index pages', () => {
    expect(SSEN_TYPES.find((row) => row.sectionCode === '01' && row.typeCode === '01')?.title).toBe('다항식의 덧셈과 뺄셈')
    expect(SSEN_TYPES.some((row) => row.sectionCode === '10' && row.evidencePage === 173)).toBe(true)
  })
})
