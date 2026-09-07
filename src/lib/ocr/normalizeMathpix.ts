import { recognizeFromOcrText } from '../recognition/structure'
import type { MathExpressionDraft, RecognitionOutput } from '../recognition/types'
import { MATHPIX_PROVIDER } from './mathOcrTypes'

export type MathpixApiLike = {
  text?: string
  latex_styled?: string
  html?: string
  data?: Array<{ type?: string; value?: string }>
  line_data?: Array<{ type?: string; subtype?: string }>
  version?: string
  error?: string
  confidence?: number
  confidence_rate?: number
}

const LATEX_BLOCK =
  /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|(?<!\$)\$(?!\$)([\s\S]+?)(?<!\$)\$(?!\$)/g

export function extractProviderLatex(raw: MathpixApiLike): string[] {
  const found: string[] = []
  const push = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (trimmed && !found.includes(trimmed)) found.push(trimmed)
  }
  push(raw.latex_styled)
  for (const row of raw.data ?? []) {
    if (row.type === 'latex' || row.type === 'mathml') push(row.value)
  }
  const text = raw.text ?? ''
  for (const match of text.matchAll(LATEX_BLOCK)) {
    push(match[1] ?? match[2] ?? match[3] ?? match[4])
  }
  return found
}

function looksLikeFigure(raw: MathpixApiLike): boolean {
  return (raw.line_data ?? []).some((row) => /diagram|chart|figure/i.test(`${row.type ?? ''} ${row.subtype ?? ''}`))
}

function looksLikeTable(raw: MathpixApiLike): boolean {
  return (raw.line_data ?? []).some((row) => /table/i.test(row.type ?? ''))
}

export function mathExpressionsFromProviderLatex(latexBlocks: string[]): MathExpressionDraft[] {
  return latexBlocks.map((latex) => ({
    original: latex,
    latex_candidate: latex,
    structure_ok: /\\frac|\\sqrt|\^|\\le|\\ge|\\neq|\\left\s*\|/.test(latex),
    notes: [
      'Provider LaTeX preserved as-is',
      'Not rewritten to match Ground Truth',
      'Stacked fractions were not flattened to 1/2',
    ],
  }))
}

export function normalizeMathpixToHyper(
  raw: MathpixApiLike,
  options: { hasFigure?: boolean; hasTable?: boolean } = {},
): RecognitionOutput {
  const rawText = raw.text ?? ''
  const structured = recognizeFromOcrText(rawText, {
    engine: MATHPIX_PROVIDER,
    engineVersion: raw.version ?? 'unknown',
    hasFigure: options.hasFigure ?? looksLikeFigure(raw),
    hasTable: options.hasTable ?? looksLikeTable(raw),
  })
  const latexBlocks = extractProviderLatex(raw)
  const math_expressions = latexBlocks.length
    ? mathExpressionsFromProviderLatex(latexBlocks)
    : structured.payload.math_expressions
  return {
    ...structured,
    engine: MATHPIX_PROVIDER,
    engine_version: raw.version ?? structured.engine_version,
    processing_mode: 'SCAN_OCR',
    payload: {
      ...structured.payload,
      math_expressions,
      raw_text: rawText,
      confidence: null,
      warnings: [
        ...structured.payload.warnings,
        'MATHPIX_RAW_PRESERVED: raw API text/LaTeX were not overwritten by normalization',
        'Ground Truth is for scoring only and was not used to repair expressions',
        raw.error ? `provider error: ${raw.error}` : '',
      ].filter(Boolean),
    },
  }
}

export function preserveRawRecord(input: {
  sampleId: string
  rawResponse: unknown
  seconds: number | null
  httpStatus: number | null
  error: string | null
  version?: string | null
}): {
  sample_id: string
  provider: typeof MATHPIX_PROVIDER
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
} {
  const raw = (input.rawResponse ?? {}) as MathpixApiLike
  const data = raw.data ?? []
  return {
    sample_id: input.sampleId,
    provider: MATHPIX_PROVIDER,
    provider_version: raw.version ?? input.version ?? null,
    processing_mode: 'SCAN_OCR',
    http_status: input.httpStatus,
    seconds: input.seconds,
    raw_response: input.rawResponse,
    raw_text: raw.text ?? '',
    raw_latex: raw.latex_styled ?? data.find((row) => row.type === 'latex')?.value ?? null,
    raw_mathml: data.find((row) => row.type === 'mathml')?.value ?? null,
    warnings: raw.error ? [raw.error] : [],
    error: input.error,
  }
}
