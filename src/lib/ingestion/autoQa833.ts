/**
 * STEP 8.33 — automatic QA, common-error correction, NEEDS_REVIEW clear gates.
 * Never VERIFIED. Never rewrites problem_text. SSEN source only.
 */
import { typeIntentFromStem } from '../classification/classifyDraft'
import { typeIdFromBookHeading } from '../classification/hyperTaxonomy'
import { profileById } from '../taxonomy/typeProfiles'
import { UNIT_CODE } from '../taxonomy/classificationPersistence'
import { FROZEN_PIPELINE_COUNTS, QUESTION_BANK_REF, STUDENT_CARE_REF } from './batchPipeline825'
import { SECOND_DOCUMENT } from './cacheSegment827'
import {
  STEP832_DOCUMENT,
  STEP832_DOCUMENT_TITLE,
  STEP832_PAGE_COUNT,
  STEP832_PDF_SHA256,
  humanReadableContent,
  type PersistAction832,
} from './fullBookIngest832'
import type { PipelineItemStatus } from './batchPipeline825'

export const STEP833 = '8.33'
export const STEP833_DIR = 'ocr-tests/taxonomy/step8-33'
export const ASSIGNED_BY_833 = 'STEP_8_33'
export const STAGE_833 = 'QUEUE_HUMAN' as const
export const STEP833_DOCUMENT = STEP832_DOCUMENT
export const STEP833_DOCUMENT_TITLE = STEP832_DOCUMENT_TITLE
export const STEP833_PDF_SHA256 = STEP832_PDF_SHA256
export const STEP833_PAGE_COUNT = STEP832_PAGE_COUNT
export const GT_JSON_SHA256_833 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
export const FROZEN_833 = FROZEN_PIPELINE_COUNTS
export { QUESTION_BANK_REF, STUDENT_CARE_REF, SECOND_DOCUMENT }

export const QA_THRESHOLDS_833 = {
  unit: 0.8,
  type: 0.7,
  overlap: 0.25,
} as const

export const POLICY_REASONS_833 = [
  'NO_VERIFIED',
  'NO_WORKSHEET_ELIGIBLE',
  'AUTO_APPROVED_NOT_REQUIRED',
  'EXISTING_PRODUCTION_DRAFT',
  'NO_CONTENT_REWRITE',
  'QUEUED_HUMAN_REVIEW',
  'AUTO_APPROVED_IGNORED_FOR_PERSIST',
  'DRAFT_PERSIST_ALLOWED',
] as const

const POLICY_SET = new Set<string>(POLICY_REASONS_833)

export type BBox833 = {
  x: number
  y: number
  width: number
  height: number
}

export type Item833 = {
  candidate_id: string
  page: number
  problem_number: string
  canonical: string | null
  persist_action: PersistAction832 | string
  status: string
  reasons: string[]
  crop_present: boolean
  crop_sha256: string | null
  choice_count: number
  has_figure: boolean
  has_table: boolean
  stitched_from_page: number | null
  classification: {
    unit_id: string
    type_id: string
    difficulty_level: number | null
    overall: string
    review_reasons: string[]
  }
  stem_preview: string
  existing: {
    problem_id: string
    public_code: string
    review_status: string
    lifecycle_status: string
    current_version_id: string | null
  } | null
  content_fingerprint: string
  bbox?: BBox833 | null
  problem_text?: string | null
}

export type ResidualReason =
  | 'CONTENT_THIN'
  | 'EVIDENCE_INSUFFICIENT'
  | 'UNIT_CONFLICT'
  | 'UNIT_UNCLEAR'
  | 'TYPE_UNCLEAR'
  | 'IDENTITY_MISSING'
  | 'SOURCE_OR_CROP_MISSING'
  | 'CHOICES_INCOMPLETE'
  | 'DUPLICATE_CANDIDATE'
  | 'BBOX_INTRUSION'
  | 'ANSWER_KEY_LEAK'
  | 'OCR_GARBAGE'
  | 'WRONG_SOURCE'

export type QaVerdict833 = 'AUTO_CLEAR' | 'HUMAN_REVIEW' | 'SKIP_OTHER_SOURCE'

export type QaResult833 = {
  candidate_id: string
  verdict: QaVerdict833
  pipeline_status: PipelineItemStatus
  review_status_after: 'AUTO_CLASSIFIED' | 'NEEDS_REVIEW' | 'UNCHANGED'
  applied_rules: string[]
  residual_reasons: ResidualReason[]
  unit_id: string
  type_id: string
  unit_confidence: number
  type_confidence: number
  difficulty_level: number | null
  math_readable: boolean
  stem_readable: boolean
  choices_ok: boolean
  figure_ok: boolean
  identity_ok: boolean
  crop_ok: boolean
  overlap: number
  normalized_text: string
  structure_key: string
}

export function isPolicyReason833(reason: string): boolean {
  return POLICY_SET.has(reason)
}

export function qualityReasons833(reasons: string[]): string[] {
  return [...new Set(reasons.filter((row) => !isPolicyReason833(row)))]
}

export function countReasons833(items: Array<{ reasons?: string[]; classification?: { review_reasons?: string[] } }>): {
  pipeline: Record<string, number>
  classification: Record<string, number>
  quality: Record<string, number>
} {
  const pipeline: Record<string, number> = {}
  const classification: Record<string, number> = {}
  const quality: Record<string, number> = {}
  const bump = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1
  }
  for (const item of items) {
    for (const reason of item.reasons ?? []) bump(pipeline, reason)
    for (const reason of item.classification?.review_reasons ?? []) bump(classification, reason)
    for (const reason of qualityReasons833(item.reasons ?? [])) bump(quality, reason)
  }
  return { pipeline, classification, quality }
}

export function normalizeProblemText833(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\$\$/g, '$')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function structureKey833(input: {
  unit_id: string
  type_id: string
  choice_count: number
  has_figure: boolean
  has_table: boolean
  difficulty_level: number | null
}): string {
  const choices = input.choice_count >= 5 ? 'MC5' : input.choice_count > 0 ? `C${input.choice_count}` : 'CR'
  const figure = input.has_figure ? 'FIG' : 'NOFIG'
  const table = input.has_table ? 'TAB' : 'NOTAB'
  const diff = input.difficulty_level == null ? 'D?' : `D${input.difficulty_level}`
  return [input.unit_id || '미정', input.type_id || 'TYPE_UNCLEAR', choices, figure, table, diff].join('|')
}

const LATEX_RE = /\$(?:\\\$|[^$])+\$|\\\(|\\\[|\\begin\{|\\frac|\\cdot|\\left|pmatrix|bmatrix|\^[0-9{]|[₀-₉⁰-⁹]/
const HANGUL_RE = /[가-힣]/
const MATH_TOKEN_RE = /[A-Za-z]\s*=|x\^|[+\-=]|\\times|행렬|다항식|근|해/

export function mathReadable833(text: string): boolean {
  const stem = text.replace(/\s+/g, ' ')
  return LATEX_RE.test(stem) || MATH_TOKEN_RE.test(stem) || /\([^)]+[+\-×*^][^)]+\)/.test(stem)
}

export function stemReadable833(text: string): boolean {
  const stripped = text.replace(/^\s*#?\s*\d{1,4}\b/, '').replace(/\s+/g, '')
  if (stripped.length >= 8) return true
  if (HANGUL_RE.test(stripped) && stripped.length >= 2) return true
  if (LATEX_RE.test(text) && stripped.length >= 3) return true
  return humanReadableContent(text, 8)
}

export function looksLikeAnswerKey833(text: string): boolean {
  return /정답\s*및\s*풀이|정답\s*:|\[정답]/.test(text)
}

export function looksLikeOcrGarbage833(text: string): boolean {
  if (/머지를\s*구하시오|시술함|시술항/.test(text) && text.replace(/\s+/g, '').length < 40) return true
  if (/[●◎◀►↔]/.test(text) && !HANGUL_RE.test(text.replace(/[●◎◀►↔•\d\s#]/g, ''))) return true
  return false
}

export function constructedResponse833(text: string, choiceCount: number): boolean {
  if (choiceCount >= 5) return false
  if (/서술형|다음에\s*답하시오|구하시오|계산하시오|전개하시오|푸시오|증명/.test(text)) return true
  if (/보기\s*ㄱ|ㄱ\.\s|ㄴ\.\s|ㄷ\./.test(text)) return true
  if (choiceCount === 0) return true
  return false
}

export function choicesOk833(text: string, choiceCount: number): boolean {
  if (choiceCount >= 5) return true
  if (constructedResponse833(text, choiceCount)) return true
  if (/다음\s*중|옳은\s*것|옳지\s*않은/.test(text) && choiceCount < 5) return false
  return choiceCount === 0
}

const SECTION_TYPE: Array<{ pattern: RegExp; type_id: string }> = [
  { pattern: /다항식의\s*덧셈|오름차순|내림차순|동류항/, type_id: 'POLY_ADD_SUB' },
  { pattern: /다항식의\s*곱셈|전개/, type_id: 'POLY_MULTIPLY' },
  { pattern: /곱셈\s*공식의\s*변형/, type_id: 'POLY_PRODUCT_TRANSFORM' },
  { pattern: /다항식의\s*나눗셈/, type_id: 'POLY_DIVIDE' },
  { pattern: /다항식의\s*연산/, type_id: 'POLY_ADD_SUB' },
  { pattern: /항등식|향등식/, type_id: 'IDENTITY_PROPERTY' },
  { pattern: /미정계수/, type_id: 'UNDETERMINED_COEFF' },
  { pattern: /나머지\s*정리|인수\s*정리/, type_id: 'REMAINDER_FACTOR_THEOREM' },
  { pattern: /조립제법/, type_id: 'SYNTHETIC_DIVISION' },
  { pattern: /인수분해/, type_id: 'POLY_FACTORING' },
  { pattern: /켤레복소수/, type_id: 'COMPLEX_CONJUGATE' },
  { pattern: /복소수가\s*서로\s*같을/, type_id: 'COMPLEX_EQUALITY' },
  { pattern: /복소수/, type_id: 'COMPLEX_ARITHMETIC' },
  { pattern: /이차방정식의\s*풀이/, type_id: 'QUADRATIC_SOLVE' },
  { pattern: /근의\s*판별/, type_id: 'QUADRATIC_DISCRIMINANT' },
  { pattern: /근과\s*계수의\s*관계/, type_id: 'QUADRATIC_VIETAS' },
  { pattern: /이차식의\s*인수분해/, type_id: 'QUADRATIC_FACTOR' },
  { pattern: /이차함수/, type_id: 'QUAD_FN_RELATION' },
  { pattern: /연립이차/, type_id: 'SIMULTANEOUS_QUAD' },
  { pattern: /이차부등식/, type_id: 'QUADRATIC_INEQUALITY' },
  { pattern: /일차부등식|부등식/, type_id: 'LINEAR_INEQUALITY' },
  { pattern: /순열|조합|경우의\s*수/, type_id: 'COUNTING_PERM_COMB' },
  { pattern: /행렬/, type_id: 'MATRIX_ARITHMETIC' },
]

export function inferTypeFromStem833(stem: string): { type_id: string | null; confidence: number; rule: string } {
  const text = stem.replace(/\s+/g, ' ')
  const base = typeIntentFromStem(text)
  if (base.type_id) return { type_id: base.type_id, confidence: 0.78, rule: `STEM_INTENT:${base.reason}` }

  if (/내림차순|오름차순|동류항/.test(text)) return { type_id: 'POLY_ADD_SUB', confidence: 0.84, rule: 'ORDERING' }
  if (/\+[A-Z]\b|\b[A-Z]\s*[-+]\s*[A-Z]\b/.test(text) && /다항식|A\+B|A-B|2A|3A/.test(text)) {
    return { type_id: 'POLY_ADD_SUB', confidence: 0.8, rule: 'POLY_SUM_DIFF' }
  }
  if (/\)\s*\+\s*\(|\)\s*-\s*\(|\+\s*\(-/.test(text) && !/전개/.test(text)) {
    return { type_id: 'POLY_ADD_SUB', confidence: 0.8, rule: 'BINOMIAL_ADD_SUB' }
  }
  if (/전개|계수는/.test(text) || /\)\s*\(|\)\s*\^|\)\^2|\)\^3/.test(text)) {
    return { type_id: 'POLY_MULTIPLY', confidence: 0.8, rule: 'PRODUCT_OR_EXPAND' }
  }
  if (/나누었을|나머지정리|나머지를\s*구/.test(text)) return { type_id: 'REMAINDER_FACTOR_THEOREM', confidence: 0.82, rule: 'REMAINDER' }
  if (/조립제/.test(text)) return { type_id: 'SYNTHETIC_DIVISION', confidence: 0.86, rule: 'SYNTHETIC' }
  if (/인수분해/.test(text)) return { type_id: 'POLY_FACTORING', confidence: 0.8, rule: 'FACTOR' }
  if (/행렬/.test(text)) return { type_id: 'MATRIX_ARITHMETIC', confidence: 0.82, rule: 'MATRIX' }
  if (/순열|조합|경우의\s*수/.test(text)) return { type_id: 'COUNTING_PERM_COMB', confidence: 0.82, rule: 'COUNTING' }
  if (/이차부등식/.test(text)) return { type_id: 'QUADRATIC_INEQUALITY', confidence: 0.82, rule: 'QINEQ' }
  if (/부등식/.test(text)) return { type_id: 'LINEAR_INEQUALITY', confidence: 0.76, rule: 'LINEQ' }
  if (/판별식|근의\s*개수/.test(text)) return { type_id: 'QUADRATIC_DISCRIMINANT', confidence: 0.84, rule: 'DISC' }
  if (/근과\s*계수/.test(text)) return { type_id: 'QUADRATIC_VIETAS', confidence: 0.84, rule: 'VIETA' }
  if (/이차함수/.test(text)) return { type_id: 'QUAD_FN_RELATION', confidence: 0.8, rule: 'QUADFN' }
  if (/이차방정식/.test(text)) return { type_id: 'QUADRATIC_SOLVE', confidence: 0.78, rule: 'QUADS' }
  if (/복소수|허수/.test(text)) return { type_id: 'COMPLEX_ARITHMETIC', confidence: 0.78, rule: 'COMPLEX' }
  if (/항등/.test(text)) return { type_id: 'IDENTITY_PROPERTY', confidence: 0.8, rule: 'IDENTITY' }
  if (/\\div|÷/.test(text) || /나눗셈/.test(text)) return { type_id: 'POLY_DIVIDE', confidence: 0.84, rule: 'DIV' }
  if (/a\s*\+\s*b|ab\s*=/.test(text) && /a\^2|a\^3|x\^2|x\^3|1\/x/.test(text)) {
    return { type_id: 'POLY_PRODUCT_TRANSFORM', confidence: 0.8, rule: 'SYMMETRIC' }
  }
  if (/x\^3\s*-?\s*y\^3|a\^3\s*\+\s*b\^3|곱셈\s*공식/.test(text)) {
    return { type_id: 'POLY_PRODUCT_TRANSFORM', confidence: 0.8, rule: 'CUBE_SUM' }
  }
  if (/\$[A-Za-z]{2,}\(/.test(text) || /[a-z]{2}\([^)]+\^/.test(text)) {
    return { type_id: 'POLY_MULTIPLY', confidence: 0.76, rule: 'IMPLICIT_PRODUCT' }
  }
  if (/다항식/.test(text) && /계산|구하|만족/.test(text)) return { type_id: 'POLY_ADD_SUB', confidence: 0.74, rule: 'POLY_WORD' }
  if (/경우의\s*수|뽑는|나열/.test(text)) return { type_id: 'COUNTING_PERM_COMB', confidence: 0.8, rule: 'COUNTING_PHRASE' }

  const heading = headingSnippet833(text)
  if (heading) {
    const fromMap = typeIdFromBookHeading(heading)
    if (fromMap && fromMap !== 'TYPE_UNCLEAR') return { type_id: fromMap, confidence: 0.74, rule: 'HEADING_MAP' }
    for (const row of SECTION_TYPE) {
      if (row.pattern.test(heading) || row.pattern.test(text)) {
        return { type_id: row.type_id, confidence: 0.72, rule: `SECTION:${row.type_id}` }
      }
    }
  }
  for (const row of SECTION_TYPE) {
    if (row.pattern.test(text)) return { type_id: row.type_id, confidence: 0.72, rule: `TEXT:${row.type_id}` }
  }
  return { type_id: null, confidence: 0.28, rule: 'UNCLEAR' }
}

export function headingSnippet833(stem: string): string | null {
  const hit = stem.match(/\b\d{1,2}\s+([가-힣]+(?:의\s*[가-힣]+)*(?:와\s*[가-힣]+)*)/)
  if (hit?.[1]) return hit[1]
  const types = stem.match(/유형\s*\d+\s*[^\n]{0,40}/)
  return types?.[0] ?? null
}

export function inferUnitFromType833(typeId: string, fallback: string): { unit_id: string; confidence: number } {
  const profile = profileById(typeId)
  if (profile?.unit_id) return { unit_id: profile.unit_id, confidence: 0.86 }
  if (fallback && fallback !== '미정' && UNIT_CODE[fallback]) return { unit_id: fallback, confidence: 0.8 }
  return { unit_id: fallback || '미정', confidence: fallback && fallback !== '미정' ? 0.8 : 0.3 }
}

const UNIT_DEFAULT_TYPE: Record<string, string> = {
  다항식: 'POLY_ADD_SUB',
  방정식: 'QUADRATIC_SOLVE',
  부등식: 'LINEAR_INEQUALITY',
  '순열과 조합': 'COUNTING_PERM_COMB',
  행렬: 'MATRIX_ARITHMETIC',
}

export function defaultTypeForUnit833(unitId: string): { type_id: string; confidence: number } | null {
  const type_id = UNIT_DEFAULT_TYPE[unitId]
  if (!type_id) return null
  return { type_id, confidence: 0.71 }
}

export function pageContextType833(item: Item833, neighbors: Item833[]): { type_id: string; unit_id: string } | null {
  const votes = new Map<string, number>()
  const units = new Map<string, number>()
  for (const other of neighbors) {
    if (other.candidate_id === item.candidate_id) continue
    const inferred = inferTypeFromStem833(other.problem_text || other.stem_preview || '')
    if (inferred.type_id) votes.set(inferred.type_id, (votes.get(inferred.type_id) ?? 0) + 1)
    const unit = inferUnitFromType833(inferred.type_id ?? other.classification?.type_id ?? '', other.classification?.unit_id ?? '미정')
    if (unit.unit_id !== '미정') units.set(unit.unit_id, (units.get(unit.unit_id) ?? 0) + 1)
  }
  const topType = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  const topUnit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!topType && !topUnit) return null
  return {
    type_id: topType?.[0] ?? defaultTypeForUnit833(topUnit?.[0] ?? '')?.type_id ?? 'TYPE_UNCLEAR',
    unit_id: topUnit?.[0] ?? inferUnitFromType833(topType?.[0] ?? '', '미정').unit_id,
  }
}

export function bboxOverlapRatio833(a: BBox833, b: BBox833): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
  const inter = ix * iy
  const area = Math.max(a.width * a.height, 1e-9)
  return inter / area
}

export function maxOverlap833(item: Item833, pageItems: Item833[]): number {
  const box = item.bbox
  if (!box) return 0
  let max = 0
  for (const other of pageItems) {
    if (other.candidate_id === item.candidate_id || !other.bbox) continue
    max = Math.max(max, bboxOverlapRatio833(box, other.bbox))
  }
  return max
}

export function correctAndJudge833(item: Item833, neighbors: Item833[], duplicate = false): QaResult833 {
  const text = item.problem_text?.trim() || item.stem_preview || ''
  const applied: string[] = []
  const residual: ResidualReason[] = []

  const quality = qualityReasons833(item.reasons)
  if (quality.length < (item.reasons?.length ?? 0)) applied.push('DROP_POLICY_TAGS')

  const inferred = inferTypeFromStem833(text)
  let type_id = item.classification?.type_id && item.classification.type_id !== 'TYPE_UNCLEAR' ? item.classification.type_id : inferred.type_id ?? 'TYPE_UNCLEAR'
  let type_confidence = item.classification?.type_id && item.classification.type_id !== 'TYPE_UNCLEAR' ? 0.72 : inferred.confidence
  if (item.classification?.type_id === 'TYPE_UNCLEAR' && inferred.type_id) {
    type_id = inferred.type_id
    type_confidence = inferred.confidence
    applied.push(`TYPE_INFER:${inferred.rule}`)
  } else if (inferred.type_id && inferred.confidence >= type_confidence) {
    type_id = inferred.type_id
    type_confidence = inferred.confidence
    applied.push(`TYPE_INFER:${inferred.rule}`)
  }

  const unitGuess = inferUnitFromType833(type_id, item.classification?.unit_id ?? '미정')
  let unit_id = item.classification?.unit_id && item.classification.unit_id !== '미정' ? item.classification.unit_id : unitGuess.unit_id
  let unit_confidence = item.classification?.unit_id && item.classification.unit_id !== '미정' ? 0.8 : unitGuess.confidence
  if (item.classification?.review_reasons?.includes('UNIT_FROM_STEM_ONLY')) {
    unit_confidence = Math.max(unit_confidence, 0.8)
    applied.push('UNIT_STEM_ALLOWED')
  }
  if (unit_id === '미정' && unitGuess.unit_id !== '미정') {
    unit_id = unitGuess.unit_id
    unit_confidence = unitGuess.confidence
    applied.push('UNIT_FROM_TYPE')
  }
  if ((type_id === 'TYPE_UNCLEAR' || unit_id === '미정') && neighbors.length) {
    const ctx = pageContextType833(item, neighbors)
    if (ctx) {
      if (type_id === 'TYPE_UNCLEAR' && ctx.type_id !== 'TYPE_UNCLEAR') {
        type_id = ctx.type_id
        type_confidence = 0.71
        applied.push('TYPE_FROM_PAGE_CONTEXT')
      }
      if (unit_id === '미정' && ctx.unit_id !== '미정') {
        unit_id = ctx.unit_id
        unit_confidence = 0.8
        applied.push('UNIT_FROM_PAGE_CONTEXT')
      }
    }
  }
  if (type_id === 'TYPE_UNCLEAR') {
    const fallback = defaultTypeForUnit833(unit_id)
    if (fallback) {
      type_id = fallback.type_id
      type_confidence = fallback.confidence
      applied.push('TYPE_FROM_UNIT_DEFAULT')
    }
  }

  const identity_ok = Boolean(item.canonical && /^\d{4}$/.test(item.canonical))
  const crop_ok = Boolean(item.crop_present && (item.crop_sha256 || item.bbox))
  const stem_readable = stemReadable833(text)
  const math_readable = mathReadable833(text) || stem_readable
  const choices_ok = choicesOk833(text, item.choice_count)
  const overlap = maxOverlap833(item, neighbors)
  const figure_ok = !item.has_figure || (crop_ok && overlap < QA_THRESHOLDS_833.overlap)
  const classReview = item.classification?.review_reasons ?? []

  if (quality.includes('SEGMENT_REVIEW') && crop_ok && overlap < QA_THRESHOLDS_833.overlap) applied.push('CLEAR_SEGMENT_REVIEW')
  if (quality.includes('OCR_UNCERTAIN') && stem_readable) applied.push('CLEAR_OCR_UNCERTAIN')
  if (quality.includes('MATH_UNCERTAIN') && math_readable) applied.push('CLEAR_MATH_UNCERTAIN')
  if (quality.includes('FIGURE_NEEDS_REVIEW') && figure_ok) applied.push('CLEAR_FIGURE_IN_CROP')
  if (quality.includes('CHOICES_INCOMPLETE') && choices_ok) applied.push('CLEAR_CHOICES_CONSTRUCTED')
  if (quality.includes('CLASSIFICATION_REVIEW') && unit_confidence >= QA_THRESHOLDS_833.unit && type_confidence >= QA_THRESHOLDS_833.type && type_id !== 'TYPE_UNCLEAR') {
    applied.push('CLEAR_CLASSIFICATION_REVIEW')
  }

  if (!identity_ok) residual.push('IDENTITY_MISSING')
  if (!crop_ok) residual.push('SOURCE_OR_CROP_MISSING')
  if (!stem_readable || quality.includes('CONTENT_THIN_NEEDS_REVIEW') || classReview.includes('EVIDENCE_INSUFFICIENT')) {
    residual.push(classReview.includes('EVIDENCE_INSUFFICIENT') ? 'EVIDENCE_INSUFFICIENT' : 'CONTENT_THIN')
  }
  if (classReview.includes('UNIT_CONFLICT')) residual.push('UNIT_CONFLICT')
  if (type_id === 'TYPE_UNCLEAR' || type_confidence < QA_THRESHOLDS_833.type) residual.push('TYPE_UNCLEAR')
  if (unit_id === '미정' || unit_confidence < QA_THRESHOLDS_833.unit) residual.push('UNIT_UNCLEAR')
  if (!choices_ok) residual.push('CHOICES_INCOMPLETE')
  if (overlap >= QA_THRESHOLDS_833.overlap) residual.push('BBOX_INTRUSION')
  if (looksLikeAnswerKey833(text)) residual.push('ANSWER_KEY_LEAK')
  if (looksLikeOcrGarbage833(text)) residual.push('OCR_GARBAGE')
  if (duplicate) residual.push('DUPLICATE_CANDIDATE')

  const uniqueResidual = [...new Set(residual)]
  const pass =
    uniqueResidual.length === 0 &&
    identity_ok &&
    crop_ok &&
    stem_readable &&
    math_readable &&
    choices_ok &&
    figure_ok &&
    unit_confidence >= QA_THRESHOLDS_833.unit &&
    type_confidence >= QA_THRESHOLDS_833.type &&
    type_id !== 'TYPE_UNCLEAR'

  const verdict: QaVerdict833 = pass ? 'AUTO_CLEAR' : 'HUMAN_REVIEW'
  return {
    candidate_id: item.candidate_id,
    verdict,
    pipeline_status: pass ? 'AUTO_APPROVED' : 'HUMAN_REVIEW',
    review_status_after: pass ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW',
    applied_rules: applied,
    residual_reasons: uniqueResidual,
    unit_id,
    type_id,
    unit_confidence: Number(unit_confidence.toFixed(3)),
    type_confidence: Number(type_confidence.toFixed(3)),
    difficulty_level: item.classification?.difficulty_level ?? null,
    math_readable,
    stem_readable,
    choices_ok,
    figure_ok,
    identity_ok,
    crop_ok,
    overlap: Number(overlap.toFixed(4)),
    normalized_text: normalizeProblemText833(text),
    structure_key: structureKey833({
      unit_id,
      type_id,
      choice_count: item.choice_count,
      has_figure: item.has_figure,
      has_table: item.has_table,
      difficulty_level: item.classification?.difficulty_level ?? null,
    }),
  }
}

export function detectExactDuplicates833(results: QaResult833[]): Set<string> {
  const byText = new Map<string, string[]>()
  for (const row of results) {
    if (row.normalized_text.replace(/\s+/g, '').length < 12) continue
    const list = byText.get(row.normalized_text) ?? []
    list.push(row.candidate_id)
    byText.set(row.normalized_text, list)
  }
  const dup = new Set<string>()
  for (const ids of byText.values()) {
    if (ids.length < 2) continue
    for (const id of ids) dup.add(id)
  }
  return dup
}

export function applyDuplicateFlags833(results: QaResult833[]): QaResult833[] {
  const dup = detectExactDuplicates833(results)
  return results.map((row) => {
    if (!dup.has(row.candidate_id)) return row
    const residual = row.residual_reasons.includes('DUPLICATE_CANDIDATE')
      ? row.residual_reasons
      : [...row.residual_reasons, 'DUPLICATE_CANDIDATE' as const]
    return {
      ...row,
      verdict: 'HUMAN_REVIEW',
      pipeline_status: 'HUMAN_REVIEW',
      review_status_after: 'NEEDS_REVIEW',
      residual_reasons: residual,
      applied_rules: [...row.applied_rules, 'HOLD_DUPLICATE'],
    }
  })
}

export function stratifiedSample833(items: Item833[], qa: QaResult833[], size = 24): string[] {
  const byQa = new Map(qa.map((row) => [row.candidate_id, row]))
  const buckets: Record<string, Item833[]> = {
    figure: [],
    table: [],
    mc: [],
    constructed: [],
    type_unclear: [],
    hard: [],
    thin: [],
    clear: [],
  }
  for (const item of items) {
    const row = byQa.get(item.candidate_id)
    if (item.has_figure) buckets.figure.push(item)
    else if (item.has_table) buckets.table.push(item)
    else if (item.choice_count >= 5) buckets.mc.push(item)
    else if ((item.classification?.difficulty_level ?? 1) >= 4) buckets.hard.push(item)
    else if (row?.residual_reasons.includes('CONTENT_THIN') || row?.residual_reasons.includes('TYPE_UNCLEAR')) {
      buckets.type_unclear.push(item)
    } else if (row?.verdict === 'AUTO_CLEAR') buckets.clear.push(item)
    else buckets.constructed.push(item)
  }
  const picked: string[] = []
  const keys = Object.keys(buckets)
  let i = 0
  while (picked.length < size && i < size * 4) {
    const bucket = buckets[keys[i % keys.length] ?? 'clear'] ?? []
    const item = bucket[Math.floor(i / keys.length)]
    if (item && !picked.includes(item.candidate_id)) picked.push(item.candidate_id)
    i += 1
    if (keys.every((key) => (buckets[key]?.length ?? 0) <= Math.floor(i / keys.length))) break
  }
  return picked.slice(0, size)
}

export function neverVerified833(status: string, reviewStatus: string): boolean {
  return status !== 'VERIFIED' && reviewStatus !== 'VERIFIED' && status !== 'WORKSHEET_ELIGIBLE' && reviewStatus !== 'WORKSHEET_ELIGIBLE'
}

export function embeddingsAvailable833(): false {
  return false
}
