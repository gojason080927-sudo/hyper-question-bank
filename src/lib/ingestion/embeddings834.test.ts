import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_LOCK,
  EMBEDDING_MODEL,
  assertEmbeddingDimension834,
  cosineSimilarity834,
  embeddingCacheKey834,
  estimateEmbeddingCost834,
  rankSimilar834,
  requestMistralEmbeddings834,
} from './embeddings834'

describe('STEP 8.34 embeddings lock and search helpers', () => {
  it('locks mistral-embed at 1024 dimensions without truncation', () => {
    expect(EMBEDDING_LOCK.model).toBe('mistral-embed')
    expect(EMBEDDING_LOCK.dimensions).toBe(1024)
    expect(EMBEDDING_LOCK.truncation).toBe(false)
    expect(EMBEDDING_MODEL).toBe('mistral-embed')
  })

  it('dedups identical text in the cost estimate and stays under the $5 cap for SSEN-scale stems', () => {
    const texts = Array.from({ length: 1200 }, (_, i) => `다음을 계산하시오. $(x+${i % 3})^2$`)
    const estimate = estimateEmbeddingCost834(texts)
    expect(estimate.unique).toBe(3)
    expect(estimate.exceeds_cap).toBe(false)
    expect(estimate.usd).toBeLessThan(5)
  })

  it('uses the same cache key for identical normalized text', () => {
    expect(embeddingCacheKey834('abc')).toBe(embeddingCacheKey834('abc'))
    expect(embeddingCacheKey834('abc')).not.toBe(embeddingCacheKey834('abd'))
  })

  it('ranks similar vectors and drops self plus exact fingerprint twins', () => {
    const query = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0))
    const close = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 0.9 : i === 1 ? 0.1 : 0))
    const far = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 2 ? 1 : 0))
    const hits = rankSimilar834({
      query_id: 'p1',
      query_fingerprint: 'fp-same',
      query_vector: query,
      k: 3,
      candidates: [
        { problem_id: 'p1', vector: query, fingerprint: 'fp-same' },
        { problem_id: 'p-dup', vector: close, fingerprint: 'fp-same' },
        { problem_id: 'p-blocked', vector: close, fingerprint: 'fp-other', blocked: true },
        { problem_id: 'p-near', vector: close, fingerprint: 'fp-other' },
        { problem_id: 'p-far', vector: far, fingerprint: 'fp-far' },
      ],
    })
    expect(hits.map((row) => row.problem_id)).toEqual(['p-near', 'p-far'])
    expect(hits[0]?.similarity).toBeGreaterThan(hits[1]?.similarity ?? 0)
  })

  it('rejects non-1024 vectors', () => {
    expect(() => assertEmbeddingDimension834([1, 2, 3])).toThrow(/1024/)
  })

  it('posts inputs to the locked Mistral embeddings endpoint', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe('https://api.mistral.ai/v1/embeddings')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('mistral-embed')
      expect(body.inputs).toEqual(['hello'])
      expect(JSON.stringify(init?.headers)).not.toMatch(/sk-|length|prefix/i)
      const embedding = Array.from({ length: 1024 }, () => 0.01)
      return new Response(JSON.stringify({ data: [{ embedding, index: 0 }], usage: { prompt_tokens: 4 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const result = await requestMistralEmbeddings834({ apiKey: 'secret', texts: ['hello'], fetchImpl })
    expect(result.vectors[0]).toHaveLength(1024)
    expect(result.prompt_tokens).toBe(4)
    expect(cosineSimilarity834(result.vectors[0]!, result.vectors[0]!)).toBeCloseTo(1)
  })
})
