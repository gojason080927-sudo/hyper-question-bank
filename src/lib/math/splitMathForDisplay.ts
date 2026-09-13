import { extractMathSpans, type MathSpan } from '../editor/mathNormalize'

export type DisplayMathPart = {
  kind: 'text' | 'math'
  value: string
  display: boolean
}

const ENV = /\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g
const KNOWN_COMMAND =
  /^(frac|dfrac|tfrac|binom|sqrt|overline|underline|mathbf|mathrm|mathbb|text|textrm|textbf|times|div|cdot|pm|mp|neq|ne|leq|geq|le|ge|alpha|beta|gamma|theta|pi|infty|quad|qquad|left|right)$/

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

function matchingBrace(text: string, open: number): number | null {
  if (text[open] !== '{') return null
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return null
}

function consumeLatexAt(text: string, start: number): number | null {
  if (text[start] !== '\\') return null
  const match = text.slice(start).match(/^\\([a-zA-Z]+|[,;:!])/)
  if (!match) return null
  const name = match[1]
  if (!KNOWN_COMMAND.test(name) && name !== 'times') return null
  let pos = start + match[0].length
  while (text[pos] === '[') {
    const close = text.indexOf(']', pos)
    if (close < 0) break
    pos = close + 1
  }
  let consumedBrace = false
  while (text[pos] === '{') {
    const close = matchingBrace(text, pos)
    if (close == null) break
    pos = close + 1
    consumedBrace = true
  }
  if (name === 'left' || name === 'right') {
    if (text[pos]) pos += 1
  }
  if (!consumedBrace && name.length === 1) return null
  return pos
}

function collectEnvSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = []
  for (const match of text.matchAll(ENV)) {
    if (match.index == null) continue
    spans.push({
      latex: match[0],
      display: true,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return spans
}

function collectCommandSpans(text: string, taken: MathSpan[]): MathSpan[] {
  const spans: MathSpan[] = []
  let i = 0
  while (i < text.length) {
    if (taken.some((span) => i >= span.start && i < span.end)) {
      i += 1
      continue
    }
    const end = consumeLatexAt(text, i)
    if (end == null) {
      i += 1
      continue
    }
    const span: MathSpan = {
      latex: text.slice(i, end).trim(),
      display: false,
      start: i,
      end,
    }
    if (!taken.some((row) => overlaps(row, span)) && !spans.some((row) => overlaps(row, span))) {
      spans.push(span)
    }
    i = end
  }
  return spans
}

function isUnwrappedLatexBlob(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.includes('\\')) return false
  if (/[가-힣]/.test(trimmed)) return false
  return /\\[a-zA-Z]+/.test(trimmed)
}

/**
 * Display-layer math islands. Does not rewrite stored OCR/stem strings.
 */
export function splitMathForDisplay(text: string): DisplayMathPart[] {
  if (!text) return []
  const dollar = extractMathSpans(text)
  const env = collectEnvSpans(text).filter((span) => !dollar.some((row) => overlaps(row, span)))
  const taken = [...dollar, ...env]
  const commands = collectCommandSpans(text, taken)
  const spans = [...taken, ...commands].sort((a, b) => a.start - b.start)

  if (!spans.length) {
    if (isUnwrappedLatexBlob(text)) {
      return [{ kind: 'math', value: text.trim(), display: /\\begin\{/.test(text) }]
    }
    return [{ kind: 'text', value: text, display: false }]
  }

  const parts: DisplayMathPart[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) {
      const leftover = text.slice(cursor, span.start)
      if (leftover) parts.push({ kind: 'text', value: leftover, display: false })
    }
    parts.push({ kind: 'math', value: span.latex, display: span.display })
    cursor = span.end
  }
  if (cursor < text.length) {
    const leftover = text.slice(cursor)
    if (leftover) {
      if (isUnwrappedLatexBlob(leftover)) {
        parts.push({ kind: 'math', value: leftover.trim(), display: /\\begin\{/.test(leftover) })
      } else {
        parts.push({ kind: 'text', value: leftover, display: false })
      }
    }
  }
  return parts
}
