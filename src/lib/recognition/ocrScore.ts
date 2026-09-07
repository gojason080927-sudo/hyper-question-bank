export type MathCriticalRule = { from: string; not: string }

export type ScanGroundTruth = {
  sample_id: string
  category: string
  problem_number?: string | null
  ground_truth_text: string
  korean_must?: string[]
  digits_must?: string[]
  operators_must?: string[]
  superscripts_must?: string[]
  subscripts_must?: string[]
  fractions_must?: string[]
  radicals_must?: string[]
  inequalities_must?: string[]
  parens_abs_must?: string[]
  choices_must?: string[]
  has_figure?: boolean
  has_table?: boolean
  math_critical_if_collapsed?: MathCriticalRule[]
}

export type ScanOcrRow = {
  sample_id: string
  raw_text: string
  seconds?: number
  error?: string | null
  skipped?: boolean
}

export type ScanSampleScore = {
  sample_id: string
  category: string
  verdict: 'GREEN' | 'YELLOW' | 'RED'
  cer: number
  korean: number | null
  digits: number | null
  operators: number | null
  superscripts: number | null
  subscripts: number | null
  fractions: number | null
  radicals: number | null
  inequalities: number | null
  parens_abs: number | null
  choices: number | null
  problem_number: boolean
  figure_table: boolean | null
  math_critical_errors: string[]
  seconds?: number
  failed: boolean
}

function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

export function charErrorRate(hypothesis: string, reference: string): number {
  if (!reference) return hypothesis ? 1 : 0
  const rows = Array.from({ length: hypothesis.length + 1 }, () => new Array<number>(reference.length + 1).fill(0))
  for (let i = 0; i <= hypothesis.length; i += 1) rows[i][0] = i
  for (let j = 0; j <= reference.length; j += 1) rows[0][j] = j
  for (let i = 1; i <= hypothesis.length; i += 1) {
    for (let j = 1; j <= reference.length; j += 1) {
      const cost = hypothesis[i - 1] === reference[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
    }
  }
  return rows[hypothesis.length][reference.length] / reference.length
}

export function tokenHitRate(text: string, tokens: string[] | undefined): number | null {
  if (!tokens?.length) return null
  const hit = tokens.filter((token) => token && text.includes(token)).length
  return hit / tokens.length
}

export function detectMathCriticalErrors(text: string, truth: ScanGroundTruth): string[] {
  const errors: string[] = []
  const packed = compact(text)
  for (const rule of truth.math_critical_if_collapsed ?? []) {
    const from = compact(rule.from)
    const collapsed = compact(rule.not)
    if (from && !packed.includes(from) && collapsed && packed.includes(collapsed)) {
      errors.push(`MATH_CRITICAL: ${rule.from} collapsed toward ${rule.not}`)
    }
  }
  if ((truth.radicals_must ?? []).some((token) => token.includes('√')) && !text.includes('√')) {
    errors.push('MATH_CRITICAL: radical sign missing')
  }
  if ((truth.inequalities_must ?? []).includes('≤') && !text.includes('≤') && !text.includes('<=') && text.includes('<')) {
    errors.push('MATH_CRITICAL: ≤ flattened to <')
  }
  if ((truth.inequalities_must ?? []).includes('≥') && !text.includes('≥') && !text.includes('>=') && text.includes('>')) {
    errors.push('MATH_CRITICAL: ≥ flattened to >')
  }
  if ((truth.parens_abs_must ?? []).some((token) => token.includes('|')) && (text.match(/\|/g) ?? []).length < 2) {
    errors.push('MATH_CRITICAL: absolute-value bars missing')
  }
  return errors
}

function rateOrNull(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(3))
}

export function scoreScanSample(row: ScanOcrRow, truth: ScanGroundTruth): ScanSampleScore {
  const failed = Boolean(row.error || row.skipped || !row.raw_text?.trim())
  const text = row.raw_text || ''
  const korean = tokenHitRate(text, truth.korean_must)
  const digits = tokenHitRate(text, truth.digits_must)
  const operators = tokenHitRate(text, truth.operators_must)
  const critical = failed ? [] : detectMathCriticalErrors(text, truth)
  const tokens = [
    ...(truth.korean_must ?? []),
    ...(truth.digits_must ?? []),
    ...(truth.operators_must ?? []),
    ...(truth.superscripts_must ?? []),
    ...(truth.choices_must ?? []),
  ]
  const hit = tokenHitRate(text, tokens) ?? (failed ? 0 : 0.5)
  let verdict: ScanSampleScore['verdict'] = 'RED'
  if (!failed && critical.length === 0 && hit >= 0.75 && (korean == null || korean >= 0.7)) verdict = 'GREEN'
  else if (!failed && critical.length === 0 && (hit >= 0.4 || (korean != null && korean >= 0.5))) verdict = 'YELLOW'
  else if (!failed && critical.length > 0) verdict = 'RED'
  const figureNeeded = Boolean(truth.has_figure || truth.has_table)
  return {
    sample_id: truth.sample_id,
    category: truth.category,
    verdict,
    cer: Number(charErrorRate(compact(text), compact(truth.ground_truth_text)).toFixed(3)),
    korean: rateOrNull(korean),
    digits: rateOrNull(digits),
    operators: rateOrNull(operators),
    superscripts: rateOrNull(tokenHitRate(text, truth.superscripts_must)),
    subscripts: rateOrNull(tokenHitRate(text, truth.subscripts_must)),
    fractions: rateOrNull(tokenHitRate(text, truth.fractions_must)),
    radicals: rateOrNull(tokenHitRate(text, truth.radicals_must)),
    inequalities: rateOrNull(tokenHitRate(text, truth.inequalities_must)),
    parens_abs: rateOrNull(tokenHitRate(text, truth.parens_abs_must)),
    choices: rateOrNull(tokenHitRate(text, truth.choices_must)),
    problem_number: truth.problem_number == null || text.includes(truth.problem_number),
    figure_table: figureNeeded ? /그림|표에서|그래프/.test(text) : null,
    math_critical_errors: critical,
    seconds: row.seconds,
    failed,
  }
}

export function sameNormalizedBbox(
  left: { page_number: number; bbox: { x: number; y: number; width: number; height: number } },
  right: { page_number: number; bbox: { x: number; y: number; width: number; height: number } },
): boolean {
  return (
    left.page_number === right.page_number &&
    left.bbox.x === right.bbox.x &&
    left.bbox.y === right.bbox.y &&
    left.bbox.width === right.bbox.width &&
    left.bbox.height === right.bbox.height
  )
}
