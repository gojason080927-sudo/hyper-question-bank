import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { FIGURE_VALIDATION_FREEZE } from './figureGtFreeze'
import { STEP817_DOCUMENT } from './step817Run'
import { canonicalizeProblemNumber, upsertPayload } from '../recognition/draftUpsert'
import type { NormalizedBBox } from '../pdf/bbox'

export const GT_PATH = 'workers/ocr/ground-truth.json'
export const VERIFIED_PENDING_ALLOWLIST = ['20|0097'] as const
export const UNRESOLVED_PENDING_IDS = [
  '108|0735',
  '108|0736',
  '114|0775',
  '122|0833',
  '134|0924',
  '134|0925',
  '134|0926',
  '189|1300',
] as const
export const DO_NOT_RECREATE_IDS = ['12|0045', '114|0773'] as const
export const UNRESOLVED_REASON =
  'No human-read stem/content in committed OCR GT, segmentation, or book-pipeline artifacts. Paid OCR not authorized.'

export type VerifiedPendingProblem = {
  id: string
  page: number
  original_problem_number: string
  source_document_id: string
  bbox: NormalizedBBox
  problem_text: string
  provenance: {
    ground_truth_sample_id: string
    freeze_id: string
    note: string
  }
}

type GroundTruthFile = {
  document_id?: string
  items?: Array<{
    sample_id?: string
    page_number?: number
    problem_number?: string
    ground_truth_text?: string
  }>
}

export function loadVerifiedPendingProblems(root: string): VerifiedPendingProblem[] {
  const gtFile = path.join(root, GT_PATH)
  if (!existsSync(gtFile)) return []
  const gt = JSON.parse(readFileSync(gtFile, 'utf8')) as GroundTruthFile
  if (gt.document_id && gt.document_id !== STEP817_DOCUMENT) return []
  const out: VerifiedPendingProblem[] = []
  for (const id of VERIFIED_PENDING_ALLOWLIST) {
    const freeze = FIGURE_VALIDATION_FREEZE.find((row) => row.id === id)
    if (!freeze || freeze.book !== 'SSEN') continue
    const canonical = canonicalizeProblemNumber(freeze.display_number)
    if (!canonical) continue
    const item = (gt.items ?? []).find(
      (row) =>
        row.page_number === freeze.page && canonicalizeProblemNumber(row.problem_number ?? '') === canonical,
    )
    const text = item?.ground_truth_text?.trim() ?? ''
    if (!text || text.length < 40) continue
    if (!text.includes(canonical) && !text.includes(freeze.display_number)) continue
    out.push({
      id,
      page: freeze.page,
      original_problem_number: canonical,
      source_document_id: STEP817_DOCUMENT,
      bbox: freeze.problem_bbox,
      problem_text: text,
      provenance: {
        ground_truth_sample_id: item?.sample_id ?? '',
        freeze_id: freeze.id,
        note: 'Human-read GT stem from workers/ocr/ground-truth.json. Not paid OCR. Not a guessed crop-as-stem.',
      },
    })
  }
  return out
}

export function pendingDraftPayload(problem: VerifiedPendingProblem) {
  return upsertPayload({
    source_document_id: problem.source_document_id,
    page_number: problem.page,
    original_problem_number: problem.original_problem_number,
    bbox: problem.bbox,
    problem_text: problem.problem_text,
  })
}

export function unresolvedPendingReport() {
  return UNRESOLVED_PENDING_IDS.map((id) => ({ id, reason: UNRESOLVED_REASON }))
}

export function pendingPaidOcrEstimate() {
  const pages = [...new Set(UNRESOLVED_PENDING_IDS.map((id) => Number(id.split('|')[0])))]
  return {
    problems: [...UNRESOLVED_PENDING_IDS],
    problem_count: UNRESOLVED_PENDING_IDS.length,
    unique_pages: pages,
    unique_page_count: pages.length,
    paid_ocr_authorized: false,
    mathpix: {
      service: 'Mathpix',
      typical_calls: pages.length,
      unit: 'page image',
      typical_usd: Number((pages.length * 0.005).toFixed(4)),
      crop_calls_if_problem_crops: UNRESOLVED_PENDING_IDS.length,
      crop_typical_usd: Number((UNRESOLVED_PENDING_IDS.length * 0.002).toFixed(4)),
    },
    mistral: {
      service: 'Mistral OCR',
      typical_calls: pages.length,
      unit: 'page',
      typical_usd: Number((pages.length * 0.004).toFixed(4)),
    },
    note: 'No committed stem exists. Do not call paid OCR until the user approves.',
  }
}
