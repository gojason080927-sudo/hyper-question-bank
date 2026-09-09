import { describe, expect, it } from 'vitest'
import { assignModelA, MODEL_A_CUTS } from './difficulty813a'
import {
  BASELINE_CUTS,
  CONFIDENCE_REVIEW,
  assignBandD,
  extractIntrinsicFeatures,
  groupedSplit,
  leakagePairs,
  ocrLengthShouldNotDominate,
  scoreModelD1,
  scoreModelD3,
  typeRelativeComponent,
} from './intrinsicDifficulty'
import { normalizePublisherBadge, publisherBadgeIsNotHyper } from './publisherBadge'
import { STEP811_THRESHOLDS } from './classificationPersistence'
import { STEP813_TYPE_THRESHOLD } from './typeCoverageV2'

const easy = {
  choice_count: 5,
  math_count: 2,
  figure_hint: false,
  graph_hint: false,
}

describe('STEP 8.13C intrinsic difficulty engine', () => {
  it('does not use publisher badge as an intrinsic score input and keeps it off HYPER bands', () => {
    const math = '세 다항식 $A,B,C$에 대하여 $A+B=-x^2$일 때 $A+B+C$를 구하시오'
    const low = extractIntrinsicFeatures({ stem: `${math} 하`, ...easy })
    const high = extractIntrinsicFeatures({ stem: `${math} 상`, ...easy })
    expect(low.publisher_badge_used).toBe(false)
    expect(high.publisher_badge_used).toBe(false)
    expect(Math.abs(low.intrinsic_difficulty_score - high.intrinsic_difficulty_score)).toBeLessThan(0.02)
    expect(publisherBadgeIsNotHyper(normalizePublisherBadge('하'), 'LOW')).toBe(true)
    expect(normalizePublisherBadge('상')).not.toBe(assignModelA(0.81, 0.8))
  })

  it('does not let OCR length or expression length create HIGH', () => {
    const base = '다음 식을 전개하시오. $(x+1)(x+2)$'
    expect(ocrLengthShouldNotDominate(base, '다음을 구하시오. '.repeat(40), easy)).toBe(true)
    const longExpr = extractIntrinsicFeatures({
      stem: `다음 식을 전개하시오. ${'$x+1$ '.repeat(20)}`,
      ...easy,
      math_count: 20,
    })
    expect(assignBandD(longExpr.intrinsic_difficulty_score, 0.84, longExpr.structural_hard, longExpr.families)).not.toBe('HIGH')
    expect(longExpr.structural_hard.sufficient).toBe(false)
  })

  it('treats missing features as missing, not as zero-easy, and sends low-confidence hard stems to REVIEW', () => {
    const missing = extractIntrinsicFeatures({ stem: '구하시오', ...easy, figure_hint: true })
    expect(missing.features.concept_count.value).toBeNull()
    expect(missing.features.concept_count.missing_reason).toBeTruthy()
    expect(missing.difficulty_confidence).toBeLessThan(CONFIDENCE_REVIEW)
    expect(assignBandD(0.6, missing.difficulty_confidence, missing.structural_hard, missing.families)).toBe('REVIEW')
    const easyFull = extractIntrinsicFeatures({ stem: '다음 다항식을 간단히 하시오. $x+x$', ...easy })
    expect(easyFull.features.concept_count.value).not.toBeNull()
    const orInMcq = extractIntrinsicFeatures({
      stem: '다음 중 옳은 것은? ① $x+1$ 또는 $x-1$ ② $x$',
      ...easy,
    })
    expect(orInMcq.features.case_split_requirement.value ?? 0).toBeLessThan(0.5)
  })

  it('raises conceptual load for evidenced multi-concept and reasoning load for branching or case split', () => {
    const one = extractIntrinsicFeatures({ stem: '다항식 $x+1$을 간단히 하시오', ...easy })
    const multi = extractIntrinsicFeatures({
      stem: '이차함수 $y=x^2$의 그래프와 이차방정식의 판별식을 이용하여 실근의 개수를 구하시오',
      ...easy,
      graph_hint: true,
    })
    expect(multi.families.conceptual_load_score).toBeGreaterThan(one.families.conceptual_load_score)
    expect((multi.features.multi_concept_combo.value ?? 0)).toBeGreaterThan(0.5)
    const polar = extractIntrinsicFeatures({
      stem: '두 복소수 $z,w$에 대하여 $z^n=w^n$을 만족시키는 가장 작은 자연수 $n$의 값은?',
      ...easy,
    })
    expect(polar.families.reasoning_strategy_score).toBeGreaterThan(one.families.reasoning_strategy_score)
    expect((polar.features.reverse_reasoning.value ?? 0)).toBeGreaterThan(0.5)
    const branched = extractIntrinsicFeatures({
      stem: '(가) $k>0$ (나) $k<0$인 경우로 나누어 각각 실수 k의 값의 범위를 구하시오. 단, 서로 다른 두 실근',
      ...easy,
    })
    expect(branched.families.reasoning_strategy_score).toBeGreaterThan(one.families.reasoning_strategy_score)
    expect((branched.features.case_split_requirement.value ?? 0)).toBeGreaterThan(0.5)
    expect((branched.features.strategy_branching.value ?? 0)).toBeGreaterThan(0.5)
  })

  it('does not make a calculation-only problem HIGH and applies type-relative only with enough evidence', () => {
    const calc = extractIntrinsicFeatures({
      stem: '다음 식을 전개하시오. $(2x+3y-1)(x-4y+2)$',
      ...easy,
      math_count: 6,
    })
    const band = assignBandD(calc.intrinsic_difficulty_score, 0.8, calc.structural_hard, calc.families)
    expect(band).not.toBe('HIGH')
    expect(typeRelativeComponent(0.4, 0.3, 3)).toBeNull()
    expect(typeRelativeComponent(0.6, 0.4, 8)).not.toBeNull()
    expect(scoreModelD3(0.4, null)).toBe(0.4)
  })

  it('keeps baseline cuts, forbids forced 1/3 splits, and freezes TYPE/legacy constants', () => {
    expect(BASELINE_CUTS.low).toBe(0.42)
    expect(BASELINE_CUTS.high).toBe(0.72)
    expect(MODEL_A_CUTS.high).toBe(0.72)
    const scores = [0.12, 0.18, 0.2, 0.22, 0.25, 0.3, 0.35, 0.4, 0.5]
    const highs = scores.filter((score) => assignModelA(score, 0.8) === 'HIGH').length
    expect(highs).toBe(0)
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(STEP811_THRESHOLDS.type).toBe(0.78)
    const split = groupedSplit([
      { identity: 'a', type_id: 'T', page: 12, badge: 'LOW_BADGE' as const },
      { identity: 'b', type_id: 'T', page: 13, badge: 'MID_BADGE' as const },
      { identity: 'c', type_id: 'U', page: 40, badge: 'HIGH_BADGE' as const },
      { identity: 'd', type_id: 'U', page: 41, badge: 'MID_BADGE' as const },
      { identity: 'e', type_id: 'V', page: 80, badge: 'LOW_BADGE' as const },
    ])
    expect(leakagePairs(split.train, split.holdout)).toEqual([])
    expect(typeof scoreModelD1).toBe('function')
  })
})
