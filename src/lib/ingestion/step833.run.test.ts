import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep833 } from './step833Run'
import { FROZEN_833, GT_JSON_SHA256_833, STEP833_DOCUMENT } from './autoQa833'

describe('STEP 8.33 runner (cache-only)', () => {
  it('QAs the STEP 8.32 SSEN corpus without Production writes or paid OCR', async () => {
    const result = await runStep833(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.33')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.textbook.id).toBe(STEP833_DOCUMENT)
    expect(result.inspected).toBe(1256)
    expect(result.production_verified_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_draft_writes).toBe(0)
    expect(result.paid_api_calls.mathpix).toBe(0)
    expect(result.paid_api_calls.mistral).toBe(0)
    expect(result.estimated_usd).toBe(0)
    expect(result.content_rewrites).toBe(0)
    expect(result.embeddings_available).toBe(false)
    expect(result.embeddings_written).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.frozen).toEqual(FROZEN_833)
    expect(result.auto_cleared).toBeGreaterThan(800)
    expect(result.human_review_remaining).toBeLessThan(400)
    expect(result.items.every((row) => row.pipeline_status !== 'VERIFIED')).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-33/summary.json'))).toBe(true)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GT_JSON_SHA256_833)
  }, 60_000)

  it('refuses paid OCR flags', async () => {
    await expect(runStep833(process.cwd(), ['--allow-paid-api'])).rejects.toThrow(/forbids paid OCR/)
  })

  it('is idempotent: a second cache-only run still writes zero Production problem rows', async () => {
    const first = await runStep833(process.cwd(), ['--cache-only'])
    const second = await runStep833(process.cwd(), ['--cache-only'])
    expect(second.production_problem_writes).toBe(0)
    expect(second.paid_api_calls).toEqual(first.paid_api_calls)
    expect(second.auto_cleared).toBe(first.auto_cleared)
    expect(second.human_review_remaining).toBe(first.human_review_remaining)
    expect(second.items.map((row) => row.verdict)).toEqual(first.items.map((row) => row.verdict))
  }, 60_000)
})
