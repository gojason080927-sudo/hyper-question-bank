import type { NormalizedPilotProblem } from './problemPipeline'

export const PERSIST_STEP = '8.4'
export const PERSIST_MAX_PROBLEMS = 3
export const STABLE_IDENTITY_PREFIX = 'ssen-common-math1'

export const STEP84_CANDIDATES = ['0159', '0401', '0274'] as const

export type IntrusionKind = 'NONE' | 'HEADER_ONLY' | 'BODY_INTRUSION'
export type PreInsertDecision = 'INSERT' | 'PRE_INSERT_BLOCKED'

export type FigurePreservation = {
  figure_source_truth: 'original_problem_crop'
  detected_figures: number
  expected_visual_figures: number | null
  figure_detection_complete: boolean
}

export type AdjacentIntrusion = {
  kind: IntrusionKind
  next_problem_number: string | null
  evidence: string | null
}

export type CleanedNormalized = {
  stem_text: string
  math_expressions: Array<{ original: string; latex_candidate: string | null; preferred: string }>
  choices: Array<{ index: number; text: string; math: string[] }>
  warnings: string[]
  raw_untouched: true
}

export type PreInsertGate = {
  problem_number: string
  decision: PreInsertDecision
  reasons: string[]
  segmentation_status: string
  crop_safe: boolean
  structure_complete: boolean
  math_conflict: boolean
  missing_choice: boolean
  requires_review: boolean
  figures: FigurePreservation
  adjacent: AdjacentIntrusion
}

export function persistIdentityKey(input: { document_key: string; page_number: number; problem_number: string }): string {
  return `${input.document_key}|${input.page_number}|${input.problem_number}`
}

export function assessFigurePreservation(input: {
  problem_number: string
  detected_figures: number
  expected_visual_figures?: number | null
}): FigurePreservation {
  const expected = input.expected_visual_figures ?? null
  return {
    figure_source_truth: 'original_problem_crop',
    detected_figures: input.detected_figures,
    expected_visual_figures: expected,
    figure_detection_complete: expected == null ? input.detected_figures >= 0 : input.detected_figures >= expected,
  }
}

export function classifyAdjacentIntrusion(input: {
  stem: string
  next_problem_number?: string | null
}): AdjacentIntrusion {
  const next = input.next_problem_number ?? null
  if (!next) return { kind: 'NONE', next_problem_number: null, evidence: null }
  const escaped = next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const header = new RegExp(`(?:^|[\\s#•])${escaped}(?:\\b|[\\s|•])`)
  if (!header.test(input.stem) && !input.stem.includes(next)) {
    return { kind: 'NONE', next_problem_number: next, evidence: null }
  }
  const bodyLike = new RegExp(`${escaped}\\s+[^\\n]{24,}`)
  if (bodyLike.test(input.stem)) {
    return { kind: 'BODY_INTRUSION', next_problem_number: next, evidence: next }
  }
  return { kind: 'HEADER_ONLY', next_problem_number: next, evidence: next }
}

export function stripProblemNumberPrefix(stem: string, problemNumber: string): string {
  const escaped = problemNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return stem
    .replace(new RegExp(`^[#\\s]*${escaped}(?:\\s*[|•]\\s*대표 문제)?\\s*`), '')
    .replace(new RegExp(`^[#\\s]*${escaped}\\s*`), '')
    .trim()
}

export function stripAdjacentHeader(stem: string, nextNumber: string | null): string {
  if (!nextNumber) return stem
  const escaped = nextNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return stem
    .replace(new RegExp(`(?:^|\\s)[#\\s]*${escaped}(?:\\s*[|•][^\\n]*)?$`), '')
    .replace(/\s*문서구의 기출\s*$/u, '')
    .trim()
}

export type MathTokenVerdict = 'KEEP' | 'REMOVE_ARTIFACT' | 'REVIEW'

export function classifyMathToken(token: string): { verdict: MathTokenVerdict; evidence: string } {
  const text = token.replace(/\s+/g, '')
  if (/^(?:\d{2}\+\d{2})$/.test(text)) {
    return { verdict: 'REMOVE_ARTIFACT', evidence: 'page_type_ref' }
  }
  if (!text || text === ')' || text === '(') {
    return { verdict: 'REVIEW', evidence: 'empty_or_paren_residue' }
  }
  return { verdict: 'KEEP', evidence: 'possible_real_math' }
}

export function filterResidualMath(
  expressions: Array<{ original: string; latex_candidate: string | null; preferred: string }>,
): { kept: typeof expressions; dropped: string[]; warnings: string[] } {
  const kept: typeof expressions = []
  const dropped: string[] = []
  const warnings: string[] = []
  for (const row of expressions) {
    const classified = classifyMathToken(row.latex_candidate ?? row.original)
    if (classified.verdict === 'REMOVE_ARTIFACT') {
      dropped.push(row.original)
      warnings.push(`dropped_${classified.evidence}:${row.original}`)
      continue
    }
    if (classified.verdict === 'REVIEW') {
      kept.push(row)
      warnings.push(`review_math_token:${classified.evidence}:${row.original}`)
      continue
    }
    kept.push(row)
    if (/^[A-Za-z]$/.test((row.latex_candidate ?? row.original).replace(/\s+/g, ''))) {
      warnings.push(`possible_lone_math_token:${row.original}`)
    }
  }
  return { kept, dropped, warnings }
}

export function cleanNormalizedForInsert(
  problem: NormalizedPilotProblem,
  nextProblemNumber?: string | null,
): CleanedNormalized {
  const warnings: string[] = []
  let stem = stripProblemNumberPrefix(problem.content.stem_text, problem.problem_number)
  if (stem !== problem.content.stem_text) warnings.push('stripped_problem_number_prefix')
  const afterHeader = stripAdjacentHeader(stem, nextProblemNumber ?? null)
  if (afterHeader !== stem) warnings.push('stripped_adjacent_header')
  stem = afterHeader.replace(/^(?:사실형|시술형|서술형)\s*/u, (match) => {
    warnings.push(`badge_ocr_cosmetic:${match.trim()}`)
    return ''
  })
  const math = filterResidualMath(
    problem.content.math_expressions.map((row) => ({
      original: row.original,
      latex_candidate: row.latex_candidate,
      preferred: row.preferred,
    })),
  )
  warnings.push(...math.warnings)
  return {
    stem_text: stem.trim(),
    math_expressions: math.kept,
    choices: problem.content.choices,
    warnings,
    raw_untouched: true,
  }
}

export const CROP_HEADER_ONLY: Record<string, string> = {
  '0159': '0160',
  '0274': '0275',
}

export function assessPreInsert(input: {
  problem: NormalizedPilotProblem
  next_problem_number?: string | null
  expected_visual_figures?: number | null
  crop_adjacent?: AdjacentIntrusion | null
}): PreInsertGate {
  const adjacent = classifyAdjacentIntrusion({
    stem: input.problem.content.stem_text,
    next_problem_number: input.next_problem_number,
  })
  const cropAdjacent = input.crop_adjacent ?? null
  const mergedAdjacent: AdjacentIntrusion =
    adjacent.kind === 'BODY_INTRUSION'
      ? adjacent
      : cropAdjacent?.kind === 'HEADER_ONLY' && adjacent.kind === 'NONE'
        ? cropAdjacent
        : adjacent
  const figures = assessFigurePreservation({
    problem_number: input.problem.problem_number,
    detected_figures: input.problem.content.figures.length,
    expected_visual_figures: input.expected_visual_figures,
  })
  const reasons: string[] = []
  if (input.problem.segmentation.segmentation_status !== 'AUTO_OK') reasons.push('segmentation_not_auto_ok')
  if (!input.problem.quality.crop_safe) reasons.push('crop_not_safe')
  if (!input.problem.quality.structure_complete) reasons.push('structure_incomplete')
  if (input.problem.quality.requires_review) reasons.push('requires_review')
  if (input.problem.quality.math_conflict) reasons.push('math_conflict')
  if (input.problem.quality.missing_choice) reasons.push('missing_choice')
  if (mergedAdjacent.kind === 'BODY_INTRUSION') reasons.push('adjacent_body_intrusion')
  if (mergedAdjacent.kind === 'HEADER_ONLY') reasons.push('adjacent_header_only_warning')
  if (input.problem.status !== 'DRAFT') reasons.push(`status_${input.problem.status}`)
  if (!figures.figure_detection_complete && (input.expected_visual_figures ?? 0) > 0) {
    reasons.push('figure_detection_incomplete_warning')
  }
  const blocked = reasons.some(
    (row) => row !== 'figure_detection_incomplete_warning' && row !== 'adjacent_header_only_warning',
  )
  return {
    problem_number: input.problem.problem_number,
    decision: blocked ? 'PRE_INSERT_BLOCKED' : 'INSERT',
    reasons,
    segmentation_status: input.problem.segmentation.segmentation_status,
    crop_safe: input.problem.quality.crop_safe,
    structure_complete: input.problem.quality.structure_complete,
    math_conflict: input.problem.quality.math_conflict,
    missing_choice: input.problem.quality.missing_choice,
    requires_review: input.problem.quality.requires_review,
    figures,
    adjacent: mergedAdjacent,
  }
}

export function compareReadBack(input: {
  local: { problem_number: string; page_number: number; stem: string; choices: string[]; math: string[] }
  db: { problem_number: string | null; page_number: number | null; stem: string; choices: string[]; math: string[] }
}): { verdict: 'MATCH' | 'MISMATCH'; diffs: string[] } {
  const diffs: string[] = []
  if (input.local.problem_number !== input.db.problem_number) diffs.push('problem_number')
  if (input.local.page_number !== input.db.page_number) diffs.push('page_number')
  if (input.local.stem.replace(/\s+/g, ' ') !== input.db.stem.replace(/\s+/g, ' ')) diffs.push('stem')
  if (input.local.choices.join('|') !== input.db.choices.join('|')) diffs.push('choices')
  const localMath = [...input.local.math].sort().join('|')
  const dbMath = [...input.db.math].sort().join('|')
  if (localMath !== dbMath) diffs.push('math')
  return { verdict: diffs.length ? 'MISMATCH' : 'MATCH', diffs }
}

export function nextProblemHint(problemNumber: string): string | null {
  const n = Number(problemNumber)
  return Number.isFinite(n) ? String(n + 1).padStart(problemNumber.length, '0') : null
}

export function expectedVisualFigures(problemNumber: string): number | null {
  if (problemNumber === '0274') return 4
  return null
}

export function cropAdjacentForProblem(problemNumber: string): AdjacentIntrusion | null {
  const next = CROP_HEADER_ONLY[problemNumber]
  if (!next) return null
  return {
    kind: 'HEADER_ONLY',
    next_problem_number: next,
    evidence: `padded_crop_includes_${next}_header`,
  }
}

export function bboxClose(
  a: { x: number; y: number; width: number; height: number } | null | undefined,
  b: { x: number; y: number; width: number; height: number } | null | undefined,
  eps = 1e-6,
): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps
  )
}

export function recognitionApplyPayload(cleaned: CleanedNormalized, problem: NormalizedPilotProblem): Record<string, unknown> {
  return {
    problem_number: problem.problem_number,
    stem_text: cleaned.stem_text,
    raw_text: problem.content.stem_markdown,
    math_expressions: cleaned.math_expressions.map((row) => ({
      original: row.original,
      latex_candidate: row.latex_candidate,
    })),
    choices: cleaned.choices.map((row) => ({
      order: row.index,
      label: String(row.index),
      text: row.text,
    })),
    has_figure: problem.content.figures.length > 0,
    has_table: problem.content.tables.length > 0,
    figure_source_truth: 'original_problem_crop',
    detected_figures: problem.content.figures.length,
    figure_detection_complete: assessFigurePreservation({
      problem_number: problem.problem_number,
      detected_figures: problem.content.figures.length,
      expected_visual_figures: expectedVisualFigures(problem.problem_number),
    }).figure_detection_complete,
    original_crop_reference: problem.source.original_crop_reference,
    identity_key: persistIdentityKey({
      document_key: STABLE_IDENTITY_PREFIX,
      page_number: problem.source.page_number,
      problem_number: problem.problem_number,
    }),
    confidence: null,
    warnings: [...problem.recognition.warnings, ...cleaned.warnings],
  }
}

export function draftFromRegionPayload(cleaned: CleanedNormalized, problem: NormalizedPilotProblem): Record<string, unknown> {
  return {
    source: {
      original_problem_number: problem.problem_number,
      source_type_label: 'PDF_REGION',
    },
    version: {
      problem_text: cleaned.stem_text,
      normalized_text: cleaned.stem_text,
      item_format: cleaned.choices.length ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
      origin: 'OCR',
    },
  }
}
