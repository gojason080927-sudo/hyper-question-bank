import type { RecognitionOutput } from '../recognition/types'

export const MATHPIX_PROVIDER = 'mathpix-v3-text'
export const MATHPIX_ENDPOINT = 'https://api.mathpix.com/v3/text'
export const WINDOWS_OCR_BASELINE_ENGINE = 'windows-media-ocr-ko'

export const PAID_CALL_DENIED = 'HQB_PAID_CALL_DENIED'
export const MATHPIX_NOT_CONFIGURED = 'HQB_MATHPIX_NOT_CONFIGURED'

export type MathOcrProviderName = 'windows-media-ocr-ko' | 'mathpix-v3-text' | 'tesseractjs-kor-eng'

export type MathOcrRecognizeInput = {
  sampleId: string
  imageBytes: Uint8Array
  mimeType?: 'image/png' | 'image/jpeg'
  hasFigure?: boolean
  hasTable?: boolean
}

export type MathOcrRawRecord = {
  sample_id: string
  provider: MathOcrProviderName
  provider_version: string | null
  processing_mode: 'SCAN_OCR'
  http_status: number | null
  seconds: number | null
  raw_response: unknown
  raw_text: string
  raw_latex: string | null
  raw_mathml: string | null
  warnings: string[]
  error: string | null
}

export type MathOcrRecognizeResult = {
  raw: MathOcrRawRecord
  normalized: RecognitionOutput
}

export type PaidCallGate = {
  allowPaidApi: boolean
  confirmCost: boolean
}

export type MathOcrProvider = {
  providerName: MathOcrProviderName
  providerVersion: string
  processingMode: 'SCAN_OCR'
  recognizeCrop(input: MathOcrRecognizeInput, gate: PaidCallGate): Promise<MathOcrRecognizeResult>
}
