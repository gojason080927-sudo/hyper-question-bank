/**
 * STEP 8.34 — remaining-exception auto cleanup (bbox, duplicate, leak, OCR, unit).
 * Never VERIFIED. Never DELETE. Never silent problem_text rewrite.
 */
import {
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
  bboxOverlapRatio833,
  inferTypeFromStem833,
  inferUnitFromType833,
  looksLikeAnswerKey833,
  looksLikeOcrGarbage833,
  mathReadable833,
  neverVerified833,
  normalizeProblemText833,
  pageContextType833,
  stemReadable833,
  structureKey833,
  type BBox833,
  type Item833,
  type QaResult833,
  type ResidualReason,
} from './autoQa833'
import { FROZEN_PIPELINE_COUNTS } from './batchPipeline825'
import { SECOND_DOCUMENT } from './cacheSegment827'
import {
  STEP832_DOCUMENT,
  STEP832_DOCUMENT_TITLE,
  STEP832_PAGE_COUNT,
  STEP832_PDF_SHA256,
} from './fullBookIngest832'

export const STEP834 = '8.34'
export const STEP834_DIR = 'ocr-tests/taxonomy/step8-34'
export const ASSIGNED_BY_834 = 'STEP_8_34'
export const STAGE_834 = 'QUEUE_HUMAN' as const
export const STEP834_DOCUMENT = STEP832_DOCUMENT
export const STEP834_DOCUMENT_TITLE = STEP832_DOCUMENT_TITLE
export const STEP834_PDF_SHA256 = STEP832_PDF_SHA256
export const STEP834_PAGE_COUNT = STEP832_PAGE_COUNT
export const GT_JSON_SHA256_834 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
export const FROZEN_834 = FROZEN_PIPELINE_COUNTS
export const EMBEDDING_USD_CAP = 5
export { QUESTION_BANK_REF, STUDENT_CARE_REF, SECOND_DOCUMENT }

export const BBOX_OVERLAP_MAX = 0.25
export const BBOX_MIN_AREA_RETAINED = 0.45
export const BBOX_GAP = 0.004
export const SHORT_DUP_TEXT_CHARS = 80

export type DupKind834 = 'EXACT_DUPLICATE' | 'VERSION_CANDIDATE' | 'SIMILAR_DISTINCT' | 'UNCERTAIN'

export type BboxCorrection834 = {
  candidate_id: string
  page: number
  original: BBox833
  corrected: BBox833 | null
  original_hash: string
  corrected_hash: string | null
  method: string
  confidence: 'HIGH' | 'MEDIUM' | 'UNCERTAIN'
  overlap_before: number
  overlap_after: number
  area_retained: number
  apply: boolean
}

export type DupDecision834 = {
  left_id: string
  right_id: string
  kind: DupKind834
  keeper_id: string
  extra_id: string
  evidence: string[]
  block_extra: boolean
  clear_duplicate_flag: boolean
  status: 'LINKED' | 'KEPT_DISTINCT' | 'HUMAN_REVIEW'
}

export type LeakSplit834 = {
  original_preserved: true
  leaked: boolean
  stem: string
  answer: string | null
  explanation: string | null
}

export type CleanupItem834 = {
  item: Item833
  qa: QaResult833
  neighbors: Item833[]
  page_items: Item833[]
}

export type CleanupResult834 = {
  candidate_id: string
  verdict: 'AUTO_CLEAR' | 'HUMAN_REVIEW'
  pipeline_status: 'AUTO_APPROVED' | 'HUMAN_REVIEW'
  review_status_after: 'AUTO_CLASSIFIED' | 'NEEDS_REVIEW'
  residual_reasons: ResidualReason[]
  applied_rules: string[]
  bbox: BboxCorrection834 | null
  dup: DupDecision834 | null
  leak_split: LeakSplit834 | null
  ocr_recovery_accepted: boolean
  unit_id: string
  type_id: string
  content_rewrite: false
}

export function bboxHash834(box: BBox833): string {
  const canon = {
    x: Number(box.x.toFixed(6)),
    y: Number(box.y.toFixed(6)),
    width: Number(box.width.toFixed(6)),
    height: Number(box.height.toFixed(6)),
  }
  return stableHex834(JSON.stringify(canon))
}

export function stableHex834(text: string): string {
  let h1 = 2166136261
  let h2 = 2166136261 ^ 0x9e3779b9
  for (let i = 0; i < text.length; i += 1) {
    h1 ^= text.charCodeAt(i)
    h1 = Math.imul(h1, 16777619)
    h2 ^= text.charCodeAt(i) + i
    h2 = Math.imul(h2, 16777619)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex(h2 ^ 0xa5a5a5a5)}`.repeat(2).slice(0, 64)
}

export function clampBox834(box: BBox833): BBox833 {
  const x = Math.max(0, Math.min(1, box.x))
  const y = Math.max(0, Math.min(1, box.y))
  const width = Math.max(0.01, Math.min(1 - x, box.width))
  const height = Math.max(0.01, Math.min(1 - y, box.height))
  return { x, y, width, height }
}

export function area834(box: BBox833): number {
  return Math.max(box.width * box.height, 1e-9)
}

function problemOrder834(item: Item833): number {
  const n = Number.parseInt(item.canonical || item.problem_number, 10)
  return Number.isFinite(n) ? n : item.page * 10000
}

export function maxOverlapAgainst834(box: BBox833, selfId: string, pageItems: Item833[]): number {
  let max = 0
  for (const other of pageItems) {
    if (other.candidate_id === selfId || !other.bbox) continue
    max = Math.max(max, bboxOverlapRatio833(box, other.bbox))
  }
  return max
}

export function iou834(a: BBox833, b: BBox833): number {
  const overlap = bboxOverlapRatio833(a, b) * area834(a)
  const union = area834(a) + area834(b) - overlap
  return overlap / Math.max(union, 1e-9)
}

export function sameColumn834(a: BBox833, b: BBox833): boolean {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  return ix / Math.min(a.width, b.width) >= 0.6
}

function unionBox834(boxes: BBox833[]): BBox833 {
  const x1 = Math.min(...boxes.map((b) => b.x))
  const y1 = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.width))
  const y2 = Math.max(...boxes.map((b) => b.y + b.height))
  return clampBox834({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 })
}

export function correctPageBboxes834(pageItems: Item833[]): Map<string, BBox833> {
  const corrected = new Map<string, BBox833>()
  for (const item of pageItems) {
    if (item.bbox) corrected.set(item.candidate_id, item.bbox)
  }
  const boxed = pageItems.filter((row) => row.bbox)
  const used = new Set<string>()
  for (const item of boxed) {
    if (used.has(item.candidate_id) || !item.bbox) continue
    const cluster = boxed.filter((other) => {
      if (!other.bbox) return false
      return sameColumn834(item.bbox!, other.bbox) && (iou834(item.bbox!, other.bbox) >= 0.45 || bboxOverlapRatio833(item.bbox!, other.bbox) >= 0.7)
    })
    if (cluster.length < 2) continue
    cluster.sort((a, b) => problemOrder834(a) - problemOrder834(b))
    const union = unionBox834(cluster.map((row) => row.bbox!))
    const slice = union.height / cluster.length
    cluster.forEach((row, i) => {
      used.add(row.candidate_id)
      const y = union.y + i * slice
      corrected.set(
        row.candidate_id,
        clampBox834({
          x: union.x,
          y,
          width: union.width,
          height: Math.max(0.02, slice - BBOX_GAP),
        }),
      )
    })
  }
  for (const item of boxed) {
    const current = corrected.get(item.candidate_id)
    if (!current) continue
    const synthetic = pageItems.map((row) => ({
      ...row,
      bbox: corrected.get(row.candidate_id) ?? row.bbox,
    }))
    const pair = correctBboxIntrusion834({ ...item, bbox: current }, synthetic)
    if (pair?.apply && pair.corrected) corrected.set(item.candidate_id, pair.corrected)
  }
  return corrected
}

export function bboxCorrectionFromPage834(
  item: Item833,
  pageItems: Item833[],
  pageCorrected?: Map<string, BBox833>,
): BboxCorrection834 | null {
  const original = item.bbox
  if (!original) return null
  const overlapBefore = maxOverlapAgainst834(original, item.candidate_id, pageItems)
  const next = pageCorrected?.get(item.candidate_id) ?? original
  const synthetic = pageItems.map((row) => ({
    ...row,
    bbox: pageCorrected?.get(row.candidate_id) ?? row.bbox,
  }))
  const overlapAfter = maxOverlapAgainst834(next, item.candidate_id, synthetic)
  const areaRetained = area834(next) / area834(original)
  const changed = bboxHash834(next) !== bboxHash834(original)
  const safeAfter = overlapAfter < BBOX_OVERLAP_MAX
  const apply = safeAfter && changed && areaRetained >= 0.28
  return {
    candidate_id: item.candidate_id,
    page: item.page,
    original,
    corrected: apply ? next : safeAfter && !changed ? original : null,
    original_hash: bboxHash834(original),
    corrected_hash: apply || (safeAfter && !changed) ? bboxHash834(next) : null,
    method: changed ? 'PAGE_COLUMN_RESPLIT_OR_SHRINK' : safeAfter ? 'NO_INTRUSION' : 'UNRESOLVED',
    confidence: !safeAfter ? 'UNCERTAIN' : apply && areaRetained >= 0.5 ? 'HIGH' : apply ? 'MEDIUM' : 'HIGH',
    overlap_before: Number(overlapBefore.toFixed(4)),
    overlap_after: Number(overlapAfter.toFixed(4)),
    area_retained: Number(areaRetained.toFixed(4)),
    apply,
  }
}

export function correctBboxIntrusion834(item: Item833, pageItems: Item833[]): BboxCorrection834 | null {
  const original = item.bbox
  if (!original) return null
  const overlapBefore = maxOverlapAgainst834(original, item.candidate_id, pageItems)
  const originalHash = bboxHash834(original)
  if (overlapBefore < BBOX_OVERLAP_MAX) {
    return {
      candidate_id: item.candidate_id,
      page: item.page,
      original,
      corrected: original,
      original_hash: originalHash,
      corrected_hash: originalHash,
      method: 'NO_INTRUSION',
      confidence: 'HIGH',
      overlap_before: overlapBefore,
      overlap_after: overlapBefore,
      area_retained: 1,
      apply: false,
    }
  }

  const selfOrder = problemOrder834(item)
  const others = pageItems
    .filter((row) => row.candidate_id !== item.candidate_id && row.bbox)
    .sort((a, b) => problemOrder834(a) - problemOrder834(b))

  let next = original
  const methods: string[] = []

  for (const other of others) {
    const box = other.bbox
    if (!box) continue
    const overlap = bboxOverlapRatio833(next, box)
    if (overlap < BBOX_OVERLAP_MAX) continue
    const otherOrder = problemOrder834(other)
    const vertical = Math.abs(next.x - box.x) < Math.max(next.width, box.width) * 0.6
    const horizontal = Math.abs(next.y - box.y) < Math.max(next.height, box.height) * 0.6

    if (vertical && selfOrder <= otherOrder && next.y <= box.y) {
      const newHeight = box.y - next.y - BBOX_GAP
      if (newHeight >= original.height * BBOX_MIN_AREA_RETAINED && newHeight > 0.02) {
        next = clampBox834({ ...next, height: newHeight })
        methods.push('SHRINK_BOTTOM_TO_NEXT')
      }
    } else if (vertical && selfOrder >= otherOrder && next.y < box.y + box.height) {
      const newY = box.y + box.height + BBOX_GAP
      const newHeight = next.y + next.height - newY
      if (newHeight >= original.height * BBOX_MIN_AREA_RETAINED && newHeight > 0.02) {
        next = clampBox834({ ...next, y: newY, height: newHeight })
        methods.push('RAISE_TOP_TO_PREV')
      }
    } else if (horizontal && selfOrder <= otherOrder && next.x <= box.x) {
      const newWidth = box.x - next.x - BBOX_GAP
      if (newWidth >= original.width * BBOX_MIN_AREA_RETAINED && newWidth > 0.02) {
        next = clampBox834({ ...next, width: newWidth })
        methods.push('SHRINK_RIGHT_TO_NEXT')
      }
    } else if (horizontal && selfOrder >= otherOrder && next.x < box.x + box.width) {
      const newX = box.x + box.width + BBOX_GAP
      const newWidth = next.x + next.width - newX
      if (newWidth >= original.width * BBOX_MIN_AREA_RETAINED && newWidth > 0.02) {
        next = clampBox834({ ...next, x: newX, width: newWidth })
        methods.push('SHIFT_LEFT_TO_PREV')
      }
    }
  }

  const overlapAfter = maxOverlapAgainst834(next, item.candidate_id, pageItems.map((row) => (
    row.candidate_id === item.candidate_id ? { ...row, bbox: next } : row
  )))
  const areaRetained = area834(next) / area834(original)
  const cutsChoices = item.choice_count >= 5 && next.height < original.height * 0.85
  const cutsFigure = item.has_figure && areaRetained < 0.7
  const method = methods.join('+') || 'UNRESOLVED'
  const apply =
    overlapAfter < BBOX_OVERLAP_MAX &&
    areaRetained >= BBOX_MIN_AREA_RETAINED &&
    !cutsChoices &&
    !cutsFigure &&
    methods.length > 0
  const confidence: BboxCorrection834['confidence'] = !apply
    ? 'UNCERTAIN'
    : areaRetained >= 0.7 && overlapAfter < 0.12
      ? 'HIGH'
      : 'MEDIUM'

  return {
    candidate_id: item.candidate_id,
    page: item.page,
    original,
    corrected: apply ? next : null,
    original_hash: originalHash,
    corrected_hash: apply ? bboxHash834(next) : null,
    method,
    confidence,
    overlap_before: Number(overlapBefore.toFixed(4)),
    overlap_after: Number(overlapAfter.toFixed(4)),
    area_retained: Number(areaRetained.toFixed(4)),
    apply,
  }
}

const LEAK_HEADER_RE = /정답\s*및\s*\S+(?:\s*[•●·⦁]?\s*\d+\s*쪽)?/
const LEAK_INLINE_RE = /정답\s*:|\[정답]|정답\s+\d+/

export function splitAnswerLeak834(text: string): LeakSplit834 {
  const leaked = looksLikeAnswerKey833(text) || LEAK_HEADER_RE.test(text) || LEAK_INLINE_RE.test(text)
  if (!leaked) {
    return { original_preserved: true, leaked: false, stem: text, answer: null, explanation: null }
  }
  const header = text.match(new RegExp(`^\\s*${LEAK_HEADER_RE.source}\\s*`))
  if (header) {
    const stem = text.slice(header[0].length).replace(/^[#\s•●·⦁]+/, '').trim()
    return {
      original_preserved: true,
      leaked: true,
      stem,
      answer: null,
      explanation: header[0].trim(),
    }
  }
  const parts = text.split(/정답\s*및\s*\S+|\[정답]\s*|정답\s*:|정답\s+(?=\d)/)
  const stem = (parts[0] ?? text).trim()
  const rest = parts.slice(1).join('\n').trim()
  const answerMatch = rest.match(/^\s*([^\n]{1,80})/)
  return {
    original_preserved: true,
    leaked: true,
    stem,
    answer: answerMatch?.[1]?.trim() || null,
    explanation: rest || null,
  }
}

export function acceptRecoveredOcr834(original: string, recovered: string): boolean {
  if (!recovered.trim()) return false
  if (looksLikeOcrGarbage833(recovered)) return false
  if (!stemReadable833(recovered) && !mathReadable833(recovered)) return false
  const origLen = original.replace(/\s+/g, '').length
  const recLen = recovered.replace(/\s+/g, '').length
  return recLen >= Math.max(8, origLen)
}

export function shortStemValid834(text: string, original?: string | null): boolean {
  const body = text.replace(/^\s*#?\s*\d{1,4}\b/, '').trim()
  if (mathReadable833(body) && body.replace(/\s+/g, '').length >= 3) return true
  if (stemReadable833(body)) return true
  if (original && normalizeProblemText833(original) === normalizeProblemText833(text) && mathReadable833(text)) {
    return true
  }
  return false
}

function keeper834(a: Item833, b: Item833): { keeper: Item833; extra: Item833 } {
  const ao = problemOrder834(a)
  const bo = problemOrder834(b)
  if (ao !== bo) return ao <= bo ? { keeper: a, extra: b } : { keeper: b, extra: a }
  if (a.page !== b.page) return a.page <= b.page ? { keeper: a, extra: b } : { keeper: b, extra: a }
  return a.candidate_id <= b.candidate_id ? { keeper: a, extra: b } : { keeper: b, extra: a }
}

export function classifyDuplicatePair834(a: Item833, b: Item833, qaA: QaResult833, qaB: QaResult833): DupDecision834 {
  const { keeper, extra } = keeper834(a, b)
  const samePage = a.page === b.page
  const sameNumber = (a.canonical || a.problem_number) === (b.canonical || b.problem_number)
  const sameSource = true
  const textA = qaA.normalized_text
  const textB = qaB.normalized_text
  const exactText = Boolean(textA) && textA === textB && textA.replace(/\s+/g, '').length >= 12
  const longText = textA.replace(/\s+/g, '').length >= SHORT_DUP_TEXT_CHARS
  const structureSame = qaA.structure_key === qaB.structure_key
  const boxOverlap =
    a.bbox && b.bbox ? bboxOverlapRatio833(a.bbox, b.bbox) : 0
  const sameProblemId = Boolean(a.existing?.problem_id && a.existing.problem_id === b.existing?.problem_id)
  const evidence: string[] = []
  if (sameSource) evidence.push('SAME_SOURCE')
  if (samePage) evidence.push('SAME_PAGE')
  if (sameNumber) evidence.push('SAME_NUMBER')
  if (exactText) evidence.push('EXACT_NORMALIZED_TEXT')
  if (structureSame) evidence.push('STRUCTURE_MATCH')
  if (boxOverlap >= 0.5) evidence.push('BBOX_OVERLAP')
  if (sameProblemId) evidence.push('SAME_PROBLEM_ID')

  if (sameProblemId) {
    return {
      left_id: a.candidate_id,
      right_id: b.candidate_id,
      kind: 'EXACT_DUPLICATE',
      keeper_id: keeper.candidate_id,
      extra_id: extra.candidate_id,
      evidence,
      block_extra: false,
      clear_duplicate_flag: true,
      status: 'LINKED',
    }
  }

  if (exactText && samePage && sameNumber) {
    return {
      left_id: a.candidate_id,
      right_id: b.candidate_id,
      kind: 'EXACT_DUPLICATE',
      keeper_id: keeper.candidate_id,
      extra_id: extra.candidate_id,
      evidence,
      block_extra: true,
      clear_duplicate_flag: true,
      status: 'LINKED',
    }
  }

  if (exactText && longText && (samePage || boxOverlap >= 0.5)) {
    return {
      left_id: a.candidate_id,
      right_id: b.candidate_id,
      kind: 'EXACT_DUPLICATE',
      keeper_id: keeper.candidate_id,
      extra_id: extra.candidate_id,
      evidence,
      block_extra: true,
      clear_duplicate_flag: true,
      status: 'LINKED',
    }
  }

  if (exactText && !longText && !sameNumber) {
    return {
      left_id: a.candidate_id,
      right_id: b.candidate_id,
      kind: 'SIMILAR_DISTINCT',
      keeper_id: keeper.candidate_id,
      extra_id: extra.candidate_id,
      evidence: [...evidence, 'SHORT_TEMPLATE_STEM'],
      block_extra: false,
      clear_duplicate_flag: true,
      status: 'KEPT_DISTINCT',
    }
  }

  if (samePage && sameNumber && !exactText && structureSame) {
    return {
      left_id: a.candidate_id,
      right_id: b.candidate_id,
      kind: 'VERSION_CANDIDATE',
      keeper_id: keeper.candidate_id,
      extra_id: extra.candidate_id,
      evidence,
      block_extra: false,
      clear_duplicate_flag: false,
      status: 'HUMAN_REVIEW',
    }
  }

  if (!exactText && (!samePage || !sameNumber)) {
    return {
      left_id: a.candidate_id,
      right_id: b.candidate_id,
      kind: 'SIMILAR_DISTINCT',
      keeper_id: keeper.candidate_id,
      extra_id: extra.candidate_id,
      evidence,
      block_extra: false,
      clear_duplicate_flag: true,
      status: 'KEPT_DISTINCT',
    }
  }

  return {
    left_id: a.candidate_id,
    right_id: b.candidate_id,
    kind: 'UNCERTAIN',
    keeper_id: keeper.candidate_id,
    extra_id: extra.candidate_id,
    evidence,
    block_extra: false,
    clear_duplicate_flag: false,
    status: 'HUMAN_REVIEW',
  }
}

export function pairKey834(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function classifyDuplicates834(
  items: Item833[],
  qaById: Map<string, QaResult833>,
): Map<string, DupDecision834> {
  const flagged = items.filter((row) => qaById.get(row.candidate_id)?.residual_reasons.includes('DUPLICATE_CANDIDATE'))
  const byText = new Map<string, Item833[]>()
  for (const item of items) {
    const qa = qaById.get(item.candidate_id)
    if (!qa?.normalized_text || qa.normalized_text.replace(/\s+/g, '').length < 12) continue
    const list = byText.get(qa.normalized_text) ?? []
    list.push(item)
    byText.set(qa.normalized_text, list)
  }
  const decisions = new Map<string, DupDecision834>()
  const consider = new Set(flagged.map((row) => row.candidate_id))
  for (const group of byText.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i]
        const right = group[j]
        if (!left || !right) continue
        consider.add(left.candidate_id)
        consider.add(right.candidate_id)
        const qaA = qaById.get(left.candidate_id)
        const qaB = qaById.get(right.candidate_id)
        if (!qaA || !qaB) continue
        const decision = classifyDuplicatePair834(left, right, qaA, qaB)
        decisions.set(pairKey834(left.candidate_id, right.candidate_id), decision)
      }
    }
  }
  const byId = new Map<string, DupDecision834>()
  for (const id of consider) {
    const related = [...decisions.values()].filter((row) => row.left_id === id || row.right_id === id)
    if (!related.length) continue
    const exact = related.find((row) => row.kind === 'EXACT_DUPLICATE')
    const version = related.find((row) => row.kind === 'VERSION_CANDIDATE')
    const uncertain = related.find((row) => row.kind === 'UNCERTAIN')
    byId.set(id, exact ?? version ?? uncertain ?? related[0]!)
  }
  return byId
}

function svgCompare834(page: number, boxes: BboxCorrection834[]): string {
  const rows = boxes
    .map((row) => {
      const o = row.original
      const c = row.corrected
      const orig = `<rect x="${(o.x * 100).toFixed(2)}" y="${(o.y * 100).toFixed(2)}" width="${(o.width * 100).toFixed(2)}" height="${(o.height * 100).toFixed(2)}" fill="none" stroke="red" stroke-width="0.6" />`
      const corr = c
        ? `<rect x="${(c.x * 100).toFixed(2)}" y="${(c.y * 100).toFixed(2)}" width="${(c.width * 100).toFixed(2)}" height="${(c.height * 100).toFixed(2)}" fill="none" stroke="green" stroke-width="0.6" />`
        : ''
      return `${orig}${corr}`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" data-page="${page}">${rows}</svg>`
}

export function bboxCompareSvg834(corrections: BboxCorrection834[]): Map<number, string> {
  const byPage = new Map<number, BboxCorrection834[]>()
  for (const row of corrections) {
    const list = byPage.get(row.page) ?? []
    list.push(row)
    byPage.set(row.page, list)
  }
  const out = new Map<number, string>()
  for (const [page, list] of byPage) out.set(page, svgCompare834(page, list))
  return out
}

export function cleanupOne834(
  item: Item833,
  qa: QaResult833,
  pageItems: Item833[],
  dup: DupDecision834 | null,
  recoveredText?: string | null,
  pageCorrected?: Map<string, BBox833>,
): CleanupResult834 {
  const applied = [...qa.applied_rules]
  let residual = [...qa.residual_reasons]
  const drop = (reason: ResidualReason, rule: string) => {
    if (!residual.includes(reason)) return
    residual = residual.filter((row) => row !== reason)
    applied.push(rule)
  }

  const bbox = residual.includes('BBOX_INTRUSION') || item.bbox
    ? bboxCorrectionFromPage834(item, pageItems, pageCorrected ?? correctPageBboxes834(pageItems))
    : null
  if (bbox?.apply) drop('BBOX_INTRUSION', `BBOX_CORRECT:${bbox.method}`)
  else if (bbox && bbox.overlap_after < BBOX_OVERLAP_MAX) drop('BBOX_INTRUSION', 'BBOX_NO_INTRUSION')

  const leak = splitAnswerLeak834(item.problem_text || item.stem_preview || '')
  if (leak.leaked && (stemReadable833(leak.stem) || mathReadable833(leak.stem)) && leak.stem.replace(/\s+/g, '').length >= 8) {
    drop('ANSWER_KEY_LEAK', 'SPLIT_ANSWER_EXPLANATION')
  }

  if (residual.includes('OCR_GARBAGE') && recoveredText && acceptRecoveredOcr834(item.problem_text || item.stem_preview, recoveredText)) {
    drop('OCR_GARBAGE', 'OCR_RECOVERY_ACCEPTED')
  }

  if (
    (residual.includes('EVIDENCE_INSUFFICIENT') || residual.includes('CONTENT_THIN')) &&
    shortStemValid834(item.problem_text || item.stem_preview, item.problem_text)
  ) {
    drop('EVIDENCE_INSUFFICIENT', 'SHORT_FORMULA_VALID')
    drop('CONTENT_THIN', 'SHORT_FORMULA_VALID')
  }

  let unit_id = qa.unit_id
  let type_id = qa.type_id
  if (residual.includes('UNIT_CONFLICT') || residual.includes('UNIT_UNCLEAR') || residual.includes('TYPE_UNCLEAR')) {
    const inferred = inferTypeFromStem833(item.problem_text || item.stem_preview)
    const ctx = pageContextType833(item, pageItems)
    if (inferred.type_id && inferred.confidence >= 0.76) {
      type_id = inferred.type_id
      unit_id = inferUnitFromType833(type_id, unit_id).unit_id
      drop('TYPE_UNCLEAR', `TYPE_REINFER:${inferred.rule}`)
      drop('UNIT_UNCLEAR', 'UNIT_FROM_REINFER')
      drop('UNIT_CONFLICT', 'UNIT_FROM_REINFER')
    } else if (ctx && ctx.type_id !== 'TYPE_UNCLEAR' && ctx.unit_id !== '미정') {
      const votes = pageItems.filter((row) => row.candidate_id !== item.candidate_id).length
      if (votes >= 2) {
        type_id = ctx.type_id
        unit_id = ctx.unit_id
        drop('TYPE_UNCLEAR', 'TYPE_PAGE_MAJORITY')
        drop('UNIT_UNCLEAR', 'UNIT_PAGE_MAJORITY')
        drop('UNIT_CONFLICT', 'UNIT_PAGE_MAJORITY')
      }
    }
  }

  if (dup?.clear_duplicate_flag) drop('DUPLICATE_CANDIDATE', `DUP:${dup.kind}`)
  else if (dup?.kind === 'UNCERTAIN' || dup?.kind === 'VERSION_CANDIDATE') {
    if (!residual.includes('DUPLICATE_CANDIDATE')) residual.push('DUPLICATE_CANDIDATE')
  }

  const unique = [...new Set(residual)]
  const pass = unique.length === 0
  return {
    candidate_id: item.candidate_id,
    verdict: pass ? 'AUTO_CLEAR' : 'HUMAN_REVIEW',
    pipeline_status: pass ? 'AUTO_APPROVED' : 'HUMAN_REVIEW',
    review_status_after: pass ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW',
    residual_reasons: unique,
    applied_rules: applied,
    bbox,
    dup,
    leak_split: leak.leaked ? leak : null,
    ocr_recovery_accepted: Boolean(recoveredText && acceptRecoveredOcr834(item.problem_text || item.stem_preview, recoveredText)),
    unit_id,
    type_id,
    content_rewrite: false,
  }
}

export function cleanupResiduals834(
  items: Item833[],
  qaRows: QaResult833[],
  recoveredById: Map<string, string> = new Map(),
): CleanupResult834[] {
  const qaById = new Map(qaRows.map((row) => [row.candidate_id, row]))
  const dups = classifyDuplicates834(items, qaById)
  const byPage = new Map<number, Item833[]>()
  for (const item of items) {
    const list = byPage.get(item.page) ?? []
    list.push(item)
    byPage.set(item.page, list)
  }
  const pageCorrected = new Map<number, Map<string, BBox833>>()
  for (const [page, list] of byPage) pageCorrected.set(page, correctPageBboxes834(list))
  return items
    .filter((item) => qaById.get(item.candidate_id)?.verdict === 'HUMAN_REVIEW')
    .map((item) => {
      const qa = qaById.get(item.candidate_id)!
      return cleanupOne834(
        item,
        qa,
        byPage.get(item.page) ?? [item],
        dups.get(item.candidate_id) ?? null,
        recoveredById.get(item.candidate_id),
        pageCorrected.get(item.page),
      )
    })
}

export function countBy834<T extends string>(rows: T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) out[row] = (out[row] ?? 0) + 1
  return out
}

export function neverVerified834(status: string, reviewStatus: string): boolean {
  return neverVerified833(status, reviewStatus)
}

export function structureFromCleanup834(item: Item833, result: CleanupResult834): string {
  return structureKey833({
    unit_id: result.unit_id,
    type_id: result.type_id,
    choice_count: item.choice_count,
    has_figure: item.has_figure,
    has_table: item.has_table,
    difficulty_level: item.classification?.difficulty_level ?? null,
  })
}
