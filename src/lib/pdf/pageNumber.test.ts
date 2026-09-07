import { describe, expect, it } from 'vitest'
import { isValidPageNumber, pageNumberToPdfIndex, pdfIndexToPageNumber } from './pageNumber'

describe('page numbering', () => {
  it('uses 1-based page_number and 0-based pdf_index', () => {
    expect(pdfIndexToPageNumber(0)).toBe(1)
    expect(pdfIndexToPageNumber(1)).toBe(2)
    expect(pageNumberToPdfIndex(1)).toBe(0)
    expect(pageNumberToPdfIndex(2)).toBe(1)
  })

  it('rejects invalid values', () => {
    expect(() => pdfIndexToPageNumber(-1)).toThrow()
    expect(() => pageNumberToPdfIndex(0)).toThrow()
    expect(isValidPageNumber(1, 2)).toBe(true)
    expect(isValidPageNumber(0, 2)).toBe(false)
    expect(isValidPageNumber(3, 2)).toBe(false)
  })
})
