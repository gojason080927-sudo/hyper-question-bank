import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { runSsenLayoutCache827 } from './ssenLayoutCache827Run'
import { STEP827_DOCUMENT, STEP827_SSEN_FILE_HASH } from './cacheSegment827'

describe('STEP 8.27 SSEN OCR cache runner', () => {
  it('verifies the Production original when present and stops before paid OCR without MISTRAL_API_KEY', async () => {
    const argv = existsSync('/tmp/hqb-ssen-ocr/original.pdf')
      ? ['--pdf=/tmp/hqb-ssen-ocr/original.pdf', '--cache-only']
      : ['--cache-only']
    const result = await runSsenLayoutCache827(process.cwd(), argv)
    expect(result.step).toBe('8.27')
    expect(result.next_step_started).toBe(false)
    expect(result.student_care_accessed).toBe(false)
    expect(result.target_ref).toBe('owpxsmdcxjmsgadkdsci')
    expect(result.textbook.id).toBe(STEP827_DOCUMENT)
    expect(result.paid_api_calls).toEqual({ mistral: 0, mathpix: 0, retries: 0 })
    expect(result.provider.mathpix_called).toBe(false)
    expect(result.usd_spent).toBe(0)
    expect(result.original.substituted).toBe(false)
    expect(result.original.committed_to_git).toBe(false)
    if (argv[0]?.startsWith('--pdf=')) {
      expect(result.original.sha256).toBe(STEP827_SSEN_FILE_HASH)
      expect(result.original.page_count).toBe(192)
      expect(result.original.match).toBe(true)
      expect(result.status).toBe('BLOCKED_MISTRAL_KEY_MISSING')
      expect(result.user_action).toMatch(/MISTRAL_API_KEY/)
      expect(result.user_action).not.toMatch(/VITE_MISTRAL/)
    } else {
      expect(['BLOCKED_ORIGINAL_MISMATCH', 'BLOCKED_MISTRAL_KEY_MISSING']).toContain(result.status)
    }
  })

  it('does not call Mistral when paid flags are absent even if a key exists later', async () => {
    const result = await runSsenLayoutCache827(process.cwd(), ['--cache-only'])
    expect(result.paid_api_calls.mistral).toBe(0)
    expect(result.paid_api_calls.mathpix).toBe(0)
  })
})
