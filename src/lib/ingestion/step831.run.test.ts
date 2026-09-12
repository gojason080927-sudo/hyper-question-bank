import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep831 } from './step831Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { STEP828_GT_SHA256 } from './structureFromCache828'
import { STEP831_DOCUMENT } from './confidenceGate831'

describe('STEP 8.31 runner (cache-only)', () => {
  it('gates the frozen 26 items without Production problem writes or paid OCR', async () => {
    const result = await runStep831(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.31')
    expect(result.status === 'CACHE_ONLY_GATED' || result.status === 'CACHE_ONLY_BLOCKED').toBe(true)
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.textbook.id).toBe(STEP831_DOCUMENT)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_verified_writes).toBe(0)
    expect(result.production_draft_writes).toBe(0)
    expect(result.paid_api_calls.mathpix).toBe(0)
    expect(result.paid_api_calls.mistral).toBe(0)
    expect(result.mistral_credentials === 'PRESENT' || result.mistral_credentials === 'ABSENT').toBe(true)
    expect(result.dry_run.pass).toBe(true)
    expect(result.items).toHaveLength(26)
    expect(result.progress.total).toBe(26)
    expect(result.progress.auto_approved).toBe(0)
    expect(result.tally.auto_approved).toBe(0)
    expect(result.tally.create_draft).toBe(0)
    expect(result.items.every((row) => row.status !== 'AUTO_APPROVED')).toBe(true)
    expect(result.items.every((row) => row.section_d_all_met === false)).toBe(true)
    expect(result.items.every((row) => row.image_compare_pass === false)).toBe(true)
    expect(result.progress_matches_items).toBe(true)
    expect(result.duplicates).toBe(0)
    expect(result.orphans).toBe(0)
    expect(result.wrong_source).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.content_rewrites).toBe(0)
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.results.REVIEW).toBe(0)
    if (result.tally.crop_present === 26) {
      expect(result.progress.human_review).toBe(22)
      expect(result.progress.blocked).toBe(4)
      expect(result.tally.frozen_hash_match).toBe(0)
      const blocked = result.items.filter((row) => row.status === 'BLOCKED').map((row) => row.candidate_id)
      expect(blocked.sort()).toEqual(['S02', 'S03', 'S16', 'S24'])
      expect(result.items.filter((row) => row.persist_action === 'SKIP_IDENTITY').map((row) => row.candidate_id).sort()).toEqual(
        ['S01', 'S22', 'S23'],
      )
    } else {
      expect(result.progress.blocked).toBe(26)
      expect(result.progress.human_review).toBe(0)
    }
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-31/summary.json'))).toBe(true)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(STEP828_GT_SHA256)
  }, 120_000)

  it('refuses paid OCR flags', async () => {
    await expect(runStep831(process.cwd(), ['--allow-paid-api'])).rejects.toThrow(/forbids paid OCR/)
  })

  it('is idempotent: a second cache-only run still writes zero Production problem rows', async () => {
    const first = await runStep831(process.cwd(), ['--cache-only'])
    const second = await runStep831(process.cwd(), ['--cache-only'])
    expect(second.production_problem_writes).toBe(0)
    expect(second.production_draft_writes).toBe(0)
    expect(second.paid_api_calls).toEqual(first.paid_api_calls)
    expect(second.tally.auto_approved).toBe(0)
    expect(second.gt_mutated).toBe(false)
    expect(second.items.map((row) => row.content_fingerprint)).toEqual(
      first.items.map((row) => row.content_fingerprint),
    )
  }, 120_000)
})
