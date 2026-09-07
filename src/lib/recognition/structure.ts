import { meaningfulCharCount } from '../pdf/classifyPdf'
import type {
  ChoiceDraft,
  ComponentStatus,
  MathExpressionDraft,
  RecognitionOutput,
  RecognitionPayload,
} from './types'
import {
  RECOGNITION_ENGINE_EMBEDDED,
  RECOGNITION_ENGINE_SCAN_OCR,
  RECOGNITION_ENGINE_SCAN_OCR_VERSION,
  RECOGNITION_ENGINE_SCAN_UNAVAILABLE,
  RECOGNITION_ENGINE_VERSION,
  REGION_TEXT_MIN_CHARS,
} from './types'

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

const PROBLEM_NUMBER = /^(?:문제\s+)(\d{1,2})\s+|(\d{1,2})\s*[.)]\s+|\[(\d{1,2})\]\s+/
const SCAN_PROBLEM_NUMBER = /(?:^|\n)\s*(\d{4})\b/
const ANSWER_LINE = /^(?:정답|답)\s*[:：]\s*(.+)$/
const FIGURE = /그림|도형|그래프|다음 그림|figure|diagram/i
const TABLE = /다음 표|표\s*\d|table/i
const LOST_EXPONENT = /(?<![0-9])([A-Za-z])(\d)(?![0-9])/
const MATHY = /[=≠≤≥<>±√]|<=|>=|\^|²|³|sqrt|\d\/\d|[A-Za-z]\s*[+-]\s*[A-Za-z0-9]/

export function splitLines(raw: string): string[] {
  return raw
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function extractProblemNumber(raw: string): { number: string | null; rest: string; warning?: string } {
  const text = raw.trim()
  const circled = text.match(/^[①-⑩]/)
  if (circled) {
    return { number: null, rest: text, warning: 'circled glyph looks like a choice, not a problem number' }
  }
  const match = text.match(PROBLEM_NUMBER)
  if (!match) return { number: null, rest: text }
  return { number: match[1] || match[2] || match[3], rest: text.slice(match[0].length).trim() }
}

export function extractChoices(lines: string[]): { choices: ChoiceDraft[]; leftover: string[]; warning?: string } {
  const choices: ChoiceDraft[] = []
  const leftover: string[] = []
  for (const line of lines) {
    const circled = line.match(/^([①-⑩])\s*(.*)$/)
    if (circled) {
      choices.push({ order: CIRCLED.indexOf(circled[1]) + 1, label: circled[1], text: circled[2].trim() })
      continue
    }
    const paren = line.match(/^\((\d{1,2})\)\s*(.*)$/)
    if (paren) {
      choices.push({ order: Number(paren[1]), label: `(${paren[1]})`, text: paren[2].trim() })
      continue
    }
    const dotted = line.match(/^(\d{1,2})\)\s+(.*)$/)
    if (dotted) {
      choices.push({ order: Number(dotted[1]), label: `${dotted[1]})`, text: dotted[2].trim() })
      continue
    }
    leftover.push(line)
  }
  const orders = choices.map((row) => row.order)
  const sorted = [...orders].sort((a, b) => a - b)
  const sequential = sorted.every((value, index) => value === (sorted[0] ?? 1) + index)
  const warning = choices.length > 0 && !sequential ? 'CHOICES_REVIEW_REQUIRED: a choice is missing or out of order' : undefined
  return { choices, leftover, warning }
}

export function extractAnswerCandidate(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(ANSWER_LINE)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

export function extractMath(text: string): MathExpressionDraft[] {
  const found = new Set<string>()
  const results: MathExpressionDraft[] = []
  const chunks = [
    ...(text.match(/[^\s,]*(?:[=≠≤≥<>±√^²³]|<=|>=|sqrt)[^\s,]*/g) ?? []),
    ...(text.match(/(?<![0-9])[A-Za-z]\d(?![0-9])/g) ?? []),
    ...(text.match(/\)\d(?![0-9])/g) ?? []),
  ]
  for (const chunk of chunks) {
    const original = chunk.replace(/[.;]+$/, '')
    if (original.length < 2 || found.has(original)) continue
    found.add(original)
    const notes: string[] = []
    let latex: string | null = original
      .replace(/<=/g, '\\le ')
      .replace(/>=/g, '\\ge ')
      .replace(/≤/g, '\\le ')
      .replace(/≥/g, '\\ge ')
      .replace(/≠/g, '\\neq ')
      .replace(/±/g, '\\pm ')
      .replace(/√/g, '\\sqrt ')
      .replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}')
      .replace(/\^(\d+)/g, '^{$1}')
      .replace(/²/g, '^{2}')
      .replace(/³/g, '^{3}')
    const lost = (LOST_EXPONENT.test(original) || /\)\d/.test(original)) && !/[²³^]/.test(original)
    if (lost) {
      notes.push('digit beside a letter may be a lost exponent; x2 is not treated as x^{2}')
      latex = null
    }
    if (/\^/.test(original) || /sqrt\(/i.test(original)) {
      notes.push('ASCII math notation; typographic structure was not seen in the PDF')
    }
    if (/\d\/\d/.test(original)) {
      notes.push('slash fraction; stacked fraction structure was not recovered')
    }
    results.push({
      original,
      latex_candidate: latex,
      structure_ok: !lost && notes.length === 0 && /[²³≤≥≠±√]/.test(original),
      notes,
    })
  }
  return results
}

export function detectFigure(text: string): boolean {
  return FIGURE.test(text)
}

export function detectTable(text: string): boolean {
  if (TABLE.test(text)) return true
  const lines = splitLines(text)
  const columnar = lines.filter((line) => (line.match(/\s{2,}/g) ?? []).length >= 2).length
  return columnar >= 2
}

export function recognizeFromText(
  rawText: string,
  options: { pageHint?: string } = {},
): RecognitionOutput {
  const normalized = rawText.trim()
  const chars = meaningfulCharCount(normalized)
  if (chars < REGION_TEXT_MIN_CHARS) {
    return scanUnavailable(normalized, options.pageHint)
  }

  const lines = splitLines(normalized)
  const numbered = extractProblemNumber(lines[0] ?? normalized)
  const afterNumber = numbered.number && lines[0] ? [numbered.rest, ...lines.slice(1)] : lines
  const answer = extractAnswerCandidate(afterNumber)
  const withoutAnswer = afterNumber.filter((line) => !ANSWER_LINE.test(line))
  const { choices, leftover, warning: choiceWarning } = extractChoices(withoutAnswer)
  const stem = leftover.join(' ').trim() || numbered.rest
  const math = extractMath(`${stem} ${choices.map((row) => row.text).join(' ')}`)
  const hasFigure = detectFigure(normalized)
  const hasTable = detectTable(normalized)
  const warnings: string[] = []
  const component: ComponentStatus[] = ['TEXT_OK']

  if (numbered.warning) {
    warnings.push(numbered.warning)
    component.push('NUMBER_REVIEW_REQUIRED')
  } else if (numbered.number) {
    component.push('NUMBER_OK')
  } else {
    warnings.push('problem number was left in the stem because it was not reliable')
    component.push('NUMBER_REVIEW_REQUIRED')
  }
  if (choiceWarning) {
    warnings.push(choiceWarning)
    component.push('CHOICES_REVIEW_REQUIRED')
  } else if (choices.length) {
    component.push('CHOICES_OK')
  }
  if (math.some((row) => !row.structure_ok)) {
    warnings.push('MATH_REVIEW_REQUIRED: formula structure is incomplete or ASCII-only')
    component.push('MATH_REVIEW_REQUIRED')
  } else if (math.length) {
    component.push('MATH_OK')
  } else if (MATHY.test(normalized)) {
    warnings.push('MATH_REVIEW_REQUIRED: math-like tokens were not structured')
    component.push('MATH_REVIEW_REQUIRED')
  }
  if (hasFigure) {
    component.push('FIGURE_DETECTED')
    warnings.push('figure detected; keep the original region image as source of truth')
  }
  if (hasTable) {
    component.push('TABLE_DETECTED')
    warnings.push('table-like layout detected; cell structure was not rebuilt')
  }
  if (answer) {
    warnings.push('answer_candidate copied from an explicit answer line; the engine did not solve the problem')
  }

  const payload: RecognitionPayload = {
    problem_number: numbered.number,
    stem_text: stem,
    math_expressions: math,
    choices,
    answer_candidate: answer,
    has_figure: hasFigure,
    has_table: hasTable,
    confidence: null,
    component_status: component,
    warnings,
    raw_text: normalized,
  }

  const lostExponent = math.some((row) => row.notes.some((note) => note.includes('lost exponent')))
  const review = component.some((row) => row.endsWith('REVIEW_REQUIRED') || row === 'FIGURE_DETECTED' || row === 'TABLE_DETECTED')
  const verdict = !payload.stem_text || lostExponent
    ? 'RED'
    : review
      ? 'YELLOW'
      : 'GREEN'

  return {
    engine: RECOGNITION_ENGINE_EMBEDDED,
    engine_version: RECOGNITION_ENGINE_VERSION,
    processing_mode: options.pageHint === 'MIXED' ? 'MIXED_EMBEDDED' : 'EMBEDDED_TEXT',
    status: verdict === 'GREEN' ? 'SUCCEEDED' : 'REVIEW_REQUIRED',
    verdict,
    payload,
  }
}

export function scanUnavailable(rawText = '', pageHint?: string): RecognitionOutput {
  const payload: RecognitionPayload = {
    problem_number: null,
    stem_text: '',
    math_expressions: [],
    choices: [],
    answer_candidate: null,
    has_figure: true,
    has_table: false,
    confidence: null,
    component_status: ['OCR_UNAVAILABLE', 'LOW_CONFIDENCE', 'MATH_REVIEW_REQUIRED', 'FIGURE_DETECTED'],
    warnings: [
      'SCAN_NO_ENGINE: no free math OCR is installed in this environment',
      'Do not invent formulas from a blank scan',
      'Use the original PDF region as source of truth',
    ],
    raw_text: rawText,
  }
  return {
    engine: RECOGNITION_ENGINE_SCAN_UNAVAILABLE,
    engine_version: RECOGNITION_ENGINE_VERSION,
    processing_mode: pageHint === 'MIXED' ? 'MIXED_EMBEDDED' : 'SCAN_NO_ENGINE',
    status: 'FAILED',
    verdict: 'RED',
    payload,
  }
}

export function extractScanProblemNumber(raw: string): string | null {
  const match = raw.match(SCAN_PROBLEM_NUMBER)
  return match?.[1] ?? null
}

export function recognizeFromOcrText(
  rawText: string,
  options: {
    engine?: string
    engineVersion?: string
    hasFigure?: boolean
    hasTable?: boolean
  } = {},
): RecognitionOutput {
  const normalized = rawText.trim()
  if (meaningfulCharCount(normalized) < REGION_TEXT_MIN_CHARS) {
    const empty = scanUnavailable(normalized, 'SCAN_PDF')
    return {
      ...empty,
      engine: options.engine ?? RECOGNITION_ENGINE_SCAN_OCR,
      engine_version: options.engineVersion ?? RECOGNITION_ENGINE_SCAN_OCR_VERSION,
      processing_mode: 'SCAN_OCR',
      payload: {
        ...empty.payload,
        warnings: [
          'SCAN_OCR produced no usable text',
          'Uncertain tokens were not restored from context',
          'Use the original PDF region as source of truth',
        ],
      },
    }
  }

  const structured = recognizeFromText(normalized, { pageHint: 'SCAN_PDF' })
  const scanNumber = extractScanProblemNumber(normalized)
  const hasFigure = options.hasFigure ?? structured.payload.has_figure
  const hasTable = options.hasTable ?? structured.payload.has_table
  const warnings = [
    ...structured.payload.warnings,
    'SCAN_OCR: raw engine output. Uncertain tokens were not restored from context.',
    'Do not treat collapsed x2 as x²',
  ]
  const component: ComponentStatus[] = [...structured.payload.component_status]
  if (!component.includes('LOW_CONFIDENCE')) component.push('LOW_CONFIDENCE')
  if (!component.includes('MATH_REVIEW_REQUIRED')) component.push('MATH_REVIEW_REQUIRED')
  if (hasFigure && !component.includes('FIGURE_DETECTED')) {
    component.push('FIGURE_DETECTED')
    warnings.push('figure present; keep the original region image')
  }
  if (hasTable && !component.includes('TABLE_DETECTED')) {
    component.push('TABLE_DETECTED')
    warnings.push('table present; cell structure was not rebuilt')
  }

  const lostExponent = structured.payload.math_expressions.some((row) =>
    row.notes.some((note) => note.includes('lost exponent')),
  )
  const collapsedAsciiPower = /[A-Za-z]\d/.test(normalized) && !/[²³^]/.test(normalized)
  if (collapsedAsciiPower) {
    warnings.push('possible lost exponent in OCR raw text; x2 is not restored to x²')
  }
  const stem = structured.payload.stem_text
  const verdict = !stem || lostExponent || collapsedAsciiPower ? 'RED' : 'YELLOW'

  return {
    engine: options.engine ?? RECOGNITION_ENGINE_SCAN_OCR,
    engine_version: options.engineVersion ?? RECOGNITION_ENGINE_SCAN_OCR_VERSION,
    processing_mode: 'SCAN_OCR',
    status: 'REVIEW_REQUIRED',
    verdict,
    payload: {
      ...structured.payload,
      problem_number: structured.payload.problem_number ?? scanNumber,
      has_figure: hasFigure,
      has_table: hasTable,
      confidence: null,
      component_status: component,
      warnings,
    },
  }
}
