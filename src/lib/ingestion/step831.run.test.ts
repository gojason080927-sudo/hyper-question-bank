import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runStep831 } from './step831Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { STEP828_GT_SHA256 } from './structureFromCache828'
import { STEP831_DOCUMENT } from './e2ePilot831'

const cropPath = path.join(process.cwd(), '.ocr-temp/step8-31/crops/S01.png')
const ocrPath = path.join(process.cwd(), '.ocr-temp/step8-31/mistral/S01.json')
const pdfPath = path.join(process.cwd(), '.ocr-temp/ssen-original.pdf')
const canRun = existsSync(cropPath) && existsSync(ocrPath) && existsSync(pdfPath)

describe('STEP 8.31 runner (cache-only recovered crops)', () => {
  it.skipIf(!canRun)(
    'compares all 26 recovered crops without new paid OCR or persist',
    async () => {
      const result = await runStep831(process.cwd(), ['--cache-only'])
      if (!result) throw new Error('missing summary')
      expect(result.step).toBe('8.31')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.textbook.id).toBe(STEP831_DOCUMENT)
    expect(result.tally.compared).toBe(26)
    expect(result.tally.auto_approved).toBe(0)
    expect(result.tally.human_review).toBe(22)
    expect(result.tally.blocked).toBe(4)
    expect(result.tally.crop_present).toBe(26)
    expect(result.paid_api_calls.mistral).toBe(0)
    expect(result.paid_api_calls.mathpix).toBe(0)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_verified_writes).toBe(0)
    expect(result.content_rewrites).toBe(0)
    expect(result.duplicates).toBe(0)
    expect(result.orphans).toBe(0)
    expect(result.wrong_source).toBe(0)
    expect(result.gt_mutated).toBe(false)
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.persist_plan_ok).toBe(true)
    expect(result.items).toHaveLength(26)
    expect(result.items.every((row: { status: string }) => row.status !== 'AUTO_APPROVED')).toBe(true)
    expect(result.items.every((row: { compared: boolean }) => row.compared)).toBe(true)
    const bytes = readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(STEP828_GT_SHA256)
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-31/summary.json'))).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-31/review-queue.json'))).toBe(true)
  },
  30_000,
)

  it('does not persist unless --persist is passed', async () => {
    if (!canRun) return
    const result = await runStep831(process.cwd(), ['--cache-only'])
    if (!result) throw new Error('missing summary')
    expect(result.persist.ran).toBe(false)
    expect(result.production_problem_writes).toBe(0)
  })
})
