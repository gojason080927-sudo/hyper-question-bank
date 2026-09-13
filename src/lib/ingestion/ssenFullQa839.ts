/**
 * STEP 8.39 — free full QA of 쎈수학 공통수학1 (192 pages / 1,242 listed).
 * Never DELETE. Never paid OCR. Never overwrite TEACHER_EDIT / VERIFIED.
 */
import { sectionForPage, SSEN_LAST_PAGE, SSEN_SECTIONS, SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { safeRenderKatex } from '../math/safeKatex'
import { splitMathForDisplay } from '../math/splitMathForDisplay'
import {
  isInsideMathSpan,
  isMathBracketFalsePositive,
  parseRangeTokens,
  stemHash838,
  stripLeadingProblemNumber,
  stripOcrPackaging,
  type CatalogProblem838,
} from './rangeStemRestore838'

export const STEP839 = '8.39'
export const STEP839_DIR = 'ocr-tests/taxonomy/step8-39'
export const INSPECTOR_VERSION_839 = '8.39.3'
export const RULES_VERSION_839 = 'r1'
export const ASSIGNED_BY_839 = 'STEP_8_39'
export const CHANGE_REASON_839 = 'STEP 8.39 full-QA AUTO_SAFE'
export const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
export const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
export const SSEN_LISTED_FROZEN = 1242
export const SSEN_LINKED_FROZEN = 1253
export const SSEN_HIDDEN_FROZEN = 11
export const SSEN_PAGE_COUNT = SSEN_LAST_PAGE
export const EMBEDDINGS_FROZEN = 1244
export const FINGERPRINTS_FROZEN = 3543
export const MAJORS_FROZEN = { I: 252, II: 462, III: 253, IV: 160, V: 115 } as const
export const MOBILE_WIDTH_PX = 360
export const A4_2COL_WIDTH_PX = 321
export const A4_1COL_WIDTH_PX = 680

export const TEST_WORKSHEET_IDS_839 = [
  '671dffbc-ffff-4438-b072-07fde6ce637b',
  'eed4ad3b-7963-4697-a36f-3ac3b63b16d6',
  'd322df83-429b-4eec-93ea-ee58c99b3757',
  '2d48d36d-86cf-43ff-ab26-e373a1c5a88c',
  '6b96c426-f29e-4835-bdce-5901c050f3fa',
  '71842afc-75ba-4fcd-840f-0ce881cc883e',
  '2a09202f-0438-45b6-b055-6aed3752606a',
] as const

export type QaSignalCode =
  | 'RANGE_LEAK'
  | 'OWN_RANGE_HEADER'
  | 'NEXT_NUMBER_LEAK'
  | 'BROKEN_LATEX'
  | 'LATEX_ENV_MISMATCH'
  | 'MISSING_CHOICES'
  | 'UNEXPECTED_CHOICES'
  | 'POSSIBLE_FIGURE_MISSING'
  | 'FIGURE_LINK_ORPHAN'
  | 'PAGE_MISMATCH'
  | 'HEADER_NOISE'
  | 'TOO_SHORT'
  | 'DUPLICATE_BODY'
  | 'EMPTY_STEM'
  | 'ORPHAN_VERSION'
  | 'PUBLIC_CODE_DUP'
  | 'NUMBER_GAP'
  | 'PAGE_REVERSE'
  | 'PAREN_IMBALANCE'
  | 'OCR_PACKAGING'
  | 'LEADING_NUMBER_DUP'
  | 'OVERFLOW_MOBILE'
  | 'OVERFLOW_A4'
  | 'KATEX_FALLBACK'
  | 'MIXED_PROMPTS'
  | 'HIDDEN_AND_LISTED'

export type QaPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
export type QaVerdict = 'PASS' | 'AUTO_SAFE' | 'REVIEW_REQUIRED' | 'PAID_OCR_CANDIDATE' | 'BLOCKED'

export type QaSignal = {
  code: QaSignalCode
  gate: 1 | 2 | 3 | 4 | 5 | 6
  priority: QaPriority
  detail: string
}

export type CatalogProblem839 = CatalogProblem838 & {
  item_format: string | null
  choice_count: number | null
  choices: Array<{ label: string; order: number; text: string }>
  figure_ids: string[]
  figure_pages: number[]
  figure_paths: string[]
  fingerprint_values: string[]
  lifecycle_status: string | null
  major_code: string | null
}

export type KatexCensus839 = {
  spans: number
  render_ok: number
  render_fail: number
  fallback: number
  max_width_px: number
  overflow_360: boolean
  overflow_a4_2col: boolean
  overflow_a4_1col: boolean
  failed_tex: string[]
}

export type QaApply839 = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  from_stem: string
  to_stem: string
  from_hash: string
  to_hash: string
  rules: string[]
  parent_version_id: string | null
}

export type QaRecord839 = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  section_code: string | null
  major_code: string | null
  display_state: string
  origin: string | null
  review_status: string
  current_version_id: string | null
  teacher_edit: boolean
  verified: boolean
  stem: string
  proposed_stem: string | null
  stem_sha256: string
  cache_key: string
  cache_hit: boolean
  signals: QaSignal[]
  root_cause: string | null
  priority: QaPriority | null
  verdict: QaVerdict
  verdict_reason: string
  katex: KatexCensus839
  has_figure: boolean
  figure_needed: boolean
  evidence: string[]
  inspected: true
}

export type PageCensus839 = {
  page: number
  listed_count: number
  hidden_count: number
  numbers: string[]
  reverse: boolean
  dense: boolean
  sparse: boolean
  suspect: boolean
  page_sha256: string | null
}

export type Integrity839 = {
  listed: number
  linked: number
  hidden: number
  public_code_dups: number
  missing_page: number
  missing_number: number
  orphan_current_version: number
  empty_stem: number
  number_gaps: number[]
  page_reverse_ids: string[]
}

export type QaPlan839 = {
  inspector_version: string
  rules_version: string
  records: QaRecord839[]
  pages: PageCensus839[]
  applies: QaApply839[]
  integrity: Integrity839
  summary: QaSummary839
}

export type QaSummary839 = {
  pages_inspected: number
  listed_inspected: number
  hidden_inspected: number
  unique_candidates: number
  p0: number
  p1: number
  p2: number
  p3: number
  p4: number
  pass: number
  auto_safe: number
  review_required: number
  paid_ocr_candidate: number
  blocked: number
  new_versions: number
  affected_problems: number
  teacher_edit_protected: number
  verified_protected: number
  problems_deleted: number
  raw_ocr_changed: number
  expected_listed: number
  embeddings_changed: number
  fingerprints_changed: number
  paid_ocr_calls: number
  paid_ocr_pages: number
  cache_hits: number
  cache_misses: number
  gate1_fail: number
  gate2_fail: number
  gate3_fail: number
  gate4_fail: number
  gate5_fail: number
  gate6_fail: number
}

export type InspectCache839 = Record<string, { record: QaRecord839; inspector: string; rules: string }>

const FIGURE_HINT =
  /그림|그래프|도형|좌표평면|다음 행렬|오른쪽 그림|왼쪽 그림|아래 그림|위의 그림|표와 같|보기와 같/
const PROMPT_VERB = /구하시오|하시오|고르시오|나타내시오|풀이하시오|푸시오|전개하시오|인수분해하시오|계산하시오|답하시오|말하시오|정리하시오/

export function cacheKey839(input: {
  versionId: string | null
  stem: string
  pageSha: string | null
  pdfSha: string | null
}): string {
  return [
    INSPECTOR_VERSION_839,
    RULES_VERSION_839,
    input.pdfSha ?? 'no-pdf',
    input.pageSha ?? 'no-page',
    input.versionId ?? 'no-version',
    stemHash838(input.stem),
  ].join('|')
}

export function overlapIds(left: string[], right: string[]): { both: string[]; onlyLeft: string[]; onlyRight: string[] } {
  const rightSet = new Set(right)
  const leftSet = new Set(left)
  return {
    both: left.filter((id) => rightSet.has(id)),
    onlyLeft: left.filter((id) => !rightSet.has(id)),
    onlyRight: right.filter((id) => !leftSet.has(id)),
  }
}

export function estimateTexWidthPx(tex: string, display: boolean): number {
  const rows = String(tex ?? '').split('\\\\')
  const cols = Math.max(1, ...rows.map((row) => row.split('&').length))
  if (/pmatrix|array|cases|aligned/.test(tex)) return cols * 56 + 48
  const visible = tex.replace(/\\[a-zA-Z]+\*?/g, 'x').replace(/[{}^_[\]]/g, '').length
  return Math.max(24, visible * (display ? 11 : 8))
}

export function censusKatex(stem: string): KatexCensus839 {
  const parts = splitMathForDisplay(String(stem ?? ''))
  const math = parts.filter((part) => part.kind === 'math')
  const failed: string[] = []
  let ok = 0
  let fail = 0
  let fallback = 0
  let maxWidth = 0
  for (const part of math) {
    const rendered = safeRenderKatex(part.value, part.display)
    const width = estimateTexWidthPx(part.value, part.display)
    if (width > maxWidth) maxWidth = width
    if (rendered.ok) ok += 1
    else {
      fail += 1
      fallback += 1
      failed.push(part.value.slice(0, 120))
    }
  }
  return {
    spans: math.length,
    render_ok: ok,
    render_fail: fail,
    fallback,
    max_width_px: maxWidth,
    overflow_360: maxWidth > MOBILE_WIDTH_PX,
    overflow_a4_2col: maxWidth > A4_2COL_WIDTH_PX,
    overflow_a4_1col: maxWidth > A4_1COL_WIDTH_PX,
    failed_tex: failed,
  }
}

export function latexEnvBalance(stem: string): { ok: boolean; detail: string } {
  const names = ['pmatrix', 'cases', 'array', 'aligned', 'matrix', 'bmatrix']
  for (const name of names) {
    const begin = String(stem ?? '').match(new RegExp(`\\\\begin\\{${name}\\}`, 'g'))?.length ?? 0
    const end = String(stem ?? '').match(new RegExp(`\\\\end\\{${name}\\}`, 'g'))?.length ?? 0
    if (begin !== end) return { ok: false, detail: `${name} begin=${begin} end=${end}` }
  }
  return { ok: true, detail: '' }
}

export function dollarBalanceSerious(stem: string): boolean {
  const text = String(stem ?? '').replace(/\\\$/g, '')
  const display = text.match(/\$\$/g)?.length ?? 0
  if (display % 2 !== 0) return true
  const singles = text.replace(/\$\$/g, '').split('').filter((ch) => ch === '$').length
  return singles % 2 !== 0
}

export function parenImbalanceSerious(stem: string): boolean {
  const plain = String(stem ?? '').replace(/\$.*?\$/gs, ' ')
  let depth = 0
  let min = 0
  for (const ch of plain) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (depth < min) min = depth
  }
  return min < -2 || depth >= 3
}

function visibleLen(stem: string): number {
  return String(stem ?? '')
    .replace(/\$+/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\d{3,4}/g, '')
    .replace(/\s+/g, '')
    .length
}

function figureNeeded(stem: string): boolean {
  return FIGURE_HINT.test(stem)
}

export function splitNextNumberLeak(
  stem: string,
  current: number,
  nextStem: string | null,
): { keep: string; leaked: string } | null {
  const padded = String(current + 1).padStart(4, '0')
  const re = new RegExp(`(?:\\n|\\s)${padded}(?!\\d)`)
  const match = re.exec(stem)
  if (!match || match.index == null) return null
  if (isInsideMathSpan(stem, match.index + 1)) return null
  const keep = stem.slice(0, match.index).trim()
  const leaked = stem.slice(match.index).trim()
  if (!keep || !leaked) return null
  if (!nextStem) return { keep, leaked }
  const nextNorm = stripLeadingProblemNumber(nextStem, current + 1).replace(/\s+/g, ' ').trim()
  const leakedNorm = stripLeadingProblemNumber(leaked, current + 1).replace(/\s+/g, ' ').trim()
  if (nextNorm && (leakedNorm === nextNorm || leakedNorm.startsWith(nextNorm) || nextNorm.startsWith(leakedNorm.slice(0, 40)))) {
    return { keep, leaked }
  }
  return { keep, leaked }
}

function listedOf(catalog: CatalogProblem839[], n: number): CatalogProblem839[] {
  return catalog.filter((row) => row.display_state === 'LISTED' && row.problem_number === n)
}

export function buildIntegrity(catalog: CatalogProblem839[]): Integrity839 {
  const listed = catalog.filter((row) => row.display_state === 'LISTED')
  const hidden = catalog.filter((row) => row.display_state !== 'LISTED')
  const codes = listed.map((row) => row.public_code)
  const numbers = listed
    .map((row) => row.problem_number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i]! > numbers[i - 1]! + 1) {
      for (let n = numbers[i - 1]! + 1; n < numbers[i]!; n += 1) gaps.push(n)
    }
  }
  const pageReverse: string[] = []
  const ordered = [...listed].sort((a, b) => a.problem_number - b.problem_number)
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!
    const cur = ordered[i]!
    if (prev.source_page != null && cur.source_page != null && cur.source_page < prev.source_page - 1) {
      pageReverse.push(cur.id)
    }
  }
  return {
    listed: listed.length,
    linked: catalog.length,
    hidden: hidden.length,
    public_code_dups: codes.length - new Set(codes).size,
    missing_page: listed.filter((row) => row.source_page == null).length,
    missing_number: listed.filter((row) => !row.problem_number).length,
    orphan_current_version: listed.filter((row) => !row.current_version_id).length,
    empty_stem: listed.filter((row) => !String(row.stem ?? '').trim()).length,
    number_gaps: gaps.slice(0, 40),
    page_reverse_ids: pageReverse,
  }
}

export function buildPageCensus(catalog: CatalogProblem839[], pageHashes: Map<number, string> = new Map()): PageCensus839[] {
  const pages: PageCensus839[] = []
  for (let page = 1; page <= SSEN_PAGE_COUNT; page += 1) {
    const rows = catalog.filter((row) => row.source_page === page)
    const listed = rows.filter((row) => row.display_state === 'LISTED')
    const numbers = listed.map((row) => row.original_problem_number).sort()
    pages.push({
      page,
      listed_count: listed.length,
      hidden_count: rows.length - listed.length,
      numbers,
      reverse: false,
      dense: listed.length > 14,
      sparse: listed.length === 0 && page >= 9 && ![7, 45, 115, 149, 173, 6].includes(page),
      suspect: listed.length > 14,
      page_sha256: pageHashes.get(page) ?? null,
    })
  }
  return pages
}

function gate1Signals(row: CatalogProblem839, catalog: CatalogProblem839[], integrity: Integrity839): QaSignal[] {
  const signals: QaSignal[] = []
  if (!row.current_version_id) {
    signals.push({ code: 'ORPHAN_VERSION', gate: 1, priority: 'P0', detail: 'current_version_id 없음' })
  }
  if (!String(row.stem ?? '').trim()) {
    signals.push({ code: 'EMPTY_STEM', gate: 1, priority: 'P0', detail: 'stem 공란' })
  }
  if (row.source_page == null) {
    signals.push({ code: 'PAGE_MISMATCH', gate: 1, priority: 'P1', detail: 'source page 누락' })
  }
  if (!row.problem_number) {
    signals.push({ code: 'NUMBER_GAP', gate: 1, priority: 'P1', detail: '문제번호 누락' })
  }
  const sameCode = catalog.filter((item) => item.display_state === 'LISTED' && item.public_code === row.public_code)
  if (sameCode.length > 1) {
    signals.push({ code: 'PUBLIC_CODE_DUP', gate: 1, priority: 'P0', detail: row.public_code })
  }
  const sameNum = listedOf(catalog, row.problem_number)
  if (row.display_state === 'LISTED' && sameNum.length > 1) {
    signals.push({ code: 'HIDDEN_AND_LISTED', gate: 1, priority: 'P1', detail: `listed 중복 ${sameNum.length}` })
  }
  const hiddenTwin = catalog.find(
    (item) => item.id !== row.id && item.problem_number === row.problem_number && item.display_state !== 'LISTED',
  )
  if (row.display_state === 'LISTED' && hiddenTwin) {
    signals.push({ code: 'HIDDEN_AND_LISTED', gate: 1, priority: 'P3', detail: `hidden twin ${hiddenTwin.public_code}` })
  }
  if (integrity.page_reverse_ids.includes(row.id)) {
    signals.push({ code: 'PAGE_REVERSE', gate: 1, priority: 'P2', detail: `p.${row.source_page}` })
  }
  if (row.item_format === 'MULTIPLE_CHOICE' && row.choices.length === 0) {
    signals.push({ code: 'MISSING_CHOICES', gate: 1, priority: 'P0', detail: '객관식인데 선택지 0' })
  }
  if ((row.item_format === 'SHORT_ANSWER' || row.item_format === 'CONSTRUCTED_RESPONSE') && row.choices.length > 0) {
    signals.push({ code: 'UNEXPECTED_CHOICES', gate: 1, priority: 'P2', detail: `서술/단답에 선택지 ${row.choices.length}` })
  }
  const twins = catalog.filter(
    (item) => item.display_state === 'LISTED' && item.id !== row.id && item.stem.trim() && item.stem.trim() === row.stem.trim(),
  )
  if (twins.length) {
    signals.push({ code: 'DUPLICATE_BODY', gate: 1, priority: 'P1', detail: twins.map((item) => item.original_problem_number).join(',') })
  }
  return signals
}

function gate2Signals(row: CatalogProblem839, catalog: CatalogProblem839[]): QaSignal[] {
  const stem = row.stem
  const signals: QaSignal[] = []
  const later = parseRangeTokens(stem).filter(
    (token) => token.start > row.problem_number && !isMathBracketFalsePositive(stem, token),
  )
  if (later[0]) {
    signals.push({
      code: 'RANGE_LEAK',
      gate: 2,
      priority: 'P2',
      detail: later[0].raw,
    })
  }
  const own = parseRangeTokens(stem).filter((token) => token.start === row.problem_number)
  if (own[0] && extraSiblingNumbers(stem, row.problem_number, own[0].start, own[0].end)) {
    signals.push({ code: 'OWN_RANGE_HEADER', gate: 2, priority: 'P2', detail: own[0].raw })
  }
  const next = listedOf(catalog, row.problem_number + 1)[0]
  const leak = splitNextNumberLeak(stem, row.problem_number, next?.stem ?? null)
  if (leak) {
    signals.push({ code: 'NEXT_NUMBER_LEAK', gate: 2, priority: 'P2', detail: leak.leaked.slice(0, 80) })
  }
  const packed = stripOcrPackaging(stem)
  if (packed.rules.includes('fence') || packed.rules.includes('heading_hashes')) {
    signals.push({ code: 'OCR_PACKAGING', gate: 2, priority: 'P3', detail: packed.rules.join(',') })
  }
  if (packed.rules.some((rule) => rule.startsWith('trailing_outline') || rule === 'book_title')) {
    signals.push({ code: 'HEADER_NOISE', gate: 2, priority: 'P3', detail: packed.rules.join(',') })
  }
  const strippedLead = stripLeadingProblemNumber(stem, row.problem_number)
  if (strippedLead !== stem.trim() && /^\d{3,4}/.test(stem.trim())) {
    signals.push({ code: 'LEADING_NUMBER_DUP', gate: 2, priority: 'P3', detail: row.original_problem_number })
  }
  if (dollarBalanceSerious(stem) || censusKatex(stem).render_fail > 0) {
    const census = censusKatex(stem)
    if (census.render_fail > 0) {
      signals.push({
        code: 'BROKEN_LATEX',
        gate: 2,
        priority: census.render_ok === 0 && census.spans > 0 ? 'P0' : 'P1',
        detail: census.failed_tex[0] ?? 'delimiter',
      })
    } else if (dollarBalanceSerious(stem)) {
      signals.push({ code: 'BROKEN_LATEX', gate: 2, priority: 'P1', detail: 'dollar imbalance' })
    }
  }
  const env = latexEnvBalance(stem)
  if (!env.ok) signals.push({ code: 'LATEX_ENV_MISMATCH', gate: 2, priority: 'P1', detail: env.detail })
  if (parenImbalanceSerious(stem)) {
    signals.push({ code: 'PAREN_IMBALANCE', gate: 2, priority: 'P3', detail: 'paren depth' })
  }
  if (visibleLen(stem) < 4 && row.display_state === 'LISTED') {
    signals.push({ code: 'TOO_SHORT', gate: 2, priority: 'P1', detail: `visible=${visibleLen(stem)}` })
  }
  const prompts = stem.match(PROMPT_VERB)?.length ?? 0
  if (prompts >= 2 && later[0]) {
    signals.push({ code: 'MIXED_PROMPTS', gate: 2, priority: 'P2', detail: `verbs=${prompts}` })
  }
  return signals
}

function extraSiblingNumbers(stem: string, current: number, start: number, end: number): boolean {
  for (const match of stem.matchAll(/\b(\d{3,4})\b/g)) {
    const n = Number(match[1])
    if (n !== current && n >= start && n <= end && n !== start) return true
  }
  return false
}

function gate3Signals(row: CatalogProblem839): QaSignal[] {
  const signals: QaSignal[] = []
  if (row.source_page != null) {
    const section = sectionForPage(row.source_page)
    if (row.section_code && section && row.section_code !== section.code) {
      signals.push({
        code: 'PAGE_MISMATCH',
        gate: 3,
        priority: 'P2',
        detail: `section ${row.section_code} vs page section ${section.code}`,
      })
    }
  }
  return signals
}

function gate4Signals(_row: CatalogProblem839, katex: KatexCensus839): QaSignal[] {
  const signals: QaSignal[] = []
  if (katex.render_fail > 0) {
    signals.push({
      code: 'KATEX_FALLBACK',
      gate: 4,
      priority: katex.render_ok === 0 && katex.spans > 0 ? 'P0' : 'P4',
      detail: `${katex.render_fail}/${katex.spans} fail max=${katex.max_width_px}px`,
    })
  }
  if (katex.overflow_360) {
    signals.push({
      code: 'OVERFLOW_MOBILE',
      gate: 4,
      priority: 'P4',
      detail: `${katex.max_width_px}px > ${MOBILE_WIDTH_PX}`,
    })
  }
  if (katex.overflow_a4_2col) {
    signals.push({
      code: 'OVERFLOW_A4',
      gate: 4,
      priority: 'P4',
      detail: `${katex.max_width_px}px > ${A4_2COL_WIDTH_PX}`,
    })
  }
  return signals
}

function gate5Signals(row: CatalogProblem839): QaSignal[] {
  const signals: QaSignal[] = []
  const needed = figureNeeded(row.stem)
  if (needed && row.figure_ids.length === 0 && row.figure_paths.length === 0 && !row.crop_present) {
    signals.push({
      code: 'POSSIBLE_FIGURE_MISSING',
      gate: 5,
      priority: 'P1',
      detail: '그림/그래프 신호 있으나 asset 없음',
    })
  }
  if (row.figure_ids.length > 0 && row.figure_paths.length === 0 && !row.crop_present) {
    signals.push({ code: 'FIGURE_LINK_ORPHAN', gate: 5, priority: 'P1', detail: row.figure_ids.join(',') })
  }
  if (row.figure_pages.some((page) => row.source_page != null && Math.abs(page - row.source_page) > 1)) {
    signals.push({
      code: 'PAGE_MISMATCH',
      gate: 5,
      priority: 'P2',
      detail: `figure page ${row.figure_pages.join(',')} vs ${row.source_page}`,
    })
  }
  return signals
}

function evidenceFor(row: CatalogProblem839): string[] {
  const items: string[] = []
  if (row.origin) items.push(`origin:${row.origin}`)
  if (row.step832_preview) items.push('step832_preview')
  if (row.crop_present) items.push('crop')
  if (row.has_page_image) items.push('page_image')
  if ((row.page_ocr_chars ?? 0) > 0) items.push('page_ocr')
  if (row.source_page != null) items.push(`page:${row.source_page}`)
  if (row.section_code) items.push(`section:${row.section_code}`)
  if (row.figure_ids.length) items.push(`figures:${row.figure_ids.length}`)
  return items
}

function worstPriority(signals: QaSignal[]): QaPriority | null {
  const rank: QaPriority[] = ['P0', 'P1', 'P2', 'P3', 'P4']
  for (const level of rank) {
    if (signals.some((signal) => signal.priority === level)) return level
  }
  return null
}

function rootCause(signals: QaSignal[]): string | null {
  const order: QaSignalCode[] = [
    'EMPTY_STEM',
    'RANGE_LEAK',
    'NEXT_NUMBER_LEAK',
    'BROKEN_LATEX',
    'MISSING_CHOICES',
    'POSSIBLE_FIGURE_MISSING',
    'OWN_RANGE_HEADER',
    'DUPLICATE_BODY',
    'OCR_PACKAGING',
    'HEADER_NOISE',
    'OVERFLOW_MOBILE',
  ]
  for (const code of order) {
    if (signals.some((signal) => signal.code === code)) return code
  }
  return signals[0]?.code ?? null
}

export function stripSafePackaging839(text: string): { text: string; rules: string[] } {
  const rules: string[] = []
  let next = String(text ?? '').replace(/\u00a0/g, ' ')
  const original = next.trim()
  if (/```/.test(next)) {
    next = next.replace(/```+/g, '')
    rules.push('fence')
  }
  if (/###/.test(next)) {
    next = next.replace(/#{2,}/g, '')
    rules.push('heading_hashes')
  }
  next = next.replace(/\n?^\s*쎈수학[^\n]*$/gm, () => {
    rules.push('book_title')
    return ''
  })
  for (const title of SSEN_SECTIONS.map((row) => row.title)) {
    if (title.length < 6) continue
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const trailing = new RegExp(`(?:\\n|\\s+)(?:0?\\d{1,2}\\s*)?${escaped}\\s*$`)
    if (trailing.test(next)) {
      next = next.replace(trailing, '')
      rules.push(`trailing_section:${title}`)
    }
  }
  next = next.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (next === original) return { text: original, rules: [] }
  return { text: next, rules }
}

export function proposeAutoSafeStem(row: CatalogProblem839, catalog: CatalogProblem839[]): { stem: string; rules: string[] } | null {
  if (row.origin === 'TEACHER_EDIT' || row.review_status === 'VERIFIED') return null
  if (row.display_state !== 'LISTED') return null
  let next = row.stem
  const rules: string[] = []
  const packed = stripSafePackaging839(next)
  if (packed.rules.length) {
    next = packed.text
    rules.push(...packed.rules)
  }
  const neighbor = listedOf(catalog, row.problem_number + 1)[0]
  const leak = splitNextNumberLeak(next, row.problem_number, neighbor?.stem ?? null)
  if (leak && neighbor) {
    const nextNorm = stripLeadingProblemNumber(neighbor.stem, neighbor.problem_number).replace(/\s+/g, ' ').trim()
    const leakedNorm = stripLeadingProblemNumber(leak.leaked, neighbor.problem_number).replace(/\s+/g, ' ').trim()
    if (nextNorm && leakedNorm && (leakedNorm === nextNorm || leakedNorm.startsWith(nextNorm))) {
      next = leak.keep
      rules.push('next_number_leak')
    }
  }
  next = next.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!next || next === row.stem.trim() || rules.length === 0) return null
  const allowed = new Set(['fence', 'heading_hashes', 'book_title', 'next_number_leak'])
  const safeRules = rules.filter((rule) => allowed.has(rule) || rule.startsWith('trailing_section'))
  if (safeRules.length !== rules.length) return null
  const leftover = gate2Signals({ ...row, stem: next }, catalog).filter((signal) =>
    ['RANGE_LEAK', 'NEXT_NUMBER_LEAK', 'OWN_RANGE_HEADER', 'TOO_SHORT', 'EMPTY_STEM'].includes(signal.code),
  )
  if (leftover.length) return null
  return { stem: next, rules: safeRules }
}

function decideVerdict(row: CatalogProblem839, signals: QaSignal[], proposed: { stem: string; rules: string[] } | null): {
  verdict: QaVerdict
  reason: string
} {
  if (row.display_state !== 'LISTED') {
    return { verdict: 'BLOCKED', reason: 'HIDDEN_DUPLICATE는 listed 복원 대상이 아니다' }
  }
  if (row.origin === 'TEACHER_EDIT' || row.review_status === 'VERIFIED') {
    if (signals.length === 0) return { verdict: 'PASS', reason: '보호된 문항, 신호 없음' }
    return { verdict: 'REVIEW_REQUIRED', reason: 'TEACHER_EDIT/VERIFIED 보호 — 자동 수정 금지' }
  }
  const p0 = signals.filter((signal) => signal.priority === 'P0')
  const serious = signals.filter((signal) => ['P0', 'P1', 'P2'].includes(signal.priority))
  const onlyDisplay = signals.length > 0 && signals.every((signal) => signal.priority === 'P4')
  if (proposed) {
    const leftover = serious.filter(
      (signal) =>
        !['OCR_PACKAGING', 'HEADER_NOISE', 'LEADING_NUMBER_DUP', 'NEXT_NUMBER_LEAK'].includes(signal.code),
    )
    if (leftover.length === 0 && p0.length === 0) {
      return { verdict: 'AUTO_SAFE', reason: `명확한 OCR 포장/번호 누수 제거: ${proposed.rules.join(',')}` }
    }
  }
  if (signals.some((signal) => signal.code === 'POSSIBLE_FIGURE_MISSING') && !row.crop_present && !row.step832_preview) {
    return { verdict: 'PAID_OCR_CANDIDATE', reason: '도형 신호가 있으나 기존 crop/OCR 근거가 부족하다' }
  }
  if (signals.some((signal) => signal.code === 'BROKEN_LATEX' && signal.priority === 'P0') && !row.step832_preview) {
    return { verdict: 'PAID_OCR_CANDIDATE', reason: '수식이 렌더되지 않고 원본 텍스트 근거가 부족하다' }
  }
  if (signals.some((signal) => signal.code === 'EMPTY_STEM')) {
    return { verdict: 'PAID_OCR_CANDIDATE', reason: 'stem이 비어 기존 텍스트만으로 복원할 수 없다' }
  }
  if (signals.some((signal) => signal.code === 'RANGE_LEAK' || signal.code === 'OWN_RANGE_HEADER')) {
    return { verdict: 'REVIEW_REQUIRED', reason: '범위 발문 경계는 8.38 잔여 — 자동 확정하지 않는다' }
  }
  if (serious.length) {
    return { verdict: 'REVIEW_REQUIRED', reason: serious.map((signal) => signal.code).join(',') }
  }
  const cosmetic = signals.every(
    (signal) => signal.priority === 'P4' || signal.code === 'LEADING_NUMBER_DUP' || signal.code === 'HIDDEN_AND_LISTED',
  )
  if (onlyDisplay || (cosmetic && !proposed)) {
    return { verdict: 'PASS', reason: '필수 구조 검사 통과. 표시/번호 중복은 문제 의미와 무관' }
  }
  if (signals.length === 0) return { verdict: 'PASS', reason: 'GATE 1–5 구조 모순 없음' }
  if (signals.every((signal) => signal.priority === 'P3') && !proposed) {
    return { verdict: 'REVIEW_REQUIRED', reason: 'P3 신호는 있으나 AUTO_SAFE 경계가 아니다' }
  }
  return { verdict: 'REVIEW_REQUIRED', reason: signals.map((signal) => signal.code).join(',') }
}

export function inspectProblem(
  row: CatalogProblem839,
  catalog: CatalogProblem839[],
  _pages: PageCensus839[],
  integrity: Integrity839,
  cache: InspectCache839,
  pageHashes: Map<number, string>,
  pdfSha: string | null,
): QaRecord839 {
  const key = cacheKey839({
    versionId: row.current_version_id,
    stem: row.stem,
    pageSha: row.source_page != null ? pageHashes.get(row.source_page) ?? null : null,
    pdfSha,
  })
  const hit = cache[key]
  if (hit && hit.inspector === INSPECTOR_VERSION_839 && hit.rules === RULES_VERSION_839) {
    return { ...hit.record, cache_hit: true, cache_key: key }
  }
  const katex = censusKatex(row.stem)
  const signals = [
    ...gate1Signals(row, catalog, integrity),
    ...gate2Signals(row, catalog),
    ...gate3Signals(row),
    ...gate4Signals(row, katex),
    ...gate5Signals(row),
  ]
  const proposed = proposeAutoSafeStem(row, catalog)
  const decision = decideVerdict(row, signals, proposed)
  return {
    problem_id: row.id,
    public_code: row.public_code,
    current_number: row.original_problem_number,
    source_page: row.source_page,
    section_code: row.section_code,
    major_code: row.major_code,
    display_state: row.display_state,
    origin: row.origin,
    review_status: row.review_status,
    current_version_id: row.current_version_id,
    teacher_edit: row.origin === 'TEACHER_EDIT',
    verified: row.review_status === 'VERIFIED',
    stem: row.stem,
    proposed_stem: decision.verdict === 'AUTO_SAFE' ? proposed?.stem ?? null : null,
    stem_sha256: stemHash838(row.stem),
    cache_key: key,
    cache_hit: false,
    signals,
    root_cause: rootCause(signals),
    priority: worstPriority(signals),
    verdict: decision.verdict,
    verdict_reason: decision.reason,
    katex,
    has_figure: row.figure_ids.length > 0 || row.crop_present === true,
    figure_needed: figureNeeded(row.stem),
    evidence: evidenceFor(row),
    inspected: true,
  }
}

export function inspectCatalog(
  catalog: CatalogProblem839[],
  options: { cache?: InspectCache839; pageHashes?: Map<number, string>; pdfSha?: string | null } = {},
): QaPlan839 {
  const cache = options.cache ?? {}
  const pageHashes = options.pageHashes ?? new Map()
  const pdfSha = options.pdfSha ?? null
  const integrity = buildIntegrity(catalog)
  const pages = buildPageCensus(catalog, pageHashes)
  const records = catalog.map((row) => inspectProblem(row, catalog, pages, integrity, cache, pageHashes, pdfSha))
  const listed = records.filter((row) => row.display_state === 'LISTED')
  const applies: QaApply839[] = []
  for (const record of listed) {
    if (record.verdict !== 'AUTO_SAFE' || !record.proposed_stem) continue
    if (record.proposed_stem === record.stem.trim()) continue
    applies.push({
      problem_id: record.problem_id,
      public_code: record.public_code,
      current_number: record.current_number,
      source_page: record.source_page,
      from_stem: record.stem,
      to_stem: record.proposed_stem,
      from_hash: stemHash838(record.stem),
      to_hash: stemHash838(record.proposed_stem),
      rules: ['AUTO_SAFE'],
      parent_version_id: record.current_version_id,
    })
  }
  const uniqueCandidates = listed.filter((row) => row.verdict !== 'PASS').length
  const countP = (level: QaPriority) => listed.filter((row) => row.priority === level).length
  const countV = (verdict: QaVerdict) => listed.filter((row) => row.verdict === verdict).length
  const gateFail = (gate: 1 | 2 | 3 | 4 | 5 | 6) =>
    listed.filter((row) => row.signals.some((signal) => signal.gate === gate)).length
  const paidPages = new Set(
    listed.filter((row) => row.verdict === 'PAID_OCR_CANDIDATE' && row.source_page != null).map((row) => row.source_page),
  )
  const summary: QaSummary839 = {
    pages_inspected: pages.length,
    listed_inspected: listed.length,
    hidden_inspected: records.length - listed.length,
    unique_candidates: uniqueCandidates,
    p0: countP('P0'),
    p1: countP('P1'),
    p2: countP('P2'),
    p3: countP('P3'),
    p4: countP('P4'),
    pass: countV('PASS'),
    auto_safe: countV('AUTO_SAFE'),
    review_required: countV('REVIEW_REQUIRED'),
    paid_ocr_candidate: countV('PAID_OCR_CANDIDATE'),
    blocked: countV('BLOCKED') + records.filter((row) => row.display_state !== 'LISTED').length,
    new_versions: applies.length,
    affected_problems: applies.length,
    teacher_edit_protected: listed.filter((row) => row.teacher_edit).length,
    verified_protected: listed.filter((row) => row.verified).length,
    problems_deleted: 0,
    raw_ocr_changed: 0,
    expected_listed: SSEN_LISTED_FROZEN,
    embeddings_changed: 0,
    fingerprints_changed: 0,
    paid_ocr_calls: 0,
    paid_ocr_pages: paidPages.size,
    cache_hits: records.filter((row) => row.cache_hit).length,
    cache_misses: records.filter((row) => !row.cache_hit).length,
    gate1_fail: gateFail(1),
    gate2_fail: gateFail(2),
    gate3_fail: gateFail(3),
    gate4_fail: gateFail(4),
    gate5_fail: gateFail(5),
    gate6_fail: gateFail(6),
  }
  return {
    inspector_version: INSPECTOR_VERSION_839,
    rules_version: RULES_VERSION_839,
    records,
    pages,
    applies,
    integrity,
    summary,
  }
}

export function withAppliedStems839(catalog: CatalogProblem839[], applies: QaApply839[]): CatalogProblem839[] {
  const map = new Map(applies.map((row) => [row.problem_id, row.to_stem]))
  return catalog.map((row) => (map.has(row.id) ? { ...row, stem: map.get(row.id)! } : row))
}

export function dryRunSafety839(
  plan: QaPlan839,
  listedCount = SSEN_LISTED_FROZEN,
): { ok: boolean; violations: string[] } {
  const violations: string[] = []
  if (plan.summary.problems_deleted !== 0) violations.push('DELETE != 0')
  if (plan.summary.raw_ocr_changed !== 0) violations.push('raw OCR != 0')
  if (listedCount === SSEN_LISTED_FROZEN && plan.integrity.listed !== listedCount) {
    violations.push(`listed ${plan.integrity.listed} != ${listedCount}`)
  }
  if (plan.summary.embeddings_changed !== 0) violations.push('embeddings changed')
  if (plan.summary.fingerprints_changed !== 0) violations.push('fingerprints changed')
  if (plan.summary.paid_ocr_calls !== 0) violations.push('paid OCR != 0')
  if (plan.applies.some((_, i) => plan.records.find((row) => row.problem_id === plan.applies[i]?.problem_id)?.teacher_edit)) {
    violations.push('TEACHER_EDIT overwrite')
  }
  if (plan.applies.some((_, i) => plan.records.find((row) => row.problem_id === plan.applies[i]?.problem_id)?.verified)) {
    violations.push('VERIFIED overwrite')
  }
  if (plan.summary.pages_inspected !== SSEN_PAGE_COUNT) violations.push(`pages ${plan.summary.pages_inspected} != 192`)
  return { ok: violations.length === 0, violations }
}

export function paidOcrPlan839(plan: QaPlan839): {
  unique_problems: number
  unique_pages: number
  mathpix_usd_per_image: number
  mathpix_usd_per_pdf_page: number
  mistral_usd_per_page: number
  mathpix_image_estimate_usd: number
  mathpix_pdf_estimate_usd: number
  mistral_estimate_usd: number
  recommended: string
  max_usd: number
  source: string[]
} {
  const rows = plan.records.filter((row) => row.display_state === 'LISTED' && row.verdict === 'PAID_OCR_CANDIDATE')
  const pages = new Set(rows.map((row) => row.source_page).filter((page): page is number => page != null))
  const n = pages.size
  const mathpixImage = 0.002
  const mathpixPdf = 0.005
  const mistral = 0.004
  return {
    unique_problems: rows.length,
    unique_pages: n,
    mathpix_usd_per_image: mathpixImage,
    mathpix_usd_per_pdf_page: mathpixPdf,
    mistral_usd_per_page: mistral,
    mathpix_image_estimate_usd: Number((n * mathpixImage).toFixed(4)),
    mathpix_pdf_estimate_usd: Number((n * mathpixPdf).toFixed(4)),
    mistral_estimate_usd: Number((n * mistral).toFixed(4)),
    recommended:
      n === 0
        ? '호출 불필요'
        : '페이지당 1회. 교재 페이지는 12행 초과 가능성이 높아 Mathpix는 PDF 페이지 단가($0.005)로 잡는 것이 안전. Mistral OCR 4는 $0.004/page. 소량 후보면 Mathpix 이미지 $0.002가 더 싸지만 교과서 페이지는 PDF 단가가 적용될 수 있다. 권장: 사용자 승인 후 해당 페이지만 Mathpix v3/pdf 또는 Mistral OCR 4 페이지 1회.',
    max_usd: Number((n * Math.max(mathpixPdf, mistral)).toFixed(4)),
    source: [
      'https://mathpix.com/pricing/api ($0.002/image, $0.005/PDF page, 12행 초과 이미지는 PDF 단가)',
      'https://mistral.ai/pricing/api/ OCR 4 $4 / 1000 pages = $0.004/page',
      'https://docs.mistral.ai/inference/pricing OCR 4 €3.5 / 1000 pages (EUR list)',
    ],
  }
}

export function formatQaMarkdown(plan: QaPlan839): string {
  const lines = [
    '# STEP 8.39 full QA audit',
    '',
    `- pages: ${plan.summary.pages_inspected}/${SSEN_PAGE_COUNT}`,
    `- listed: ${plan.summary.listed_inspected}/${SSEN_LISTED_FROZEN}`,
    `- PASS ${plan.summary.pass} · AUTO_SAFE ${plan.summary.auto_safe} · REVIEW ${plan.summary.review_required} · PAID_OCR ${plan.summary.paid_ocr_candidate} · BLOCKED ${plan.summary.blocked}`,
    `- P0 ${plan.summary.p0} P1 ${plan.summary.p1} P2 ${plan.summary.p2} P3 ${plan.summary.p3} P4 ${plan.summary.p4}`,
    `- applies: ${plan.applies.length}`,
    '',
    '| number | page | verdict | priority | signals | reason |',
    '|---|---|---|---|---|---|',
  ]
  for (const row of plan.records.filter((item) => item.display_state === 'LISTED' && item.verdict !== 'PASS').slice(0, 200)) {
    lines.push(
      `| ${row.current_number} | ${row.source_page ?? ''} | ${row.verdict} | ${row.priority ?? ''} | ${row.signals.map((s) => s.code).join(',')} | ${row.verdict_reason.replace(/\|/g, '/')} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

export function problem839(partial: Partial<CatalogProblem839> & Pick<CatalogProblem839, 'id' | 'problem_number' | 'stem'>): CatalogProblem839 {
  const n = partial.problem_number
  return {
    public_code: `HQB-${partial.id}`,
    display_state: 'LISTED',
    review_status: 'AUTO_CLASSIFIED',
    current_version_id: `v-${partial.id}`,
    origin: 'OCR',
    version_no: 1,
    parent_version_id: null,
    original_problem_number: String(n).padStart(4, '0'),
    source_page: 9,
    section_code: '01',
    instruction: null,
    source_document_id: SSEN_SOURCE_DOCUMENT_ID,
    step832_preview: partial.stem,
    crop_present: true,
    has_page_image: false,
    page_ocr_chars: 0,
    item_format: 'CONSTRUCTED_RESPONSE',
    choice_count: 0,
    choices: [],
    figure_ids: [],
    figure_pages: [],
    figure_paths: [],
    fingerprint_values: [],
    lifecycle_status: 'DRAFT',
    major_code: 'I',
    ...partial,
  }
}
