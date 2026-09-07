import type { ScanSampleScore } from '../recognition/ocrScore'

export const CORRECTION_BURDEN_LEVELS = ['NONE', 'LIGHT', 'MODERATE', 'HEAVY', 'RETYPE'] as const
export type CorrectionBurden = (typeof CORRECTION_BURDEN_LEVELS)[number]

/**
 * Conservative instructor-correction estimate from measured OCR errors.
 * Does not invent seconds saved.
 */
export function classifyCorrectionBurden(score: ScanSampleScore): CorrectionBurden {
  if (score.failed || !score.sample_id) return 'RETYPE'
  const critical = score.math_critical_errors.length
  const korean = score.korean
  if (score.verdict === 'RED') {
    if (critical >= 2 || (korean != null && korean < 0.4)) return 'RETYPE'
    return 'HEAVY'
  }
  if (score.verdict === 'YELLOW') {
    if (critical > 0) return 'HEAVY'
    if (korean != null && korean < 0.7) return 'MODERATE'
    return 'LIGHT'
  }
  if (critical > 0) return 'MODERATE'
  const mathRates = [score.superscripts, score.fractions, score.radicals, score.choices]
  const mathMiss = mathRates.some((rate) => rate != null && rate < 1)
  if (mathMiss) return 'LIGHT'
  if (korean != null && korean < 0.95) return 'LIGHT'
  return 'NONE'
}

export function countCorrectionBurden(scores: ScanSampleScore[]): Record<CorrectionBurden, number> {
  const counts: Record<CorrectionBurden, number> = {
    NONE: 0,
    LIGHT: 0,
    MODERATE: 0,
    HEAVY: 0,
    RETYPE: 0,
  }
  for (const score of scores) counts[classifyCorrectionBurden(score)] += 1
  return counts
}

/** Aggregate-only mapping when per-sample Windows rows are not committed. */
export function conservativeWindowsBaselineBurden(): {
  counts: Record<CorrectionBurden, number>
  seconds_saved: null
  note: string
} {
  return {
    counts: {
      NONE: 0,
      LIGHT: 8,
      MODERATE: 8,
      HEAVY: 0,
      RETYPE: 10,
    },
    seconds_saved: null,
    note: 'Conservative aggregate from frozen STEP 7 GREEN/YELLOW/RED only. GREEN mapped to LIGHT because math tokens were 0. YELLOW mapped to MODERATE. RED mapped to RETYPE. No seconds invented.',
  }
}
