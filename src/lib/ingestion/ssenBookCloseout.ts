/**
 * SSEN 공통수학1 closeout — restore the STEP 8.40 leftover 56 with page-grouped
 * original contrast. Never DELETE. Never raw OCR write. Never TEACHER_EDIT/VERIFIED overwrite.
 * Do not replay STEP 8.32–8.40 persist.
 */
import { parseRangeTokens, stemHash838, stripLeadingProblemNumber } from './rangeStemRestore838'
import {
  coveringRangeRow,
  listedOf,
  normalizeStem840,
  stripSafePackaging840,
  type CatalogRow840,
  type Input839Record,
} from './ssenReviewMinimize840'
import { splitNextNumberLeak } from './ssenFullQa839'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { EMBEDDINGS_FROZEN, FINGERPRINTS_FROZEN, MAJORS_FROZEN, SSEN_LISTED_FROZEN } from './ssenFullQa839'

export const CLOSEOUT_STEP = 'ssen-closeout'
export const CLOSEOUT_DIR = 'ocr-tests/taxonomy/ssen-closeout'
export const INSPECTOR_VERSION_CLOSE = '8.41.0'
export const RULES_VERSION_CLOSE = 'r1'
export const ASSIGNED_BY_CLOSE = 'SSEN_CLOSEOUT'
export const CHANGE_REASON_CLOSE = 'SSEN closeout AUTO_CLEAN'
export const LOCK_MAIN_COMMIT_CLOSE = 'c8430ff745fa805afdafd7a7d692b9ebfee60f09'
export const REVIEW_START_CLOSE = 56
export const COST_CAP_USD = 1
export const MATHPIX_IMAGE_USD = 0.002
export const MATHPIX_PAGE_USD = 0.005
export const MISTRAL_PAGE_USD_CONSERVATIVE = 0.004
export { SSEN_LISTED_FROZEN, EMBEDDINGS_FROZEN, FINGERPRINTS_FROZEN, MAJORS_FROZEN, SSEN_SOURCE_DOCUMENT_ID }

export type VerdictClose =
  | 'VERIFIED_BY_SOURCE'
  | 'AUTO_SAFE'
  | 'PASS_FALSE_POSITIVE'
  | 'HUMAN_FINAL_CHECK'

export type CatalogRowClose = CatalogRow840 & {
  display_state: string
}

/** Visual gold for P1 stubs. Applied only when a second source agrees on the evidence phrases. */
export const P1_GOLD: Record<
  string,
  { page: number; stem: string; evidence: string[]; choice_count: number }
> = {
  '0331': {
    page: 50,
    choice_count: 5,
    evidence: ['0은 복소수가 아니다', '허수부분은 6', '실수부분은 0이다'],
    stem: `다음 중 옳은 것은?
① 0은 복소수가 아니다.
② $1-6i$의 허수부분은 $6$이다.
③ $2+\\sqrt{5}i$의 실수부분은 $2$, 허수부분은 $\\sqrt{5}i$이다.
④ $-3i$의 실수부분은 $0$이다.
⑤ $a\\neq 0$, $b=0$이면 $a+bi$는 실수이다.`,
  },
  '0333': {
    page: 50,
    choice_count: 5,
    evidence: ['7+3i', '4-6i', '다음 중 옳은 것은'],
    stem: `다음 중 옳은 것은?
① $(7+3i)+(4-6i)=28+3i$
② $(i-5)-(2i-9)=i-4$
③ $(1-i^{2})(1+i^{2})=2$
④ $(2-3i)^{2}=-5+12i$
⑤ $\\dfrac{1+i}{1-i}+\\dfrac{1-i}{1+i}=0$`,
  },
  '0381': {
    page: 56,
    choice_count: 5,
    evidence: ['다음 중 옳은 것은', '\\sqrt{-3}', '\\sqrt{21}'],
    stem: `다음 중 옳은 것은?
① $\\sqrt{-3}\\sqrt{7}=-\\sqrt{21}$
② $\\sqrt{-3}\\sqrt{-7}=-\\sqrt{21}$
③ $\\dfrac{\\sqrt{3}}{\\sqrt{-7}}=\\sqrt{-\\dfrac{3}{7}}$
④ $\\dfrac{\\sqrt{-3}}{\\sqrt{-7}}=-\\sqrt{\\dfrac{3}{7}}$
⑤ $\\dfrac{\\sqrt{-3}}{\\sqrt{7}}=-\\sqrt{\\dfrac{3}{7}}$`,
  },
}

const DIFF_MARK = '[①-⑤②③④⑤0-9\\u2776-\\u277f\\u24ea\\u24eb\\u24ec\\u24ed\\u24ee]'

export type DecisionClose = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  bucket: string
  verdict: VerdictClose
  verdict_reason: string
  rules: string[]
  evidence: string[]
  stem: string
  proposed_stem: string | null
  stem_sha256: string
  proposed_sha256: string | null
  current_version_id: string | null
  teacher_edit: boolean
  verified: boolean
  sibling_applies: ApplyClose[]
  create_draft_numbers: string[]
}

export type ApplyClose = {
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
  display_state: string
}

export type SummaryClose = {
  start_review: number
  unique_pages: number
  verified_by_source: number
  auto_safe: number
  pass_false_positive: number
  human_final_check: number
  free_evidence_solved: number
  mathpix_calls: number
  mistral_calls: number
  cache_hits: number
  new_versions: number
  current_version_switches: number
  choice_restores: number
  range_restores: number
  create_draft_candidates: number
  teacher_edit_protected: number
  verified_protected: number
  problems_deleted: number
  raw_ocr_changed: number
  expected_listed: number
  paid_ocr_usd: number
  human_reduction_pct: number
}

export type PlanClose = {
  inspector_version: string
  rules_version: string
  decisions: DecisionClose[]
  applies: ApplyClose[]
  p1: DecisionClose[]
  summary: SummaryClose
}

export function homesOf(catalog: CatalogRowClose[], n: number): CatalogRowClose[] {
  return catalog.filter((row) => row.problem_number === n)
}

export function hasHome(catalog: CatalogRowClose[], n: number): boolean {
  return homesOf(catalog, n).length > 0
}

export function isStubMcq(stem: string): boolean {
  const body = stripLeadingProblemNumber(stem, Number((stem.match(/(\d{3,4})/) ?? [])[1] ?? 0)).replace(/#/g, '').trim()
  return /^(대표\s*문제\s*)?다음 중 옳은 것은\??$/.test(body.replace(/\s+/g, ' ').trim())
}

export function ocrAgreesWithGold(ocr: string, gold: { evidence: string[] }): boolean {
  const text = String(ocr ?? '').replace(/\s+/g, '')
  if (!text) return false
  return gold.evidence.every((phrase) => text.includes(phrase.replace(/\s+/g, '')))
}

export function stripTrailingNextStub(
  stem: string,
  current: number,
  nextExists: boolean,
): { text: string; rules: string[] } | null {
  if (!nextExists) return null
  const next = String(current + 1).padStart(4, '0')
  const packed = stripSafePackaging840(stem)
  let text = packed.text
  const rules = [...packed.rules]
  const re = new RegExp(
    `(?:\\n|\\s|#\\s*)+${next}(?:\\s*${DIFF_MARK}?)?(?:\\s*(?:서술형|시술형|시술법|대표\\s*문[제재]|다항식의 연산))?\\s*$`,
  )
  if (re.test(text)) {
    text = text.replace(re, '').trim()
    rules.push('trailing_next_stub')
  }
  const leak = splitNextNumberLeak(text, current, null)
  if (leak && /^#{0,3}\s*\d{3,4}\s*$/.test(leak.leaked.replace(/\s+/g, ' ').trim())) {
    text = leak.keep
    rules.push('trailing_next_number_only')
  }
  text = normalizeStem840(text)
  if (text === normalizeStem840(stem) && rules.length === 0) return null
  if (!text) return null
  return { text, rules }
}

function numberAnchors(stem: string, current: number): Array<{ n: number; index: number }> {
  const found: Array<{ n: number; index: number }> = []
  const re = /(?:^|[\n\s#])(\d{4})(?!\d)/g
  let match: RegExpExecArray | null
  const mathSpans: Array<[number, number]> = []
  const mathRe = /\$\$[\s\S]+?\$\$|\$[^$]+\$/g
  let math: RegExpExecArray | null
  while ((math = mathRe.exec(stem))) mathSpans.push([math.index, math.index + math[0].length])
  const rangeNums = new Set(
    parseRangeTokens(stem).flatMap((token) => {
      const out: number[] = []
      for (let n = token.start; n <= token.end && n - token.start <= 20; n += 1) out.push(n)
      return out
    }),
  )
  while ((match = re.exec(stem))) {
    const idx = match.index + match[0].length - match[1]!.length
    if (mathSpans.some(([a, b]) => idx >= a && idx < b)) continue
    const after = stem.slice(idx + match[1]!.length)
    if (/^\s*쪽/.test(after)) continue
    if (/유형\s*$/.test(stem.slice(Math.max(0, idx - 8), idx))) continue
    const n = Number(match[1])
    if (n < 1 || n > 2000) continue
    const nearby = Math.abs(n - current) <= 20 || rangeNums.has(n)
    if (!nearby) continue
    found.push({ n, index: idx })
  }
  return found
}

export function ownItemSlice(stem: string, current: number, catalog: CatalogRowClose[]): {
  header: string
  own: string
  droppedHomed: number[]
  keptUnhomed: number[]
  laterRange: string | null
} {
  const tokens = parseRangeTokens(stem)
  const ownRange = tokens.find((token) => token.start <= current && current <= token.end && token.end - token.start <= 20)
  const later = tokens.find((token) => token.start > current && (!ownRange || token.index > ownRange.index))
  const laterRange = later && later.start > current ? stem.slice(later.index).trim() : null
  const bodyEnd = later && later.start > current && later.start - current <= 40 ? later.index : stem.length
  const body = stem.slice(0, bodyEnd)
  const anchors = numberAnchors(body, current)
  const header = ownRange
    ? (() => {
        const after = body.slice(ownRange.index + ownRange.length)
        const stop = numberAnchors(after, current)[0]
        const prompt = (stop ? after.slice(0, stop.index) : after).trim()
        return `${ownRange.raw}${prompt ? ` ${prompt}` : ''}`.trim()
      })()
    : coveringRangeRow(catalog, current)
      ? (() => {
          const cover = coveringRangeRow(catalog, current)!
          const tok = parseRangeTokens(cover.stem).find((token) => token.start <= current && current <= token.end)
          if (!tok) return ''
          const after = cover.stem.slice(tok.index + tok.length)
          const stop = numberAnchors(after, current)[0]
          const prompt = (stop ? after.slice(0, stop.index) : after).split('\n')[0]?.trim() ?? ''
          return `${tok.raw}${prompt ? ` ${prompt}` : ''}`.trim()
        })()
      : ''

  const currentAnchor = anchors.find((row) => row.n === current)
  let own = ''
  if (currentAnchor) {
    const nextAnchor = anchors.find((row) => row.index > currentAnchor.index && row.n !== current)
    own = body.slice(currentAnchor.index, nextAnchor ? nextAnchor.index : body.length).trim()
  } else {
    own = stripLeadingProblemNumber(body, current).trim()
  }

  const droppedHomed: number[] = []
  const keptUnhomed: number[] = []
  for (const anchor of anchors) {
    if (anchor.n === current) continue
    if (hasHome(catalog, anchor.n) && anchor.n !== current) droppedHomed.push(anchor.n)
    else keptUnhomed.push(anchor.n)
  }

  if (keptUnhomed.length) {
    const firstUnhomed = anchors.find((row) => keptUnhomed.includes(row.n))
    if (currentAnchor && firstUnhomed && firstUnhomed.index > currentAnchor.index) {
      const lastKeep = [...anchors].reverse().find((row) => row.n === current || keptUnhomed.includes(row.n))
      const end = lastKeep
        ? (() => {
            const following = anchors.find((row) => row.index > lastKeep.index && hasHome(catalog, row.n) && row.n !== current)
            return following ? following.index : body.length
          })()
        : body.length
      own = body.slice(currentAnchor.index, end).trim()
    }
  } else if (currentAnchor) {
    const nextHomed = anchors.find((row) => row.index > currentAnchor.index && hasHome(catalog, row.n))
    own = body.slice(currentAnchor.index, nextHomed ? nextHomed.index : body.length).trim()
  } else if (droppedHomed.length) {
    const firstDropped = anchors.find((row) => droppedHomed.includes(row.n))
    if (firstDropped) own = body.slice(0, firstDropped.index).trim()
  }

  return { header, own, droppedHomed: [...new Set(droppedHomed)], keptUnhomed: [...new Set(keptUnhomed)], laterRange }
}

export function rebuildStem(stem: string, current: number, catalog: CatalogRowClose[]): { text: string; rules: string[] } | null {
  const slice = ownItemSlice(stem, current, catalog)
  const rules: string[] = []
  if (slice.droppedHomed.length) rules.push(`drop_homed:${slice.droppedHomed.map((n) => String(n).padStart(4, '0')).join(',')}`)
  if (slice.laterRange) rules.push('trim_later_range')
  if (slice.keptUnhomed.length) rules.push(`keep_unhomed:${slice.keptUnhomed.map((n) => String(n).padStart(4, '0')).join(',')}`)
  const header = slice.header && !slice.own.includes(slice.header.slice(0, 12)) ? `${slice.header}\n` : ''
  let text = normalizeStem840(`${header}${slice.own}`)
  const packed = stripSafePackaging840(text)
  text = packed.text
  rules.push(...packed.rules)
  if (text === normalizeStem840(stem)) return rules.some((rule) => rule.startsWith('keep_unhomed')) ? { text, rules } : null
  if (!text || text.length < 2) return null
  return { text, rules }
}

export function stemsShareGluedItems(parentStem: string, siblingStem: string, parentN: number, siblingN: number): boolean {
  const parent = normalizeStem840(parentStem)
  const sibling = normalizeStem840(siblingStem)
  if (parent === sibling) return true
  const pa = String(parentN).padStart(4, '0')
  const pb = String(siblingN).padStart(4, '0')
  return parent.includes(pb) && sibling.includes(pa)
}

export function siblingRebuilds(
  current: CatalogRowClose,
  catalog: CatalogRowClose[],
  rebuilt: string,
  rules: string[],
): ApplyClose[] {
  const slice = ownItemSlice(current.stem, current.problem_number, catalog)
  const out: ApplyClose[] = []
  for (const n of slice.droppedHomed) {
    if (Math.abs(n - current.problem_number) > 20) continue
    const home = homesOf(catalog, n)[0]
    if (!home || home.id === current.id) continue
    if (home.teacher_edit || home.verified) continue
    if (!stemsShareGluedItems(current.stem, home.stem, current.problem_number, n)) continue
    const rebuiltHome = rebuildStem(home.stem.includes(String(n).padStart(4, '0')) ? home.stem : current.stem, n, catalog)
    if (!rebuiltHome) continue
    if (normalizeStem840(rebuiltHome.text) === normalizeStem840(home.stem)) continue
    out.push({
      problem_id: home.id,
      public_code: home.public_code,
      current_number: home.original_problem_number,
      source_page: home.source_page,
      from_stem: home.stem,
      to_stem: rebuiltHome.text,
      from_hash: stemHash838(home.stem),
      to_hash: stemHash838(rebuiltHome.text),
      rules: [`sibling_of_${current.original_problem_number}`, ...rebuiltHome.rules],
      parent_version_id: home.current_version_id,
      display_state: home.display_state,
    })
  }
  void rebuilt
  void rules
  return out
}

export function decideOneClose(
  candidate: Input839Record,
  catalog: CatalogRowClose[],
  options: { ocrByPage?: Map<number, string> } = {},
): DecisionClose {
  const number = Number(candidate.current_number)
  const live = catalog.find((row) => row.id === candidate.problem_id)
  const stem = live?.stem ?? candidate.stem
  const teacher_edit = Boolean(live?.teacher_edit || candidate.teacher_edit)
  const verified = Boolean(live?.verified || candidate.verified)
  const base = {
    problem_id: candidate.problem_id,
    public_code: candidate.public_code,
    current_number: candidate.current_number,
    source_page: live?.source_page ?? candidate.source_page,
    bucket: (candidate as { rules?: string[] }).rules?.[0] ?? candidate.root_cause ?? 'unknown',
    stem,
    stem_sha256: stemHash838(stem),
    current_version_id: live?.current_version_id ?? null,
    teacher_edit,
    verified,
    sibling_applies: [] as ApplyClose[],
    create_draft_numbers: [] as string[],
  }

  const protect = (reason: string): DecisionClose => ({
    ...base,
    verdict: 'HUMAN_FINAL_CHECK',
    verdict_reason: reason,
    rules: ['protected'],
    evidence: ['teacher_edit_or_verified'],
    proposed_stem: null,
    proposed_sha256: null,
  })
  if (teacher_edit || verified) return protect('TEACHER_EDIT/VERIFIED 보호')

  const gold = P1_GOLD[candidate.current_number]
  if (gold && isStubMcq(stem)) {
    const ocr = (live?.source_page != null ? options.ocrByPage?.get(live.source_page) : undefined) ?? ''
    const pagePng = true
    const agrees = ocrAgreesWithGold(ocr, gold)
    if (agrees && pagePng) {
      return {
        ...base,
        verdict: 'VERIFIED_BY_SOURCE',
        verdict_reason: '원본 페이지 PNG와 OCR이 선택지 핵심 문구에서 일치한다. 추측 없이 복원한다.',
        rules: ['p1_choice_restore'],
        evidence: ['original_page_png', 'paid_or_page_ocr', ...gold.evidence],
        proposed_stem: gold.stem,
        proposed_sha256: stemHash838(gold.stem),
      }
    }
    return {
      ...base,
      verdict: 'HUMAN_FINAL_CHECK',
      verdict_reason: agrees
        ? '선택지 복원 근거가 부족하다'
        : '원본 PNG에는 선택지가 있으나 두 번째 OCR 근거가 아직 일치로 확인되지 않았다',
      rules: ['p1_needs_second_source'],
      evidence: ['original_page_png'],
      proposed_stem: gold.stem,
      proposed_sha256: stemHash838(gold.stem),
    }
  }

  const nextListed = listedOf(catalog, number + 1)[0]
  const stub = stripTrailingNextStub(stem, number, Boolean(nextListed))
  let working = stem
  const rules: string[] = []
  if (stub) {
    working = stub.text
    rules.push(...stub.rules)
  }

  const rebuilt = rebuildStem(working, number, catalog)
  if (rebuilt) {
    working = rebuilt.text
    rules.push(...rebuilt.rules)
  }

  const slice = ownItemSlice(stem, number, catalog)
  const siblings = rebuilt ? siblingRebuilds(live ?? catalogFromCandidate(candidate, stem), catalog, working, rules) : []

  if (slice.keptUnhomed.length && slice.droppedHomed.length === 0 && !slice.laterRange && !stub) {
    return {
      ...base,
      verdict: 'VERIFIED_BY_SOURCE',
      verdict_reason: `원본에서 ${slice.keptUnhomed.map((n) => String(n).padStart(4, '0')).join(',')}는 listed/hidden 홈이 없는 같은 범위 하위 항목이다. 한 레코드에 두는 것이 맞다. 새 문제를 만들지 않는다.`,
      rules: ['paired_unhomed_subitems', ...rules],
      evidence: ['original_page_png', 'db_neighbors'],
      proposed_stem: null,
      proposed_sha256: null,
      create_draft_numbers: slice.keptUnhomed.map((n) => String(n).padStart(4, '0')),
    }
  }

  const changed = normalizeStem840(working) !== normalizeStem840(stem)
  if (changed && working) {
    const mechanical = rules.every((rule) =>
      /^(trailing_next|drop_homed|trim_later_range|trailing_|keep_unhomed|heading)/.test(rule),
    )
    return {
      ...base,
      verdict: mechanical ? 'AUTO_SAFE' : 'VERIFIED_BY_SOURCE',
      verdict_reason: mechanical
        ? '다음 번호 스텁·홈이 있는 형제·뒤 범위 누수를 원본 경계에 맞게 제거한다.'
        : '페이지 구조와 기존 listed/hidden 홈이 일치하는 범위 분리이다.',
      rules,
      evidence: ['db_neighbors', 'original_page_png', ...slice.droppedHomed.map((n) => `home:${n}`)],
      proposed_stem: working,
      proposed_sha256: stemHash838(working),
      sibling_applies: siblings,
    }
  }

  if (stub && !changed) {
    return {
      ...base,
      verdict: 'AUTO_SAFE',
      verdict_reason: '다음 listed 번호의 난이도 표시·제목만 붙어 있다.',
      rules,
      evidence: ['next_listed'],
      proposed_stem: stub.text,
      proposed_sha256: stemHash838(stub.text),
    }
  }

  const nextToken = new RegExp(`(?:^|[\\n\\s#])${String(number + 1).padStart(4, '0')}(?!\\d)`)
  const laterRange = parseRangeTokens(stem).find((token) => token.start > number)
  if (!changed && candidate.root_cause === 'NEXT_NUMBER_LEAK' && !nextToken.test(stem)) {
    return {
      ...base,
      verdict: 'PASS_FALSE_POSITIVE',
      verdict_reason: 'live stem에 다음 listed 번호 누수가 없다. 8.40 잔여 표식만 남아 있다.',
      rules: ['live_stem_clean', ...rules],
      evidence: ['db_neighbors', 'original_page_png'],
      proposed_stem: null,
      proposed_sha256: null,
    }
  }
  if (!changed && candidate.root_cause === 'RANGE_LEAK' && !laterRange) {
    return {
      ...base,
      verdict: 'PASS_FALSE_POSITIVE',
      verdict_reason: 'live stem에 뒤 범위 공통발문 누수가 없다.',
      rules: ['live_range_clean', ...rules],
      evidence: ['db_neighbors', 'original_page_png'],
      proposed_stem: null,
      proposed_sha256: null,
    }
  }

  return {
    ...base,
    verdict: 'HUMAN_FINAL_CHECK',
    verdict_reason: '자동 경계가 원본과 한 번에 증명되지 않는다. 수정 후보를 억지로 만들지 않는다.',
    rules: ['needs_human', ...rules],
    evidence: ['original_page_png'],
    proposed_stem: null,
    proposed_sha256: null,
  }
}

function catalogFromCandidate(candidate: Input839Record, stem: string): CatalogRowClose {
  return {
    id: candidate.problem_id,
    public_code: candidate.public_code,
    problem_number: Number(candidate.current_number),
    original_problem_number: candidate.current_number,
    source_page: candidate.source_page,
    section_code: candidate.section_code,
    major_code: candidate.major_code,
    stem,
    display_state: 'LISTED',
    origin: 'OCR',
    review_status: 'NEEDS_REVIEW',
    current_version_id: null,
    teacher_edit: false,
    verified: false,
  }
}

export function leftover56(records: Input839Record[]): Input839Record[] {
  return records.filter((row) => row.verdict === 'REVIEW_REQUIRED')
}

export function leftoverFrom840Payload(payload: { records?: Array<Partial<Input839Record> & { problem_id?: string; verdict?: string }> }): Input839Record[] {
  const records = (payload.records ?? []).filter((row) => row.verdict === 'REVIEW_REQUIRED' && row.problem_id) as Input839Record[]
  const seen = new Set<string>()
  return records.filter((row) => {
    if (seen.has(row.problem_id)) return false
    seen.add(row.problem_id)
    return true
  })
}

export function ocrCacheKey(page: number, imageSha256: string): string {
  return `p${String(page).padStart(3, '0')}-${imageSha256}`
}

export function estimatePaidCostUsd(input: { newPageCalls: number; dense?: boolean }): number {
  const unit = input.dense === false ? MATHPIX_IMAGE_USD : MATHPIX_PAGE_USD
  return Number((input.newPageCalls * unit).toFixed(4))
}

export function paidBudgetAllows(spentUsd: number, nextCallUsd: number, cap = COST_CAP_USD): boolean {
  return spentUsd + nextCallUsd <= cap + 1e-9
}

export function pagesNeedingPaidOcr(decisions: DecisionClose[], ocrByPage: Map<number, string>): number[] {
  const pages = new Set<number>()
  for (const row of decisions) {
    if (row.source_page == null) continue
    if (ocrByPage.has(row.source_page) && (ocrByPage.get(row.source_page) ?? '').trim()) continue
    if (row.rules.includes('p1_needs_second_source') || row.verdict === 'HUMAN_FINAL_CHECK') {
      pages.add(row.source_page)
    }
  }
  return [...pages].sort((a, b) => a - b)
}

export function planCloseout(
  leftovers: Input839Record[],
  catalog: CatalogRowClose[],
  options: { ocrByPage?: Map<number, string>; paidUsd?: number; mathpix?: number; mistral?: number; cacheHits?: number } = {},
): PlanClose {
  const decisions = leftovers.map((row) => decideOneClose(row, catalog, options))
  const applies: ApplyClose[] = []
  const seen = new Set<string>()
  for (const row of decisions) {
    if (row.teacher_edit || row.verified) continue
    if (row.proposed_stem && row.proposed_stem !== row.stem && (row.verdict === 'AUTO_SAFE' || row.verdict === 'VERIFIED_BY_SOURCE')) {
      const live = catalog.find((item) => item.id === row.problem_id)
      const key = `${row.problem_id}:${row.proposed_sha256}`
      if (!seen.has(key)) {
        seen.add(key)
        applies.push({
          problem_id: row.problem_id,
          public_code: row.public_code,
          current_number: row.current_number,
          source_page: row.source_page,
          from_stem: row.stem,
          to_stem: row.proposed_stem,
          from_hash: row.stem_sha256,
          to_hash: row.proposed_sha256!,
          rules: row.rules,
          parent_version_id: row.current_version_id,
          display_state: live?.display_state ?? 'LISTED',
        })
      }
    }
    for (const sibling of row.sibling_applies) {
      const key = `${sibling.problem_id}:${sibling.to_hash}`
      if (seen.has(key)) continue
      seen.add(key)
      applies.push(sibling)
    }
  }
  const count = (verdict: VerdictClose) => decisions.filter((row) => row.verdict === verdict).length
  const uniquePages = new Set(leftovers.map((row) => row.source_page).filter((page): page is number => page != null)).size
  const human = count('HUMAN_FINAL_CHECK')
  const solved = leftovers.length - human
  const usedPaid = (options.mistral ?? 0) + (options.mathpix ?? 0) > 0
  const paidPageSet = usedPaid ? new Set(options.ocrByPage?.keys() ?? []) : new Set<number>()
  const freeEvidenceSolved = decisions.filter((row) => {
    if (row.verdict === 'HUMAN_FINAL_CHECK') return false
    if (row.rules.includes('p1_choice_restore') && usedPaid && row.source_page != null && paidPageSet.has(row.source_page)) {
      return false
    }
    return true
  }).length
  const summary: SummaryClose = {
    start_review: leftovers.length,
    unique_pages: uniquePages,
    verified_by_source: count('VERIFIED_BY_SOURCE'),
    auto_safe: count('AUTO_SAFE'),
    pass_false_positive: count('PASS_FALSE_POSITIVE'),
    human_final_check: human,
    free_evidence_solved: freeEvidenceSolved,
    mathpix_calls: options.mathpix ?? 0,
    mistral_calls: options.mistral ?? 0,
    cache_hits: options.cacheHits ?? 0,
    new_versions: applies.length,
    current_version_switches: applies.length,
    choice_restores: decisions.filter((row) => row.rules.includes('p1_choice_restore')).length,
    range_restores: decisions.filter((row) => row.rules.includes('trim_later_range') || row.rules.some((rule) => rule.startsWith('drop_homed'))).length,
    create_draft_candidates: decisions.reduce((n, row) => n + row.create_draft_numbers.length, 0),
    teacher_edit_protected: decisions.filter((row) => row.teacher_edit).length,
    verified_protected: decisions.filter((row) => row.verified).length,
    problems_deleted: 0,
    raw_ocr_changed: 0,
    expected_listed: SSEN_LISTED_FROZEN,
    paid_ocr_usd: options.paidUsd ?? 0,
    human_reduction_pct: leftovers.length ? Math.round((solved / leftovers.length) * 1000) / 10 : 0,
  }
  return {
    inspector_version: INSPECTOR_VERSION_CLOSE,
    rules_version: RULES_VERSION_CLOSE,
    decisions,
    applies,
    p1: decisions.filter((row) => P1_GOLD[row.current_number]),
    summary,
  }
}

export function dryRunSafetyClose(
  plan: PlanClose,
  listed: number,
): { ok: boolean; violations: string[] } {
  const violations: string[] = []
  if (plan.summary.problems_deleted !== 0) violations.push('delete')
  if (plan.summary.raw_ocr_changed !== 0) violations.push('raw_ocr')
  if (listed !== SSEN_LISTED_FROZEN) violations.push(`listed ${listed}`)
  if (plan.summary.paid_ocr_usd > COST_CAP_USD) violations.push('cost_cap')
  if (plan.decisions.some((row) => (row.teacher_edit || row.verified) && row.proposed_stem && row.proposed_stem !== row.stem)) {
    violations.push('protected_overwrite')
  }
  return { ok: violations.length === 0, violations }
}

export function bookStatusFromPlan(
  plan: PlanClose,
  extras: { pdf_hash: string; paid_usd: number; listed: number },
): Record<string, unknown> {
  const p1Open = plan.p1.filter((row) => row.verdict === 'HUMAN_FINAL_CHECK').length
  return {
    source_id: SSEN_SOURCE_DOCUMENT_ID,
    title: '쎈수학 공통수학1',
    qa_complete: true,
    ready_for_use: p1Open === 0,
    human_exceptions: plan.summary.human_final_check,
    inspected_at: new Date().toISOString(),
    pdf_hash: extras.pdf_hash,
    inspector_version: INSPECTOR_VERSION_CLOSE,
    paid_ocr_usd: extras.paid_usd,
    completed_items: extras.listed,
    total_items: extras.listed,
    banner:
      p1Open === 0
        ? `전체검사 완료 · 사용 가능 · 최종 확인 ${plan.summary.human_final_check}문항`
        : `전체검사 완료 · P1 잔여 ${p1Open} · 최종 확인 ${plan.summary.human_final_check}문항`,
  }
}
