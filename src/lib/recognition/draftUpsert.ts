export const UPSERT_STEP = '8.5A'
export const UPSERT_RPC = 'hqb_upsert_problem_draft_from_identity'
export const ADVISORY_LOCK_NAMESPACE = 854201

export function canonicalizeProblemNumber(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, '').replace(/\.$/, '')
  if (!/^\d{1,4}$/.test(trimmed)) return null
  return trimmed.padStart(4, '0')
}

export function draftIdentityKey(input: {
  source_document_id: string
  page_number: number
  original_problem_number: string
}): string | null {
  const canonical = canonicalizeProblemNumber(input.original_problem_number)
  if (!canonical || !input.source_document_id || input.page_number < 1) return null
  return `${input.source_document_id}|${input.page_number}|${canonical}`
}

export function upsertPayload(input: {
  source_document_id: string
  source_page_id?: string
  page_number: number
  original_problem_number: string
  source_page_region_id?: string
  bbox?: { x: number; y: number; width: number; height: number; unit?: 'normalized'; origin?: 'top-left' }
  problem_text: string
}): Record<string, unknown> {
  return {
    source_document_id: input.source_document_id,
    source_page_id: input.source_page_id,
    page_number: input.page_number,
    original_problem_number: input.original_problem_number,
    source_page_region_id: input.source_page_region_id,
    bbox: input.bbox
      ? { ...input.bbox, unit: input.bbox.unit ?? 'normalized', origin: input.bbox.origin ?? 'top-left' }
      : undefined,
    version: { problem_text: input.problem_text, normalized_text: input.problem_text, origin: 'OCR' },
  }
}
