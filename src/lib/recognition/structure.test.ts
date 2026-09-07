import { describe, expect, it } from 'vitest'
import { extractChoices, extractProblemNumber, recognizeFromText, scanUnavailable } from './structure'

describe('problem number vs choices', () => {
  it('splits 1. and 문제 1 and ignores ① as a problem number', () => {
    expect(extractProblemNumber('1. 2x + 3 = 11일 때 x를 구하여라.').number).toBe('1')
    expect(extractProblemNumber('01. Find x.').number).toBe('01')
    expect(extractProblemNumber('[1] Find x.').number).toBe('1')
    expect(extractProblemNumber('문제 2 다음을 풀어라.').number).toBe('2')
    expect(extractProblemNumber('① 2').number).toBeNull()
  })
})

describe('choice order', () => {
  it('keeps ①-⑤ order and warns when a choice is missing', () => {
    const ok = extractChoices(['① 2', '② 4', '③ 6', '④ 8', '⑤ 10'])
    expect(ok.choices.map((row) => row.label)).toEqual(['①', '②', '③', '④', '⑤'])
    expect(ok.warning).toBeUndefined()
    const missing = extractChoices(['① 2', '③ 6', '⑤ 10'])
    expect(missing.warning).toMatch(/CHOICES_REVIEW_REQUIRED/)
  })
})

describe('math structure honesty', () => {
  it('does not treat x2 as x^{2}', () => {
    const result = recognizeFromText('4. x2 - 5x + 6 = 0')
    expect(result.payload.component_status).toContain('MATH_REVIEW_REQUIRED')
    expect(result.payload.math_expressions.some((row) => row.latex_candidate?.includes('^{2}'))).toBe(false)
    expect(result.verdict).toBe('RED')
  })

  it('keeps typographic superscripts and flags ASCII caret', () => {
    const ok = recognizeFromText('4. x² - 5x + 6 = 0')
    expect(ok.payload.math_expressions.some((row) => row.original.includes('x²'))).toBe(true)
    const ascii = recognizeFromText('4. x^2 - 5x + 6 = 0')
    expect(ascii.payload.component_status).toContain('MATH_REVIEW_REQUIRED')
    expect(ascii.verdict).toBe('YELLOW')
  })
})

describe('answers are not solved', () => {
  it('copies an explicit answer line only', () => {
    const withLine = recognizeFromText('1. 2x + 3 = 11. Find x.\n정답: 4')
    expect(withLine.payload.answer_candidate).toBe('4')
    const noLine = recognizeFromText('1. 2x + 3 = 11. Find x.')
    expect(noLine.payload.answer_candidate).toBeNull()
  })
})

describe('scan path', () => {
  it('does not invent text when the layer is empty', () => {
    const result = scanUnavailable('')
    expect(result.engine).toBe('hqb-scan-unavailable-v1')
    expect(result.payload.stem_text).toBe('')
    expect(result.payload.component_status).toContain('OCR_UNAVAILABLE')
    expect(result.verdict).toBe('RED')
  })
})
