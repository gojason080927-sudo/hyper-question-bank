export type MathSpan = {
  latex: string
  display: boolean
  start: number
  end: number
}

const BLOCK_DOLLARS = /\$\$([\s\S]+?)\$\$/g
const BRACKETS = /\\\[([\s\S]+?)\\\]/g
const PARENS = /\\\(([\s\S]+?)\\\)/g
const INLINE_DOLLARS = /(?<!\$)\$(?!\$)([\s\S]+?)(?<!\$)\$(?!\$)/g

function pushUnique(target: MathSpan[], span: MathSpan): void {
  if (target.some((row) => row.start < span.end && span.start < row.end)) return
  target.push(span)
}

export function extractMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = []
  for (const match of text.matchAll(BLOCK_DOLLARS)) {
    if (match.index == null) continue
    pushUnique(spans, {
      latex: match[1].trim(),
      display: true,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  for (const match of text.matchAll(BRACKETS)) {
    if (match.index == null) continue
    pushUnique(spans, {
      latex: match[1].trim(),
      display: true,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  for (const match of text.matchAll(PARENS)) {
    if (match.index == null) continue
    pushUnique(spans, {
      latex: match[1].trim(),
      display: false,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  for (const match of text.matchAll(INLINE_DOLLARS)) {
    if (match.index == null) continue
    pushUnique(spans, {
      latex: match[1].trim(),
      display: false,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return spans.sort((a, b) => a.start - b.start)
}

export function preserveUnsupportedLatex(latex: string): string {
  return latex.replace(/\u00a0/g, ' ').trim()
}

export function latexRoundTripEqual(original: string, next: string): boolean {
  return preserveUnsupportedLatex(original) === preserveUnsupportedLatex(next)
}

export const MATH_TEMPLATES: Array<{ id: string; label: string; latex: string; display?: boolean }> = [
  { id: 'frac', label: '분수', latex: '\\frac{a}{b}' },
  { id: 'sqrt', label: '제곱근', latex: '\\sqrt{a}' },
  { id: 'nthroot', label: 'n제곱근', latex: '\\sqrt[n]{a}' },
  { id: 'pow', label: '지수', latex: 'a^{n}' },
  { id: 'sub', label: '아래첨자', latex: 'a_{n}' },
  { id: 'log', label: '로그', latex: '\\log_{a} b' },
  { id: 'abs', label: '절댓값', latex: '\\left| a \\right|' },
  { id: 'eq', label: '등식', latex: 'a = b' },
  { id: 'neq', label: '부등식', latex: 'a \\ne b' },
  { id: 'leq', label: '≤', latex: 'a \\le b' },
  { id: 'geq', label: '≥', latex: 'a \\ge b' },
  { id: 'set', label: '집합', latex: '\\{ x \\mid x > 0 \\}' },
  { id: 'in', label: '원소', latex: 'a \\in A' },
  { id: 'fn', label: '함수', latex: 'f(x) = ax + b' },
  { id: 'seq', label: '수열', latex: 'a_{n} = a_{1} + (n-1)d' },
  { id: 'prob', label: '확률', latex: 'P(A \\cap B)' },
  { id: 'matrix', label: '행렬', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', display: true },
  { id: 'lim', label: '극한', latex: '\\lim_{x \\to 0} f(x)' },
  { id: 'int', label: '적분', latex: '\\int_{a}^{b} f(x)\\, dx' },
  { id: 'sum', label: '급수', latex: '\\sum_{k=1}^{n} a_{k}' },
  { id: 'vec', label: '벡터', latex: '\\overrightarrow{AB}' },
  { id: 'aligned', label: '연립', latex: '\\begin{cases} x + y = 1 \\\\ x - y = 3 \\end{cases}', display: true },
  { id: 'alpha', label: 'α', latex: '\\alpha' },
  { id: 'theta', label: 'θ', latex: '\\theta' },
  { id: 'pi', label: 'π', latex: '\\pi' },
  { id: 'infty', label: '∞', latex: '\\infty' },
]
