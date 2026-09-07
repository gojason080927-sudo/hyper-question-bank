import type { RecognitionOutput } from './types'

export type GroundTruth = {
  id: string
  category: string
  problem_number?: string | null
  stem_includes?: string[]
  math?: string[]
  math_must_not_collapse?: Array<{ from: string; not: string }>
  choices?: string[]
  has_figure?: boolean
  has_table?: boolean
  expected_verdict?: 'GREEN' | 'YELLOW' | 'RED'
}

export type DimensionScore = {
  body: boolean
  digits: boolean
  symbols: boolean
  math_structure: boolean
  problem_number: boolean
  choices: boolean
  figure_table: boolean
  usable: boolean
}

export function charErrorRate(hypothesis: string, reference: string): number {
  if (!reference) return hypothesis ? 1 : 0
  const a = hypothesis
  const b = reference
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
    }
  }
  return rows[a.length][b.length] / b.length
}

export function scoreRecognition(output: RecognitionOutput, truth: GroundTruth): DimensionScore {
  const text = `${output.payload.stem_text} ${output.payload.raw_text}`
  const body = (truth.stem_includes ?? []).every((chunk) => text.includes(chunk))
  const digits = (truth.stem_includes ?? []).filter((chunk) => /\d/.test(chunk)).every((chunk) => text.includes(chunk))
  const symbols = (truth.math ?? []).every((token) => text.includes(token) || output.payload.math_expressions.some((row) => row.original.includes(token)))
  const mathStructure = (truth.math_must_not_collapse ?? []).every((rule) => {
    const collapsed = text.includes(rule.not) && !text.includes(rule.from)
    const recovered = output.payload.math_expressions.some((row) => row.original.includes(rule.from) && row.structure_ok)
    return !collapsed && (recovered || text.includes(rule.from))
  })
  const problemNumber = truth.problem_number == null || output.payload.problem_number === truth.problem_number
  const choices =
    !truth.choices?.length ||
    (output.payload.choices.length === truth.choices.length &&
      output.payload.choices.every((row, index) => row.text.includes(truth.choices![index]) || truth.choices![index].includes(row.text)))
  const figureTable =
    (truth.has_figure ?? false) === output.payload.has_figure && (truth.has_table ?? false) === output.payload.has_table
  const usable = output.verdict !== 'RED' && body && mathStructure && choices
  return { body, digits, symbols, math_structure: mathStructure, problem_number: problemNumber, choices, figure_table: figureTable, usable }
}

export function verdictFromScore(score: DimensionScore): 'GREEN' | 'YELLOW' | 'RED' {
  const flags = [score.body, score.digits, score.symbols, score.math_structure, score.problem_number, score.choices, score.figure_table]
  if (flags.every(Boolean) && score.usable) return 'GREEN'
  if (score.body && score.usable) return 'YELLOW'
  if (score.body && !score.math_structure) return 'YELLOW'
  return 'RED'
}
