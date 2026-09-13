/**
 * STEP 8.34 — reusable per-book pipeline (generalizes 8.32 + 8.33).
 * Dry-run by default. Persist is explicit. No per-page human RUN approval.
 */
import type { PipelineItemStatus } from './batchPipeline825'
import { STEP834_DOCUMENT, STEP834_DOCUMENT_TITLE, STEP834_PAGE_COUNT } from './exceptionCleanup834'

export const BOOK_PIPELINE_STAGES = [
  'PDF_CHECK',
  'PAGE_RENDER',
  'SEGMENT',
  'OCR',
  'STRUCTURE',
  'CLASSIFY',
  'CROP_FIGURE',
  'DUP_CHECK',
  'PERSIST_DRAFT',
  'AUTO_QA',
  'FINGERPRINT',
  'EMBEDDING',
  'EXCEPTION_QUEUE',
] as const

export type BookPipelineStage = (typeof BOOK_PIPELINE_STAGES)[number]

export type OcrProviderPolicy834 = 'cache-only' | 'cache-first' | 'paid-allowed'

export type BookPipelineInput834 = {
  pdf_path: string
  source_document_id: string
  title: string
  subject: string
  curriculum: string
  from_page: number
  to_page: number
  ocr_policy: OcrProviderPolicy834
}

export type BookCheckpoint834 = {
  source_document_id: string
  completed_stages: BookPipelineStage[]
  completed_pages: number[]
  failed_pages: number[]
  failed_items: Array<{ candidate_id: string; stage: BookPipelineStage; error: string }>
  items_ok: number
  dry_run: boolean
}

export type BookManifest834 = {
  source_document_id: string
  title: string
  pages: { from: number; to: number }
  dry_run: boolean
  persist: boolean
  stages: BookPipelineStage[]
  progress: Record<BookPipelineStage, { ok: number; failed: number; skipped: number }>
  estimated_usd: number
  actual_usd: number
  paid_calls: { mistral_ocr: number; mistral_embed: number }
  production_writes: number
  extra_writes_on_rerun: number
  cross_book_duplicates: number
  checkpoint: BookCheckpoint834
}

export const SSEN_BOOK_INPUT: BookPipelineInput834 = {
  pdf_path: 'ocr-tests/taxonomy/ssen-common-math-1.pdf',
  source_document_id: STEP834_DOCUMENT,
  title: STEP834_DOCUMENT_TITLE,
  subject: '공통수학1',
  curriculum: '2022-개정',
  from_page: 1,
  to_page: STEP834_PAGE_COUNT,
  ocr_policy: 'cache-only',
}

export function emptyProgress834(): Record<BookPipelineStage, { ok: number; failed: number; skipped: number }> {
  return Object.fromEntries(
    BOOK_PIPELINE_STAGES.map((stage) => [stage, { ok: 0, failed: 0, skipped: 0 }]),
  ) as Record<BookPipelineStage, { ok: number; failed: number; skipped: number }>
}

export function parseBookPipelineFlags834(argv: string[]): {
  dry_run: boolean
  persist: boolean
  resume: boolean
  input: Partial<BookPipelineInput834>
} {
  const persist = argv.includes('--persist')
  const dry_run = argv.includes('--dry-run') || !persist
  const resume = argv.includes('--resume')
  const read = (name: string): string | undefined => {
    const hit = argv.find((row) => row.startsWith(`${name}=`))
    return hit?.slice(name.length + 1)
  }
  return {
    dry_run,
    persist,
    resume,
    input: {
      pdf_path: read('--pdf'),
      source_document_id: read('--source-document-id'),
      title: read('--title'),
      subject: read('--subject'),
      curriculum: read('--curriculum'),
      from_page: read('--from-page') ? Number(read('--from-page')) : undefined,
      to_page: read('--to-page') ? Number(read('--to-page')) : undefined,
      ocr_policy: (read('--ocr-policy') as OcrProviderPolicy834 | undefined) ?? 'cache-only',
    },
  }
}

export function validateBookInput834(input: Partial<BookPipelineInput834>): {
  ok: boolean
  reasons: string[]
  value: BookPipelineInput834 | null
} {
  const reasons: string[] = []
  if (!input.pdf_path) reasons.push('PDF_PATH_REQUIRED')
  if (!input.source_document_id) reasons.push('SOURCE_DOCUMENT_ID_REQUIRED')
  if (!input.title) reasons.push('TITLE_REQUIRED')
  if (!input.subject) reasons.push('SUBJECT_REQUIRED')
  if (!input.curriculum) reasons.push('CURRICULUM_REQUIRED')
  const from = input.from_page ?? 1
  const to = input.to_page ?? 0
  if (!Number.isInteger(from) || from < 1) reasons.push('FROM_PAGE_INVALID')
  if (!Number.isInteger(to) || to < from) reasons.push('TO_PAGE_INVALID')
  if (reasons.length) return { ok: false, reasons, value: null }
  return {
    ok: true,
    reasons: [],
    value: {
      pdf_path: input.pdf_path!,
      source_document_id: input.source_document_id!,
      title: input.title!,
      subject: input.subject!,
      curriculum: input.curriculum!,
      from_page: from,
      to_page: to,
      ocr_policy: input.ocr_policy ?? 'cache-only',
    },
  }
}

export function nextStage834(checkpoint: BookCheckpoint834): BookPipelineStage | null {
  for (const stage of BOOK_PIPELINE_STAGES) {
    if (!checkpoint.completed_stages.includes(stage)) return stage
  }
  return null
}

export function resumePages834(from: number, to: number, checkpoint: BookCheckpoint834): number[] {
  const done = new Set(checkpoint.completed_pages)
  const pages: number[] = []
  for (let page = from; page <= to; page += 1) {
    if (!done.has(page)) pages.push(page)
  }
  return pages
}

export function mapLogicalStageToFrozen834(stage: BookPipelineStage): string {
  if (stage === 'PDF_CHECK' || stage === 'PAGE_RENDER') return 'PAGE_RENDER'
  if (stage === 'SEGMENT') return 'SEGMENT'
  if (stage === 'OCR') return 'SELECTIVE_OCR'
  if (stage === 'STRUCTURE' || stage === 'CLASSIFY') return 'STRUCTURE'
  if (stage === 'CROP_FIGURE') return 'FIGURE_DETECT_LINK'
  if (stage === 'DUP_CHECK' || stage === 'AUTO_QA') return 'CONFIDENCE_GATE'
  if (stage === 'PERSIST_DRAFT') return 'PERSIST_DRAFT'
  return 'QUEUE_HUMAN'
}

export function continueOnItemError834(
  failed: BookCheckpoint834['failed_items'],
  row: { candidate_id: string; stage: BookPipelineStage; error: string },
): BookCheckpoint834['failed_items'] {
  return [...failed, row]
}

export function pipelineStatusForException834(hasResidual: boolean): PipelineItemStatus {
  return hasResidual ? 'HUMAN_REVIEW' : 'AUTO_APPROVED'
}

export function dryRunWrites834(persist: boolean, alreadyExists: boolean): { writes: number; extra_on_rerun: number } {
  if (!persist) return { writes: 0, extra_on_rerun: 0 }
  if (alreadyExists) return { writes: 0, extra_on_rerun: 0 }
  return { writes: 1, extra_on_rerun: 0 }
}
