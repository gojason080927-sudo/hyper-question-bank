import { describe, expect, it } from 'vitest'
import { estimateRubricDifficulty, mapRubricLevel, RUBRIC_CUTS, step88Level3RootCause } from './difficultyRubric'

describe('HYPER difficulty rubric v1', () => {
  it('makes level 3 reachable without forcing a flat 1-5 distribution', () => {
    const easy = estimateRubricDifficulty({
      stem: '다음을 계산하시오.',
      choice_count: 5,
      math_count: 1,
      figure_hint: false,
      graph_hint: false,
    })
    const mid = estimateRubricDifficulty({
      stem: '항등식의 계수 비교와 나머지 정리를 함께 사용하여 미정계수를 구한 뒤 전개하시오. (가) (나)',
      choice_count: 0,
      math_count: 4,
      figure_hint: false,
      graph_hint: false,
    })
    const hard = estimateRubricDifficulty({
      stem: '(가) (나) (다) 단, 그림과 같이 설명하시오. 유형 01 + 19쪽 유형 12 고난도',
      choice_count: 0,
      math_count: 9,
      figure_hint: true,
      graph_hint: true,
    })
    expect(easy.difficulty_level).toBeLessThanOrEqual(2)
    expect(mid.difficulty_level).toBe(3)
    expect(hard.difficulty_score).toBeGreaterThan(mid.difficulty_score)
    expect(mapRubricLevel(0.5, RUBRIC_CUTS)).toBe(3)
    const same = Array.from({ length: 12 }, () =>
      estimateRubricDifficulty({ stem: '다음을 계산하시오.', choice_count: 5, math_count: 0, figure_hint: false, graph_hint: false }),
    )
    expect(same.every((row) => row.difficulty_level === same[0]?.difficulty_level)).toBe(true)
    expect(step88Level3RootCause().cause).toBe('threshold_gap_and_confidence_penalty')
  })

  it('does not put publisher badge into the numeric score', () => {
    const plain = estimateRubricDifficulty({ stem: '이차방정식의 해를 구하시오.', choice_count: 0, math_count: 2, figure_hint: false, graph_hint: false })
    const badged = estimateRubricDifficulty({ stem: '이차방정식의 해를 구하시오. 고난도', choice_count: 0, math_count: 2, figure_hint: false, graph_hint: false })
    expect(plain.difficulty_score).toBe(badged.difficulty_score)
    expect(badged.source_difficulty_label).toBe('고난도/실력')
  })
})
