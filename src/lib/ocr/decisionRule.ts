/**
 * Phase B must pick exactly one of these after a REAL Mathpix run.
 * Phase A must not choose A/B/C/D.
 */
export const MATHPIX_DECISION_OPTIONS = ['A', 'B', 'C', 'D'] as const
export type MathpixDecision = (typeof MATHPIX_DECISION_OPTIONS)[number]

export const MATHPIX_DECISION_TEXT = {
  A: 'Mathpix clearly superior and correction burden materially lower. Recommend Mathpix primary OCR.',
  B: 'Mathpix better but improvement too small relative to cost. Keep free/local primary.',
  C: 'Hybrid is best. Example: general Korean OCR + Mathpix only for math-heavy/problem regions.',
  D: 'Neither is reliable enough. Human review remains substantial; investigate another math OCR provider.',
} as const

export const PHASE_A_DECISION: null = null
