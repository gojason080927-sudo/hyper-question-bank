/** Human / DB / PDF.js getPage() page number. Always >= 1. */
export function pdfIndexToPageNumber(pdfIndex: number): number {
  if (!Number.isInteger(pdfIndex) || pdfIndex < 0) {
    throw new Error('PDF index must be a 0-based integer')
  }
  return pdfIndex + 1
}

/** 0-based loop index. Never store this in source_pages.page_number. */
export function pageNumberToPdfIndex(pageNumber: number): number {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error('page_number must be a 1-based integer')
  }
  return pageNumber - 1
}

export function isValidPageNumber(pageNumber: number, pageCount: number): boolean {
  return Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pageCount
}
