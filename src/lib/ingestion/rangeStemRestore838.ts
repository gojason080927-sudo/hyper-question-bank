/**
 * STEP 8.38 — restore leaked `[n~m]` shared prompts onto existing records.
 * Never DELETE. Never overwrite TEACHER_EDIT / VERIFIED. Never invent problems.
 */
import { sectionForPage, SSEN_MAJORS, SSEN_SECTIONS, SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'

export const STEP838 = '8.38'
export const STEP838_DIR = 'ocr-tests/taxonomy/step8-38'
export const ASSIGNED_BY_838 = 'STEP_8_38'
export const CHANGE_REASON_838 = 'STEP 8.38 range-stem restore'
export const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
export const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
export const SSEN_LISTED_FROZEN = 1242
export const TEST_WORKSHEET_IDS_838 = [
  '671dffbc-ffff-4438-b072-07fde6ce637b',
  'eed4ad3b-7963-4697-a36f-3ac3b63b16d6',
  'd322df83-429b-4eec-93ea-ee58c99b3757',
  '2d48d36d-86cf-43ff-ab26-e373a1c5a88c',
  '6b96c426-f29e-4835-bdce-5901c050f3fa',
] as const

export const RANGE_TOKEN_RE = /\[(\d{1,4})\s*[~～-]\s*(\d{1,4})\]/g
const PROMPT_VERB =
  /구하시오|하시오|고르시오|나타내시오|풀이하시오|푸시오|전개하시오|인수분해하시오|계산하시오|답하시오|말하시오|정리하시오|구하여라|하라/
const LATEX_KEEP = /\$|\\frac|\\times|\\begin\{pmatrix\}|\\begin\{array\}/
const MAX_RANGE_SPAN = 20

export type RangeVerdict838 = 'AUTO_SAFE' | 'REVIEW_REQUIRED' | 'BLOCKED'

export type RangeToken838 = {
  raw: string
  start: number
  end: number
  index: number
  length: number
}

export type CatalogProblem838 = {
  id: string
  public_code: string
  display_state: string
  review_status: string
  current_version_id: string | null
  origin: string | null
  version_no: number | null
  parent_version_id: string | null
  original_problem_number: string
  problem_number: number
  source_page: number | null
  section_code: string | null
  stem: string
  instruction: string | null
  source_document_id: string
  has_page_image?: boolean
  page_ocr_chars?: number
  step832_preview?: string | null
  crop_present?: boolean
}

export type TargetSnapshot838 = {
  problem_number: number
  listed_count: number
  hidden_count: number
  records: Array<{
    id: string
    public_code: string
    display_state: string
    source_page: number | null
    section_code: string | null
    stem: string
    origin: string | null
    review_status: string
    current_version_id: string | null
  }>
}

export type RangeCandidate838 = {
  source_id: string
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  current_stem: string
  detected_range: string | null
  keep: string
  shared: string
  targets: TargetSnapshot838[]
  numbers_consecutive: boolean
  pages_ok: boolean
  origin: string | null
  teacher_edit: boolean
  verified: boolean
  existing_auto_clean: boolean
  evidence: string[]
  verdict: RangeVerdict838
  verdict_reason: string
  planned_changes: string[]
  hash_before: string
  hash_after_donor: string | null
  extra_boundary: string[]
  kind: 'LATER_LEAK' | 'OWN_RANGE_HEADER' | 'HIDDEN_DUPLICATE' | 'OTHER'
}

export type StemApply838 = {
  problem_id: string
  public_code: string
  role: 'donor' | 'target'
  from_stem: string
  to_stem: string
  from_hash: string
  to_hash: string
  parent_version_id: string | null
  current_number: string
  source_page: number | null
  range: string
}

export type RangePlan838 = {
  candidates: RangeCandidate838[]
  applies: StemApply838[]
  summary: RangeSummary838
}

export type RangeSummary838 = {
  candidates: number
  listed_range_hits: number
  hidden_range_hits: number
  later_leaks: number
  auto_safe: number
  review_required: number
  blocked: number
  donor_problems: number
  target_problems: number
  new_versions: number
  current_version_switches: number
  teacher_edit_protected: number
  verified_protected: number
  problems_added: number
  problems_deleted: number
  expected_listed: number
  embeddings_changed: number
  fingerprints_changed: number
  paid_ocr_calls: number
}

export function stemHash838(text: string): string {
  let hash = 5381
  const value = String(text ?? '')
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33) ^ value.charCodeAt(i)
  return `djb2:${(hash >>> 0).toString(16).padStart(8, '0')}:${value.length}`
}

export function parseRangeTokens(text: string): RangeToken838[] {
  const tokens: RangeToken838[] = []
  const source = String(text ?? '')
  const matcher = new RegExp(RANGE_TOKEN_RE.source, 'g')
  for (const match of source.matchAll(matcher)) {
    if (match.index == null) continue
    const start = Number(match[1])
    const end = Number(match[2])
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    if (start < 1 || end < 1 || start > 2000 || end > 2000) continue
    if (start > end) continue
    tokens.push({
      raw: match[0],
      start,
      end,
      index: match.index,
      length: match[0].length,
    })
  }
  return tokens
}

export function isInsideMathSpan(text: string, index: number): boolean {
  let i = 0
  while (i < text.length) {
    if (text.startsWith('$$', i)) {
      const end = text.indexOf('$$', i + 2)
      if (end < 0) return index >= i
      if (index >= i && index < end + 2) return true
      i = end + 2
      continue
    }
    if (text[i] === '$') {
      const end = text.indexOf('$', i + 1)
      if (end < 0) return index >= i
      if (index >= i && index <= end) return true
      i = end + 1
      continue
    }
    if (text.startsWith('\\begin{', i)) {
      const name = text.slice(i).match(/^\\begin\{([a-zA-Z*]+)\}/)
      if (name) {
        const close = text.indexOf(`\\end{${name[1]}}`, i)
        const end = close < 0 ? text.length : close + `\\end{${name[1]}}`.length
        if (index >= i && index < end) return true
        i = end
        continue
      }
    }
    i += 1
  }
  return false
}

export function isMathBracketFalsePositive(text: string, token: RangeToken838): boolean {
  if (isInsideMathSpan(text, token.index)) return true
  const before = text.slice(Math.max(0, token.index - 12), token.index)
  return /\\(?:sqrt|begin|end|left|right)\s*$/.test(before)
}

export function looksLikeSharedPrompt(shared: string): boolean {
  const body = shared.replace(RANGE_TOKEN_RE, '').trim()
  if (body.length < 6) return false
  if (PROMPT_VERB.test(body)) return true
  return /다음|다항식|부등식|방정식|행렬|경우의 수/.test(body) && body.length >= 10
}

export function stripLeadingProblemNumber(text: string, problemNumber: number): string {
  const padded = String(problemNumber).padStart(4, '0')
  const loose = String(problemNumber)
  return String(text ?? '')
    .replace(new RegExp(`^(?:${padded}|${loose})\\.?\\s+`), '')
    .trim()
}

export function stripOcrPackaging(text: string): { text: string; rules: string[] } {
  const rules: string[] = []
  let next = String(text ?? '').replace(/\u00a0/g, ' ')
  const original = next
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
  const titles = [
    ...SSEN_MAJORS.map((row) => row.title),
    ...SSEN_SECTIONS.map((row) => row.title),
  ]
  for (const title of titles) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const trailing = new RegExp(`(?:\\n|\\s+)(?:0?\\d{1,2}\\s*)?${escaped}\\s*$`)
    if (trailing.test(next) && !LATEX_KEEP.test(next.slice(-title.length - 8))) {
      next = next.replace(trailing, '')
      rules.push(`trailing_outline:${title}`)
    }
  }
  next = next.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (next !== original.trim() && rules.length === 0) rules.push('whitespace')
  return { text: next, rules }
}

export function splitDonorAtLaterRange(
  stem: string,
  currentNumber: number,
): { keep: string; shared: string; token: RangeToken838 } | null {
  const tokens = parseRangeTokens(stem).filter(
    (token) => token.start > currentNumber && !isMathBracketFalsePositive(stem, token),
  )
  const token = tokens[0]
  if (!token) return null
  const keep = stem.slice(0, token.index).trim()
  const shared = stem.slice(token.index).trim()
  return { keep, shared, token }
}

export function composeTargetStem(sharedPrompt: string, currentStem: string, problemNumber: number): string {
  const shared = stripOcrPackaging(sharedPrompt).text.trim()
  const individual = stripLeadingProblemNumber(currentStem, problemNumber)
  if (!shared) return stripOcrPackaging(individual).text
  const normalizedShared = shared.replace(/\s+/g, ' ')
  const normalizedCurrent = String(currentStem ?? '').replace(/\s+/g, ' ')
  if (normalizedCurrent.startsWith(normalizedShared) || normalizedCurrent.includes(normalizedShared)) {
    return stripOcrPackaging(currentStem).text
  }
  const body = stripOcrPackaging(individual).text
  if (!body) return shared
  return `${shared}\n${body}`
}

function listedOf(catalog: CatalogProblem838[], n: number): CatalogProblem838[] {
  return catalog.filter((row) => row.display_state === 'LISTED' && row.problem_number === n)
}

function hiddenOf(catalog: CatalogProblem838[], n: number): CatalogProblem838[] {
  return catalog.filter((row) => row.display_state !== 'LISTED' && row.problem_number === n)
}

function isProtected(row: CatalogProblem838 | undefined): { teacher: boolean; verified: boolean } {
  if (!row) return { teacher: false, verified: false }
  return {
    teacher: row.origin === 'TEACHER_EDIT',
    verified: row.review_status === 'VERIFIED',
  }
}

function extraProblemNumbers(text: string, current: number, token: RangeToken838 | null): number[] {
  const skip = new Set<number>([current])
  if (token) {
    skip.add(token.start)
    skip.add(token.end)
  }
  const found: number[] = []
  for (const match of String(text ?? '').matchAll(/\b(\d{3,4})\b/g)) {
    const n = Number(match[1])
    if (n >= 1 && n <= 2000 && !skip.has(n) && !found.includes(n)) found.push(n)
  }
  return found
}

function extraBoundaryFlags(stem: string, current: number): string[] {
  const flags: string[] = []
  if (/```/.test(stem) || /###/.test(stem)) flags.push('ocr_fence')
  if (/^\s*쎈수학/m.test(stem)) flags.push('book_title')
  if (/유형\s*\d{1,2}/.test(stem)) flags.push('type_title')
  const others = extraProblemNumbers(stem, current, parseRangeTokens(stem)[0] ?? null)
  if (others.some((n) => n === current + 1)) flags.push('next_number_in_stem')
  return flags
}

function evidenceFor(row: CatalogProblem838): string[] {
  const items: string[] = []
  if (row.origin === 'OCR' || row.origin === 'AUTO_CLEAN') items.push(`version_origin:${row.origin}`)
  if (row.step832_preview) items.push('step832_item_preview')
  if (row.crop_present) items.push('crop_asset')
  if (row.has_page_image) items.push('page_image')
  if ((row.page_ocr_chars ?? 0) > 0) items.push('source_page_ocr')
  if (row.source_page != null) items.push(`source_page:${row.source_page}`)
  if (row.section_code) items.push(`outline_section:${row.section_code}`)
  return items
}

function pageOk(donor: CatalogProblem838, target: CatalogProblem838): boolean {
  if (donor.source_page == null || target.source_page == null) return false
  return target.source_page >= donor.source_page && target.source_page - donor.source_page <= 2
}

function sectionOk(donor: CatalogProblem838, target: CatalogProblem838): boolean {
  if (!donor.section_code || !target.section_code) return false
  return donor.section_code === target.section_code
}

function pageMatchesOutline(row: CatalogProblem838): boolean {
  if (row.source_page == null) return false
  const section = sectionForPage(row.source_page)
  if (!section) return false
  if (row.section_code && row.section_code !== section.code) return false
  return true
}

function targetSnapshot(catalog: CatalogProblem838[], n: number): TargetSnapshot838 {
  const listed = listedOf(catalog, n)
  const hidden = hiddenOf(catalog, n)
  return {
    problem_number: n,
    listed_count: listed.length,
    hidden_count: hidden.length,
    records: [...listed, ...hidden].map((row) => ({
      id: row.id,
      public_code: row.public_code,
      display_state: row.display_state,
      source_page: row.source_page,
      section_code: row.section_code,
      stem: row.stem,
      origin: row.origin,
      review_status: row.review_status,
      current_version_id: row.current_version_id,
    })),
  }
}

function classifyCandidate(row: CatalogProblem838, catalog: CatalogProblem838[]): RangeCandidate838 {
  const tokens = parseRangeTokens(row.stem)
  const later = tokens.filter((token) => token.start > row.problem_number && !isMathBracketFalsePositive(row.stem, token))
  const own = tokens.filter((token) => token.start === row.problem_number)
  const split = splitDonorAtLaterRange(row.stem, row.problem_number)
  const keep = split?.keep ?? (own[0] ? row.stem.slice(0, own[0].index).trim() : row.stem)
  const shared = split?.shared ?? (own[0] ? row.stem.slice(own[0].index).trim() : '')
  const token = split?.token ?? own[0] ?? tokens[0] ?? null
  const start = token?.start ?? 0
  const end = token?.end ?? -1
  const targets: TargetSnapshot838[] = []
  if (token) {
    for (let n = start; n <= end; n += 1) targets.push(targetSnapshot(catalog, n))
  }
  const donorProtect = isProtected(row)
  const targetProtect = targets.some((item) =>
    item.records.some((record) => record.display_state === 'LISTED' && (record.origin === 'TEACHER_EDIT' || record.review_status === 'VERIFIED')),
  )
  const teacher_edit = donorProtect.teacher || targetProtect
  const verified = donorProtect.verified || targets.some((item) => item.records.some((record) => record.review_status === 'VERIFIED'))
  const numbers_consecutive = Boolean(token && end >= start && end - start + 1 === targets.length)
  const pages_ok = targets.every((item) => {
    const listed = item.records.find((record) => record.display_state === 'LISTED')
    if (!listed) return false
    return pageOk(row, {
      ...row,
      source_page: listed.source_page,
      section_code: listed.section_code,
      problem_number: item.problem_number,
      id: listed.id,
    })
  })
  const extraKeep = extraProblemNumbers(keep, row.problem_number, token)
  const extraShared = extraProblemNumbers(shared.replace(token?.raw ?? '', ''), row.problem_number, token)
  const extra_boundary = extraBoundaryFlags(row.stem, row.problem_number)
  const evidence = evidenceFor(row)
  const hash_before = stemHash838(row.stem)
  const cleanedKeep = stripLeadingProblemNumber(stripOcrPackaging(keep).text, row.problem_number)
  const hash_after_donor = split ? stemHash838(cleanedKeep) : null

  let kind: RangeCandidate838['kind'] = 'OTHER'
  if (row.display_state !== 'LISTED') kind = 'HIDDEN_DUPLICATE'
  else if (later.length) kind = 'LATER_LEAK'
  else if (own.length) kind = 'OWN_RANGE_HEADER'

  const planned_changes: string[] = []
  const reasons: string[] = []
  let verdict: RangeVerdict838 = 'REVIEW_REQUIRED'

  if (kind === 'HIDDEN_DUPLICATE') {
    verdict = 'BLOCKED'
    reasons.push('HIDDEN_DUPLICATE는 listed 복원 대상이 아니다')
  } else if (!tokens.length) {
    verdict = 'BLOCKED'
    reasons.push('범위 토큰이 없다')
  } else if (tokens.some((item) => isMathBracketFalsePositive(row.stem, item))) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('수식 대괄호와 범위 토큰을 구분할 수 없다')
  } else if (kind === 'OWN_RANGE_HEADER') {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('현재 번호가 범위 시작이라 앞 문항 누수가 아니다. 형제 문항이 stem에 섞여 있으면 bbox 없이 분리하지 않는다')
    if (extraProblemNumbers(row.stem, row.problem_number, token).length) {
      reasons.push('범위 안에 다른 문제번호 본문이 포함되어 있다')
    }
  } else if (!split || !token) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('뒤 범위 경계를 파싱하지 못했다')
  } else if (token.end - token.start > MAX_RANGE_SPAN) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push(`범위 폭 ${token.end - token.start + 1}이 너무 넓다`)
  } else if (!cleanedKeep) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('앞 문항 본문이 비어 복원 시 정보 손실 가능성이 있다')
  } else if (!looksLikeSharedPrompt(shared)) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('공통 발문인지 해설·머리말인지 불명확하다')
  } else if (!numbers_consecutive) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('범위 번호가 연속이 아니다')
  } else if (targets.some((item) => item.listed_count !== 1)) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('범위 안 listed 레코드가 정확히 하나가 아니다')
  } else if (!pages_ok) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('대상 페이지가 동일/인접이 아니다')
  } else if (targets.some((item) => {
    const listed = item.records.find((record) => record.display_state === 'LISTED')
    return !listed || !sectionOk(row, { ...row, section_code: listed.section_code, id: listed.id, problem_number: item.problem_number })
  })) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('소단원이 다르다')
  } else if (!pageMatchesOutline(row)) {
    verdict = 'BLOCKED'
    reasons.push('문제번호와 페이지·목차 연결이 모순이다')
  } else if (teacher_edit) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('TEACHER_EDIT 보호')
  } else if (verified) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('VERIFIED 보호')
  } else if (extraKeep.length) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push(`앞 본문에 다른 문제번호 ${extraKeep.join(',')}가 있다`)
  } else if (extraShared.length) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push(`공통 발문에 개별 문항 번호 ${extraShared.join(',')}가 섞여 있다`)
  } else if (/!\[[^\]]*\]\([^)]+\)/.test(shared)) {
    verdict = 'REVIEW_REQUIRED'
    reasons.push('공통 발문에 도형 이미지가 있어 소속을 단정할 수 없다')
  } else if (!evidence.some((item) => item.startsWith('version_origin') || item === 'step832_item_preview' || item === 'source_page_ocr' || item === 'page_image')) {
    verdict = 'BLOCKED'
    reasons.push('원본 페이지 OCR/이미지 근거가 없다')
  } else {
    verdict = 'AUTO_SAFE'
    reasons.push('뒤 범위 공통 발문이 명확하고 대상 listed 레코드가 모두 존재한다')
    planned_changes.push(`donor ${row.original_problem_number}: 누수 범위 발문 제거`)
    for (const item of targets) {
      planned_changes.push(`target ${String(item.problem_number).padStart(4, '0')}: 공통 발문 연결`)
    }
    if (stripOcrPackaging(keep).rules.length) {
      planned_changes.push(`donor OCR 포장 문자 제거: ${stripOcrPackaging(keep).rules.join(',')}`)
    }
  }

  return {
    source_id: row.source_document_id,
    problem_id: row.id,
    public_code: row.public_code,
    current_number: row.original_problem_number,
    source_page: row.source_page,
    current_stem: row.stem,
    detected_range: token?.raw ?? null,
    keep,
    shared,
    targets,
    numbers_consecutive,
    pages_ok,
    origin: row.origin,
    teacher_edit,
    verified,
    existing_auto_clean: row.origin === 'AUTO_CLEAN',
    evidence,
    verdict,
    verdict_reason: reasons.join('; '),
    planned_changes,
    hash_before,
    hash_after_donor,
    extra_boundary,
    kind,
  }
}

export function buildRangeRestorePlan(catalog: CatalogProblem838[]): RangePlan838 {
  const ssen = catalog.filter((row) => row.source_document_id === SSEN_SOURCE_DOCUMENT_ID)
  const hits = ssen.filter((row) => parseRangeTokens(row.stem).length > 0)
  const candidates = hits.map((row) => classifyCandidate(row, ssen))
  const working = new Map(ssen.map((row) => [row.id, row.stem]))
  const autoSafe = candidates.filter((row) => row.verdict === 'AUTO_SAFE' && row.kind === 'LATER_LEAK')

  for (const candidate of autoSafe) {
    const donor = ssen.find((row) => row.id === candidate.problem_id)
    if (!donor) continue
    const cleaned = stripLeadingProblemNumber(stripOcrPackaging(candidate.keep).text, donor.problem_number)
    working.set(donor.id, cleaned)
  }
  for (const candidate of autoSafe) {
    const shared = stripOcrPackaging(candidate.shared).text
    for (const target of candidate.targets) {
      const listed = target.records.find((record) => record.display_state === 'LISTED')
      if (!listed) continue
      const current = working.get(listed.id) ?? listed.stem
      working.set(listed.id, composeTargetStem(shared, current, target.problem_number))
    }
  }

  const applies: StemApply838[] = []
  const seen = new Set<string>()
  const maybeApply = (problemId: string, role: 'donor' | 'target', range: string, fromCatalog: CatalogProblem838) => {
    const from = fromCatalog.stem
    const to = working.get(problemId) ?? from
    if (from === to) return
    const key = `${problemId}:${to}`
    if (seen.has(key)) return
    seen.add(key)
    applies.push({
      problem_id: problemId,
      public_code: fromCatalog.public_code,
      role,
      from_stem: from,
      to_stem: to,
      from_hash: stemHash838(from),
      to_hash: stemHash838(to),
      parent_version_id: fromCatalog.current_version_id,
      current_number: fromCatalog.original_problem_number,
      source_page: fromCatalog.source_page,
      range,
    })
  }

  for (const candidate of autoSafe) {
    const donor = ssen.find((row) => row.id === candidate.problem_id)
    if (donor) maybeApply(donor.id, 'donor', candidate.detected_range ?? '', donor)
    for (const target of candidate.targets) {
      const listed = ssen.find((row) => row.id === target.records.find((item) => item.display_state === 'LISTED')?.id)
      if (listed) maybeApply(listed.id, 'target', candidate.detected_range ?? '', listed)
    }
  }

  const teacher_edit_protected = candidates.filter((row) => row.teacher_edit).length
  const verified_protected = candidates.filter((row) => row.verified).length
  const donorIds = new Set(applies.filter((row) => row.role === 'donor').map((row) => row.problem_id))
  const targetIds = new Set(applies.filter((row) => row.role === 'target').map((row) => row.problem_id))

  const summary: RangeSummary838 = {
    candidates: candidates.length,
    listed_range_hits: hits.filter((row) => row.display_state === 'LISTED').length,
    hidden_range_hits: hits.filter((row) => row.display_state !== 'LISTED').length,
    later_leaks: candidates.filter((row) => row.kind === 'LATER_LEAK').length,
    auto_safe: autoSafe.length,
    review_required: candidates.filter((row) => row.verdict === 'REVIEW_REQUIRED').length,
    blocked: candidates.filter((row) => row.verdict === 'BLOCKED').length,
    donor_problems: donorIds.size,
    target_problems: targetIds.size,
    new_versions: applies.length,
    current_version_switches: applies.length,
    teacher_edit_protected,
    verified_protected,
    problems_added: 0,
    problems_deleted: 0,
    expected_listed: SSEN_LISTED_FROZEN,
    embeddings_changed: 0,
    fingerprints_changed: 0,
    paid_ocr_calls: 0,
  }

  return { candidates, applies, summary }
}

export function withAppliedStems(catalog: CatalogProblem838[], applies: StemApply838[]): CatalogProblem838[] {
  const next = new Map(applies.map((row) => [row.problem_id, row.to_stem]))
  return catalog.map((row) => {
    const stem = next.get(row.id)
    if (!stem) return row
    return {
      ...row,
      stem,
      origin: 'AUTO_CLEAN',
      parent_version_id: row.current_version_id,
      current_version_id: `clean:${row.id}`,
    }
  })
}

export function dryRunSafety838(plan: RangePlan838, listedCount = SSEN_LISTED_FROZEN): { ok: boolean; violations: string[] } {
  const violations: string[] = []
  if (plan.summary.problems_deleted !== 0) violations.push('problem DELETE != 0')
  if (plan.summary.problems_added !== 0) violations.push('problem add != 0')
  if (plan.summary.expected_listed !== SSEN_LISTED_FROZEN) violations.push('expected listed drifted')
  if (listedCount !== SSEN_LISTED_FROZEN) violations.push(`listed ${listedCount} != ${SSEN_LISTED_FROZEN}`)
  if (plan.summary.embeddings_changed !== 0) violations.push('embeddings changed')
  if (plan.summary.fingerprints_changed !== 0) violations.push('fingerprints changed')
  if (plan.summary.paid_ocr_calls !== 0) violations.push('paid OCR != 0')
  if (plan.applies.some((row) => row.from_stem === row.to_stem)) violations.push('unchanged apply')
  const autoIds = new Set(plan.candidates.filter((row) => row.verdict === 'AUTO_SAFE').map((row) => row.problem_id))
  for (const apply of plan.applies) {
    const candidate = plan.candidates.find((row) => row.problem_id === apply.problem_id || row.targets.some((target) => target.records.some((record) => record.id === apply.problem_id)))
    if (apply.role === 'donor' && !autoIds.has(apply.problem_id)) violations.push(`non AUTO_SAFE donor ${apply.problem_id}`)
    if (candidate?.teacher_edit) violations.push(`TEACHER_EDIT apply ${apply.problem_id}`)
    if (candidate?.verified) violations.push(`VERIFIED apply ${apply.problem_id}`)
  }
  return { ok: violations.length === 0, violations }
}

export function formatAuditMarkdown(plan: RangePlan838): string {
  const lines = [
    '# STEP 8.38 range-stem audit',
    '',
    `- candidates: ${plan.summary.candidates}`,
    `- listed hits: ${plan.summary.listed_range_hits}`,
    `- hidden hits: ${plan.summary.hidden_range_hits}`,
    `- later leaks: ${plan.summary.later_leaks}`,
    `- AUTO_SAFE: ${plan.summary.auto_safe}`,
    `- REVIEW_REQUIRED: ${plan.summary.review_required}`,
    `- BLOCKED: ${plan.summary.blocked}`,
    `- applies: ${plan.applies.length}`,
    '',
    '| number | page | range | verdict | reason | keep | shared |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const row of plan.candidates) {
    const keep = row.keep.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 80)
    const shared = row.shared.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 80)
    lines.push(
      `| ${row.current_number} | ${row.source_page ?? ''} | ${row.detected_range ?? ''} | ${row.verdict} | ${row.verdict_reason.replace(/\|/g, '/')} | ${keep} | ${shared} |`,
    )
  }
  return `${lines.join('\n')}\n`
}
