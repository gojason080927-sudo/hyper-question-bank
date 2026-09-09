import { describe, expect, it } from 'vitest'
import { extractConditionStructure } from './conditionStructure'
import { extractMathFingerprint, fingerprintAgreement } from './mathFingerprint'
import { CLASSIFICATION_RPC, STEP811_THRESHOLDS } from './classificationPersistence'
import {
  headingOnlyCannotAuto,
  neighborOnlyCannotAuto,
  STEP813_TYPE_THRESHOLD,
  strengthenOne,
} from './typeCoverageV2'
import type { ProblemClassificationV1 } from './taxonomyClassifier'

function reviewRow(overrides: Partial<ProblemClassificationV1> = {}): ProblemClassificationV1 {
  return {
    problem_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    page_number: 24,
    original_problem_number: '0120',
    subject_id: '공통수학1',
    unit_id: '다항식',
    unit_confidence: 0.97,
    subunit_id: '나머지 정리와 인수분해',
    subunit_confidence: 0.9,
    type_id: 'REMAINDER_FACTOR_THEOREM',
    type_confidence: 0.72,
    subtype_id: null,
    subtype_confidence: 0,
    core_concepts: ['나머지정리'],
    solution_strategy: ['대입한다'],
    key_test_points: ['나머지 정리를 사용할 수 있는가'],
    difficulty_level: 2,
    difficulty_confidence: 0.8,
    difficulty_evidence: [],
    source_difficulty_label: null,
    classification_status: 'REVIEW',
    review_reasons: ['TYPE_FROM_STEM_ONLY'],
    source_heading: '나머지정리',
    source_heading_distance: 1,
    source_alias_match: '나머지정리',
    decisions: {
      unit: 'AUTO',
      subunit: 'AUTO',
      type: 'REVIEW',
      subtype: 'REVIEW',
      key_point: 'REVIEW',
      solution_strategy: 'REVIEW',
      common_mistakes: 'REVIEW',
      difficulty: 'AUTO',
      overall: 'REVIEW',
    },
    stem_excerpt: '나누었을 때 나머지',
    evidence_insufficient: false,
    ...overrides,
  }
}

describe('STEP 8.13 type coverage evidence', () => {
  it('keeps the frozen type threshold at 0.78', () => {
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(STEP811_THRESHOLDS.type).toBe(0.78)
    expect(STEP813_TYPE_THRESHOLD).toBe(STEP811_THRESHOLDS.type)
  })

  it('does not AUTO from heading-only evidence', () => {
    const stem = '다음 중 옳은 것은?'
    const fingerprint = extractMathFingerprint(stem)
    const row = reviewRow({
      type_id: 'POLY_ADD_SUB',
      type_confidence: 0.7,
      source_heading: '다항식의 덧셈과 뺄셈',
      review_reasons: [],
    })
    const out = strengthenOne({
      row,
      stem,
      fingerprint,
      condition: extractConditionStructure(stem),
      hasAnchor: true,
      oldAuto: false,
    })
    expect(headingOnlyCannotAuto(out.type_evidence)).toBe(true)
    expect(out.coverage_source).toBe('REVIEW')
    expect(out.decisions.type).toBe('REVIEW')
    expect(out.type_confidence).toBeLessThan(STEP813_TYPE_THRESHOLD)
  })

  it('does not AUTO from neighbor-only evidence', () => {
    const stem = '다음을 구하시오.'
    const neighbor = reviewRow({
      problem_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      classification_status: 'AUTO',
      type_confidence: 0.94,
      decisions: { ...reviewRow().decisions, type: 'AUTO', overall: 'AUTO' },
    })
    const out = strengthenOne({
      row: reviewRow({ type_confidence: 0.7, source_heading: '나머지정리', review_reasons: [] }),
      stem,
      fingerprint: extractMathFingerprint(stem),
      condition: extractConditionStructure(stem),
      prev: neighbor,
      next: neighbor,
      hasAnchor: true,
      oldAuto: false,
    })
    expect(neighborOnlyCannotAuto(out.type_evidence)).toBe(true)
    expect(out.decisions.type).toBe('REVIEW')
  })

  it('can strengthen stem-only remainder evidence with math structure and strategy without lowering the threshold', () => {
    const stem = '다항식 $P(x)$를 $x-1$로 나누었을 때 나머지를 구하시오. 나머지정리를 이용하시오.'
    const fingerprint = extractMathFingerprint(stem)
    expect(fingerprintAgreement('REMAINDER_FACTOR_THEOREM', fingerprint)).toBe('SUPPORT')
    const out = strengthenOne({
      row: reviewRow(),
      stem,
      fingerprint,
      condition: extractConditionStructure(stem),
      hasAnchor: true,
      oldAuto: false,
    })
    expect(out.coverage_source).toBe('NEW_AUTO')
    expect(out.decisions.type).toBe('AUTO')
    expect(out.type_confidence).toBeGreaterThanOrEqual(STEP813_TYPE_THRESHOLD)
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(out.production_write).toBe(false)
    expect(out.type_evidence.boosts.some((item) => item.startsWith('math_structure'))).toBe(true)
    expect(out.type_evidence.boosts.some((item) => item.startsWith('strategy'))).toBe(true)
  })

  it('keeps REVIEW when heading and math structure conflict', () => {
    const stem = '두 행렬 A, B의 곱 AB를 구하시오'
    const out = strengthenOne({
      row: reviewRow({
        type_id: 'REMAINDER_FACTOR_THEOREM',
        source_heading: '나머지정리',
        review_reasons: ['TYPE_HEADING_STEM_MISMATCH'],
        unit_id: '행렬',
      }),
      stem,
      fingerprint: extractMathFingerprint(stem),
      condition: extractConditionStructure(stem),
      hasAnchor: true,
      oldAuto: false,
    })
    expect(out.coverage_source).toBe('REVIEW')
    expect(out.type_evidence.conflicts.length).toBeGreaterThan(0)
  })

  it('freezes old AUTO rows and never writes classifications through the persistence RPC name', () => {
    const stem = '다항식 $P(x)$를 $x-1$로 나누었을 때 나머지를 구하시오.'
    const old = reviewRow({
      classification_status: 'AUTO',
      type_confidence: 0.94,
      review_reasons: [],
      decisions: { ...reviewRow().decisions, type: 'AUTO', overall: 'AUTO' },
    })
    const out = strengthenOne({
      row: old,
      stem,
      fingerprint: extractMathFingerprint(stem),
      condition: extractConditionStructure(stem),
      hasAnchor: true,
      oldAuto: true,
    })
    expect(out.coverage_source).toBe('OLD_AUTO')
    expect(out.type_id).toBe(old.type_id)
    expect(out.type_confidence).toBe(0.94)
    expect(out.production_write).toBe(false)
    expect(CLASSIFICATION_RPC).toBe('hqb_upsert_problem_classification')
  })
})
