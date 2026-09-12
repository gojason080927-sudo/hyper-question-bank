/**
 * STEP 8.32 — full 192-page 쎈수학 공통수학1 ingest policy.
 * AUTO_APPROVED is not required for DRAFT persist. Never VERIFIED.
 */
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
  type PipelineItemStatus,
  type PipelineStage,
} from './batchPipeline825'
import { SECOND_DOCUMENT } from './cacheSegment827'
import { STEP828_DOCUMENT, STEP828_DOCUMENT_TITLE, STEP828_SSEN_FILE_HASH } from './structureFromCache828'
import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import {
  extractWorkbookProblemAnchor,
  recognizeFromOcrText,
  type WorkbookAnchorKind,
} from '../recognition/structure'
import type { LayoutBlock, LayoutPageInput } from '../recognition/layoutSegment'
import { blockedNonProblemKind, type BookPageKindV2 } from '../recognition/bookClassify'

export const STEP832 = '8.32'
export const STEP832_DIR = 'ocr-tests/taxonomy/step8-32'
export const ASSIGNED_BY = 'STEP_8_32'
export const STAGE: PipelineStage = 'PERSIST_DRAFT'
export const STEP832_DOCUMENT = STEP828_DOCUMENT
export const STEP832_DOCUMENT_TITLE = STEP828_DOCUMENT_TITLE
export const STEP832_PDF_SHA256 = STEP828_SSEN_FILE_HASH
export const STEP832_PAGE_COUNT = 192
export const STEP832_PAID_OCR_CAP = { maxCalls: 250, maxUsd: 1.0 } as const
export const MISTRAL_PAGE_USD = 0.004
export const STORAGE_BUCKET = 'question-bank-sources'
export const STORAGE_ORIGINAL = `${STEP832_DOCUMENT}/original.pdf`
export const CACHE_DIR = '.ocr-temp/step8-32'
export const GT_PATH = 'workers/ocr/ground-truth.json'
export const GT_JSON_SHA256 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
export const HUMAN_READABLE_MIN_CHARS = 8
export const PAGE_OCR_BATCH = 20
export const DB_INSERT_BATCH = 25

export { QUESTION_BANK_REF, STUDENT_CARE_REF, SECOND_DOCUMENT, FROZEN_PIPELINE_COUNTS }

export type PersistAction832 =
  | 'CREATE_DRAFT'
  | 'RECORD_EXISTING'
  | 'SKIP_BLOCKED'
  | 'SKIP_IDENTITY'
  | 'SKIP_EXCLUDED'
  | 'SKIP_DUPLICATE'

export type Step832Verdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type ExistingDraft832 = {
  problem_id: string
  public_code: string
  review_status: string
  lifecycle_status: string
  current_version_id: string | null
}

export type PersistEligibilityInput = {
  source_document_id: string
  page: number
  bbox: NormalizedBBox | null
  crop_present: boolean
  text: string
  canonical: string | null
  duplicate_check_ran: boolean
  identity_collision: boolean
  auto_approved: boolean
}

export type PersistEligibility = {
  ok: boolean
  action: PersistAction832
  reasons: string[]
}

const EXCLUDED_KINDS: BookPageKindV2[] = [
  'COVER',
  'TOC',
  'CHAPTER_TITLE',
  'THEORY',
  'ANSWER',
  'EXPLANATION',
  'ADVERTISEMENT',
  'BLANK',
]

export function isFrontMatterPage(page: number, text: string): boolean {
  if (page >= 9) return false
  if (page <= 7) return !/\b0001\b/.test(text)
  return false
}

export function isExcludedPageKind(kind: BookPageKindV2): boolean {
  return EXCLUDED_KINDS.includes(kind) || (blockedNonProblemKind(kind) && kind !== 'UNKNOWN' && kind !== 'OCR_FAILED' && kind !== 'MIXED')
}

export function problemPageKind(kind: BookPageKindV2): boolean {
  return kind === 'PROBLEM' || kind === 'MIXED' || kind === 'UNKNOWN'
}

export function humanReadableContent(text: string, min = HUMAN_READABLE_MIN_CHARS): boolean {
  return text.replace(/\s+/g, '').length >= min
}

export function bboxPresent(bbox: NormalizedBBox | null): boolean {
  if (!bbox) return false
  try {
    validateBBox(bbox)
    return bbox.width > 0.02 && bbox.height > 0.02
  } catch {
    return false
  }
}

export function persistEligible832(input: PersistEligibilityInput): PersistEligibility {
  const reasons: string[] = ['NO_VERIFIED', 'NO_WORKSHEET_ELIGIBLE', 'AUTO_APPROVED_NOT_REQUIRED']
  if (input.auto_approved) reasons.push('AUTO_APPROVED_IGNORED_FOR_PERSIST')
  if (input.source_document_id !== STEP832_DOCUMENT) {
    return { ok: false, action: 'SKIP_BLOCKED', reasons: [...reasons, 'WRONG_SOURCE'] }
  }
  if (input.page < 1 || input.page > STEP832_PAGE_COUNT) {
    return { ok: false, action: 'SKIP_BLOCKED', reasons: [...reasons, 'PAGE_OUT_OF_RANGE'] }
  }
  if (!input.duplicate_check_ran) {
    return { ok: false, action: 'SKIP_BLOCKED', reasons: [...reasons, 'DUPLICATE_CHECK_MISSING'] }
  }
  if (input.identity_collision) {
    return { ok: false, action: 'SKIP_DUPLICATE', reasons: [...reasons, 'IDENTITY_COLLISION'] }
  }
  if (!bboxPresent(input.bbox)) {
    return { ok: false, action: 'SKIP_BLOCKED', reasons: [...reasons, 'BBOX_MISSING'] }
  }
  if (!input.crop_present) {
    return { ok: false, action: 'SKIP_BLOCKED', reasons: [...reasons, 'CROP_MISSING'] }
  }
  if (!humanReadableContent(input.text)) {
    reasons.push('CONTENT_THIN_NEEDS_REVIEW')
  }
  if (!input.canonical) {
    return { ok: false, action: 'SKIP_IDENTITY', reasons: [...reasons, 'IDENTITY_NOT_CANONICAL', 'QUEUED_HUMAN_REVIEW'] }
  }
  return { ok: true, action: 'CREATE_DRAFT', reasons: [...reasons, 'DRAFT_PERSIST_ALLOWED'] }
}

export function mapPersistWithExisting(
  eligibility: PersistEligibility,
  existing: ExistingDraft832 | null,
): PersistEligibility {
  if (existing) {
    const reasons = [
      ...eligibility.reasons.filter((row) => row !== 'DRAFT_PERSIST_ALLOWED'),
      'EXISTING_PRODUCTION_DRAFT',
      'NO_CONTENT_REWRITE',
    ]
    if (existing.review_status === 'VERIFIED') reasons.push('EXISTING_VERIFIED_UNCHANGED')
    return { ok: true, action: 'RECORD_EXISTING', reasons }
  }
  return eligibility
}

export function pipelineStatusFor(action: PersistAction832): PipelineItemStatus {
  if (action === 'SKIP_BLOCKED') return 'BLOCKED'
  return 'HUMAN_REVIEW'
}

export function neverVerified832(status: string, reviewStatus: string): boolean {
  return status !== 'VERIFIED' && reviewStatus !== 'VERIFIED' && status !== 'WORKSHEET_ELIGIBLE'
}

export function paidCapAllows(calls: number, usd: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (calls > STEP832_PAID_OCR_CAP.maxCalls) reasons.push('PAID_CALL_CAP')
  if (usd > STEP832_PAID_OCR_CAP.maxUsd + 1e-9) reasons.push('PAID_USD_CAP')
  return { ok: reasons.length === 0, reasons }
}

export function estimateMistralUsd(calls: number): number {
  return Number((calls * MISTRAL_PAGE_USD).toFixed(4))
}

export type CrossPageItem = {
  candidate_id: string
  page: number
  problem_number: string
  canonical: string | null
  bbox: NormalizedBBox
  text: string
  choice_count: number
  incomplete: boolean
}

export function looksIncompleteStem(text: string, choiceCount: number, bbox: NormalizedBBox): boolean {
  const hitsBottom = bbox.y + bbox.height >= 0.9
  const noChoices = choiceCount < 2
  const hasChoices = /[①-⑤]/.test(text)
  return hitsBottom && noChoices && !hasChoices
}

export function stitchCrossPageProblems(items: CrossPageItem[]): Array<CrossPageItem & { stitched_from_page: number | null }> {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.bbox.y - b.bbox.y)
  const skip = new Set<string>()
  const out: Array<CrossPageItem & { stitched_from_page: number | null }> = []
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]
    if (skip.has(current.candidate_id)) continue
    const next = sorted[i + 1]
    const canStitch =
      next &&
      next.page === current.page + 1 &&
      current.incomplete &&
      next.bbox.y < 0.22 &&
      (!next.canonical || next.canonical === current.canonical) &&
      current.canonical != null
    if (canStitch && next) {
      skip.add(next.candidate_id)
      out.push({
        ...current,
        text: `${current.text}\n${next.text}`.trim(),
        choice_count: Math.max(current.choice_count, next.choice_count),
        incomplete: false,
        stitched_from_page: next.page,
      })
      continue
    }
    out.push({ ...current, stitched_from_page: null })
  }
  return out
}

export function candidateIdFor(page: number, canonical: string | null, fallback: string): string {
  if (canonical) return `${page}|${canonical}`
  return `${page}|${fallback}`
}

export function inBatchDuplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const dups: string[] = []
  for (const id of ids) {
    if (seen.has(id)) dups.push(id)
    seen.add(id)
  }
  return dups
}

export function contentFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  let hash = 2166136261
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${normalized.length}`
}

export function extractOverlappingText(blocks: LayoutBlock[], bbox: NormalizedBBox): string {
  const parts: string[] = []
  for (const block of blocks) {
    const cx = block.bbox.x + block.bbox.width / 2
    const cy = block.bbox.y + block.bbox.height / 2
    const inside =
      cx >= bbox.x - 0.01 &&
      cx <= bbox.x + bbox.width + 0.01 &&
      cy >= bbox.y - 0.01 &&
      cy <= bbox.y + bbox.height + 0.01
    if (inside && block.content?.trim()) parts.push(block.content.trim())
  }
  return parts.join('\n')
}

export function syntheticLayoutFromMarkdown(
  markdown: string,
  pageWidth = 1000,
  pageHeight = 1400,
  images: LayoutPageInput['images'] = [],
): LayoutPageInput {
  const lines = markdown
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const n = Math.max(1, lines.length)
  const blocks: LayoutBlock[] = lines.map((content, index) => ({
    type: 'text',
    content,
    bbox: {
      x: 0.06,
      y: 0.04 + (index / n) * 0.9,
      width: 0.88,
      height: Math.max(0.012, 0.9 / n),
      unit: 'normalized',
      origin: 'top-left',
    },
    confidence: 0.7,
  }))
  return { pageWidth, pageHeight, blocks, images }
}

export function countFourDigitAnchors(text: string): { four_digit: number; section: number } {
  const four = new Set<string>()
  const section = new Set<string>()
  for (const line of text.split(/\n+/)) {
    const hit = extractWorkbookProblemAnchor(line)
    if (hit.kind === 'four_digit' && hit.number) four.add(hit.number)
    if (hit.kind === 'section' && hit.number) section.add(hit.number)
  }
  return { four_digit: four.size, section: section.size }
}

export function structureFromRegionText(text: string): {
  stem: string
  choice_count: number
  math: string[]
  has_figure: boolean
  has_table: boolean
  reviewable: boolean
} {
  const rec = recognizeFromOcrText(text, { hasFigure: /그림|도형|그래프/.test(text), hasTable: /표/.test(text) })
  const stem = rec.payload.stem_text?.trim() || text.replace(/\s+/g, ' ').trim()
  return {
    stem,
    choice_count: rec.payload.choices?.length ?? 0,
    math: (rec.payload.math_expressions ?? []).map((row) => row.original).filter(Boolean),
    has_figure: Boolean(rec.payload.has_figure),
    has_table: Boolean(rec.payload.has_table),
    reviewable: humanReadableContent(stem),
  }
}

export function reviewReasonsFor(input: {
  choice_count: number
  math: string[]
  has_figure: boolean
  classification_review: boolean
  stitched: boolean
  ocr_uncertain: boolean
  segmentation_status: string
  anchor_kind: WorkbookAnchorKind | null
}): string[] {
  const reasons = ['NO_VERIFIED', 'QUEUED_HUMAN_REVIEW']
  if (input.choice_count > 0 && input.choice_count < 5) reasons.push('CHOICES_INCOMPLETE')
  if (input.ocr_uncertain) reasons.push('OCR_UNCERTAIN')
  if (input.has_figure) reasons.push('FIGURE_NEEDS_REVIEW')
  if (input.classification_review) reasons.push('CLASSIFICATION_REVIEW')
  if (input.stitched) reasons.push('CROSS_PAGE_STITCH')
  if (input.segmentation_status !== 'AUTO_OK') reasons.push('SEGMENT_REVIEW')
  if (input.anchor_kind && input.anchor_kind !== 'four_digit') reasons.push('NUMBER_UNCERTAIN')
  if (input.math.length === 0) reasons.push('MATH_UNCERTAIN')
  return [...new Set(reasons)]
}

export type Tally832 = {
  pages_processed: number
  pages_excluded: number
  problems_found: number
  create_draft: number
  record_existing: number
  needs_review: number
  blocked: number
  skipped_duplicate: number
  skipped_identity: number
  auto_approved: number
}

export function emptyTally832(): Tally832 {
  return {
    pages_processed: 0,
    pages_excluded: 0,
    problems_found: 0,
    create_draft: 0,
    record_existing: 0,
    needs_review: 0,
    blocked: 0,
    skipped_duplicate: 0,
    skipped_identity: 0,
    auto_approved: 0,
  }
}

export function persistPlanSafe832(input: {
  create_draft: number
  auto_approved: number
  verified: number
  duplicate_ids: string[]
  wrong_source: number
  lookup_complete: boolean
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (input.auto_approved > 0) reasons.push('MUST_NOT_SET_AUTO_APPROVED')
  if (input.verified > 0) reasons.push('MUST_NOT_SET_VERIFIED')
  if (input.wrong_source > 0) reasons.push('WRONG_SOURCE')
  if (input.create_draft > 0 && !input.lookup_complete) reasons.push('EXISTING_LOOKUP_INCOMPLETE')
  return { ok: reasons.length === 0, reasons }
}

export function projectStep832Targets(input: {
  originalPdfHashMatch: boolean
  pagesProcessed: number
  persisted: boolean
  verifiedWrites: number
  autoApproved: number
}): Array<{ id: string; kind: string; verdict: Step832Verdict; reasons: string[] }> {
  return [
    {
      id: 'locked-ssen-192',
      kind: 'TARGET',
      verdict: input.originalPdfHashMatch && input.pagesProcessed === STEP832_PAGE_COUNT ? 'PASS' : 'BLOCKED',
      reasons: input.originalPdfHashMatch ? ['SSEN_ORIGINAL'] : ['ORIGINAL_MISSING_OR_HASH'],
    },
    {
      id: 'no-verified',
      kind: 'WRITES',
      verdict: input.verifiedWrites === 0 ? 'PASS' : 'BLOCKED',
      reasons: ['NO_VERIFIED'],
    },
    {
      id: 'no-auto-approved-required',
      kind: 'GATE',
      verdict: input.autoApproved === 0 ? 'PASS' : 'BLOCKED',
      reasons: ['AUTO_APPROVED_NOT_REQUIRED', 'NO_AUTO_APPROVED_IN_8_32'],
    },
    {
      id: 'second-book-excluded',
      kind: 'TEXTBOOK',
      verdict: 'PASS',
      reasons: ['SECOND_BOOK_EXCLUDED'],
    },
    {
      id: 'persist-optional-until-flag',
      kind: 'DRAFTS',
      verdict: 'PASS',
      reasons: input.persisted ? ['PERSIST_RAN'] : ['DRY_OR_CACHE'],
    },
  ]
}
