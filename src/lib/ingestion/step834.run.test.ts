import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep834 } from './step834Run'
import { FROZEN_834, GT_JSON_SHA256_834, STEP834_DOCUMENT } from './exceptionCleanup834'
import { EMBEDDING_LOCK } from './embeddings834'

describe('STEP 8.34 runner (cache-only)', () => {
  it('cleans residual exceptions without Production writes, paid OCR, or VERIFIED', async () => {
    const result = await runStep834(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.34')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.textbook.id).toBe(STEP834_DOCUMENT)
    expect(result.inspected_residuals).toBeGreaterThan(0)
    expect(result.production_verified_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.content_rewrites).toBe(0)
    expect(result.paid_api_calls.mathpix).toBe(0)
    expect(result.paid_api_calls.mistral_ocr).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.frozen).toEqual(FROZEN_834)
    expect(result.embeddings.model).toBe(EMBEDDING_LOCK.model)
    expect(result.embeddings.dimensions).toBe(1024)
    expect(result.pipeline?.dry_run).toBe(true)
    expect(result.pipeline?.production_writes).toBe(0)
    expect(result.pipeline?.extra_writes_on_rerun).toBe(0)
    expect(result.items.every((row) => row.verdict !== 'VERIFIED')).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-34/summary.json'))).toBe(true)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GT_JSON_SHA256_834)
  }, 90_000)

  it('is idempotent in cache-only mode', async () => {
    const first = await runStep834(process.cwd(), ['--cache-only'])
    const second = await runStep834(process.cwd(), ['--cache-only'])
    expect(second.production_problem_writes).toBe(0)
    expect(second.auto_resolved).toBe(first.auto_resolved)
    expect(second.human_review_remaining).toBe(first.human_review_remaining)
  }, 90_000)
})
