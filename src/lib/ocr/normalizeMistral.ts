import { recognizeFromOcrText } from '../recognition/structure'
import type { RecognitionOutput } from '../recognition/types'
import { mathExpressionsFromProviderLatex } from './normalizeMathpix'
import { MISTRAL_PROVIDER } from './mathOcrTypes'

export type MistralImageLike = {
  id?: string
  top_left_x?: number
  top_left_y?: number
  bottom_right_x?: number
  bottom_right_y?: number
  image_base64?: string
}

export type MistralPageLike = {
  index?: number
  markdown?: string
  images?: MistralImageLike[]
  blocks?: unknown[]
  tables?: unknown
  dimensions?: { dpi?: number; height?: number; width?: number }
}

export type MistralOcrLike = {
  pages?: MistralPageLike[]
  model?: string
  usage_info?: { pages_processed?: number; doc_size_bytes?: number | null }
  detail?: string
  message?: string
  error?: string
}

const LATEX_BLOCK =
  /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|(?<!\$)\$(?!\$)([\s\S]+?)(?<!\$)\$(?!\$)/g

export function extractMistralMarkdown(raw: MistralOcrLike): string {
  return (raw.pages ?? []).map((page) => page.markdown ?? '').filter(Boolean).join('\n\n')
}

export function extractMistralLatex(markdown: string): string[] {
  const found: string[] = []
  for (const match of markdown.matchAll(LATEX_BLOCK)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4])?.trim()
    if (value && !found.includes(value)) found.push(value)
  }
  return found
}

export function mistralLayoutFromRaw(raw: MistralOcrLike): {
  page_count: number
  blocks: unknown[]
  images: Array<{ id?: string; bbox: number[] | null }>
  has_table_html: boolean
  dimensions: MistralPageLike['dimensions'] | null
} {
  const pages = raw.pages ?? []
  const images = pages.flatMap((page) =>
    (page.images ?? []).map((image) => ({
      id: image.id,
      bbox:
        image.top_left_x == null
          ? null
          : [image.top_left_x, image.top_left_y, image.bottom_right_x, image.bottom_right_y].map((n) => n ?? 0),
    })),
  )
  const markdown = extractMistralMarkdown(raw)
  return {
    page_count: pages.length,
    blocks: pages.flatMap((page) => (Array.isArray(page.blocks) ? page.blocks : [])),
    images,
    has_table_html: /<table[\s>]|\n\|.+\|/i.test(markdown),
    dimensions: pages[0]?.dimensions ?? null,
  }
}

export function normalizeMistralToHyper(
  raw: MistralOcrLike,
  options: { hasFigure?: boolean; hasTable?: boolean } = {},
): RecognitionOutput {
  const rawText = extractMistralMarkdown(raw)
  const layout = mistralLayoutFromRaw(raw)
  const structured = recognizeFromOcrText(rawText, {
    engine: MISTRAL_PROVIDER,
    engineVersion: raw.model ?? 'unknown',
    hasFigure: options.hasFigure ?? layout.images.length > 0,
    hasTable: options.hasTable ?? layout.has_table_html,
  })
  const latexBlocks = extractMistralLatex(rawText)
  const math_expressions = latexBlocks.length
    ? mathExpressionsFromProviderLatex(latexBlocks)
    : structured.payload.math_expressions
  return {
    ...structured,
    engine: MISTRAL_PROVIDER,
    engine_version: raw.model ?? structured.engine_version,
    processing_mode: 'SCAN_OCR',
    payload: {
      ...structured.payload,
      math_expressions,
      raw_text: rawText,
      confidence: null,
      warnings: [
        ...structured.payload.warnings,
        'MISTRAL_RAW_PRESERVED: raw markdown/LaTeX were not overwritten by normalization',
        'Ground Truth is for scoring only and was not used to repair expressions',
        raw.error || raw.detail || raw.message ? `provider error: ${raw.error ?? raw.detail ?? raw.message}` : '',
      ].filter(Boolean),
    },
  }
}

export function preserveMistralRawRecord(input: {
  sampleId: string
  rawResponse: unknown
  seconds: number | null
  httpStatus: number | null
  error: string | null
  version?: string | null
}): {
  sample_id: string
  provider: typeof MISTRAL_PROVIDER
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
  const raw = (input.rawResponse ?? {}) as MistralOcrLike
  const markdown = extractMistralMarkdown(raw)
  const latex = extractMistralLatex(markdown)
  return {
    sample_id: input.sampleId,
    provider: MISTRAL_PROVIDER,
    provider_version: raw.model ?? input.version ?? null,
    processing_mode: 'SCAN_OCR',
    http_status: input.httpStatus,
    seconds: input.seconds,
    raw_response: input.rawResponse,
    raw_text: markdown,
    raw_latex: latex[0] ?? null,
    raw_mathml: null,
    warnings: raw.error || raw.detail || raw.message ? [raw.error ?? raw.detail ?? raw.message ?? ''] : [],
    error: input.error,
  }
}
