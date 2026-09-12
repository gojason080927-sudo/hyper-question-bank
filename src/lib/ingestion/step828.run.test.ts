import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep828 } from './step828Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { STEP828_DOCUMENT, STEP828_GT_SHA256 } from './structureFromCache828'

describe('STEP 8.28 runner (cache-only)', () => {
  it('structures the frozen 26 GT samples without Production or paid OCR', async () => {
    const result = await runStep828(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.28')
    expect(result.status).toBe('CACHE_ONLY_STRUCTURED')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.textbook.id).toBe(STEP828_DOCUMENT)
    expect(result.executed).toBe(true)
    expect(result.execution_count).toBe(1)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_draft_writes).toBe(0)
    expect(result.production_pipeline_writes).toEqual({ runs: 0, items: 0 })
    expect(result.paid_api_calls).toEqual({ mathpix: 0, mistral: 0 })
    expect(result.dry_run.pass).toBe(true)
    expect(result.items).toHaveLength(26)
    expect(result.progress.total).toBe(26)
    expect(result.progress.human_review).toBe(22)
    expect(result.progress.blocked).toBe(4)
    expect(result.progress.auto_approved).toBe(0)
    expect(result.progress_matches_items).toBe(true)
    expect(result.duplicates).toBe(0)
    expect(result.orphans).toBe(0)
    expect(result.wrong_source).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.content_rewrites).toBe(0)
    expect(result.original_pdf.substituted).toBe(false)
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.results.PASS).toBe(7)
    expect(result.results.REVIEW).toBe(0)
    expect(result.results.BLOCKED).toBe(11)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(STEP828_GT_SHA256)
  })

  it('refuses problem persist and paid OCR flags', async () => {
    await expect(runStep828(process.cwd(), ['--persist'])).rejects.toThrow(/forbids problem persist/)
    await expect(runStep828(process.cwd(), ['--allow-paid-api'])).rejects.toThrow(/forbids paid OCR/)
  })

  it('is idempotent: a second cache-only run still writes zero Production rows', async () => {
    const first = await runStep828(process.cwd(), ['--cache-only'])
    const second = await runStep828(process.cwd(), ['--cache-only'])
    expect(second.production_pipeline_writes).toEqual({ runs: 0, items: 0 })
    expect(second.production_draft_writes).toBe(0)
    expect(second.results).toEqual(first.results)
    expect(second.items.map((row) => row.content_fingerprint)).toEqual(
      first.items.map((row) => row.content_fingerprint),
    )
  })
})
