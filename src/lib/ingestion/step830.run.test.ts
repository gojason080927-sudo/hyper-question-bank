import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep830 } from './step830Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { STEP828_GT_SHA256 } from './structureFromCache828'
import { STEP830_DOCUMENT } from './imageCompare830'

describe('STEP 8.30 runner (cache-only)', () => {
  it('compares the frozen 26 STEP 8.28/8.29 items without Production or paid OCR', async () => {
    const result = await runStep830(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.30')
    expect(result.status).toBe('CACHE_ONLY_COMPARED')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.textbook.id).toBe(STEP830_DOCUMENT)
    expect(result.executed).toBe(true)
    expect(result.execution_count).toBe(1)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_draft_writes).toBe(0)
    expect(result.production_pipeline_writes).toEqual({ runs: 0, items: 0 })
    expect(result.paid_api_calls).toEqual({ mathpix: 0, mistral: 0 })
    expect(result.mistral_credentials === 'PRESENT' || result.mistral_credentials === 'ABSENT').toBe(true)
    expect(result.dry_run.pass).toBe(true)
    expect(result.items).toHaveLength(26)
    expect(result.progress.total).toBe(26)
    expect(result.progress.auto_approved).toBe(0)
    expect(result.progress.human_review).toBe(0)
    expect(result.progress.blocked).toBe(26)
    expect(result.compare.crop_present).toBe(0)
    expect(result.compare.crop_missing).toBe(26)
    expect(result.compare.page_png_present).toBe(6)
    expect(result.compare.page_png_missing).toBe(20)
    expect(result.compare.compared).toBe(0)
    expect(result.compare.auto_approved).toBe(0)
    expect(result.progress_matches_items).toBe(true)
    expect(result.duplicates).toBe(0)
    expect(result.orphans).toBe(0)
    expect(result.wrong_source).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.content_rewrites).toBe(0)
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.results.PASS).toBe(9)
    expect(result.results.REVIEW).toBe(0)
    expect(result.results.BLOCKED).toBe(12)
    expect(result.items.every((row) => row.status === 'BLOCKED')).toBe(true)
    expect(result.items.every((row) => row.reasons.includes('CROP_CACHE_MISSING'))).toBe(true)
    expect(result.items.every((row) => row.image_compare_pass === false)).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-30/summary.json'))).toBe(true)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(STEP828_GT_SHA256)
  })

  it('refuses problem persist and paid OCR flags', async () => {
    await expect(runStep830(process.cwd(), ['--persist'])).rejects.toThrow(/forbids problem persist/)
    await expect(runStep830(process.cwd(), ['--allow-paid-api'])).rejects.toThrow(/forbids paid OCR/)
  })

  it('is idempotent: a second cache-only run still writes zero Production rows', async () => {
    const first = await runStep830(process.cwd(), ['--cache-only'])
    const second = await runStep830(process.cwd(), ['--cache-only'])
    expect(second.production_pipeline_writes).toEqual({ runs: 0, items: 0 })
    expect(second.results).toEqual(first.results)
    expect(second.compare).toEqual(first.compare)
    expect(second.gt_mutated).toBe(false)
  })
})
