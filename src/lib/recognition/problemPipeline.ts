import {
  bboxCoverage,
  bboxIoU,
  isValidBBox,
  pixelRectFromNormalized,
  validateBBox,
  type NormalizedBBox,
  type PixelRect,
} from '../pdf/bbox'
import { extractMistralLatex } from '../ocr/normalizeMistral'
import { extractChoices, extractMath, extractScanProblemNumber, recognizeFromOcrText, splitLines } from './structure'
import type { LayoutBlock, LayoutImage, SegmentStatus } from './layoutSegment'

export const PIPELINE_STEP = '8.3'
export const PILOT_DOCUMENT_KEY = 'ssen-common-math1'
export const MAX_PILOT_PROBLEMS = 5
export const MAX_MISTRAL_CALLS = 5
export const MAX_MATHPIX_CALLS = 5
export const CROP_PAD = 0.022

export type PipelineStatus = 'DRAFT' | 'PIPELINE_REVIEW'
export type TeacherActionLike = 'APPROVED_AS_IS' | 'BBOX_ADJUSTED' | null
export type PilotSlot = 'A' | 'B' | 'C' | 'D' | 'E'

export type PilotProblemSpec = {
  problem_number: string
  page_number: number
  slot: PilotSlot
  role: string
  reason: string
}

export const PILOT_PROBLEMS: readonly PilotProblemSpec[] = [
  {
    problem_number: '0159',
    page_number: 28,
    slot: 'A',
    role: 'text_and_math',
    reason: '일반 본문 + 다항식 항등식(x³, ax²)과 객관식. AUTO_OK 기본형.',
  },
  {
    problem_number: '0402',
    page_number: 60,
    slot: 'B',
    role: 'multiple_choice',
    reason: '복소수 객관식 ①–⑤. 보기 수식(3−i 등) 구조화 검증.',
  },
  {
    problem_number: '0401',
    page_number: 60,
    slot: 'C',
    role: 'complex_math',
    reason: '분수/근호/켤레/지수 (z⁴, (−1+i)/√2, (z̄)¹⁰⁰⁰). Mathpix 정밀 검증.',
  },
  {
    problem_number: '0274',
    page_number: 44,
    slot: 'D',
    role: 'figures',
    reason: '입체도형 4개 + 객관식. 원본 crop이 도형 정본인지 확인.',
  },
  {
    problem_number: '1092',
    page_number: 156,
    slot: 'E',
    role: 'long_korean',
    reason: '긴 한글 조건 서술형(동전 지불). 도형 없음.',
  },
]

export type CropSafetyChecks = {
  problem_number_present: boolean
  bbox_valid: boolean
  body_coverage: number | null
  last_edge_ok: boolean
  figure_coverage: number | null
  neighbor_invasion: number
  assigned_images_inside: boolean
}

export type CropSafetyResult = {
  crop_safe: boolean
  reasons: string[]
  checks: CropSafetyChecks
}

export type PipelineChoice = {
  index: number
  text: string
  math: string[]
}

export type PipelineFigure = {
  id: string
  source_bbox: NormalizedBBox
  crop_reference: string
  associated_problem: string
  caption: string | null
  detection_source: 'mistral_image' | 'assigned_region' | 'visual_in_crop'
}

export type MathConflict = {
  kind: 'OCR_CONFLICT'
  code: string
  detail: string
  mistral: string
  mathpix: string
}

export type NormalizedPilotProblem = {
  problem_number: string
  source: {
    document_id: string
    page_number: number
    source_bbox: NormalizedBBox
    original_crop_reference: string
  }
  content: {
    stem_text: string
    stem_markdown: string
    math_expressions: Array<{ original: string; latex_candidate: string | null; preferred: 'mathpix' | 'mistral' | 'merged' }>
    choices: PipelineChoice[]
    subitems: string[]
    tables: string[]
    figures: PipelineFigure[]
  }
  recognition: {
    mistral_raw_reference: string | null
    mathpix_raw_reference: string | null
    mistral_used: boolean
    mathpix_used: boolean
    mistral_source: 'page_cache' | 'crop_call' | 'none'
    mathpix_source: 'crop_call' | 'crop_cache' | 'none'
    conflicts: MathConflict[]
    warnings: string[]
  }
  segmentation: {
    auto_bbox: NormalizedBBox
    confirmed_bbox: NormalizedBBox
    segmentation_status: SegmentStatus
    confidence: number
  }
  quality: {
    crop_safe: boolean
    structure_complete: boolean
    math_conflict: boolean
    missing_figure: boolean
    missing_choice: boolean
    requires_review: boolean
  }
  status: PipelineStatus
}

export type DraftInsertPlan = {
  db_writes: 0
  production_inserts: 0
  idempotency_key: string
  schema_changes_required: false
  tables: string[]
  transaction: string[]
  rollback: string[]
  lookup_before_insert: string[]
  payloads: {
    recognition_result: Record<string, unknown>
    draft_from_region: Record<string, unknown>
  }
}

const BODY_COVERAGE_MIN = 0.88
const FIGURE_COVERAGE_MIN = 0.7
const NEIGHBOR_IOU_MAX = 0.12
const CLIP_SLACK = 0.018

export function assertPilotSelection(): void {
  if (PILOT_PROBLEMS.length === 0 || PILOT_PROBLEMS.length > MAX_PILOT_PROBLEMS) {
    throw new Error('HQB_PIPELINE_LIMIT: STEP 8.3 allows 1–5 AUTO_OK pilot problems')
  }
  const seen = new Set<string>()
  for (const row of PILOT_PROBLEMS) {
    const key = `${row.page_number}:${row.problem_number}`
    if (seen.has(key)) throw new Error(`HQB_PIPELINE_DUP: ${key}`)
    seen.add(key)
  }
}

export function cropPixelRect(bbox: NormalizedBBox, page: { width: number; height: number }): PixelRect {
  return pixelRectFromNormalized(bbox, page)
}

export function assessCropSafety(input: {
  problem_number: string
  bbox: NormalizedBBox
  gt?: { number: string; has_choices: boolean; has_figure: boolean; bbox: NormalizedBBox } | null
  assigned_images: LayoutImage[]
  neighbor_bboxes: NormalizedBBox[]
}): CropSafetyResult {
  const reasons: string[] = []
  const bbox_valid = isValidBBox(input.bbox)
  if (!bbox_valid) reasons.push('bbox_invalid')
  const problem_number_present = /^\d{4}$/.test(input.problem_number)
  if (!problem_number_present) reasons.push('problem_number_missing')

  let body_coverage: number | null = null
  let last_edge_ok = true
  if (input.gt) {
    body_coverage = bboxCoverage(input.gt.bbox, input.bbox)
    if (body_coverage < BODY_COVERAGE_MIN) reasons.push(`body_clipped:${body_coverage.toFixed(2)}`)
    const cropBottom = input.bbox.y + input.bbox.height
    const gtBottom = input.gt.bbox.y + input.gt.bbox.height
    last_edge_ok = cropBottom + CLIP_SLACK >= gtBottom
    if (!last_edge_ok) reasons.push('last_line_or_choice_clipped')
    if (input.bbox.y > input.gt.bbox.y + CLIP_SLACK) reasons.push('problem_number_or_stem_top_clipped')
  }

  const figureCoverages = input.assigned_images.map((image) => bboxCoverage(image.bbox, input.bbox))
  const figure_coverage = figureCoverages.length ? Math.min(...figureCoverages) : null
  const assigned_images_inside = figureCoverages.every((value) => value >= FIGURE_COVERAGE_MIN)
  if (input.gt?.has_figure && input.assigned_images.length === 0) reasons.push('figure_expected_but_unassigned')
  if (input.assigned_images.length > 0 && !assigned_images_inside) reasons.push('figure_cut_by_bbox')

  const neighbor_invasion = input.neighbor_bboxes.reduce((max, neighbor) => Math.max(max, bboxIoU(input.bbox, neighbor)), 0)
  if (neighbor_invasion >= NEIGHBOR_IOU_MAX) reasons.push(`neighbor_invasion:${neighbor_invasion.toFixed(2)}`)
  if (bbox_valid && (input.bbox.height < 0.07 || input.bbox.height > 0.72)) reasons.push('bbox_size_abnormal')

  return {
    crop_safe: reasons.length === 0,
    reasons,
    checks: {
      problem_number_present,
      bbox_valid,
      body_coverage,
      last_edge_ok,
      figure_coverage,
      neighbor_invasion,
      assigned_images_inside,
    },
  }
}

export function blocksInsideProblem(blocks: LayoutBlock[], bbox: NormalizedBBox, minCoverage = 0.55): LayoutBlock[] {
  return blocks
    .filter((block) => {
      const cx = block.bbox.x + block.bbox.width / 2
      const cy = block.bbox.y + block.bbox.height / 2
      const centerInside =
        cx >= bbox.x && cx <= bbox.x + bbox.width && cy >= bbox.y && cy <= bbox.y + bbox.height
      return centerInside || bboxCoverage(block.bbox, bbox) >= minCoverage
    })
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
}

export function imagesInsideProblem(images: LayoutImage[], bbox: NormalizedBBox, assignedIds: string[]): LayoutImage[] {
  return images.filter(
    (image) => assignedIds.includes(image.id) || bboxCoverage(image.bbox, bbox) >= FIGURE_COVERAGE_MIN,
  )
}

export function structureFromPageBlocks(input: {
  problem_number: string
  blocks: LayoutBlock[]
  hasFigure: boolean
  hasTable?: boolean
}): {
  stem_text: string
  stem_markdown: string
  choices: PipelineChoice[]
  math: string[]
  detected_number: string | null
  warnings: string[]
} {
  const markdown = input.blocks
    .map((block) => (block.content ?? '').trim())
    .filter(Boolean)
    .join('\n')
  const recognized = recognizeFromOcrText(markdown, {
    engine: 'mistral-ocr',
    engineVersion: 'page-cache',
    hasFigure: input.hasFigure,
    hasTable: input.hasTable ?? false,
  })
  const parsed = extractChoices(splitLines(markdown))
  const choices: PipelineChoice[] = (parsed.choices.length ? parsed.choices : recognized.payload.choices).map((row) => ({
    index: row.order,
    text: row.text,
    math: extractMath(row.text).map((item) => item.latex_candidate ?? item.original),
  }))
  const detected_number =
    extractScanProblemNumber(markdown) ?? recognized.payload.problem_number ?? (markdown.includes(input.problem_number) ? input.problem_number : null)
  const warnings = [...recognized.payload.warnings]
  if (parsed.warning) warnings.push(parsed.warning)
  return {
    stem_text: recognized.payload.stem_text,
    stem_markdown: markdown,
    choices,
    math: extractMistralLatex(markdown),
    detected_number,
    warnings,
  }
}

export function associateFigures(input: {
  problem_number: string
  images: LayoutImage[]
  assigned_ids: string[]
}): PipelineFigure[] {
  return input.images.map((image) => ({
    id: image.id,
    source_bbox: image.bbox,
    crop_reference: `figure-${image.id.replace(/[^A-Za-z0-9._-]+/g, '_')}.png`,
    associated_problem: input.problem_number,
    caption: null,
    detection_source: input.assigned_ids.includes(image.id) ? 'assigned_region' : 'mistral_image',
  }))
}

export function normalizeLatexForCompare(input: string): string {
  return input
    .replace(/\\left|\\right/g, '')
    .replace(/\\bar\{([A-Za-z])\}/g, '$1bar')
    .replace(/\\overline\{([A-Za-z])\}/g, '$1bar')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\^\{(\d+)\}/g, '^$1')
    .replace(/_\{(\d+)\}/g, '_$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, 'FRAC($1/$2)')
    .replace(/\\sqrt\{([^}]*)\}/g, 'SQRT($1)')
    .replace(/\\le\b|≤/g, '<=')
    .replace(/\\ge\b|≥/g, '>=')
    .replace(/\\neq\b|≠/g, '!=')
    .replace(/\s+/g, '')
}

export function detectMathConflicts(mistralLatex: string[], mathpixLatex: string[]): MathConflict[] {
  if (mistralLatex.length === 0 || mathpixLatex.length === 0) return []
  const mistral = mistralLatex.map(normalizeLatexForCompare).join(' || ')
  const mathpix = mathpixLatex.map(normalizeLatexForCompare).join(' || ')
  const conflicts: MathConflict[] = []

  function collect(text: string, pattern: RegExp): Map<string, string> {
    const found = new Map<string, string>()
    for (const match of text.matchAll(pattern)) {
      const key = match[1]
      const value = match[2]
      if (key && value) found.set(key, value)
    }
    return found
  }

  const mExp = collect(mistral, /([A-Za-z])\^(\d+)/g)
  const pExp = collect(mathpix, /([A-Za-z])\^(\d+)/g)
  for (const [letter, value] of mExp) {
    const other = pExp.get(letter)
    if (other && other !== value) {
      conflicts.push({
        kind: 'OCR_CONFLICT',
        code: 'exponent_mismatch',
        detail: `${letter}^${value} vs ${letter}^${other}`,
        mistral,
        mathpix,
      })
    }
  }

  const mSub = collect(mistral, /([A-Za-z])_(\d+)/g)
  const pSub = collect(mathpix, /([A-Za-z])_(\d+)/g)
  for (const [letter, value] of mSub) {
    const other = pSub.get(letter)
    if (other && other !== value) {
      conflicts.push({
        kind: 'OCR_CONFLICT',
        code: 'subscript_mismatch',
        detail: `${letter}_${value} vs ${letter}_${other}`,
        mistral,
        mathpix,
      })
    }
  }

  const mFrac = [...mistral.matchAll(/FRAC\(([^)]+)\)/g)].map((row) => row[1])
  const pFrac = [...mathpix.matchAll(/FRAC\(([^)]+)\)/g)].map((row) => row[1])
  if (mFrac.length && pFrac.length && !mFrac.some((row) => pFrac.includes(row))) {
    conflicts.push({
      kind: 'OCR_CONFLICT',
      code: 'fraction_mismatch',
      detail: `${mFrac.join(',')} vs ${pFrac.join(',')}`,
      mistral,
      mathpix,
    })
  }

  const mSqrt = [...mistral.matchAll(/SQRT\(([^)]+)\)/g)].map((row) => row[1])
  const pSqrt = [...mathpix.matchAll(/SQRT\(([^)]+)\)/g)].map((row) => row[1])
  if (mSqrt.length && pSqrt.length && !mSqrt.some((row) => pSqrt.includes(row))) {
    conflicts.push({
      kind: 'OCR_CONFLICT',
      code: 'radical_mismatch',
      detail: `${mSqrt.join(',')} vs ${pSqrt.join(',')}`,
      mistral,
      mathpix,
    })
  }

  return conflicts
}

export function pipelineIdempotencyKey(input: {
  document_id: string
  page_number: number
  problem_number: string
  bbox: NormalizedBBox
}): string {
  const box = validateBBox(input.bbox)
  const rounded = [box.x, box.y, box.width, box.height].map((value) => value.toFixed(3)).join(',')
  return `${input.document_id}|${input.page_number}|${input.problem_number}|${rounded}`
}

export function decidePipelineStatus(input: {
  crop_safe: boolean
  problem_number_ok: boolean
  stem_present: boolean
  expected_choices: boolean
  choice_count: number
  expected_figure: boolean
  figure_count: number
  conflicts: MathConflict[]
  extra_warnings?: string[]
}): { status: PipelineStatus; quality: NormalizedPilotProblem['quality']; warnings: string[] } {
  const warnings = [...(input.extra_warnings ?? [])]
  const missing_choice = input.expected_choices && input.choice_count < 5
  const missing_figure = input.expected_figure && input.figure_count === 0
  const math_conflict = input.conflicts.length > 0
  const structure_complete =
    input.problem_number_ok &&
    input.stem_present &&
    (!input.expected_choices || input.choice_count >= 5) &&
    (!input.expected_figure || input.figure_count > 0)
  if (!input.crop_safe) warnings.push('crop_not_safe')
  if (!input.stem_present) warnings.push('stem_missing')
  if (missing_choice) warnings.push('missing_choice')
  if (missing_figure) warnings.push('missing_figure')
  if (math_conflict) warnings.push('OCR_CONFLICT')
  const requires_review =
    !input.crop_safe || !structure_complete || math_conflict || missing_choice || missing_figure
  return {
    status: requires_review ? 'PIPELINE_REVIEW' : 'DRAFT',
    quality: {
      crop_safe: input.crop_safe,
      structure_complete,
      math_conflict,
      missing_figure,
      missing_choice,
      requires_review,
    },
    warnings,
  }
}

export function buildNormalizedProblem(input: {
  spec: PilotProblemSpec
  bbox: NormalizedBBox
  auto_bbox: NormalizedBBox
  confirmed_bbox: NormalizedBBox
  segmentation_status: SegmentStatus
  confidence: number
  crop_rel: string
  crop_safe: boolean
  mistral: ReturnType<typeof structureFromPageBlocks>
  mathpix_latex: string[]
  figures: PipelineFigure[]
  expected_choices: boolean
  expected_figure: boolean
  mistral_used: boolean
  mathpix_used: boolean
  mistral_source: NormalizedPilotProblem['recognition']['mistral_source']
  mathpix_source: NormalizedPilotProblem['recognition']['mathpix_source']
}): NormalizedPilotProblem {
  const conflicts = detectMathConflicts(input.mistral.math, input.mathpix_latex)
  const preferredMath = (input.mathpix_latex.length ? input.mathpix_latex : input.mistral.math).map((latex) => ({
    original: latex,
    latex_candidate: latex,
    preferred: (input.mathpix_latex.length ? 'mathpix' : 'mistral') as 'mathpix' | 'mistral',
  }))
  const decided = decidePipelineStatus({
    crop_safe: input.crop_safe,
    problem_number_ok: input.mistral.detected_number === input.spec.problem_number,
    stem_present: input.mistral.stem_text.trim().length >= 8,
    expected_choices: input.expected_choices,
    choice_count: input.mistral.choices.length,
    expected_figure: input.expected_figure,
    figure_count: input.figures.length,
    conflicts,
    extra_warnings: input.mistral.warnings,
  })
  if (input.mistral.detected_number !== input.spec.problem_number) {
    decided.warnings.push(
      input.mistral.detected_number ? `number_mismatch:${input.mistral.detected_number}` : 'problem_number_not_in_ocr',
    )
    decided.quality.requires_review = true
    decided.status = 'PIPELINE_REVIEW'
  }

  return {
    problem_number: input.spec.problem_number,
    source: {
      document_id: PILOT_DOCUMENT_KEY,
      page_number: input.spec.page_number,
      source_bbox: input.bbox,
      original_crop_reference: input.crop_rel,
    },
    content: {
      stem_text: input.mistral.stem_text,
      stem_markdown: input.mistral.stem_markdown,
      math_expressions: preferredMath,
      choices: input.mistral.choices,
      subitems: [],
      tables: [],
      figures: input.figures,
    },
    recognition: {
      mistral_raw_reference:
        input.mistral_source === 'page_cache'
          ? 'mistral-page-cache-extract.json'
          : input.mistral_used
            ? 'mistral-raw.json'
            : null,
      mathpix_raw_reference: input.mathpix_used ? 'mathpix-raw.json' : null,
      mistral_used: input.mistral_used,
      mathpix_used: input.mathpix_used,
      mistral_source: input.mistral_source,
      mathpix_source: input.mathpix_source,
      conflicts,
      warnings: decided.warnings,
    },
    segmentation: {
      auto_bbox: input.auto_bbox,
      confirmed_bbox: input.confirmed_bbox,
      segmentation_status: input.segmentation_status,
      confidence: input.confidence,
    },
    quality: decided.quality,
    status: decided.status,
  }
}

export function buildDraftInsertPlan(problem: NormalizedPilotProblem): DraftInsertPlan {
  return {
    db_writes: 0,
    production_inserts: 0,
    idempotency_key: pipelineIdempotencyKey({
      document_id: problem.source.document_id,
      page_number: problem.source.page_number,
      problem_number: problem.problem_number,
      bbox: problem.source.source_bbox,
    }),
    schema_changes_required: false,
    tables: [
      'source_page_regions',
      'recognition_results',
      'problems',
      'problem_versions',
      'problem_sources',
      'problem_choices',
      'math_expressions',
    ],
    lookup_before_insert: [
      'source_page_regions by (source_page_id, original_problem_number)',
      'problem_sources by source_page_region_id',
      'do not create a second problem for the same region',
    ],
    transaction: [
      'reuse existing source_page_region or hqb_create_source_page_region (status DRAFT)',
      'hqb_save_recognition_result (append-only history, confidence null)',
      'if region has no problem_sources: hqb_create_problem_draft_from_region',
      'else hqb_apply_recognition_to_draft on the existing draft version',
      'never promote to VERIFIED',
    ],
    rollback: [
      'stop the RPC chain on first error',
      'recognition_results rows are history and are not deleted',
      'do not create another problems row; reuse problem_sources.link',
    ],
    payloads: {
      recognition_result: {
        engine: 'hqb-hybrid-8.3',
        processing_mode: 'SCAN_OCR',
        status: problem.status === 'DRAFT' ? 'SUCCEEDED' : 'REVIEW_REQUIRED',
        verdict: problem.quality.math_conflict ? 'RED' : problem.status === 'DRAFT' ? 'YELLOW' : 'YELLOW',
        payload: {
          problem_number: problem.problem_number,
          stem_text: problem.content.stem_text,
          math_expressions: problem.content.math_expressions,
          choices: problem.content.choices.map((row) => ({ order: row.index, label: String(row.index), text: row.text })),
          has_figure: problem.content.figures.length > 0,
          has_table: problem.content.tables.length > 0,
          confidence: null,
          warnings: problem.recognition.warnings,
          raw_text: problem.content.stem_markdown,
        },
      },
      draft_from_region: {
        version: {
          problem_text: problem.content.stem_text || '[원본 crop을 보고 입력하세요]',
          origin: 'OCR',
          item_format: problem.content.choices.length ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
        },
        source: { original_problem_number: problem.problem_number },
        choices: problem.content.choices.map((row) => ({
          choice_order: row.index,
          label: String(row.index),
          choice_text: row.text,
        })),
        expressions: problem.content.math_expressions.map((row, index) => ({
          original_expression: row.original,
          latex_expression: row.latex_candidate ?? '',
          expression_role: 'TARGET',
          sort_order: index + 1,
        })),
      },
    },
  }
}
