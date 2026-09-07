import { MEANINGFUL_TEXT_CHARS, type OcrStatus, type PdfType } from './constants'

export type PageTextSignal = {
  pageNumber: number
  text: string
}

export type ClassifiedPage = {
  pageNumber: number
  textCharCount: number
  pdfTypeHint: 'TEXT_PDF' | 'SCAN_PDF' | 'UNKNOWN'
  extractionStatus: 'EXTRACTED' | 'MANUAL' | 'FAILED'
  ocrStatus: OcrStatus
}

export type PdfClassification = {
  pdfType: PdfType
  ocrStatus: OcrStatus
  extractionStatus: 'EMBEDDED_TEXT' | 'MANUAL' | 'FAILED' | 'NOT_NEEDED'
  pages: ClassifiedPage[]
}

/** Letters, digits, Hangul. A single stray glyph is not enough for TEXT_PDF. */
export function meaningfulCharCount(text: string): number {
  return (text.match(/[0-9A-Za-z\u3131-\uD79D]/g) ?? []).length
}

export function classifyPageSignal(text: string): ClassifiedPage['pdfTypeHint'] {
  const count = meaningfulCharCount(text)
  if (count >= MEANINGFUL_TEXT_CHARS) return 'TEXT_PDF'
  return 'SCAN_PDF'
}

export function classifyPdfPages(pages: PageTextSignal[]): PdfClassification {
  if (pages.length === 0) {
    return {
      pdfType: 'UNKNOWN',
      ocrStatus: 'REVIEW_REQUIRED',
      extractionStatus: 'FAILED',
      pages: [],
    }
  }

  const classified = pages.map((page) => {
    const textCharCount = meaningfulCharCount(page.text)
    const pdfTypeHint = classifyPageSignal(page.text)
    return {
      pageNumber: page.pageNumber,
      textCharCount,
      pdfTypeHint,
      extractionStatus: pdfTypeHint === 'TEXT_PDF' ? 'EXTRACTED' : 'MANUAL',
      ocrStatus: pdfTypeHint === 'SCAN_PDF' ? 'PENDING' : 'NOT_NEEDED',
    } satisfies ClassifiedPage
  })

  const textPages = classified.filter((page) => page.pdfTypeHint === 'TEXT_PDF').length
  const scanPages = classified.length - textPages
  let pdfType: PdfType
  if (textPages === classified.length) pdfType = 'TEXT_PDF'
  else if (scanPages === classified.length) pdfType = 'SCAN_PDF'
  else pdfType = 'MIXED'

  return {
    pdfType,
    ocrStatus: pdfType === 'TEXT_PDF' ? 'NOT_NEEDED' : 'PENDING',
    extractionStatus: pdfType === 'TEXT_PDF' ? 'EMBEDDED_TEXT' : 'MANUAL',
    pages: classified,
  }
}
