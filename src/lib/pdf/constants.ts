export const SOURCE_BUCKET = 'question-bank-sources'
export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const SIGNED_URL_TTL_SEC = 300
export const MEANINGFUL_TEXT_CHARS = 40
export const EXTRACT_TEXT_LIMIT = 20000

export const PDF_TYPES = ['TEXT_PDF', 'SCAN_PDF', 'MIXED', 'UNKNOWN'] as const
export type PdfType = (typeof PDF_TYPES)[number]

export const OCR_STATUSES = [
  'NOT_NEEDED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REVIEW_REQUIRED',
] as const
export type OcrStatus = (typeof OCR_STATUSES)[number]
