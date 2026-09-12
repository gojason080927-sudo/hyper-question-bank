import { describe, expect, it } from 'vitest'
import { runStep826 } from './step826Run'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'

describe('STEP 8.26 runner (cache-only)', () => {
  it('writes schema-only artifacts without Production problem/figure writes or paid OCR', async () => {
    const result = await runStep826(process.cwd(), ['--cache-only'])
    expect(result.step).toBe('8.26')
    expect(result.status).toBe('SCHEMA_ONLY')
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.student_care_accessed).toBe(false)
    expect(result.textbook_run).toBe(false)
    expect(result.next_step_started).toBe(false)
    expect(result.production_problem_writes).toBe(0)
    expect(result.production_figure_writes).toBe(0)
    expect(result.paid_api_calls).toEqual({ mathpix: 0, mistral: 0 })
    expect(result.schema_write.attempted).toBe(false)
    expect(result.migration_additive.ok).toBe(true)
    expect(result.original_pdf.substituted).toBe(false)
    expect(result.original_pdf.expected_sha256).toBe(
      '3b4e789ea8165f0473975d70de8d40658a391b65d21607997b77b468f124a5e9',
    )
    expect(result.frozen).toEqual(FROZEN_PIPELINE_COUNTS)
    expect(result.results.PASS).toBe(3)
    expect(result.results.REVIEW).toBe(0)
    expect(result.results.BLOCKED).toBe(11)
  })

  it('refuses problem persist and paid OCR flags', async () => {
    await expect(runStep826(process.cwd(), ['--persist'])).rejects.toThrow(/forbids problem persist/)
    await expect(runStep826(process.cwd(), ['--allow-paid-api'])).rejects.toThrow(/forbids paid OCR/)
  })
})
