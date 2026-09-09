import { extractWorkbookProblemAnchor } from './structure'
import type { PageLayoutKind } from './layoutSegment'

export const BOOK_PAGE_KINDS = [
  'COVER',
  'TOC',
  'CHAPTER_TITLE',
  'THEORY',
  'PROBLEM',
  'ANSWER',
  'EXPLANATION',
  'ADVERTISEMENT',
  'BLANK',
  'MIXED',
  'UNKNOWN',
] as const

export type BookPageKind = (typeof BOOK_PAGE_KINDS)[number]

export type PageClassifyInput = {
  page_number: number
  ink_ratio: number | null
  has_ocr_cache: boolean
  page_layout_kind?: PageLayoutKind | null
  four_digit_count: number
  section_count: number
  cache_text?: string
}

export type PageClassifyResult = {
  page_kind: BookPageKind
  classification_confidence: number
  needs_ocr: boolean
  warnings: string[]
}

const TOC_RE = /목차|차례|CONTENTS/i
const ANSWER_RE = /정답과\s*해설|정답\s*및\s*해설|^정답\b|해답/
const EXPLAIN_RE = /해설\s*강의|상세\s*해설|^풀이\b/
const CHAPTER_RE = /대단원|중단원|CHAPTER|단원\s*도입/
const AD_RE = /광고|이벤트|할인|QR\s*코드로\s*강의/

export function classifyBookPage(input: PageClassifyInput): PageClassifyResult {
  const warnings: string[] = []
  const ink = input.ink_ratio
  if (ink != null && ink < 0.018) {
    return { page_kind: 'BLANK', classification_confidence: 0.86, needs_ocr: false, warnings }
  }

  const text = input.cache_text ?? ''
  if (input.has_ocr_cache) {
    if (TOC_RE.test(text) && input.four_digit_count === 0) {
      return { page_kind: 'TOC', classification_confidence: 0.9, needs_ocr: false, warnings }
    }
    if (ANSWER_RE.test(text) && input.four_digit_count === 0) {
      return { page_kind: 'ANSWER', classification_confidence: 0.84, needs_ocr: false, warnings }
    }
    if (EXPLAIN_RE.test(text) && input.four_digit_count === 0) {
      return { page_kind: 'EXPLANATION', classification_confidence: 0.8, needs_ocr: false, warnings }
    }
    if (CHAPTER_RE.test(text) && input.four_digit_count === 0 && input.section_count === 0) {
      return { page_kind: 'CHAPTER_TITLE', classification_confidence: 0.78, needs_ocr: false, warnings }
    }
    if (AD_RE.test(text) && input.four_digit_count === 0) {
      return { page_kind: 'ADVERTISEMENT', classification_confidence: 0.72, needs_ocr: false, warnings }
    }
    if (input.page_layout_kind === 'MIXED') {
      return { page_kind: 'MIXED', classification_confidence: 0.88, needs_ocr: false, warnings }
    }
    if (input.page_layout_kind === 'THEORY_PAGE' || (input.section_count > 0 && input.four_digit_count === 0)) {
      return { page_kind: 'THEORY', classification_confidence: 0.86, needs_ocr: false, warnings }
    }
    if (input.page_layout_kind === 'PROBLEM_PAGE' || input.four_digit_count > 0) {
      return { page_kind: 'PROBLEM', classification_confidence: 0.92, needs_ocr: false, warnings }
    }
    warnings.push('cache_present_but_layout_uncertain')
    return { page_kind: 'UNKNOWN', classification_confidence: 0.4, needs_ocr: false, warnings }
  }

  warnings.push('no_ocr_cache')
  return {
    page_kind: 'UNKNOWN',
    classification_confidence: 0.2,
    needs_ocr: true,
    warnings,
  }
}

export function countAnchorsFromText(text: string): { four_digit: number; section: number } {
  const four = new Set<string>()
  const section = new Set<string>()
  for (const line of text.split(/\n+/)) {
    const hit = extractWorkbookProblemAnchor(line)
    if (hit.kind === 'four_digit' && hit.number) four.add(hit.number)
    if (hit.kind === 'section' && hit.number) section.add(hit.number)
  }
  return { four_digit: four.size, section: section.size }
}

export function emptyKindCounts(): Record<BookPageKind, number> {
  return Object.fromEntries(BOOK_PAGE_KINDS.map((kind) => [kind, 0])) as Record<BookPageKind, number>
}

export function assertKindSum(counts: Record<BookPageKind, number>, expected: number) {
  const sum = BOOK_PAGE_KINDS.reduce((total, kind) => total + counts[kind], 0)
  if (sum !== expected) throw new Error(`HQB_BOOK_KIND_SUM: ${sum} !== ${expected}`)
}

export const BOOK_PAGE_KINDS_V2 = [...BOOK_PAGE_KINDS, 'OCR_FAILED'] as const
export type BookPageKindV2 = (typeof BOOK_PAGE_KINDS_V2)[number]

export type PageClassifyEvidence = {
  four_digit_anchors: number
  answer_patterns: boolean
  explanation_patterns: boolean
  theory_headings: boolean
  chapter_headings: boolean
  layout_blocks: number
  choice_patterns: number
  dense_explanation_text: boolean
  page_position_hint: 'front' | 'middle' | 'back' | 'unknown'
  image_layout_hints: number
  answer_key_lines: number
  problem_stem_hits: number
}

export type PageClassifyInputV2 = {
  page_number: number
  total_pages?: number
  ink_ratio: number | null
  ocr_failed?: boolean
  has_ocr: boolean
  cache_text?: string
  four_digit_count: number
  section_count: number
  page_layout_kind?: PageLayoutKind | null
  block_count?: number
  image_count?: number
}

export type PageClassifyResultV2 = {
  page_kind: BookPageKindV2
  classification_confidence: number
  needs_ocr: boolean
  warnings: string[]
  evidence: PageClassifyEvidence
}

const THEORY_HEADING_RE = /유형\s*\d+|개념\s*(?:Plus|정리)|SSEN\s*NOTE|기본\s*다잡기|핵심\s*개념|\d{2}-\d\b/
const PROBLEM_STEM_RE = /다음(?:\s*중)?|구하시오|고르시오|계산하시오|옳(?:은|지)|빈칸/
const ANSWER_HEADING_RE = /정답과\s*해설|정답\s*및\s*해설|(?:^|\n)\s*정답\s*(?:$|\n)/
const ANSWER_KEY_LINE_RE = /^\s*\d{3,4}\s*(?:[①-⑤㉠-㉥]|[:：]\s*[①-⑤]|정답)/
const EXPLAIN_HEADING_RE = /(?:^|\n)\s*(?:상세\s*)?해설(?:\s*강의)?|(?:^|\n)\s*풀이\b/
const COVER_RE = /표지|ISBN|좋은책신사고|<copyright>|발행일/

function pagePositionHint(page: number, total?: number): PageClassifyEvidence['page_position_hint'] {
  if (!total || total < 1) return 'unknown'
  if (page <= 6) return 'front'
  if (page >= total - 24) return 'back'
  return 'middle'
}

export function collectPageClassifyEvidence(input: PageClassifyInputV2): PageClassifyEvidence {
  const text = input.cache_text ?? ''
  const lines = text.split(/\n+/)
  return {
    four_digit_anchors: input.four_digit_count,
    answer_patterns: ANSWER_HEADING_RE.test(text),
    explanation_patterns: EXPLAIN_HEADING_RE.test(text) || EXPLAIN_RE.test(text),
    theory_headings: THEORY_HEADING_RE.test(text),
    chapter_headings: CHAPTER_RE.test(text),
    layout_blocks: input.block_count ?? 0,
    choice_patterns: (text.match(/[①-⑤]/g) ?? []).length,
    dense_explanation_text: (text.match(/풀이|해설|따라서|그러므로/g) ?? []).length >= 8,
    page_position_hint: pagePositionHint(input.page_number, input.total_pages),
    image_layout_hints: input.image_count ?? 0,
    answer_key_lines: lines.filter((line) => ANSWER_KEY_LINE_RE.test(line)).length,
    problem_stem_hits: (text.match(PROBLEM_STEM_RE) ?? []).length,
  }
}

function looksLikeAnswerKey(evidence: PageClassifyEvidence): boolean {
  if (evidence.answer_patterns && evidence.four_digit_anchors > 0 && evidence.problem_stem_hits <= 2) return true
  if (evidence.answer_key_lines >= 8 && evidence.four_digit_anchors >= 5 && evidence.problem_stem_hits <= 3) return true
  if (evidence.answer_patterns && evidence.answer_key_lines >= 3) return true
  return false
}

/**
 * Page classifier v2. OCR text and layout decide the kind.
 * Page position is recorded as a hint and never used as the sole reason.
 */
export function classifyBookPageV2(input: PageClassifyInputV2): PageClassifyResultV2 {
  const warnings: string[] = []
  const evidence = collectPageClassifyEvidence(input)
  const text = input.cache_text ?? ''

  if (input.ocr_failed) {
    return {
      page_kind: 'OCR_FAILED',
      classification_confidence: 0.95,
      needs_ocr: false,
      warnings: ['ocr_failed'],
      evidence,
    }
  }

  if (input.ink_ratio != null && input.ink_ratio < 0.018) {
    return { page_kind: 'BLANK', classification_confidence: 0.86, needs_ocr: false, warnings, evidence }
  }

  if (!input.has_ocr) {
    warnings.push('no_ocr_cache')
    return {
      page_kind: 'UNKNOWN',
      classification_confidence: 0.2,
      needs_ocr: true,
      warnings,
      evidence,
    }
  }

  if (TOC_RE.test(text) && input.four_digit_count === 0 && !looksLikeAnswerKey(evidence)) {
    return { page_kind: 'TOC', classification_confidence: 0.9, needs_ocr: false, warnings, evidence }
  }
  if (looksLikeAnswerKey(evidence)) {
    return { page_kind: 'ANSWER', classification_confidence: 0.88, needs_ocr: false, warnings, evidence }
  }
  if (evidence.explanation_patterns && evidence.dense_explanation_text && evidence.problem_stem_hits <= 1) {
    return { page_kind: 'EXPLANATION', classification_confidence: 0.82, needs_ocr: false, warnings, evidence }
  }
  if (COVER_RE.test(text) && input.four_digit_count === 0 && input.section_count === 0 && evidence.problem_stem_hits === 0) {
    return { page_kind: 'COVER', classification_confidence: 0.8, needs_ocr: false, warnings, evidence }
  }
  if (AD_RE.test(text) && input.four_digit_count === 0) {
    return { page_kind: 'ADVERTISEMENT', classification_confidence: 0.72, needs_ocr: false, warnings, evidence }
  }
  if (CHAPTER_RE.test(text) && input.four_digit_count === 0 && input.section_count === 0 && evidence.problem_stem_hits === 0) {
    return { page_kind: 'CHAPTER_TITLE', classification_confidence: 0.78, needs_ocr: false, warnings, evidence }
  }
  if (input.page_layout_kind === 'MIXED' || (input.section_count > 0 && input.four_digit_count > 0 && evidence.theory_headings)) {
    return { page_kind: 'MIXED', classification_confidence: 0.86, needs_ocr: false, warnings, evidence }
  }
  if (
    input.page_layout_kind === 'THEORY_PAGE' ||
    (input.section_count > 0 && input.four_digit_count === 0) ||
    (evidence.theory_headings && input.four_digit_count === 0 && evidence.problem_stem_hits === 0)
  ) {
    return { page_kind: 'THEORY', classification_confidence: 0.86, needs_ocr: false, warnings, evidence }
  }
  if (input.page_layout_kind === 'PROBLEM_PAGE' || input.four_digit_count > 0) {
    return { page_kind: 'PROBLEM', classification_confidence: 0.92, needs_ocr: false, warnings, evidence }
  }

  warnings.push('cache_present_but_layout_uncertain')
  return { page_kind: 'UNKNOWN', classification_confidence: 0.4, needs_ocr: false, warnings, evidence }
}

export function emptyKindCountsV2(): Record<BookPageKindV2, number> {
  return Object.fromEntries(BOOK_PAGE_KINDS_V2.map((kind) => [kind, 0])) as Record<BookPageKindV2, number>
}

export function assertKindSumV2(counts: Record<BookPageKindV2, number>, expected: number) {
  const sum = BOOK_PAGE_KINDS_V2.reduce((total, kind) => total + counts[kind], 0)
  if (sum !== expected) throw new Error(`HQB_BOOK_KIND_SUM_V2: ${sum} !== ${expected}`)
}

export function blockedNonProblemKind(kind: BookPageKindV2): boolean {
  return kind !== 'PROBLEM' && kind !== 'MIXED'
}
