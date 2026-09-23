/**
 * Persist 쎈2 AUTO_SAFE drafts via existing hqb_upsert_problem_draft_from_identity.
 * Never writes NEEDS_REVIEW / BLOCKED. Never uses SSEN / STEP 8.32.
 */
import { FORBIDDEN_SOURCE_IDS, MATH2_DOCUMENT_ID, assertMath2Document } from './math2Ocr'
import type { Math2ProblemCandidate } from './math2Segment'
import { upsertPayload } from '../recognition/draftUpsert'

export const MATH2_PERSIST_ENGINE = 'hqb-math2-auto-safe-persist'
export const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
export const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'

export type Math2PersistItem = {
  page: number
  problem_number: string
  problem_text: string
  choice_count: number
  bbox: { x: number; y: number; width: number; height: number; unit: 'normalized'; origin: 'top-left' }
}

export function assertMath2PersistTarget(sourceId: string, url: string): void {
  assertMath2Document(sourceId)
  if (FORBIDDEN_SOURCE_IDS.includes(sourceId as (typeof FORBIDDEN_SOURCE_IDS)[number])) {
    throw new Error('MATH2_PERSIST_FORBIDDEN: refusing 쎈 공통수학1 / SSEN document')
  }
  if (url.includes(STUDENT_CARE_REF)) throw new Error('MATH2_PERSIST_FORBIDDEN: hyper-student-care refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('MATH2_PERSIST_WRONG_PROJECT')
}

export function autoSafePersistItems(rows: Math2ProblemCandidate[]): Math2PersistItem[] {
  const safe = rows.filter((row) => row.verdict === 'AUTO_SAFE')
  const onPage = new Map<number, Math2ProblemCandidate[]>()
  for (const row of safe) {
    const list = onPage.get(row.page) ?? []
    list.push(row)
    onPage.set(row.page, list)
  }
  return safe.map((row) => {
    const siblings = onPage.get(row.page) ?? [row]
    const index = siblings.findIndex((item) => item.problem_number === row.problem_number)
    return {
      page: row.page,
      problem_number: row.problem_number,
      problem_text: row.stem.slice(0, 8000),
      choice_count: row.choice_count,
      bbox: syntheticMath2BBox(Math.max(index, 0), siblings.length),
    }
  })
}

export function syntheticMath2BBox(
  index: number,
  count: number,
): { x: number; y: number; width: number; height: number; unit: 'normalized'; origin: 'top-left' } {
  const slots = Math.max(count, 1)
  const height = Math.min(0.1, 0.8 / slots)
  const y = Math.min(0.08 + index * (0.8 / slots), 0.88)
  return {
    x: 0.08,
    y,
    width: 0.84,
    height: Math.min(height, 1 - y - 0.01),
    unit: 'normalized',
    origin: 'top-left',
  }
}

export function math2UpsertPayload(item: Math2PersistItem): Record<string, unknown> {
  const payload = upsertPayload({
    source_document_id: MATH2_DOCUMENT_ID,
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
