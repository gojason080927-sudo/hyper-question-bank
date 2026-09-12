import { describe, expect, it } from 'vitest'
import { runStep827 } from './step827Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { STEP827_DOCUMENT } from './cacheSegment827'

describe('STEP 8.27 runner (cache-only)', () => {
  it('writes blocked dry-run artifacts without Production or paid OCR', async () => {
    const result = await runStep827(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.27')
    expect(result.status).toBe('CACHE_ONLY_BLOCKED')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.textbook.id).toBe(STEP827_DOCUMENT)
    expect(result.executed).toBe(false)
    expect(result.execution_count).toBe(0)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.production_pipeline_writes).toEqual({ runs: 0, items: 0 })
    expect(result.paid_api_calls).toEqual({ mathpix: 0, mistral: 0 })
    expect(result.schema_write.attempted).toBe(false)
    expect(result.schema_write.applied).toBe(false)
    expect(result.schema_probe.present).not.toBe(true)
    expect(result.dry_run.pass).toBe(false)
    expect(result.dry_run.blockers).toEqual(
      expect.arrayContaining([
        'LAYOUT_OCR_CACHE_MISSING',
        'PRODUCTION_SCHEMA_ABSENT_OR_UNCONFIRMED',
      ]),
    )
    expect(result.items).toEqual([])
    expect(result.progress.total).toBe(0)
    expect(result.progress_matches_items).toBe(true)
    expect(result.original_pdf.substituted).toBe(false)
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.results.PASS).toBe(4)
    expect(result.results.REVIEW).toBe(0)
    expect(result.results.BLOCKED).toBe(14)
  })

  it('refuses problem persist and paid OCR flags', async () => {
    await expect(runStep827(process.cwd(), ['--persist'])).rejects.toThrow(/forbids problem persist/)
    await expect(runStep827(process.cwd(), ['--allow-paid-api'])).rejects.toThrow(/forbids paid OCR/)
  })

  it('is idempotent: a second cache-only run still writes zero Production rows', async () => {
    const first = await runStep827(process.cwd(), ['--cache-only'])
    const second = await runStep827(process.cwd(), ['--cache-only'])
    expect(second.production_pipeline_writes).toEqual({ runs: 0, items: 0 })
    expect(second.executed).toBe(false)
    expect(second.results).toEqual(first.results)
  })
})
