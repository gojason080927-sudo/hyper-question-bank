export const ROUTER_STEP = '8.5'
export const MAX_NEW_MATHPIX = 8
export const MAX_NEW_MISTRAL = 5

export type OcrRoute = 'MISTRAL_ONLY' | 'MISTRAL_PLUS_MATHPIX' | 'PIPELINE_REVIEW'

export type MathRiskFlag =
  | 'equation_block'
  | 'high_latex_density'
  | 'exponent'
  | 'subscript'
  | 'fraction'
  | 'radical'
  | 'conjugate'
  | 'matrix'
  | 'absolute'
  | 'inequality'
  | 'complex_number'
  | 'complex_paren'
  | 'multi_variable'
  | 'polynomial'
  | 'function_expr'
  | 'math_in_choices'
  | 'dense_symbols'
  | 'mistral_uncertain'
  | 'math_conflict'

export type RouterDecision = {
  route: OcrRoute
  flags: MathRiskFlag[]
  reasons: string[]
  math_density: number
  hangul_ratio: number
}

const RISK_PATTERNS: Array<{ flag: MathRiskFlag; re: RegExp }> = [
  { flag: 'equation_block', re: /\$\$|\\\[|\\begin\{equation\}/ },
  { flag: 'exponent', re: /\^[{\dA-Za-z]|[²³⁴⁵⁶⁷⁸⁹]|\\hat|x\^|z\^/ },
  { flag: 'subscript', re: /_[{\dA-Za-z]|z_[0-9]|P_\{/ },
  { flag: 'fraction', re: /\\frac|\\dfrac|\/\s*\\sqrt|분모|분자/ },
  { flag: 'radical', re: /\\sqrt|√|근호/ },
  { flag: 'conjugate', re: /\\bar|\\overline|켤레|¯/ },
  { flag: 'matrix', re: /\\begin\{(?:p?matrix|bmatrix|vmatrix)|행렬/ },
  { flag: 'absolute', re: /\\left\s*\| |\\lvert|절댓값/ },
  { flag: 'inequality', re: /\\le|\\ge|≤|≥|\\neq|≠|<|>/ },
  { flag: 'complex_number', re: /복소수|[+-]\s*i\b|\\mathbb\{C\}/ },
  { flag: 'complex_paren', re: /\([^)]*[=+^\\√-][^)]{10,}\)/ },
  { flag: 'polynomial', re: /[a-zA-Z]\^[23]|항등식|다항식|x\^3|ax\^2/ },
  { flag: 'function_expr', re: /f\s*\(|g\s*\(|P_[a-z]|함수/ },
  { flag: 'dense_symbols', re: /[=+*/-]{3,}|\\cdot|\\times/ },
]

export function hangulRatio(text: string): number {
  const letters = text.replace(/\s+/g, '')
  if (!letters.length) return 0
  const hangul = (letters.match(/[\uAC00-\uD7A3]/g) ?? []).length
  return hangul / letters.length
}

export function mathDensity(text: string): number {
  const compact = text.replace(/\s+/g, '')
  if (!compact.length) return 0
  const hits = compact.match(/\$|\\frac|\\sqrt|\^|_|√|[=+*/\\-]|[²³⁴]/g) ?? []
  return hits.length / compact.length
}

export function detectMathRisks(input: {
  stem: string
  markdown?: string
  choices?: Array<{ text: string }>
  has_equation_block?: boolean
  mistral_uncertain?: boolean
  math_conflict?: boolean
}): MathRiskFlag[] {
  const text = [input.stem, input.markdown ?? '', ...(input.choices ?? []).map((row) => row.text)].join('\n')
  const flags = new Set<MathRiskFlag>()
  if (input.has_equation_block || /\$\$[\s\S]+\$\$/.test(text)) flags.add('equation_block')
  if (mathDensity(text) >= 0.08) flags.add('high_latex_density')
  for (const row of RISK_PATTERNS) {
    if (row.re.test(text)) flags.add(row.flag)
  }
  const vars = new Set((text.match(/\b[a-zA-Z]\b/g) ?? []).map((row) => row.toLowerCase()))
  if (vars.size >= 3 && /[=+]/.test(text)) flags.add('multi_variable')
  const choiceMath = (input.choices ?? []).some((row) => /\$|\\frac|\^|[+-]i\b|[²³]/.test(row.text))
  if (choiceMath) flags.add('math_in_choices')
  if (input.mistral_uncertain) flags.add('mistral_uncertain')
  if (input.math_conflict) flags.add('math_conflict')
  return [...flags]
}

export function routeOcr(input: {
  stem: string
  markdown?: string
  choices?: Array<{ text: string }>
  crop_safe: boolean
  structure_complete: boolean
  missing_choice?: boolean
  body_intrusion?: boolean
  math_conflict?: boolean
  mistral_uncertain?: boolean
  has_equation_block?: boolean
}): RouterDecision {
  const flags = detectMathRisks({
    stem: input.stem,
    markdown: input.markdown,
    choices: input.choices,
    has_equation_block: input.has_equation_block,
    mistral_uncertain: input.mistral_uncertain,
    math_conflict: input.math_conflict,
  })
  const density = mathDensity(`${input.stem}\n${input.markdown ?? ''}`)
  const hangul = hangulRatio(input.stem)
  const reasons: string[] = []

  if (!input.crop_safe) reasons.push('crop_not_safe')
  if (!input.structure_complete) reasons.push('structure_incomplete')
  if (input.missing_choice) reasons.push('missing_choice')
  if (input.body_intrusion) reasons.push('body_intrusion')
  if (input.math_conflict) reasons.push('math_conflict')

  if (reasons.length) {
    return { route: 'PIPELINE_REVIEW', flags, reasons, math_density: density, hangul_ratio: hangul }
  }
  if (flags.length) {
    return {
      route: 'MISTRAL_PLUS_MATHPIX',
      flags,
      reasons: flags.map((flag) => `risk:${flag}`),
      math_density: density,
      hangul_ratio: hangul,
    }
  }
  if (density > 0.04 || hangul < 0.45) {
    return {
      route: 'MISTRAL_PLUS_MATHPIX',
      flags,
      reasons: ['uncertain_simple_math'],
      math_density: density,
      hangul_ratio: hangul,
    }
  }
  return {
    route: 'MISTRAL_ONLY',
    flags,
    reasons: ['low_math_density', 'no_risk_notation'],
    math_density: density,
    hangul_ratio: hangul,
  }
}
