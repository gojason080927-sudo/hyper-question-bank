/**
 * SSEN listed-book classification from frozen TOC + 유형 titles + page heading pills.
 * Never invents math. Never VERIFIED. Never DELETE.
 */
import { typeIdFromBookHeading } from '../classification/hyperTaxonomy'
import {
  SSEN_MAJORS,
  SSEN_SOURCE_DOCUMENT_ID,
  sectionForPage,
  type FrozenSection,
} from '../outline/ssenToc'
import { extraAliasMap } from './taxonomyAlias'
import { profileById, type TypeProfileV1 } from './typeProfiles'
import { SUBUNIT_CODE, UNIT_CODE } from './classificationPersistence'

export const CLASSIFY_ASSIGNED_BY = 'SSEN_FULL_CLASSIFY'
export const CLASSIFY_ARTIFACT = 'ssen-classify'
export { SSEN_SOURCE_DOCUMENT_ID }

export type SsenTypeNode = {
  id: string
  code: string
  title: string
  sectionCode: string
}

export type SsenHeadingHit = {
  page: number
  y_norm: number
  x_norm: number
  kind: 'type_pill' | 'concept_pill' | 'c_stage'
  title_ocr: string
  badge_ocr: string
}

export type SsenClassifyItem = {
  problem_id: string
  public_code: string
  original_problem_number: string
  source_page: number
  stem: string
  review_status: string
  display_state: string
  current_version_id: string | null
  origin: string | null
  bbox_top: number
  bbox_x: number
  bbox_h: number
  existing_type_code: string | null
}

export type SsenClassifyDecision = {
  problem_id: string
  public_code: string
  original_problem_number: string
  source_page: number
  section_code: string | null
  unit_id: string | null
  subunit_id: string | null
  type_id: string | null
  type_title: string | null
  type_code: string | null
  outline_type_node_id: string | null
  verdict: 'AUTO' | 'HUMAN'
  reasons: string[]
  evidence: string[]
  clear_needs_review: boolean
}

const TITLE_RULES: Array<{ pattern: RegExp; type_id: string }> = [
  { pattern: /수치\s*대입/, type_id: 'UNDETERMINED_COEFF' },
  { pattern: /나누었을\s*때의\s*나머지|나누어떨어지는|몫\s*Q\(x\)|P\(ax/, type_id: 'REMAINDER_FACTOR_THEOREM' },
  { pattern: /몫과\s*나머지의\s*변형/, type_id: 'POLY_DIVIDE' },
  { pattern: /인수분해/, type_id: 'POLY_FACTORING' },
  { pattern: /곱셈\s*공식을\s*이용한\s*수의\s*계산/, type_id: 'POLY_PRODUCT_TRANSFORM' },
  { pattern: /다항식의\s*연산의\s*도형/, type_id: 'POLY_MULTIPLY' },
  { pattern: /복소수의\s*뜻|식의\s*값\s*구하기|실수가\s*되기|조건을\s*만족시키는\s*복소수|허수단위|복소수의\s*거듭제곱/, type_id: 'COMPLEX_ARITHMETIC' },
  { pattern: /한\s*근이\s*주어진\s*이차방정식/, type_id: 'QUADRATIC_SOLVE' },
  { pattern: /이차함수의\s*그래프와\s*x축/, type_id: 'QUAD_FN_RELATION' },
  { pattern: /그래프를\s*이용한\s*부등식/, type_id: 'QUADRATIC_INEQUALITY' },
  { pattern: /합의\s*법칙|곱의\s*법칙|해의\s*개수/, type_id: 'COUNTING_PERM_COMB' },
  { pattern: /절댓값.*방정식|가우스.*방정식|이차방정식의\s*활용|이차방정식의\s*작성|잘못\s*보고\s*푼/, type_id: 'QUADRATIC_SOLVE' },
  { pattern: /완전제곱식|판별식과\s*삼각형/, type_id: 'QUADRATIC_DISCRIMINANT' },
  { pattern: /이차함수의\s*최대|이차함수의\s*그래프와\s*직선/, type_id: 'QUAD_FN_RELATION' },
  { pattern: /연립이차방정식/, type_id: 'SIMULTANEOUS_QUAD' },
  { pattern: /연립일차부등식의\s*활용/, type_id: 'LINEAR_INEQUALITY' },
  { pattern: /연립이차부등식|이차부등식의\s*활용|이차부등식이/, type_id: 'QUADRATIC_INEQUALITY' },
  { pattern: /순열의\s*수|경우의\s*수|분할하는|약수의\s*개수|색칠/, type_id: 'COUNTING_PERM_COMB' },
  { pattern: /행렬의|단위행렬/, type_id: 'MATRIX_ARITHMETIC' },
]

export function hyperTypeFromSsenTitle(title: string, subunit?: string | null): string | null {
  if (subunit === '이차부등식' && /절댓값/.test(title) && /부등식/.test(title)) return 'QUADRATIC_INEQUALITY'
  if (subunit === '일차부등식' && /절댓값/.test(title) && /부등식/.test(title)) return 'LINEAR_INEQUALITY'
  if (subunit === '나머지 정리와 인수분해' && /나눗셈/.test(title) && /항등식/.test(title)) return 'IDENTITY_PROPERTY'
  return typeIdFromBookHeading(title) ?? extraAliasMap(title) ?? TITLE_RULES.find((row) => row.pattern.test(title))?.type_id ?? null
}

export function unitFromSection(section: FrozenSection): string {
  const major = SSEN_MAJORS.find((row) => row.code === section.majorCode)
  return major?.title ?? ''
}

export function extractTypeMarkers(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/유형\s*0?(\d{1,2})/g)) {
    found.push(String(match[1]).padStart(2, '0'))
  }
  return found
}

export function looksLikeAnswerKeyLeak(stem: string): boolean {
  return /정답\s*및\s*풀이|정답\s*:|풀이\s*:/.test(stem)
}

export function hangulOnly(text: string): string {
  return [...text].filter((ch) => ch >= '가' && ch <= '힣').join('')
}

export function coreTypeTitle(title: string): string {
  return title.replace(/^유형\s*\d+\s*/, '').trim()
}

function lcsLen(a: string, b: string): number {
  const rows = a.length
  const cols = b.length
  if (!rows || !cols) return 0
  let prev = new Array<number>(cols + 1).fill(0)
  let next = new Array<number>(cols + 1).fill(0)
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      next[j] = a[i - 1] === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, next[j - 1] ?? 0)
    }
    ;[prev, next] = [next, prev]
    next.fill(0)
  }
  return prev[cols] ?? 0
}

export function titleScore(ocr: string, frozen: string): number {
  const a = hangulOnly(ocr)
  const b = hangulOnly(coreTypeTitle(frozen))
  if (a.length < 6 || b.length < 4) return 0
  if (b.includes(a) || a.includes(b)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  const shared = lcsLen(a, b)
  if (shared < 6) return 0
  if (shared / b.length >= 0.72) return shared / b.length
  if (shared / a.length >= 0.88) return shared / Math.max(a.length, b.length)
  return 0
}

export function matchSsenTypeByTitle(ocr: string, types: SsenTypeNode[]): SsenTypeNode | null {
  if (hangulOnly(ocr).length < 4) return null
  const scored = types
    .map((row) => ({ row, score: titleScore(ocr, row.title) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (!best || best.score < 0.72) return null
  if (second && second.score > 0 && best.score - second.score < 0.1 && best.score < 0.92) return null
  return best.row
}

export function parseBadgeTypeCode(text: string): string | null {
  const matches = [...text.matchAll(/(\d{1,2})/g)].map((row) => Number(row[1]))
  const valid = matches.filter((n) => n >= 1 && n <= 26)
  if (valid.length === 1) return String(valid[0]).padStart(2, '0')
  const lastTwo = text.match(/(\d{2})\s*$/)
  if (lastTwo) {
    const n = Number(lastTwo[1])
    if (n >= 1 && n <= 26) return String(n).padStart(2, '0')
  }
  return null
}

export type ResolvedHeading = {
  node: SsenTypeNode | null
  type_id: string
  type_code: string | null
  type_title: string
  how: string
  ambiguous: boolean
}

function typeFitsSection(type_id: string | null | undefined, unit_id: string, subunit_id: string): type_id is string {
  if (!type_id) return false
  const profile = profileById(type_id)
  return Boolean(profile && profile.unit_id === unit_id && profile.subunit_id === subunit_id)
}

export function resolveHeading(
  hit: SsenHeadingHit,
  sectionTypes: SsenTypeNode[],
  unit_id: string,
  subunit_id: string,
): ResolvedHeading | null {
  if (hit.kind === 'c_stage') return null
  const blob = `${hit.title_ocr} ${hit.badge_ocr}`
  const allowed = new Map(sectionTypes.map((row) => [row.code, row]))
  const markers = [...new Set(extractTypeMarkers(blob).filter((code) => allowed.has(code)))]
  if (hit.kind === 'concept_pill' && markers.length > 1) {
    return { node: null, type_id: '', type_code: null, type_title: hit.title_ocr, how: 'concept_multi_type', ambiguous: true }
  }
  const matched = matchSsenTypeByTitle(hit.title_ocr, sectionTypes)
  if (matched) {
    const type_id = hyperTypeFromSsenTitle(matched.title, subunit_id) ?? hyperTypeFromSsenTitle(hit.title_ocr, subunit_id)
    if (typeFitsSection(type_id, unit_id, subunit_id)) {
      return { node: matched, type_id, type_code: matched.code, type_title: matched.title, how: `${hit.kind}_title`, ambiguous: false }
    }
  }
  if (hit.kind === 'concept_pill' && hangulOnly(hit.title_ocr).length >= 4) {
    return { node: null, type_id: '', type_code: null, type_title: hit.title_ocr, how: 'concept_unmapped', ambiguous: true }
  }
  const fromTitle = hyperTypeFromSsenTitle(hit.title_ocr, subunit_id)
  if (hit.kind === 'type_pill' && fromTitle && hangulOnly(hit.title_ocr).length >= 6 && typeFitsSection(fromTitle, unit_id, subunit_id)) {
    const node = sectionTypes.find((row) => hyperTypeFromSsenTitle(row.title, subunit_id) === fromTitle) ?? null
    return {
      node,
      type_id: fromTitle,
      type_code: node?.code ?? parseBadgeTypeCode(hit.badge_ocr),
      type_title: hit.title_ocr,
      how: `${hit.kind}_hyper_title`,
      ambiguous: false,
    }
  }
  if (hit.kind === 'type_pill') {
    const code = markers[0] ?? parseBadgeTypeCode(hit.badge_ocr)
    if (code && allowed.has(code) && markers.length <= 1) {
      const node = allowed.get(code) ?? null
      const type_id = node ? hyperTypeFromSsenTitle(node.title, subunit_id) : null
      if (node && typeFitsSection(type_id, unit_id, subunit_id)) {
        return { node, type_id, type_code: node.code, type_title: node.title, how: 'type_pill_badge', ambiguous: false }
      }
    }
  }
  if (hit.kind === 'concept_pill' && hangulOnly(hit.title_ocr).length >= 4) {
    return { node: null, type_id: '', type_code: null, type_title: hit.title_ocr, how: 'concept_unmapped', ambiguous: true }
  }
  return null
}

function uniqueAllowedMarkers(text: string, allowed: Map<string, SsenTypeNode>): string[] {
  return [...new Set(extractTypeMarkers(text).filter((code) => allowed.has(code)))]
}

export function planSsenClassify(
  items: SsenClassifyItem[],
  types: SsenTypeNode[],
  pageOcrByPage: Map<number, string>,
  headings: SsenHeadingHit[] = [],
): { decisions: SsenClassifyDecision[]; summary: Record<string, number> } {
  const typesBySection = new Map<string, SsenTypeNode[]>()
  for (const row of types) {
    const bag = typesBySection.get(row.sectionCode) ?? []
    bag.push(row)
    typesBySection.set(row.sectionCode, bag)
  }
  const listed = items
    .filter((row) => row.display_state === 'LISTED')
    .slice()
    .sort(
      (a, b) =>
        Number(a.original_problem_number) - Number(b.original_problem_number) ||
        a.source_page - b.source_page ||
        a.bbox_top - b.bbox_top,
    )

  const headingStream = headings
    .filter((hit) => Boolean(sectionForPage(hit.page)))
    .slice()
    .sort(
      (a, b) =>
        a.page - b.page ||
        Number(a.x_norm >= 0.48) - Number(b.x_norm >= 0.48) ||
        a.y_norm - b.y_norm ||
        a.x_norm - b.x_norm,
    )

  const headingAtOrBefore = (hit: SsenHeadingHit, item: SsenClassifyItem) => {
    if (hit.page < item.source_page) return true
    if (hit.page !== item.source_page) return false
    const hitCol = hit.x_norm < 0.48 ? 0 : 1
    const itemCol = item.bbox_x < 0.48 ? 0 : 1
    if (hitCol !== itemCol) return hitCol < itemCol
    return hit.y_norm <= item.bbox_top + 0.06
  }

  const replayHeadings = (item: SsenClassifyItem) => {
    const inherit = new Map<string, ResolvedHeading>()
    const cMode = new Map<string, boolean>()
    const blocked = new Set<string>()
    const applyHeading = (hit: SsenHeadingHit) => {
      const section = sectionForPage(hit.page)
      if (!section) return
      if (hit.kind === 'c_stage') {
        cMode.set(section.code, true)
        inherit.delete(section.code)
        blocked.add(section.code)
        return
      }
      if (cMode.get(section.code)) return
      const resolved = resolveHeading(hit, typesBySection.get(section.code) ?? [], unitFromSection(section), section.title)
      if (!resolved) return
      if (resolved.ambiguous) {
        inherit.delete(section.code)
        blocked.add(section.code)
      } else {
        inherit.set(section.code, resolved)
        blocked.delete(section.code)
      }
    }
    for (const hit of headingStream) {
      if (hit.page > item.source_page) break
      if (headingAtOrBefore(hit, item)) applyHeading(hit)
    }
    return { inherit, cMode, blocked }
  }

  const lastBySection = new Map<string, ResolvedHeading>()
  const decisions: SsenClassifyDecision[] = []

  for (const item of listed) {
    const replayed = replayHeadings(item)
    const inherit = replayed.inherit
    const cMode = replayed.cMode
    const blocked = replayed.blocked
    const section = sectionForPage(item.source_page)
    const reasons: string[] = []
    const evidence: string[] = []
    if (!section) {
      decisions.push(baseDecision(item, null, null, null, 'HUMAN', ['NO_SECTION'], []))
      continue
    }
    const unit_id = unitFromSection(section)
    const subunit_id = section.title
    evidence.push(`toc_section:${section.code}`)
    const sectionTypes = typesBySection.get(section.code) ?? []
    const allowed = new Map(sectionTypes.map((row) => [row.code, row]))

    let node: SsenTypeNode | null = null
    let type_id: string | null = null
    let how = ''
    const stemCodes = uniqueAllowedMarkers(item.stem, allowed)
    const prev = inherit.get(section.code)
    if (stemCodes.length === 1 && (cMode.get(section.code) || !prev || prev.type_code === stemCodes[0] || prev.ambiguous)) {
      node = allowed.get(stemCodes[0]!) ?? null
      how = 'stem_type_marker'
    } else if (stemCodes.length > 1) {
      reasons.push('TYPE_MARKER_AMBIGUOUS')
    }
    if (!node && !cMode.get(section.code)) {
      const pageMarkers = uniqueAllowedMarkers(pageOcrByPage.get(item.source_page) ?? '', allowed)
      if (pageMarkers.length === 1) {
        node = allowed.get(pageMarkers[0]!) ?? null
        how = 'page_ocr_unique_type'
      }
    }
    if (!node && !cMode.get(section.code)) {
      const inherited = inherit.get(section.code) ?? (blocked.has(section.code) ? undefined : lastBySection.get(section.code))
      if (inherited && !inherited.ambiguous) {
        node = inherited.node
        type_id = inherited.type_id
        how = inherit.get(section.code) ? inherited.how.startsWith('concept') ? 'inherit_concept_heading' : 'inherit_previous_in_section' : 'inherit_previous_in_section'
        evidence.push(inherited.how)
      }
    }
    const inherited = inherit.get(section.code)
    if (node) {
      type_id = type_id ?? hyperTypeFromSsenTitle(node.title, subunit_id)
      evidence.push(how, `ssen_type:${node.code}`, node.title)
    } else if (type_id) {
      evidence.push(how, inherited?.type_title ?? '')
    } else if (!reasons.includes('TYPE_MARKER_AMBIGUOUS')) {
      reasons.push('TYPE_MARKER_MISSING')
    }

    if (type_id && !profileById(type_id)) reasons.push('TYPE_PROFILE_MISSING')
    const profile = type_id ? profileById(type_id) : undefined
    if (profile && (profile.unit_id !== unit_id || profile.subunit_id !== subunit_id)) reasons.push('UNIT_TYPE_INCONSISTENT')
    if (!UNIT_CODE[unit_id]) reasons.push('UNIT_CODE_MISSING')
    if (!SUBUNIT_CODE[subunit_id]) reasons.push('SUBUNIT_CODE_MISSING')
    if (item.origin === 'TEACHER_EDIT') reasons.push('TEACHER_EDIT')
    if (item.review_status === 'VERIFIED') reasons.push('VERIFIED_BLOCKED')
    if (!item.current_version_id) reasons.push('DRAFT_VERSION_MISSING')
    const leak = looksLikeAnswerKeyLeak(item.stem)
    if (leak) reasons.push('ANSWER_KEY_LEAK')

    if (node && type_id && !cMode.get(section.code) && !reasons.includes('TYPE_MARKER_AMBIGUOUS')) {
      const resolved = {
        node,
        type_id,
        type_code: node.code,
        type_title: node.title,
        how: how || 'stem_type_marker',
        ambiguous: false,
      }
      lastBySection.set(section.code, resolved)
    }

    const auto =
      reasons.length === 0 &&
      Boolean(type_id && profile && UNIT_CODE[unit_id] && SUBUNIT_CODE[subunit_id] && item.current_version_id)
    const clear_needs_review = auto && item.review_status === 'NEEDS_REVIEW' && !leak
    decisions.push({
      problem_id: item.problem_id,
      public_code: item.public_code,
      original_problem_number: item.original_problem_number,
      source_page: item.source_page,
      section_code: section.code,
      unit_id,
      subunit_id,
      type_id: type_id,
      type_title: node?.title ?? inherited?.type_title ?? null,
      type_code: node?.code ?? null,
      outline_type_node_id: node?.id ?? null,
      verdict: auto ? 'AUTO' : 'HUMAN',
      reasons: auto ? [] : reasons,
      evidence,
      clear_needs_review,
    })
  }

  const summary = {
    listed: listed.length,
    auto: decisions.filter((row) => row.verdict === 'AUTO').length,
    human: decisions.filter((row) => row.verdict === 'HUMAN').length,
    type_mapped: decisions.filter((row) => Boolean(row.type_id)).length,
    outline_type: decisions.filter((row) => Boolean(row.outline_type_node_id)).length,
    clear_needs_review: decisions.filter((row) => row.clear_needs_review).length,
    teacher_edit: decisions.filter((row) => row.reasons.includes('TEACHER_EDIT')).length,
    verified_blocked: decisions.filter((row) => row.reasons.includes('VERIFIED_BLOCKED')).length,
    answer_key_leak: decisions.filter((row) => row.reasons.includes('ANSWER_KEY_LEAK')).length,
    c_stage_human: decisions.filter((row) => row.reasons.includes('TYPE_MARKER_MISSING') && row.evidence.every((row) => !row.startsWith('inherit'))).length,
  }
  return { decisions, summary }
}

function baseDecision(
  item: SsenClassifyItem,
  section: FrozenSection | null,
  type_id: string | null,
  node: SsenTypeNode | null,
  verdict: 'AUTO' | 'HUMAN',
  reasons: string[],
  evidence: string[],
): SsenClassifyDecision {
  return {
    problem_id: item.problem_id,
    public_code: item.public_code,
    original_problem_number: item.original_problem_number,
    source_page: item.source_page,
    section_code: section?.code ?? null,
    unit_id: section ? unitFromSection(section) : null,
    subunit_id: section?.title ?? null,
    type_id,
    type_title: node?.title ?? null,
    type_code: node?.code ?? null,
    outline_type_node_id: node?.id ?? null,
    verdict,
    reasons,
    evidence,
    clear_needs_review: false,
  }
}

export function classificationPayloadFromDecision(
  decision: SsenClassifyDecision,
  versionId: string,
  profile: TypeProfileV1,
): Record<string, unknown> {
  return {
    problem_id: decision.problem_id,
    expected_version_id: versionId,
    source_document_id: SSEN_SOURCE_DOCUMENT_ID,
    page_number: decision.source_page,
    original_problem_number: decision.original_problem_number,
    classification_status: 'AUTO',
    type_code: decision.type_id,
    unit_code: UNIT_CODE[decision.unit_id ?? ''],
    subunit_code: SUBUNIT_CODE[decision.subunit_id ?? ''] ?? '',
    subtype_code: '',
    persist_difficulty: false,
    difficulty_level: null,
    key_test_points: profile.key_test_points,
    solution_strategies: profile.solution_strategies,
    unit_confidence: 0.97,
    type_confidence: 0.9,
    difficulty_confidence: 0,
    source_heading: decision.type_title,
    heading_distance: 0,
    assigned_by: CLASSIFY_ASSIGNED_BY,
    artifact_step: CLASSIFY_ARTIFACT,
  }
}
