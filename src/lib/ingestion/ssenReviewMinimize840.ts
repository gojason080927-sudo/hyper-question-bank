/**
 * STEP 8.40 — page-grouped contrast of the 128 STEP 8.39 REVIEW_REQUIRED leftovers.
 * Minimize instructor review. Never DELETE. Never paid OCR. Never overwrite TEACHER_EDIT / VERIFIED.
 */
import { SSEN_SECTIONS, SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import {
  isMathBracketFalsePositive,
  parseRangeTokens,
  stemHash838,
  stripLeadingProblemNumber,
} from './rangeStemRestore838'
import {
  EMBEDDINGS_FROZEN,
  FINGERPRINTS_FROZEN,
  MAJORS_FROZEN,
  QUESTION_BANK_REF,
  splitNextNumberLeak,
  SSEN_HIDDEN_FROZEN,
  SSEN_LINKED_FROZEN,
  SSEN_LISTED_FROZEN,
  SSEN_PAGE_COUNT,
  stripSafePackaging839,
  STUDENT_CARE_REF,
  TEST_WORKSHEET_IDS_839,
  type CatalogProblem839,
} from './ssenFullQa839'

export const STEP840 = '8.40'
export const STEP840_DIR = 'ocr-tests/taxonomy/step8-40'
export const INSPECTOR_VERSION_840 = '8.40.1'
export const RULES_VERSION_840 = 'r1'
export const ASSIGNED_BY_840 = 'STEP_8_40'
export const CHANGE_REASON_840 = 'STEP 8.40 review-minimize AUTO_SAFE'
export const LOCK_MAIN_COMMIT_840 = 'd0fa5d2fcbba1728f22c92176016fff1e5865f5a'
export const REVIEW_START_840 = 128
export { QUESTION_BANK_REF, STUDENT_CARE_REF, SSEN_LISTED_FROZEN, EMBEDDINGS_FROZEN, FINGERPRINTS_FROZEN, MAJORS_FROZEN }
export const TEST_WORKSHEET_IDS_840 = TEST_WORKSHEET_IDS_839
export const PRODUCTION_DOMAIN_840 = 'https://hyper-question-bank.vercel.app'
export const VERCEL_PROJECT_NAME_840 = 'hyper-question-bank'
export const VERCEL_PROJECT_ID_840 = 'prj_q7khSRjjjAmwWcfs1FRsEobT1hXC'
export const VERCEL_TEAM_SLUG_840 = 'hyper-student-care'
export const SSEN_HIDDEN = SSEN_HIDDEN_FROZEN
export const SSEN_LINKED = SSEN_LINKED_FROZEN
export const SSEN_PAGES = SSEN_PAGE_COUNT

export type Verdict840 = 'PASS_FALSE_POSITIVE' | 'AUTO_SAFE' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'PAID_OCR_CANDIDATE'
export type Priority840 = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export type Input839Record = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  section_code: string | null
  major_code: string | null
  verdict: string
  priority: string | null
  root_cause: string | null
  verdict_reason: string
  signals: string[]
  stem: string
  proposed_stem: string | null
  teacher_edit?: boolean
  verified?: boolean
  evidence?: string[]
  has_figure?: boolean
  katex?: { render_fail: number; max_width_px: number; overflow_360: boolean; overflow_a4_2col: boolean }
}

export type CatalogRow840 = {
  id: string
  public_code: string
  problem_number: number
  original_problem_number: string
  source_page: number | null
  section_code: string | null
  major_code: string | null
  stem: string
  display_state: string
  origin: string | null
  review_status: string
  current_version_id: string | null
  teacher_edit: boolean
  verified: boolean
  page_ocr?: string
  has_page_image?: boolean
  crop_present?: boolean
  step832_preview?: string | null
}

export type Neighbor840 = {
  number: string
  problem_id: string
  stem: string
  verdict_839?: string | null
}

export type Decision840 = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  section_code: string | null
  major_code: string | null
  priority_839: Priority840 | null
  root_cause_839: string | null
  signals_839: string[]
  verdict: Verdict840
  verdict_reason: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  rules: string[]
  stem: string
  proposed_stem: string | null
  stem_sha256: string
  proposed_sha256: string | null
  current_version_id: string | null
  teacher_edit: boolean
  verified: boolean
  group_key: string
  neighbors_before: Neighbor840[]
  neighbors_after: Neighbor840[]
  page_numbers: string[]
  original_page_available: boolean
  contrast: 'page' | 'neighbors' | 'ocr' | 'none'
}

export type PageGroup840 = {
  group_key: string
  source_id: string
  source_page: number | null
  major_code: string | null
  section_code: string | null
  number_range: string
  listed_numbers: string[]
  candidate_numbers: string[]
  candidate_ids: string[]
  original_page_available: boolean
  page_ocr_chars: number
}

export type Apply840 = {
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

export type Plan840 = {
  inspector_version: string
  rules_version: string
  start_review: number
  unique_pages: number
  groups: PageGroup840[]
  decisions: Decision840[]
  applies: Apply840[]
  p1: Decision840[]
  summary: Summary840
}

export type Summary840 = {
  start_review: number
  unique_pages: number
  unique_ids: number
  p1: number
  pass_false_positive: number
  auto_safe: number
  review_required: number
  blocked: number
  paid_ocr_candidate: number
  human_remaining: number
  human_reduction_pct: number
  new_versions: number
  current_version_switches: number
  queue_cleared: number
  teacher_edit_protected: number
  verified_protected: number
  problems_deleted: number
  raw_ocr_changed: number
  public_code_changed: number
  expected_listed: number
  embeddings_changed: number
  fingerprints_changed: number
  paid_ocr_calls: number
  paid_ocr_pages: number
}

const PROMPT_VERB =
  /구하시오|하시오|고르시오|나타내시오|풀이하시오|푸시오|전개하시오|인수분해하시오|계산하시오|답하시오|말하시오|정리하시오|구하여라/
const PACKAGING_LINE =
  /^(?:#\s*)?(?:유형\s*\d+|개념\s*\d+(?:\s*-\s*\d+)?|정답 및 풀이\s*\d+쪽|대표 문제|보기)\s*$/
const TYPE_PAGE_REF = /^\d+쪽\s*유형\s*\d+/
const CHOICE_MARK = /^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\d+)\s*$/

export function catalogFromQa839(records: Input839Record[]): CatalogRow840[] {
  return records.map((row) => ({
    id: row.problem_id,
    public_code: row.public_code,
    problem_number: Number(row.current_number),
    original_problem_number: row.current_number,
    source_page: row.source_page,
    section_code: row.section_code,
    major_code: row.major_code,
    stem: row.stem,
    display_state: 'LISTED',
    origin: row.teacher_edit ? 'TEACHER_EDIT' : 'OCR',
    review_status: row.verified ? 'VERIFIED' : 'AUTO_CLASSIFIED',
    current_version_id: null,
    teacher_edit: Boolean(row.teacher_edit),
    verified: Boolean(row.verified),
    has_page_image: (row.evidence ?? []).some((item) => item.startsWith('page:') || item === 'page_image'),
    crop_present: (row.evidence ?? []).includes('crop'),
  }))
}

export function catalogFromLive839(rows: CatalogProblem839[]): CatalogRow840[] {
  return rows.map((row) => ({
    id: row.id,
    public_code: row.public_code,
    problem_number: row.problem_number,
    original_problem_number: row.original_problem_number,
    source_page: row.source_page,
    section_code: row.section_code,
    major_code: row.major_code,
    stem: row.stem,
    display_state: row.display_state,
    origin: row.origin,
    review_status: row.review_status,
    current_version_id: row.current_version_id,
    teacher_edit: row.origin === 'TEACHER_EDIT',
    verified: row.review_status === 'VERIFIED',
    has_page_image: row.has_page_image,
    crop_present: row.crop_present,
    step832_preview: row.step832_preview,
    page_ocr: undefined,
  }))
}

export function reviewRequired839(records: Input839Record[]): Input839Record[] {
  const rows = records.filter((row) => row.verdict === 'REVIEW_REQUIRED')
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.problem_id)) return false
    seen.add(row.problem_id)
    return true
  })
}

export function groupKey840(row: { source_page: number | null; major_code: string | null; section_code: string | null }): string {
  return `${SSEN_SOURCE_DOCUMENT_ID}|p${row.source_page ?? 'na'}|${row.major_code ?? '-'}|${row.section_code ?? '-'}`
}

export function listedOf(catalog: CatalogRow840[], n: number): CatalogRow840[] {
  return catalog.filter((row) => row.display_state === 'LISTED' && row.problem_number === n)
}

export function normalizeStem840(text: string): string {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function visibleAtom840(stem: string): boolean {
  const body = stripLeadingProblemNumber(String(stem ?? ''), Number((stem.match(/^(\d{3,4})/) ?? [])[1] ?? 0) || 0).trim()
  const compact = body
    .replace(/\$+/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
  return compact.length > 0 && compact.length <= 16 && !PROMPT_VERB.test(body) && !/다음 중|대표 문제/.test(body)
}

export function siblingItemLabelsOutsideRange(stem: string, current: number, start: number, end: number): number[] {
  const token = parseRangeTokens(stem).find((row) => row.start === start && row.end === end)
  const rest = token ? `${stem.slice(0, token.index)}${stem.slice(token.index + token.length)}` : stem
  const found: number[] = []
  for (const match of rest.matchAll(/(?:^|\n)\s*(\d{3,4})(?!\d)/g)) {
    const n = Number(match[1])
    if (n !== current && n >= start && n <= end && !found.includes(n)) found.push(n)
  }
  return found
}

export function coveringRangeRow(catalog: CatalogRow840[], number: number): CatalogRow840 | null {
  const listed = catalog.filter((row) => row.display_state === 'LISTED')
  return (
    listed.find((row) =>
      parseRangeTokens(row.stem).some((token) => token.start <= number && number <= token.end && token.end - token.start <= 20),
    ) ?? null
  )
}

export function extractRangePromptFromPageOcr(pageOcr: string, startNumber: number): { raw: string; start: number; end: number; prompt: string } | null {
  const tokens = parseRangeTokens(String(pageOcr ?? ''))
  const own = tokens.find((token) => token.start === startNumber)
  if (!own) return null
  const after = String(pageOcr).slice(own.index + own.length)
  const line = (after.match(/^[^\n]{0,200}/)?.[0] ?? '').replace(/\s+/g, ' ').trim()
  const prompt = line.replace(/^\d{3,4}\b.*/, '').trim()
  if (!prompt || prompt.length < 6) return null
  if (!PROMPT_VERB.test(prompt) && !/다음/.test(prompt)) return null
  return { raw: own.raw, start: own.start, end: own.end, prompt: prompt.slice(0, 180) }
}

export function stripSafePackaging840(text: string): { text: string; rules: string[] } {
  const first = stripSafePackaging839(text)
  let next = first.text
  const rules = [...first.rules]
  const stripTrailingSection = () => {
    let changed = false
    for (const section of SSEN_SECTIONS) {
      const title = section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const code = section.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const sameLine = new RegExp(`(?:\\n|\\s+)${code}\\s*${title}\\s*$`)
      const twoLine = new RegExp(`(?:\\n|\\s+)${code}\\s*\\n\\s*${title}\\s*$`)
      if (twoLine.test(next)) {
        next = next.replace(twoLine, '')
        rules.push(`trailing_section_code:${section.code} ${section.title}`)
        changed = true
      } else if (sameLine.test(next)) {
        next = next.replace(sameLine, '')
        rules.push(`trailing_section_code:${section.code} ${section.title}`)
        changed = true
      }
    }
    return changed
  }
  stripTrailingSection()
  for (let i = 0; i < 8; i += 1) {
    const lines = next.split('\n')
    if (lines.length < 2) break
    const last = lines[lines.length - 1]!.trim()
    if (PACKAGING_LINE.test(last) || TYPE_PAGE_REF.test(last) || last === '#' || /^#\s*유형/.test(last)) {
      lines.pop()
      next = lines.join('\n').trim()
      rules.push(`trailing_packaging:${last.slice(0, 40)}`)
      continue
    }
    if (stripTrailingSection()) continue
    break
  }
  next = next.replace(/\n?#+\s*$/g, () => {
    rules.push('trailing_hashes')
    return ''
  })
  next = normalizeStem840(next)
  if (next === normalizeStem840(text) && rules.length === 0) return { text: normalizeStem840(text), rules: [] }
  return { text: next, rules }
}

export function isPackagingTrailer840(leaked: string): boolean {
  const body = stripLeadingProblemNumber(leaked, Number((leaked.match(/(\d{3,4})/) ?? [])[1] ?? 0)).trim()
  if (!body) return true
  if (body.length <= 24 && /대표 문제/.test(body) && !PROMPT_VERB.test(body)) return true
  if (TYPE_PAGE_REF.test(body) && body.length < 40) return true
  if (PACKAGING_LINE.test(body)) return true
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length <= 2 && lines.every((line) => PACKAGING_LINE.test(line) || TYPE_PAGE_REF.test(line) || /대표 문제/.test(line))) {
    return true
  }
  if (
    lines.length === 2 &&
    CHOICE_MARK.test(lines[0] ?? '') &&
    /방정식|부등식|복소수|다항식|행렬|순열/.test(lines[1] ?? '')
  ) {
    return true
  }
  return false
}

export function extraListedNumbersInStem(stem: string, current: number, catalog: CatalogRow840[]): number[] {
  const found: number[] = []
  for (const match of stem.matchAll(/(?:^|\n)\s*(\d{3,4})(?!\d)/g)) {
    const n = Number(match[1])
    if (n === current) continue
    if (listedOf(catalog, n).length && !found.includes(n)) found.push(n)
  }
  return found
}

export function stemsAlign840(left: string, right: string): boolean {
  const a = normalizeStem840(left)
  const b = normalizeStem840(right)
  if (!a || !b) return false
  if (a === b) return true
  if (a.length < 24 || b.length < 24) return false
  return a.startsWith(b) || b.startsWith(a.slice(0, 40))
}

export function proposeTrimGluedItems840(
  stem: string,
  current: number,
  catalog: CatalogRow840[],
): { stem: string; rules: string[] } | null {
  const next = listedOf(catalog, current + 1)[0]
  const leak = splitNextNumberLeak(stem, current, next?.stem ?? null)
  if (!leak) {
    const later = parseRangeTokens(stem).filter((token) => token.start > current && !isMathBracketFalsePositive(stem, token))
    if (!later[0]) return null
    const keep = stem.slice(0, later[0].index).trim()
    const leaked = stem.slice(later[0].index).trim()
    const startRow = listedOf(catalog, later[0].start)[0]
    if (!keep || !startRow) return null
    if (extraListedNumbersInStem(keep, current, catalog).length) return null
    const startNorm = normalizeStem840(stripLeadingProblemNumber(startRow.stem, startRow.problem_number))
    const leakedNorm = normalizeStem840(stripLeadingProblemNumber(leaked, later[0].start))
    if (stemsAlign840(leakedNorm, startNorm) || (startNorm.includes(later[0].raw) && leakedNorm.startsWith(later[0].raw))) {
      const cleaned = stripSafePackaging840(keep)
      return { stem: cleaned.text, rules: ['range_leak_already_on_next', ...cleaned.rules] }
    }
    return null
  }
  if (!next) return null
  if (isPackagingTrailer840(leak.leaked)) {
    const cleaned = stripSafePackaging840(leak.keep)
    return { stem: cleaned.text, rules: ['next_number_packaging_trailer', ...cleaned.rules] }
  }
  const nextNorm = normalizeStem840(stripLeadingProblemNumber(next.stem, next.problem_number))
  const leakedNorm = normalizeStem840(stripLeadingProblemNumber(leak.leaked, next.problem_number))
  if (stemsAlign840(leakedNorm, nextNorm)) {
    const cleaned = stripSafePackaging840(leak.keep)
    return { stem: cleaned.text, rules: ['next_number_leak_equals_next', ...cleaned.rules] }
  }
  return null
}

function neighborsFor(catalog: CatalogRow840[], number: number, page: number | null, records839: Map<string, Input839Record>): {
  before: Neighbor840[]
  after: Neighbor840[]
} {
  const listed = catalog
    .filter((row) => row.display_state === 'LISTED')
    .sort((a, b) => a.problem_number - b.problem_number)
  const idx = listed.findIndex((row) => row.problem_number === number)
  const slice = (rows: CatalogRow840[]): Neighbor840[] =>
    rows.map((row) => ({
      number: row.original_problem_number,
      problem_id: row.id,
      stem: row.stem,
      verdict_839: records839.get(row.id)?.verdict ?? null,
    }))
  const before = idx >= 0 ? listed.slice(Math.max(0, idx - 2), idx) : listed.filter((row) => page != null && row.source_page === page && row.problem_number < number).slice(-2)
  const after = idx >= 0 ? listed.slice(idx + 1, idx + 3) : listed.filter((row) => page != null && row.source_page === page && row.problem_number > number).slice(0, 2)
  return { before: slice(before), after: slice(after) }
}

function evidenceFor(row: CatalogRow840, pageOcr: string | undefined, extra: string[]): string[] {
  const items = [...extra]
  if (row.crop_present) items.push('crop')
  if (row.has_page_image) items.push('page_image')
  if ((pageOcr ?? '').length > 0) items.push('page_ocr')
  if (row.step832_preview) items.push('step832_preview')
  if (row.source_page != null) items.push(`page:${row.source_page}`)
  if (row.section_code) items.push(`section:${row.section_code}`)
  return [...new Set(items)]
}

export function decideOne840(
  candidate: Input839Record,
  catalog: CatalogRow840[],
  options: { pageOcrByPage?: Map<number, string>; records839?: Map<string, Input839Record> } = {},
): Decision840 {
  const live = catalog.find((row) => row.id === candidate.problem_id)
  const number = Number(candidate.current_number)
  const stem = live?.stem ?? candidate.stem
  const page = live?.source_page ?? candidate.source_page
  const teacher = Boolean(live?.teacher_edit || candidate.teacher_edit || live?.origin === 'TEACHER_EDIT')
  const verified = Boolean(live?.verified || candidate.verified || live?.review_status === 'VERIFIED')
  const pageOcr = (page != null ? options.pageOcrByPage?.get(page) : undefined) ?? live?.page_ocr
  const records839 = options.records839 ?? new Map()
  const nb = neighborsFor(catalog, number, page, records839)
  const pageNumbers = catalog
    .filter((row) => row.display_state === 'LISTED' && row.source_page === page)
    .map((row) => row.original_problem_number)
    .sort()
  const base = {
    problem_id: candidate.problem_id,
    public_code: live?.public_code ?? candidate.public_code,
    current_number: candidate.current_number,
    source_page: page,
    section_code: live?.section_code ?? candidate.section_code,
    major_code: live?.major_code ?? candidate.major_code,
    priority_839: (candidate.priority as Priority840 | null) ?? null,
    root_cause_839: candidate.root_cause,
    signals_839: candidate.signals,
    stem,
    stem_sha256: stemHash838(stem),
    current_version_id: live?.current_version_id ?? null,
    teacher_edit: teacher,
    verified,
    group_key: groupKey840({ source_page: page, major_code: live?.major_code ?? candidate.major_code, section_code: live?.section_code ?? candidate.section_code }),
    neighbors_before: nb.before,
    neighbors_after: nb.after,
    page_numbers: pageNumbers,
    original_page_available: Boolean(live?.has_page_image || pageOcr),
    contrast: (live?.has_page_image ? 'page' : pageOcr ? 'ocr' : nb.before.length + nb.after.length > 0 ? 'neighbors' : 'none') as Decision840['contrast'],
  }

  const finish = (
    verdict: Verdict840,
    reason: string,
    extra: Partial<Decision840> = {},
  ): Decision840 => {
    const proposed = extra.proposed_stem ?? null
    return {
      ...base,
      verdict,
      verdict_reason: reason,
      confidence: extra.confidence ?? (verdict === 'REVIEW_REQUIRED' || verdict === 'BLOCKED' ? 'medium' : 'high'),
      evidence: evidenceFor(live ?? catalogFromQa839([candidate])[0]!, pageOcr, extra.evidence ?? []),
      rules: extra.rules ?? [],
      proposed_stem: proposed,
      proposed_sha256: proposed ? stemHash838(proposed) : null,
    }
  }

  if (live && live.display_state !== 'LISTED') {
    return finish('BLOCKED', 'HIDDEN_DUPLICATE는 listed 복원 대상이 아니다', { rules: ['hidden'] })
  }
  if (teacher || verified) {
    return finish('REVIEW_REQUIRED', 'TEACHER_EDIT/VERIFIED 보호 — 자동 수정·오탐 해제 금지', {
      rules: ['protected'],
      confidence: 'high',
    })
  }

  const signals = new Set(candidate.signals)
  const root = candidate.root_cause ?? ''
  const packed = stripSafePackaging840(stem)
  const glued = proposeTrimGluedItems840(packed.text, number, catalog)

  const ownTokens = parseRangeTokens(stem).filter((token) => token.start === number)
  const laterTokens = parseRangeTokens(stem).filter(
    (token) => token.start > number && !isMathBracketFalsePositive(stem, token),
  )
  const covering = coveringRangeRow(catalog, number)
  const pageRange = pageOcr ? extractRangePromptFromPageOcr(pageOcr, number) : null

  if (root === 'DUPLICATE_BODY' || signals.has('DUPLICATE_BODY')) {
    return finish(
      'REVIEW_REQUIRED',
      '동일 스텁 본문. 원본 페이지에는 선택지가 있으나 숫자를 추측해 채우지 않는다',
      { rules: ['duplicate_body_stub'], evidence: ['original_page_shows_choices'], confidence: 'high' },
    )
  }

  if ((root === 'OWN_RANGE_HEADER' || signals.has('OWN_RANGE_HEADER')) && ownTokens[0] && !laterTokens[0]) {
    const extras = siblingItemLabelsOutsideRange(stem, number, ownTokens[0].start, ownTokens[0].end)
    if (extras.length === 0) {
      return finish(
        'PASS_FALSE_POSITIVE',
        `정상 공통 발문 ${ownTokens[0].raw}. 8.39 extraSiblingNumbers는 범위 토큰 끝번호를 오탐했다`,
        { rules: ['own_range_token_false_positive'], evidence: [`range:${ownTokens[0].raw}`], confidence: 'high' },
      )
    }
    return finish('REVIEW_REQUIRED', `공통 발문에 형제 문항 ${extras.join(',')}이 본문으로 붙어 있다. 분리·삭제 금지`, {
      rules: ['own_range_glued_siblings'],
    })
  }

  if (root === 'TOO_SHORT' || signals.has('TOO_SHORT')) {
    if (covering && covering.id !== candidate.problem_id) {
      return finish(
        'PASS_FALSE_POSITIVE',
        `짧은 수식 하위 항목이 정상이다. 공통 발문은 ${covering.original_problem_number}에 이미 있다`,
        { rules: ['too_short_subitem_covered'], evidence: [`covering:${covering.original_problem_number}`] },
      )
    }
    if (pageRange && pageRange.start === number && !ownTokens[0] && visibleAtom840(stem)) {
      const proposed = normalizeStem840(`${pageRange.raw} ${pageRange.prompt}\n${stripLeadingProblemNumber(stem, number)}`)
      if (proposed !== normalizeStem840(stem) && PROMPT_VERB.test(pageRange.prompt)) {
        return finish('AUTO_SAFE', `원본 페이지 OCR에서 범위 시작 공통 발문 ${pageRange.raw}을 이 번호에만 연결한다`, {
          rules: ['too_short_restore_start_range_from_page_ocr'],
          proposed_stem: proposed,
          evidence: ['page_ocr_range_token'],
        })
      }
    }
    if (visibleAtom840(stem)) {
      return finish(
        'PASS_FALSE_POSITIVE',
        '원본에서 수식 한 줄 하위 항목으로 짧은 본문이 정상이다. 길이 신호는 오탐. 공통 발문이 이 레코드에 없어도 숫자를 추측해 넣지 않는다',
        { rules: ['too_short_math_atom'], evidence: ['page_subitem_pattern'] },
      )
    }
    return finish('REVIEW_REQUIRED', '짧은 stem이나 원본 하위 항목·누락 조건을 자동으로 확정할 수 없다', {
      rules: ['too_short_unproven'],
    })
  }

  if (glued && glued.stem && glued.stem !== normalizeStem840(stem) && glued.stem.length >= 8) {
    const leftoverLater = parseRangeTokens(glued.stem).filter(
      (token) => token.start > number && !isMathBracketFalsePositive(glued.stem, token),
    )
    const leftoverNext = listedOf(catalog, number + 1)[0]
    const leftoverLeak = splitNextNumberLeak(glued.stem, number, leftoverNext?.stem ?? null)
    if (!leftoverLater[0] && (!leftoverLeak || isPackagingTrailer840(leftoverLeak.leaked))) {
      return finish('AUTO_SAFE', `다음 문항·포장 누수가 원본 경계와 다음 listed stem으로 증명된다: ${glued.rules.join(',')}`, {
        rules: glued.rules,
        proposed_stem: glued.stem,
        evidence: leftoverNext ? [`next:${leftoverNext.original_problem_number}`] : [],
      })
    }
  }

  if ((root === 'HEADER_NOISE' || signals.has('HEADER_NOISE') || signals.has('OCR_PACKAGING')) && packed.rules.length && packed.text !== normalizeStem840(stem)) {
    const leftoverLater = parseRangeTokens(packed.text).filter(
      (token) => token.start > number && !isMathBracketFalsePositive(packed.text, token),
    )
    const leftoverNext = listedOf(catalog, number + 1)[0]
    const leftoverLeak = splitNextNumberLeak(packed.text, number, leftoverNext?.stem ?? null)
    if (!leftoverLater[0] && (!leftoverLeak || isPackagingTrailer840(leftoverLeak.leaked))) {
      return finish('AUTO_SAFE', `원본 본문이 아닌 소단원·유형 포장만 제거한다: ${packed.rules.join(',')}`, {
        rules: packed.rules,
        proposed_stem: packed.text,
      })
    }
  }

  if (root === 'RANGE_LEAK' || signals.has('RANGE_LEAK')) {
    if (laterTokens[0]) {
      const startRow = listedOf(catalog, laterTokens[0].start)[0]
      const keep = stem.slice(0, laterTokens[0].index).trim()
      const leaked = stem.slice(laterTokens[0].index).trim()
      if (startRow && keep.length >= 8 && extraListedNumbersInStem(keep, number, catalog).length === 0) {
        const startNorm = normalizeStem840(stripLeadingProblemNumber(startRow.stem, startRow.problem_number))
        const leakedNorm = normalizeStem840(stripLeadingProblemNumber(leaked, laterTokens[0].start))
        if (stemsAlign840(leakedNorm, startNorm) || (startNorm.includes(laterTokens[0].raw) && leakedNorm.startsWith(laterTokens[0].raw))) {
          return finish('AUTO_SAFE', `뒤에 붙은 ${laterTokens[0].raw}는 다음 listed ${startRow.original_problem_number}에 이미 있다. 현재 문항에서만 제거한다`, {
            rules: ['range_leak_already_on_next'],
            proposed_stem: normalizeStem840(keep),
            evidence: [`next_range:${startRow.original_problem_number}`],
          })
        }
      }
      return finish(
        'REVIEW_REQUIRED',
        `뒤 범위 ${laterTokens[0].raw} 누수. 다음 문항에 동일 발문이 없어 여기서 자르면 공통 조건이 사라질 수 있다`,
        { rules: ['range_leak_unique_copy'], confidence: 'medium' },
      )
    }
    return finish('REVIEW_REQUIRED', 'RANGE_LEAK 신호를 원본 경계로 증명하지 못했다', { rules: ['range_leak_unproven'] })
  }

  if (root === 'NEXT_NUMBER_LEAK' || signals.has('NEXT_NUMBER_LEAK')) {
    const next = listedOf(catalog, number + 1)[0]
    const leak = splitNextNumberLeak(stem, number, next?.stem ?? null)
    if (!next) {
      return finish(
        'REVIEW_REQUIRED',
        `다음 번호 ${String(number + 1).padStart(4, '0')} listed 레코드가 없다. 자르면 유일 본문이 사라진다`,
        { rules: ['next_missing_listed'], evidence: ['missing_next_listed'] },
      )
    }
    if (leak && isPackagingTrailer840(leak.leaked) && leak.keep.length >= 8) {
      const cleaned = stripSafePackaging840(leak.keep)
      return finish('AUTO_SAFE', '다음 번호처럼 보이지만 쪽·유형·대표문제 포장이다. 현재 본문만 남긴다', {
        rules: ['next_number_packaging_trailer', ...cleaned.rules],
        proposed_stem: cleaned.text,
        evidence: [`next:${next.original_problem_number}`],
      })
    }
    if (!leak) {
      return finish('PASS_FALSE_POSITIVE', 'NEXT_NUMBER_LEAK 신호가 현재 stem·다음 listed와 맞지 않는 오탐이다', {
        rules: ['next_leak_false_detect'],
      })
    }
    return finish(
      'REVIEW_REQUIRED',
      '다음 문항 본문이 붙어 있으나 다음 listed stem과 일치하지 않아 자동 절단하지 않는다',
      { rules: ['next_leak_unequal'], confidence: 'medium' },
    )
  }

  if (root === 'LEADING_NUMBER_DUP' || signals.has('LEADING_NUMBER_DUP')) {
    const stripped = normalizeStem840(stripLeadingProblemNumber(stem, number))
    if (stripped && stripped !== normalizeStem840(stem) && visibleAtom840(stripped)) {
      return finish('PASS_FALSE_POSITIVE', '선행 번호 중복과 짧은 수식 하위 항목은 원본에서 정상이다', {
        rules: ['leading_number_short_atom'],
      })
    }
    if (packed.rules.length && packed.text !== normalizeStem840(stem)) {
      return finish('AUTO_SAFE', '선행 번호·포장만 제거한다', { rules: packed.rules, proposed_stem: packed.text })
    }
  }

  if (!live?.has_page_image && !(pageOcr && pageOcr.length > 40) && !live?.crop_present && !live?.step832_preview) {
    return finish('BLOCKED', '원본 페이지·crop·OCR 근거가 부족하다. 유료 OCR은 호출하지 않는다', {
      rules: ['no_original_region'],
      confidence: 'low',
    })
  }

  return finish('REVIEW_REQUIRED', '원본을 사람이 보면 판단할 수 있으나 자동 수정 경계가 아니다', {
    rules: ['needs_human'],
    confidence: 'medium',
  })
}

export function buildPageGroups840(candidates: Input839Record[], catalog: CatalogRow840[], pageOcrByPage: Map<number, string> = new Map()): PageGroup840[] {
  const map = new Map<string, PageGroup840>()
  for (const row of candidates) {
    const live = catalog.find((item) => item.id === row.problem_id)
    const key = groupKey840({
      source_page: live?.source_page ?? row.source_page,
      major_code: live?.major_code ?? row.major_code,
      section_code: live?.section_code ?? row.section_code,
    })
    const page = live?.source_page ?? row.source_page
    const listed = catalog
      .filter((item) => item.display_state === 'LISTED' && item.source_page === page)
      .map((item) => item.original_problem_number)
      .sort()
    const existing = map.get(key)
    if (existing) {
      existing.candidate_ids.push(row.problem_id)
      existing.candidate_numbers.push(row.current_number)
      continue
    }
    const nums = listed.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    map.set(key, {
      group_key: key,
      source_id: SSEN_SOURCE_DOCUMENT_ID,
      source_page: page,
      major_code: live?.major_code ?? row.major_code,
      section_code: live?.section_code ?? row.section_code,
      number_range: nums.length ? `${String(Math.min(...nums)).padStart(4, '0')}~${String(Math.max(...nums)).padStart(4, '0')}` : row.current_number,
      listed_numbers: listed,
      candidate_numbers: [row.current_number],
      candidate_ids: [row.problem_id],
      original_page_available: Boolean(live?.has_page_image || (page != null && pageOcrByPage.get(page))),
      page_ocr_chars: page != null ? (pageOcrByPage.get(page)?.length ?? 0) : 0,
    })
  }
  return [...map.values()].sort((a, b) => (a.source_page ?? 0) - (b.source_page ?? 0))
}

export function minimizeReview840(
  candidates: Input839Record[],
  catalog: CatalogRow840[],
  options: { pageOcrByPage?: Map<number, string> } = {},
): Plan840 {
  const unique = reviewRequired839(candidates)
  const records839 = new Map(candidates.map((row) => [row.problem_id, row]))
  const groups = buildPageGroups840(unique, catalog, options.pageOcrByPage)
  const decisions = unique.map((row) => decideOne840(row, catalog, { ...options, records839 }))
  const applies: Apply840[] = []
  for (const row of decisions) {
    if (row.verdict !== 'AUTO_SAFE' || !row.proposed_stem) continue
    if (normalizeStem840(row.proposed_stem) === normalizeStem840(row.stem)) continue
    if (row.teacher_edit || row.verified) continue
    applies.push({
      problem_id: row.problem_id,
      public_code: row.public_code,
      current_number: row.current_number,
      source_page: row.source_page,
      from_stem: row.stem,
      to_stem: row.proposed_stem,
      from_hash: row.stem_sha256,
      to_hash: row.proposed_sha256 ?? stemHash838(row.proposed_stem),
      rules: row.rules,
      parent_version_id: row.current_version_id,
    })
  }
  const count = (verdict: Verdict840) => decisions.filter((row) => row.verdict === verdict).length
  const human = count('REVIEW_REQUIRED') + count('BLOCKED') + count('PAID_OCR_CANDIDATE')
  const summary: Summary840 = {
    start_review: unique.length,
    unique_pages: new Set(unique.map((row) => row.source_page)).size,
    unique_ids: new Set(unique.map((row) => row.problem_id)).size,
    p1: unique.filter((row) => row.priority === 'P1').length,
    pass_false_positive: count('PASS_FALSE_POSITIVE'),
    auto_safe: count('AUTO_SAFE'),
    review_required: count('REVIEW_REQUIRED'),
    blocked: count('BLOCKED'),
    paid_ocr_candidate: count('PAID_OCR_CANDIDATE'),
    human_remaining: human,
    human_reduction_pct: unique.length ? Number((((unique.length - human) / unique.length) * 100).toFixed(1)) : 0,
    new_versions: applies.length,
    current_version_switches: applies.length,
    queue_cleared: count('PASS_FALSE_POSITIVE'),
    teacher_edit_protected: decisions.filter((row) => row.teacher_edit).length,
    verified_protected: decisions.filter((row) => row.verified).length,
    problems_deleted: 0,
    raw_ocr_changed: 0,
    public_code_changed: 0,
    expected_listed: SSEN_LISTED_FROZEN,
    embeddings_changed: 0,
    fingerprints_changed: 0,
    paid_ocr_calls: 0,
    paid_ocr_pages: 0,
  }
  return {
    inspector_version: INSPECTOR_VERSION_840,
    rules_version: RULES_VERSION_840,
    start_review: unique.length,
    unique_pages: summary.unique_pages,
    groups,
    decisions,
    applies,
    p1: decisions.filter((row) => row.priority_839 === 'P1'),
    summary,
  }
}

export function withAppliedStems840(catalog: CatalogRow840[], applies: Apply840[]): CatalogRow840[] {
  const map = new Map(applies.map((row) => [row.problem_id, row.to_stem]))
  return catalog.map((row) => (map.has(row.id) ? { ...row, stem: map.get(row.id)! } : row))
}

export function dryRunSafety840(
  plan: Plan840,
  listedCount = SSEN_LISTED_FROZEN,
): { ok: boolean; violations: string[] } {
  const violations: string[] = []
  if (plan.summary.start_review !== REVIEW_START_840 && plan.summary.start_review !== plan.decisions.length) {
    violations.push(`start review ${plan.summary.start_review}`)
  }
  if (plan.summary.problems_deleted !== 0) violations.push('DELETE != 0')
  if (plan.summary.raw_ocr_changed !== 0) violations.push('raw OCR != 0')
  if (plan.summary.public_code_changed !== 0) violations.push('public_code changed')
  if (listedCount !== SSEN_LISTED_FROZEN) violations.push(`listed ${listedCount} != ${SSEN_LISTED_FROZEN}`)
  if (plan.summary.embeddings_changed !== 0) violations.push('embeddings changed')
  if (plan.summary.fingerprints_changed !== 0) violations.push('fingerprints changed')
  if (plan.summary.paid_ocr_calls !== 0) violations.push('paid OCR != 0')
  if (plan.applies.some((row) => plan.decisions.find((item) => item.problem_id === row.problem_id)?.teacher_edit)) {
    violations.push('TEACHER_EDIT overwrite')
  }
  if (plan.applies.some((row) => plan.decisions.find((item) => item.problem_id === row.problem_id)?.verified)) {
    violations.push('VERIFIED overwrite')
  }
  if (plan.applies.some((row) => plan.decisions.find((item) => item.problem_id === row.problem_id)?.verdict !== 'AUTO_SAFE')) {
    violations.push('non AUTO_SAFE apply')
  }
  if (plan.summary.unique_ids !== plan.decisions.length) violations.push('duplicate or missing ids')
  if (plan.p1.length !== plan.decisions.filter((row) => row.priority_839 === 'P1').length) violations.push('P1 incomplete')
  return { ok: violations.length === 0, violations }
}

export function paidOcrPlan840(plan: Plan840): {
  unique_problems: number
  unique_pages: number
  mathpix_usd_per_image: number
  mathpix_usd_per_pdf_page: number
  mistral_usd_per_page: number
  max_usd: number
  recommended: string
  calls: number
} {
  const rows = plan.decisions.filter((row) => row.verdict === 'PAID_OCR_CANDIDATE')
  const pages = new Set(rows.map((row) => row.source_page).filter((page): page is number => page != null))
  const n = pages.size
  return {
    unique_problems: rows.length,
    unique_pages: n,
    mathpix_usd_per_image: 0.002,
    mathpix_usd_per_pdf_page: 0.005,
    mistral_usd_per_page: 0.004,
    max_usd: Number((n * 0.005).toFixed(4)),
    recommended: n === 0 ? '호출 불필요' : '이번 단계는 0회. 필요 시 해당 페이지만 사용자 승인 후 1회.',
    calls: 0,
  }
}

export function formatAuditMarkdown840(plan: Plan840): string {
  const lines = [
    '# STEP 8.40 review-minimize audit',
    '',
    `- start REVIEW_REQUIRED: ${plan.summary.start_review}`,
    `- unique pages: ${plan.summary.unique_pages}`,
    `- PASS_FALSE_POSITIVE ${plan.summary.pass_false_positive} · AUTO_SAFE ${plan.summary.auto_safe} · REVIEW ${plan.summary.review_required} · BLOCKED ${plan.summary.blocked} · PAID ${plan.summary.paid_ocr_candidate}`,
    `- human remaining ${plan.summary.human_remaining} (${plan.summary.human_reduction_pct}% cleared)`,
    `- applies: ${plan.applies.length}`,
    `- paid OCR calls: 0`,
    '',
    '## P1',
    '',
    '| number | page | verdict | reason |',
    '|---|---|---|---|',
  ]
  for (const row of plan.p1) {
    lines.push(`| ${row.current_number} | ${row.source_page ?? ''} | ${row.verdict} | ${row.verdict_reason.replace(/\|/g, '/')} |`)
  }
  lines.push('', '## Decisions', '', '| number | page | 8.39 | 8.40 | rules |', '|---|---|---|---|---|')
  for (const row of plan.decisions) {
    lines.push(
      `| ${row.current_number} | ${row.source_page ?? ''} | ${row.root_cause_839} | ${row.verdict} | ${row.rules.join(',')} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

export function skipIfCurrentChanged840(
  apply: Apply840,
  live: CatalogRow840 | undefined,
): { skip: boolean; reason: string | null } {
  if (!live) return { skip: true, reason: 'missing live row' }
  if (live.teacher_edit || live.origin === 'TEACHER_EDIT') return { skip: true, reason: 'TEACHER_EDIT' }
  if (live.verified || live.review_status === 'VERIFIED') return { skip: true, reason: 'VERIFIED' }
  if (live.current_version_id && apply.parent_version_id && live.current_version_id !== apply.parent_version_id) {
    return { skip: true, reason: 'current version changed' }
  }
  if (stemHash838(live.stem) !== apply.from_hash && normalizeStem840(live.stem) !== normalizeStem840(apply.from_stem)) {
    return { skip: true, reason: 'current stem hash changed' }
  }
  return { skip: false, reason: null }
}

export function contactSheetHtml840(group: PageGroup840, decisions: Decision840[], pagePngRel: string | null): string {
  const rows = decisions.filter((row) => row.group_key === group.group_key)
  const cards = rows
    .map((row) => {
      const proposed = row.proposed_stem
        ? `<pre>${escapeHtml(row.proposed_stem.slice(0, 800))}</pre>`
        : '<p class="muted">수정 후보 없음</p>'
      return `<article>
        <h3>${row.current_number} · ${row.verdict}</h3>
        <p>${escapeHtml(row.verdict_reason)}</p>
        <div class="cols">
          <section><h4>현재</h4><pre>${escapeHtml(row.stem.slice(0, 800))}</pre></section>
          <section><h4>수정 후보</h4>${proposed}</section>
        </div>
      </article>`
    })
    .join('\n')
  const img = pagePngRel
    ? `<img src="${pagePngRel}" alt="원본 페이지 ${group.source_page ?? ''}" />`
    : '<p>페이지 PNG 없음 — 문제번호 crop을 꾸미지 않음</p>'
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>STEP 8.40 p.${group.source_page}</title>
<style>
body{font-family:sans-serif;max-width:1200px;margin:16px auto;padding:0 12px}
.sheet{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media(max-width:900px){.sheet,.cols{grid-template-columns:1fr}}
img{max-width:100%;border:1px solid #ccc}
pre{white-space:pre-wrap;background:#f7f7f7;padding:8px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.muted{color:#666}
</style></head><body>
<h1>페이지 ${group.source_page ?? '—'} · ${group.number_range}</h1>
<p>listed ${group.listed_numbers.join(', ')} · 후보 ${group.candidate_numbers.join(', ')}</p>
<div class="sheet">
  <section><h2>원본 페이지</h2>${img}<p>문자 좌표 없는 임의 crop은 사용하지 않음.</p></section>
  <section><h2>현재 DB · 수정 후보</h2>${cards}</section>
  <section><h2>앞뒤 번호</h2><p>${group.listed_numbers.join(' · ')}</p></section>
</div>
</body></html>`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

export function row840(partial: Partial<CatalogRow840> & Pick<CatalogRow840, 'id' | 'problem_number' | 'stem'>): CatalogRow840 {
  const n = partial.problem_number
  return {
    public_code: `HQB-${partial.id}`,
    original_problem_number: String(n).padStart(4, '0'),
    source_page: 9,
    section_code: '01',
    major_code: 'I',
    display_state: 'LISTED',
    origin: 'OCR',
    review_status: 'AUTO_CLASSIFIED',
    current_version_id: `v-${partial.id}`,
    teacher_edit: false,
    verified: false,
    has_page_image: true,
    crop_present: true,
    ...partial,
    id: partial.id,
    problem_number: n,
    stem: partial.stem,
  }
}

export function candidate840(
  partial: Partial<Input839Record> & Pick<Input839Record, 'problem_id' | 'current_number' | 'stem'>,
): Input839Record {
  return {
    public_code: `HQB-${partial.problem_id}`,
    source_page: 9,
    section_code: '01',
    major_code: 'I',
    verdict: 'REVIEW_REQUIRED',
    priority: 'P2',
    root_cause: 'OWN_RANGE_HEADER',
    verdict_reason: '8.39 leftover',
    signals: ['OWN_RANGE_HEADER'],
    proposed_stem: null,
    teacher_edit: false,
    verified: false,
    evidence: ['page:9'],
    ...partial,
  }
}
