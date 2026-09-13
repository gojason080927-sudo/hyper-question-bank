/**
 * STEP 8.34 — locked Mistral embedding + similar-search helpers.
 * Model/dimension are not guesses. See docs/STEP8_34_EMBEDDING_MODEL_LOCK_v1.md.
 */
import { EMBEDDING_USD_CAP, stableHex834 } from './exceptionCleanup834'

export const EMBEDDING_PROVIDER = 'mistral'
export const EMBEDDING_MODEL = 'mistral-embed'
export const EMBEDDING_MODEL_VERSION = 'locked-1024'
export const EMBEDDING_DIMENSIONS = 1024
export const EMBEDDING_TYPE = 'NORMALIZED_TEXT' as const
export const EMBEDDING_ENDPOINT = 'https://api.mistral.ai/v1/embeddings'
export const EMBEDDING_USD_PER_MILLION = 0.1
export const EMBEDDING_BATCH = 16
export { EMBEDDING_USD_CAP }

export type EmbeddingLock = {
  provider: typeof EMBEDDING_PROVIDER
  model: typeof EMBEDDING_MODEL
  model_version: typeof EMBEDDING_MODEL_VERSION
  dimensions: typeof EMBEDDING_DIMENSIONS
  embedding_type: typeof EMBEDDING_TYPE
  endpoint: typeof EMBEDDING_ENDPOINT
  usd_per_million_tokens: typeof EMBEDDING_USD_PER_MILLION
  truncation: false
}

export const EMBEDDING_LOCK: EmbeddingLock = {
  provider: EMBEDDING_PROVIDER,
  model: EMBEDDING_MODEL,
  model_version: EMBEDDING_MODEL_VERSION,
  dimensions: EMBEDDING_DIMENSIONS,
  embedding_type: EMBEDDING_TYPE,
  endpoint: EMBEDDING_ENDPOINT,
  usd_per_million_tokens: EMBEDDING_USD_PER_MILLION,
  truncation: false,
}

export function estimateEmbeddingTokens834(text: string): number {
  const chars = text.replace(/\s+/g, ' ').trim().length
  return Math.max(32, Math.ceil(chars / 2))
}

export function embeddingCacheKey834(text: string): string {
  return stableHex834(`${EMBEDDING_MODEL}\n${EMBEDDING_TYPE}\n${text}`)
}

export function estimateEmbeddingCost834(texts: string[]): {
  unique: number
  tokens: number
  usd: number
  exceeds_cap: boolean
} {
  const unique = [...new Set(texts.filter((row) => row.trim().length > 0))]
  const tokens = unique.reduce((sum, text) => sum + estimateEmbeddingTokens834(text), 0)
  const usd = Number(((tokens / 1_000_000) * EMBEDDING_USD_PER_MILLION).toFixed(6))
  return { unique: unique.length, tokens, usd, exceeds_cap: usd > EMBEDDING_USD_CAP }
}

export function cosineSimilarity834(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export type SimilarHit834 = {
  problem_id: string
  public_code?: string
  similarity: number
  fingerprint?: string
}

export function rankSimilar834(input: {
  query_id: string
  query_fingerprint: string | null
  query_vector: number[]
  candidates: Array<{
    problem_id: string
    public_code?: string
    vector: number[]
    fingerprint?: string | null
    blocked?: boolean
  }>
  k?: number
}): SimilarHit834[] {
  const k = input.k ?? 5
  return input.candidates
    .filter((row) => row.problem_id !== input.query_id)
    .filter((row) => !row.blocked)
    .filter((row) => !input.query_fingerprint || row.fingerprint !== input.query_fingerprint)
    .map((row) => ({
      problem_id: row.problem_id,
      public_code: row.public_code,
      similarity: cosineSimilarity834(input.query_vector, row.vector),
      fingerprint: row.fingerprint ?? undefined,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k)
}

export function assertEmbeddingDimension834(vector: number[]): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`HQB_EMBEDDING_DIM: expected ${EMBEDDING_DIMENSIONS}, got ${vector.length}`)
  }
}

export type MistralEmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

export async function requestMistralEmbeddings834(input: {
  apiKey: string
  texts: string[]
  fetchImpl?: typeof fetch
}): Promise<{ vectors: number[][]; prompt_tokens: number }> {
  if (!input.texts.length) return { vectors: [], prompt_tokens: 0 }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const post = (body: Record<string, unknown>) =>
    fetchImpl(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  let response = await post({ model: EMBEDDING_MODEL, input: input.texts })
  if (response.status === 422) {
    response = await post({ model: EMBEDDING_MODEL, inputs: input.texts })
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200)
    throw new Error(`HQB_EMBEDDING_HTTP: ${response.status} ${body}`)
  }
  const json = (await response.json()) as MistralEmbeddingResponse
  const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const vectors = rows.map((row) => {
    const vector = row.embedding ?? []
    assertEmbeddingDimension834(vector)
    return vector
  })
  if (vectors.length !== input.texts.length) {
    throw new Error(`HQB_EMBEDDING_COUNT: expected ${input.texts.length}, got ${vectors.length}`)
  }
  return {
    vectors,
    prompt_tokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0,
  }
}

export function chunkTexts834<T>(rows: T[], size = EMBEDDING_BATCH): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}
