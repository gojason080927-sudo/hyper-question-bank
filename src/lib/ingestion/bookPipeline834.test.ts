import { describe, expect, it } from 'vitest'
import {
  BOOK_PIPELINE_STAGES,
  SSEN_BOOK_INPUT,
  dryRunWrites834,
  mapLogicalStageToFrozen834,
  nextStage834,
  parseBookPipelineFlags834,
  resumePages834,
  validateBookInput834,
  type BookCheckpoint834,
} from './bookPipeline834'

const emptyCheckpoint = (): BookCheckpoint834 => ({
  source_document_id: SSEN_BOOK_INPUT.source_document_id,
  completed_stages: [],
  completed_pages: [],
  failed_pages: [],
  failed_items: [],
  items_ok: 0,
  dry_run: true,
})

describe('STEP 8.34 reusable book pipeline', () => {
  it('requires the minimum book inputs and defaults to dry-run', () => {
    const flags = parseBookPipelineFlags834([
      '--dry-run',
      `--pdf=${SSEN_BOOK_INPUT.pdf_path}`,
      `--source-document-id=${SSEN_BOOK_INPUT.source_document_id}`,
      `--title=${SSEN_BOOK_INPUT.title}`,
      '--subject=공통수학1',
      '--curriculum=2022-개정',
      '--from-page=1',
      '--to-page=192',
      '--ocr-policy=cache-only',
    ])
    expect(flags.dry_run).toBe(true)
    expect(flags.persist).toBe(false)
    const valid = validateBookInput834({ ...SSEN_BOOK_INPUT, ...flags.input })
    expect(valid.ok).toBe(true)
    expect(validateBookInput834({ title: 'only' }).ok).toBe(false)
  })

  it('walks frozen-compatible stages and resumes failed pages only', () => {
    expect(BOOK_PIPELINE_STAGES[0]).toBe('PDF_CHECK')
    expect(BOOK_PIPELINE_STAGES.at(-1)).toBe('EXCEPTION_QUEUE')
    const checkpoint = emptyCheckpoint()
    checkpoint.completed_stages = ['PDF_CHECK', 'PAGE_RENDER']
    checkpoint.completed_pages = [1, 2, 3]
    expect(nextStage834(checkpoint)).toBe('SEGMENT')
    expect(resumePages834(1, 5, checkpoint)).toEqual([4, 5])
    expect(mapLogicalStageToFrozen834('EMBEDDING')).toBe('QUEUE_HUMAN')
    expect(mapLogicalStageToFrozen834('PERSIST_DRAFT')).toBe('PERSIST_DRAFT')
  })

  it('does not mint writes on dry-run or on an idempotent persist of existing identities', () => {
    expect(dryRunWrites834(false, false).writes).toBe(0)
    expect(dryRunWrites834(true, true)).toEqual({ writes: 0, extra_on_rerun: 0 })
  })
})
