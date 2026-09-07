import { describe, expect, it } from 'vitest'
import { classifyPageSignal, classifyPdfPages, meaningfulCharCount } from './classifyPdf'

describe('PDF type heuristic', () => {
  it('does not treat a single character as TEXT_PDF', () => {
    expect(meaningfulCharCount('x')).toBe(1)
    expect(classifyPageSignal('x')).toBe('SCAN_PDF')
    expect(classifyPageSignal('   \n')).toBe('SCAN_PDF')
  })

  it('classifies a text-heavy page as TEXT_PDF', () => {
    const text = '1. 2x + 3 = 11. Find x. 2. x + y = 10 and x - y = 2. Keep enough letters for a real text layer.'
    expect(meaningfulCharCount(text)).toBeGreaterThanOrEqual(40)
    expect(classifyPageSignal(text)).toBe('TEXT_PDF')
  })

  it('returns TEXT_PDF, SCAN_PDF, or MIXED at document level', () => {
    const text = 'Solve 2x + 3 = 11 for x and then check x + y = 10 with x - y = 2 on this text page.'
    expect(classifyPdfPages([{ pageNumber: 1, text }, { pageNumber: 2, text }]).pdfType).toBe('TEXT_PDF')
    expect(classifyPdfPages([{ pageNumber: 1, text: '' }, { pageNumber: 2, text: '.' }]).pdfType).toBe('SCAN_PDF')
    expect(classifyPdfPages([{ pageNumber: 1, text }, { pageNumber: 2, text: '' }]).pdfType).toBe('MIXED')
    expect(classifyPdfPages([]).pdfType).toBe('UNKNOWN')
  })
})
