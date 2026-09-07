export const RECOGNITION_ENGINE_EMBEDDED = 'hqb-embedded-text-v1'
export const RECOGNITION_ENGINE_SCAN_UNAVAILABLE = 'hqb-scan-unavailable-v1'
export const RECOGNITION_ENGINE_SCAN_OCR = 'hqb-tesseractjs-v1'
export const RECOGNITION_ENGINE_VERSION = '0.1.0'
export const RECOGNITION_ENGINE_SCAN_OCR_VERSION = '0.7.0'
export const RECOGNITION_RENDER_SCALE = 2.5
/** Page TEXT vs SCAN still uses 40 chars. A short region equation is still embedded text. */
export const REGION_TEXT_MIN_CHARS = 3

export const COMPONENT_STATUSES = [
  'TEXT_OK',
  'TEXT_THIN',
  'MATH_OK',
  'MATH_REVIEW_REQUIRED',
  'CHOICES_OK',
  'CHOICES_REVIEW_REQUIRED',
  'FIGURE_DETECTED',
  'TABLE_DETECTED',
  'NUMBER_OK',
  'NUMBER_REVIEW_REQUIRED',
  'LOW_CONFIDENCE',
  'OCR_UNAVAILABLE',
] as const
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number]

export type ProcessingMode = 'EMBEDDED_TEXT' | 'SCAN_NO_ENGINE' | 'MIXED_EMBEDDED' | 'SCAN_OCR'
export type RecognitionStatus = 'SUCCEEDED' | 'REVIEW_REQUIRED' | 'FAILED'
export type RecognitionVerdict = 'GREEN' | 'YELLOW' | 'RED'

export type MathExpressionDraft = {
  original: string
  latex_candidate: string | null
  structure_ok: boolean
  notes: string[]
}

export type ChoiceDraft = {
  order: number
  label: string
  text: string
}

export type RecognitionPayload = {
  problem_number: string | null
  stem_text: string
  math_expressions: MathExpressionDraft[]
  choices: ChoiceDraft[]
  answer_candidate: string | null
  has_figure: boolean
  has_table: boolean
  confidence: null
  component_status: ComponentStatus[]
  warnings: string[]
  raw_text: string
}

export type RecognitionOutput = {
  engine: string
  engine_version: string
  processing_mode: ProcessingMode
  status: RecognitionStatus
  verdict: RecognitionVerdict
  payload: RecognitionPayload
}

export type PositionedTextItem = {
  str: string
  x: number
  y: number
  width?: number
  height?: number
  fontSize?: number
}

export type AutoRegionCandidate = {
  problem_number: string
  bbox: { x: number; y: number; width: number; height: number; unit: 'normalized'; origin: 'top-left' }
  preview: string
  needs_review: boolean
}
