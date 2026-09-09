import { describe, expect, it } from 'vitest'
import type { IntrinsicInput } from './intrinsicDifficulty'
import { extractIntrinsicFeatures } from './intrinsicDifficulty'
import { STEP811_THRESHOLDS } from './classificationPersistence'
import { STEP813_TYPE_THRESHOLD } from './typeCoverageV2'
import {
  ABSOLUTE_NINE_LEVEL,
  ANCHOR_PRIORITY,
  FORCED_DISTRIBUTION,
  SSEN_DIFFICULTY_SYSTEM,
  SSEN_EXPERT_LOCK,
  SYNTHETIC_BOOK_X,
  SYNTHETIC_STAR_SYSTEM,
  SYNTHETIC_STEP_SYSTEM,
  calibrationSupportsMultipleBooks,
  conflictDecision,
  freezeRawLabel,
  hardMapSourceToHyper,
  intrinsicInputAllowsSourceLabel,
  isAbsoluteNineLevel,
  makeOrderedSystem,
  projectSsenExpertRow,
  sameTypeAnchorsFirst,
  secondaryWithinPrimary,
  sourceDifficultyEqualsHyperField,
  sourceLabelForcesHyper,
  sourceOrdinalPosition,
  stageAndItemAreSeparate,
  unlabeledEstimatePath,
  wouldCopySsenOntoHyper,
} from './sourceDifficultySystem'

const sample = {
  page: 12,
  problem_number: '0041',
  problem_identity: '12|0041',
  publisher_badge_normalized: 'LOW_BADGE' as const,
  publisher_badge_raw: '하',
  source_stage: 'B_TYPE',
  source_type_heading: null,
  badge_confidence: 0.92,
  evidence: ['VISUAL_CIRCLE'],
}

describe('STEP 8.13D source difficulty system', () => {
  it('keeps source difficulty off the HYPER difficulty field', () => {
    const projected = projectSsenExpertRow(sample)
    expect(projected.hyper_primary).toBeNull()
    expect(sourceDifficultyEqualsHyperField('하', 'LOW')).toBe(false)
    expect(projected.source_item_label_raw).toBe('하')
    expect(projected.source_item_label_raw).not.toBe(projected.hyper_primary)
  })

  it('does not hard-force SSEN 하/중/상 onto HYPER LOW/MID/HIGH', () => {
    expect(wouldCopySsenOntoHyper('하', 'LOW')).toBe(false)
    expect(wouldCopySsenOntoHyper('중', 'MID')).toBe(false)
    expect(wouldCopySsenOntoHyper('상', 'HIGH')).toBe(false)
    expect(hardMapSourceToHyper('하')).toBeNull()
    expect(hardMapSourceToHyper('중')).toBeNull()
    expect(hardMapSourceToHyper('상')).toBeNull()
    expect(sourceLabelForcesHyper('심화', 'HIGH')).toBe(false)
  })

  it('represents 기본/발전/심화, STEP, and star systems without HYPER mapping', () => {
    expect(SYNTHETIC_BOOK_X.ordered_levels.map((row) => row.raw_label)).toEqual(['기본', '발전', '심화'])
    expect(SYNTHETIC_STEP_SYSTEM.ordered_levels.map((row) => row.raw_label)).toEqual(['STEP 1', 'STEP 2', 'STEP 3'])
    expect(SYNTHETIC_STAR_SYSTEM.ordered_levels.map((row) => row.raw_label)).toEqual(['★', '★★', '★★★'])
    expect(hardMapSourceToHyper('심화', SYNTHETIC_BOOK_X)).toBeNull()
    expect(hardMapSourceToHyper('STEP 3', SYNTHETIC_STEP_SYSTEM)).toBeNull()
    expect(hardMapSourceToHyper('★★★', SYNTHETIC_STAR_SYSTEM)).toBeNull()
  })

  it('stores stage and item labels together and keeps raw labels plus ordinals', () => {
    expect(SSEN_DIFFICULTY_SYSTEM.dimensions).toEqual(['STAGE', 'ITEM'])
    const projected = projectSsenExpertRow(sample)
    expect(stageAndItemAreSeparate(projected)).toBe(true)
    expect(freezeRawLabel('상')).toBe('상')
    expect(projected.source_level_order).toBe(0)
    expect(projected.source_level_count).toBe(3)
    expect(sourceOrdinalPosition(0, 3)).toBe(0)
    expect(sourceOrdinalPosition(1, 3)).toBe(0.5)
    expect(sourceOrdinalPosition(2, 3)).toBe(1)
    expect(sourceOrdinalPosition(2, 3)).not.toBe(extractIntrinsicFeatures({
      stem: '다항식 $x+1$을 간단히 하시오',
      choice_count: 0,
      math_count: 1,
      figure_hint: false,
      graph_hint: false,
    }).intrinsic_difficulty_score)
  })

  it('supports multi-book calibration, same-type-first anchors, unlabeled path, and REVIEW conflicts', () => {
    expect(calibrationSupportsMultipleBooks(['ssen-cm1-v1', 'synthetic-book-x-v1'])).toBe(true)
    expect(sameTypeAnchorsFirst()).toBe(true)
    expect(ANCHOR_PRIORITY[0]).toBe('same_type')
    expect(unlabeledEstimatePath().source_difficulty).toBe('NONE')
    expect(unlabeledEstimatePath().forbidden_reason).toContain('SSEN')
    expect(conflictDecision({ source_like: 'HIGH_LIKE', intrinsic_like: 'VERY_EASY', extraction_confidence: 0.8 }).status).toBe('REVIEW')
    expect(conflictDecision({ source_like: 'HIGH_LIKE', intrinsic_like: 'VERY_EASY', extraction_confidence: 0.8 }).code).toBe('SOURCE_INTRINSIC_CONFLICT')
  })

  it('keeps intrinsic extraction independent of source raw labels and secondary inside primary', () => {
    const input: IntrinsicInput = { stem: '상 하 중 심화 STEP 3', choice_count: 0, math_count: 0, figure_hint: false, graph_hint: false }
    expect(intrinsicInputAllowsSourceLabel(input)).toBe(true)
    const withBadge = extractIntrinsicFeatures(input)
    const without = extractIntrinsicFeatures({ ...input, stem: '다음 다항식을 간단히 하시오' })
    expect(withBadge.publisher_badge_used).toBe(false)
    expect(without.publisher_badge_used).toBe(false)
    expect(isAbsoluteNineLevel(secondaryWithinPrimary('HIGH', 'RELATIVE_MID'))).toBe(false)
    expect(ABSOLUTE_NINE_LEVEL).toBe(false)
    expect(FORCED_DISTRIBUTION).toBe(false)
    expect(makeOrderedSystem({
      difficulty_system_id: 'x',
      publisher: 'P',
      series: 'S',
      system_name: 'n',
      system_kind: 'ITEM_BADGE',
      labels: ['하', '중', '상'],
      scope: 'ITEM',
    }).notes[0]).toMatch(/Not a HYPER/)
    expect(STEP813_TYPE_THRESHOLD).toBe(0.78)
    expect(STEP811_THRESHOLDS.type).toBe(0.78)
    expect(SSEN_EXPERT_LOCK.CONFIRMED).toBe(261)
  })
})
