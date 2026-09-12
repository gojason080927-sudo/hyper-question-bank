import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep832 } from './step832Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { STEP832_DOCUMENT } from './fullBookIngest832'
import { STEP828_GT_SHA256 } from './structureFromCache828'

describe('STEP 8.32 runner (cache-only)', () => {
  it('plans the 192-page SSEN ingest without Production writes or paid OCR', async () => {
    const result = await runStep832(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.32')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.textbook.id).toBe(STEP832_DOCUMENT)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_verified_writes).toBe(0)
    expect(result.paid_api_calls.mathpix).toBe(0)
    expect(result.paid_api_calls.mistral).toBe(0)
    expect(result.tally.auto_approved).toBe(0)
    expect(result.mistral_credentials === 'PRESENT' || result.mistral_credentials === 'ABSENT').toBe(true)
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.content_rewrites).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.items.every((row) => row.status !== 'AUTO_APPROVED' && row.status !== 'VERIFIED')).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-32/summary.json'))).toBe(true)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(STEP828_GT_SHA256)
  }, 60_000)

  it('is idempotent: a second cache-only run still writes zero Production problem rows', async () => {
    const first = await runStep832(process.cwd(), ['--cache-only'])
    const second = await runStep832(process.cwd(), ['--cache-only'])
    expect(second.production_problem_writes).toBe(0)
    expect(second.paid_api_calls.mistral).toBe(0)
    expect(second.tally.auto_approved).toBe(0)
    expect(second.gt_mutated).toBe(false)
    expect(first.textbook.id).toBe(second.textbook.id)
  }, 60_000)
})
