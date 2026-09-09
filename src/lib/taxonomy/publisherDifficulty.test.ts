import { describe, expect, it } from 'vitest'
import { primaryFromScore } from './difficulty3Level'
import {
  buildPublisherEvidence,
  extractLetterAbc,
  normalizePublisherLabel,
  publisherLabelIsNotHyperDifficulty,
} from './publisherDifficulty'

describe('STEP 8.13 publisher difficulty vs HYPER difficulty', () => {
  it('allows UNKNOWN when the source does not show a label', () => {
    const row = buildPublisherEvidence({
      problem_id: 'p1',
      page_number: 9,
      stem: '다항식 $A+B$를 구하시오',
      source_heading: '다항식의 덧셈과 뺄셈',
      page_ocr: '',
      heading_label: null,
      page_range: null,
    })
    expect(row.source_difficulty_label).toBeNull()
    expect(row.source_difficulty_normalized).toBe('UNKNOWN')
    expect(row.letter_abc).toBeNull()
  })

  it('keeps publisher labels conceptually separate from HYPER LOW/MID/HIGH', () => {
    expect(publisherLabelIsNotHyperDifficulty('B', 'LOW')).toBe(true)
    expect(normalizePublisherLabel('B')).toBe('LEVEL_2_OF_3')
    expect(primaryFromScore(0.2)).toBe('LOW')
    expect(primaryFromScore(0.2) === 'LOW' && normalizePublisherLabel('C') === 'LEVEL_3_OF_3').toBe(true)
    const hyper = primaryFromScore(0.81)
    expect(hyper).toBe('HIGH')
    expect(hyper).not.toBe('C')
    expect(extractLetterAbc('난이도 A 단계')).toBe('A')
    expect(extractLetterAbc('행렬 A와 행렬 B의 곱')).toBeNull()
  })

  it('does not treat SSEN C as automatically HYPER HIGH', () => {
    const row = buildPublisherEvidence({
      problem_id: 'p2',
      page_number: 40,
      stem: '고난도 나머지 정리를 이용하시오',
      source_heading: null,
      page_ocr: '',
      heading_label: '고난도',
      page_range: '40-41',
    })
    expect(row.source_difficulty_label).toBe('고난도')
    expect(row.source_difficulty_normalized).toBe('LEVEL_3_OF_3')
    expect(row.source_difficulty_label).not.toBe('HIGH')
    expect(primaryFromScore(0.2)).not.toBe('HIGH')
  })
})
