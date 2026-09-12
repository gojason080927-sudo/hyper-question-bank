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

export type MistralPixelBlock = {
  type?: string
  content?: string
  id?: string
  image_id?: string
  table_id?: string
  top_left_x: number
  top_left_y: number
  bottom_right_x: number
  bottom_right_y: number
  confidence?: number
}

function asFinite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Official OCR 4.1 blocks use top_left_x/y + bottom_right_x/y.
 * Some SDK samples expose x/y/width/height. Convert to the pixel-corner
 * shape required by layoutSegment.hasPixelBox.
 */
export function coerceMistralBlock(raw: unknown): MistralPixelBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const type = typeof row.type === 'string' ? row.type : undefined
  const content = typeof row.content === 'string' ? row.content : typeof row.text === 'string' ? row.text : ''
  const id = typeof row.id === 'string' ? row.id : undefined
  const image_id = typeof row.image_id === 'string' ? row.image_id : undefined
  const table_id = typeof row.table_id === 'string' ? row.table_id : undefined
  const confidence =
    typeof row.confidence === 'number'
      ? row.confidence
      : asFinite((row.confidence_scores as { average_content_confidence_score?: unknown } | undefined)?.average_content_confidence_score) ??
        undefined

  let left = asFinite(row.top_left_x)
  let top = asFinite(row.top_left_y)
  let right = asFinite(row.bottom_right_x)
  let bottom = asFinite(row.bottom_right_y)
  if (left == null || top == null || right == null || bottom == null) {
    const x = asFinite(row.x)
    const y = asFinite(row.y)
    const width = asFinite(row.width)
    const height = asFinite(row.height)
    if (x == null || y == null || width == null || height == null) return null
    left = x
    top = y
    right = x + width
    bottom = y + height
  }
  if (right < left || bottom < top) return null
  return {
    type,
    content,
    id,
    image_id,
    table_id,
    top_left_x: left,
    top_left_y: top,
    bottom_right_x: right,
    bottom_right_y: bottom,
    confidence,
  }
}

export function mistralLayoutFromRaw(raw: MistralOcrLike): {
  page_count: number
  blocks: MistralPixelBlock[]
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
    blocks: pages.flatMap((page) => (Array.isArray(page.blocks) ? page.blocks : [])).flatMap((block) => {
      const coerced = coerceMistralBlock(block)
      return coerced ? [coerced] : []
    }),
    images,
    has_table_html: /<table[\s>]|\n\|.+\|/i.test(markdown) || pages.some((page) => Array.isArray(page.tables) && page.tables.length > 0),
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
