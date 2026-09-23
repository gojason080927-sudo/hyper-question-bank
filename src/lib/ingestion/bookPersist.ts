/**
 * Persist AUTO_SAFE drafts for a generic book spec.
 * Reuses 쎈2 identity upsert + synthetic bbox. Never writes REVIEW/BLOCKED.
 */
import { upsertPayload } from '../recognition/draftUpsert'
import { QUESTION_BANK_REF, STUDENT_CARE_REF, autoSafePersistItems, syntheticMath2BBox, type Math2PersistItem } from './math2Persist'
import { assertBookIngestSource, type BookIngestSpec } from './bookIngestSpec'

export function assertBookPersistTarget(spec: BookIngestSpec, sourceId: string, url: string): void {
  assertBookIngestSource(spec, sourceId)
  if (url.includes(STUDENT_CARE_REF)) throw new Error('BOOK_PERSIST_FORBIDDEN: hyper-student-care refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('BOOK_PERSIST_WRONG_PROJECT')
}

export function bookUpsertPayload(spec: BookIngestSpec, item: Math2PersistItem): Record<string, unknown> {
  const payload = upsertPayload({
    source_document_id: spec.sourceId,
    page_number: item.page,
    original_problem_number: item.problem_number,
    bbox: item.bbox,
    problem_text: item.problem_text,
  })
  return {
    ...payload,
    version: {
      ...(payload.version as Record<string, unknown>),
      item_format: item.choice_count >= 4 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
    },
  }
}

export { QUESTION_BANK_REF, STUDENT_CARE_REF, autoSafePersistItems, syntheticMath2BBox }
export type { Math2PersistItem }
