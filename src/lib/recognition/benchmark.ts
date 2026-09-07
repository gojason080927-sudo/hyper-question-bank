import { recognizeFromText } from './structure'
import { scoreRecognition, verdictFromScore, type GroundTruth } from './score'
import type { RecognitionVerdict } from './types'

export type BenchmarkItem = GroundTruth & {
  source: string
  source_text: string
}

export type BenchmarkFile = {
  kind: string
  note: string
  render_scale: number
  render_dpi: number
  items: BenchmarkItem[]
}

export type BenchmarkRow = {
  id: string
  category: string
  source: string
  engine: string
  verdict: RecognitionVerdict
  score_verdict: RecognitionVerdict
  expected_verdict?: RecognitionVerdict
  warnings: string[]
  component_status: string[]
  reasons: string[]
  score: ReturnType<typeof scoreRecognition>
}

export function runBenchmark(file: BenchmarkFile): {
  rows: BenchmarkRow[]
  green: number
  yellow: number
  red: number
} {
  const rows = file.items.map((item) => {
    const output = recognizeFromText(item.source_text)
    const score = scoreRecognition(output, item)
    const reasons: string[] = []
    if (!score.body) reasons.push('body')
    if (!score.digits) reasons.push('digits')
    if (!score.symbols) reasons.push('symbols')
    if (!score.math_structure) reasons.push('math_structure')
    if (!score.problem_number) reasons.push('problem_number')
    if (!score.choices) reasons.push('choices')
    if (!score.figure_table) reasons.push('figure_table')
    if (!score.usable) reasons.push('usable')
    reasons.push(...output.payload.component_status.filter((row) => row.includes('REVIEW') || row === 'OCR_UNAVAILABLE'))
    return {
      id: item.id,
      category: item.category,
      source: item.source,
      engine: output.engine,
      verdict: output.verdict,
      score_verdict: verdictFromScore(score),
      expected_verdict: item.expected_verdict,
      warnings: output.payload.warnings,
      component_status: output.payload.component_status,
      reasons,
      score,
    }
  })
  return {
    rows,
    green: rows.filter((row) => row.verdict === 'GREEN').length,
    yellow: rows.filter((row) => row.verdict === 'YELLOW').length,
    red: rows.filter((row) => row.verdict === 'RED').length,
  }
}
