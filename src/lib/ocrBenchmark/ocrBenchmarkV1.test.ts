import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CROP_PAD } from '../recognition/problemPipeline'
import { FROZEN_CROP_GATE } from '../cropRecovery/cropRecoveryV1'
import { CROP_GATE_VERSION } from '../cropGate/cropGateV2'
import { STEP813_TYPE_THRESHOLD } from '../taxonomy/typeCoverageV2'
import { hardMapSourceToHyper } from '../taxonomy/sourceDifficultySystem'
import {
  SAMPLE_TARGET,
  STEP816,
  assignStratum,
  adoptDecision,
  cropGateThresholdsUnchanged,
  estimateMathpixCost,
  estimateMistralCost,
  falseSafe,
  freezeHash,
  limitationClass,
  mathConflictBetween,
  pickStratifiedSample,
  redactBenchmarkText,
  recoveryOf,
  routeNeed,
  scoreProvider,
  type BenchmarkSample,
  type ProviderScore,
} from './ocrBenchmarkV1'

const bbox = { x: 0.05, y: 0.2, width: 0.4, height: 0.12, unit: 'normalized' as const, origin: 'top-left' as const }

function sample(partial: Partial<BenchmarkSample> & Pick<BenchmarkSample, 'sample_id' | 'stratum' | 'current_status'>): BenchmarkSample {
  return {
    source_document_id: '9ff369b4-5b16-4cb8-bfc3-a6b180c18703',
    page_number: 12,
    canonical_problem_number: '0042',
    review_unsafe_reason: partial.stratum,
    reject_reasons: [partial.stratum],
    bbox,
    has_choices: partial.stratum === 'CHOICE_INCOMPLETE',
    choice_count: partial.stratum === 'CHOICE_INCOMPLETE' ? 2 : 0,
    has_figure: partial.stratum === 'FIGURE_NOT_AUTO',
    math_density: partial.stratum === 'MATH_CONFLICT' ? 'high' : 'low',
    layout_kind: 'PROBLEM',
    two_column: true,
    publisher_difficulty: null,
    already_draft: false,
    ...partial,
  }
}

function score(partial: Partial<ProviderScore> & Pick<ProviderScore, 'provider' | 'recovery'>): ProviderScore {
  return {
    sample_id: 's1',
    dimensions: {
      IDENTITY: 'PASS',
      BOUNDARY: 'FAIL',
      STEM: 'REVIEW',
      CHOICES: 'N/A',
      MATH: 'N/A',
      FIGURE: 'N/A',
      STRUCTURE: 'REVIEW',
    },
    severity: 'CRITICAL',
    false_safe: false,
    api_failed: false,
    notes: [],
    ...partial,
  }
}

describe('STEP 8.16 paid OCR benchmark core', () => {
  it('does not relax global crop gate or TYPE threshold', () => {
    expect(cropGateThresholdsUnchanged()).toBe(true)
    expect(FROZEN_CROP_GATE.version).toBe(CROP_GATE_VERSION)
    expect(CROP_PAD).toBe(0.022)
    expect(FROZEN_CROP_GATE.neighbor_iou_max).toBe(0.12)
    const gateSrc = readFileSync(path.join(process.cwd(), 'src/lib/cropGate/cropGateV2.ts'), 'utf8')
    expect(gateSrc).toContain('const NEIGHBOR_IOU_MAX = 0.12')
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(hardMapSourceToHyper('상')).toBeNull()
  })

  it('freezes a representative sample of at most 60 before provider results', () => {
    const review = REQUIRED_POOL('CROP_REVIEW', 80)
    const unsafe = REQUIRED_POOL('CROP_UNSAFE', 20)
    const picked = pickStratifiedSample({ review, unsafe })
    expect(picked.length).toBeLessThanOrEqual(SAMPLE_TARGET)
    expect(picked.filter((row) => row.current_status === 'CROP_REVIEW')).toHaveLength(45)
    expect(picked.filter((row) => row.current_status === 'CROP_UNSAFE')).toHaveLength(15)
    const strata = new Set(picked.map((row) => row.stratum))
    expect(strata.has('STRUCTURE_INCOMPLETE')).toBe(true)
    expect(strata.has('CHOICE_INCOMPLETE')).toBe(true)
    expect(strata.has('FIGURE_NOT_AUTO')).toBe(true)
    expect(strata.has('MATH_CONFLICT')).toBe(true)
    const hash = freezeHash(picked)
    expect(freezeHash(picked)).toBe(hash)
    expect(freezeHash(picked.slice().reverse())).not.toBe(hash)
  })

  it('treats original geometry as ground truth and never copies provider text as truth', () => {
    const unsafe = scoreProvider({
      sample_id: '12|0042',
      provider: 'MISTRAL',
      status: 'CROP_UNSAFE',
      canonical: '0042',
      page_numbers: ['0042', '0043'],
      text: '0042 다항식 $(x+1)^3$ 의 값을 구하시오.\n① 1 ② 2 ③ 3 ④ 4 ⑤ 5',
      expected_choices: 5,
      has_figure: false,
      figure_cut: false,
      figure_detected: false,
      hard_blockers: ['TOP_CUT_RISK'],
      neighbor_body: false,
      math_conflict: false,
      math_density: 'medium',
      latex: ['(x+1)^3'],
    })
    expect(unsafe.recovery).not.toBe('RECOVERED_SAFE')
    expect(unsafe.dimensions.BOUNDARY).toBe('FAIL')
    expect(unsafe.false_safe).toBe(false)
  })

  it('detects critical formula exponent conflict and does not silent-merge hybrid math', () => {
    expect(mathConflictBetween(['x^3'], ['x^2'])).toBe(true)
    expect(mathConflictBetween(['x^3'], ['x^3'])).toBe(false)
    const hybrid = scoreProvider({
      sample_id: '12|0042',
      provider: 'HYBRID',
      status: 'CROP_REVIEW',
      canonical: '0042',
      page_numbers: ['0042'],
      text: '0042 x^3',
      expected_choices: 0,
      has_figure: false,
      figure_cut: false,
      figure_detected: false,
      hard_blockers: [],
      neighbor_body: false,
      math_conflict: true,
      math_density: 'high',
      latex: ['x^3'],
    })
    expect(hybrid.dimensions.MATH).toBe('FAIL')
    expect(hybrid.severity).toBe('CRITICAL')
    expect(hybrid.recovery).not.toBe('RECOVERED_SAFE')
  })

  it('keeps figure ownership as segmentation-limited even when OCR reads figure text', () => {
    const row = scoreProvider({
      sample_id: '20|0099',
      provider: 'MISTRAL',
      status: 'CROP_REVIEW',
      canonical: '0099',
      page_numbers: ['0099'],
      text: '0099 다음 그래프에서',
      expected_choices: 0,
      has_figure: true,
      figure_cut: true,
      figure_detected: true,
      hard_blockers: [],
      neighbor_body: false,
      math_conflict: false,
      math_density: 'low',
      latex: [],
    })
    expect(row.dimensions.FIGURE).toBe('FAIL')
    expect(row.recovery).not.toBe('RECOVERED_SAFE')
  })

  it('does not mark recovered when choice ownership/count is incomplete', () => {
    const row = scoreProvider({
      sample_id: '12|0042',
      provider: 'MISTRAL',
      status: 'CROP_REVIEW',
      canonical: '0042',
      page_numbers: ['0042'],
      text: '0042 다음 중 옳은 것은?\n① 1 ② 2',
      expected_choices: 5,
      has_figure: false,
      figure_cut: false,
      figure_detected: false,
      hard_blockers: [],
      neighbor_body: false,
      math_conflict: false,
      math_density: 'low',
      latex: [],
    })
    expect(row.dimensions.CHOICES).not.toBe('PASS')
    expect(row.recovery).not.toBe('RECOVERED_SAFE')
  })

  it('measures FALSE_SAFE as recovered+critical and refuses production adopt when present', () => {
    expect(falseSafe('RECOVERED_SAFE', 'CRITICAL', {
      IDENTITY: 'FAIL',
      BOUNDARY: 'PASS',
      STEM: 'PASS',
      CHOICES: 'N/A',
      MATH: 'N/A',
      FIGURE: 'N/A',
      STRUCTURE: 'PASS',
    })).toBe(true)
    expect(adoptDecision({ recovered: 10, sample: 60, false_safe: 1, unique_gain: 10 })).toBe('REJECT')
    expect(recoveryOf({
      status: 'CROP_REVIEW',
      dims: {
        IDENTITY: 'PASS',
        BOUNDARY: 'PASS',
        STEM: 'PASS',
        CHOICES: 'N/A',
        MATH: 'N/A',
        FIGURE: 'N/A',
        STRUCTURE: 'PASS',
      },
      severity: 'NONE',
      api_failed: false,
    })).toBe('RECOVERED_SAFE')
  })

  it('separates OCR_SOLVABLE from SEGMENTATION_LIMITED and costs are estimated transparently', () => {
    const current = score({
      provider: 'CURRENT',
      recovery: 'STILL_REVIEW',
      dimensions: {
        IDENTITY: 'PASS',
        BOUNDARY: 'FAIL',
        STEM: 'REVIEW',
        CHOICES: 'N/A',
        MATH: 'REVIEW',
        FIGURE: 'N/A',
        STRUCTURE: 'REVIEW',
      },
    })
    const paid = score({
      provider: 'MATHPIX',
      recovery: 'STILL_UNSAFE',
      dimensions: {
        IDENTITY: 'PASS',
        BOUNDARY: 'FAIL',
        STEM: 'PASS',
        CHOICES: 'N/A',
        MATH: 'PASS',
        FIGURE: 'N/A',
        STRUCTURE: 'PASS',
      },
    })
    expect(limitationClass({ current, bestPaid: paid })).toBe('BOTH')
    expect(routeNeed({
      current,
      mistral: current,
      mathpix: paid,
      hybrid: paid,
    })).toBe('MATHPIX_ONLY')
    const mistral = estimateMistralCost(60)
    const mathpix = estimateMathpixCost(60)
    expect(mistral.marked).toBe('ESTIMATED')
    expect(mathpix.marked).toBe('ESTIMATED')
    expect(mistral.usd).toBeCloseTo(0.24)
    expect(redactBenchmarkText('key=sk-live-secret', ['sk-live-secret'])).toBe('key=[REDACTED]')
    expect(STEP816).toBe('8.16')
    expect(assignStratum({ status: 'CROP_REVIEW', reject_reasons: ['CHOICE_INCOMPLETE'] })).toBe('CHOICE_INCOMPLETE')
  })
})

function REQUIRED_POOL(status: 'CROP_REVIEW' | 'CROP_UNSAFE', n: number): BenchmarkSample[] {
  const strata = [
    'STRUCTURE_INCOMPLETE',
    'CHOICE_INCOMPLETE',
    'FIGURE_NOT_AUTO',
    'TOP_EDGE',
    'MATH_CONFLICT',
    'NEIGHBOR_CONTEXT',
    'NUMBER_IDENTITY',
    'OTHER',
  ] as const
  return Array.from({ length: n }, (_, index) => {
    const stratum = strata[index % strata.length]
    const page = 10 + index
    const number = String(1000 + index).padStart(4, '0')
    return sample({
      sample_id: `${page}|${number}`,
      page_number: page,
      canonical_problem_number: number,
      current_status: status,
      stratum,
    })
  })
}
