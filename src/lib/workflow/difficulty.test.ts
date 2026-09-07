import { describe, expect, it } from 'vitest'
import { defaultHumanDifficulty, extractDifficultyDims, isDifficultyLevel, overallDifficulty } from './difficulty'

describe('overallDifficulty', () => {
  it('returns 1.00 for all ones', () => {
    expect(overallDifficulty(defaultHumanDifficulty())).toBe('1.00')
  })

  it('rounds the arithmetic mean to two decimals', () => {
    expect(
      overallDifficulty({
        concept_difficulty: 1,
        calculation_complexity: 2,
        reasoning_depth: 1,
        condition_complexity: 1,
        representation_complexity: 1,
        trap_level: 1,
      }),
    ).toBe('1.17')
  })
})

describe('isDifficultyLevel', () => {
  it('accepts 1 through 5', () => {
    expect([1, 2, 3, 4, 5].every(isDifficultyLevel)).toBe(true)
  })

  it('rejects 0 and 6', () => {
    expect(isDifficultyLevel(0)).toBe(false)
    expect(isDifficultyLevel(6)).toBe(false)
  })
})

describe('extractDifficultyDims', () => {
  it('reads only the six dimensions from a DB row', () => {
    expect(
      extractDifficultyDims({
        ...defaultHumanDifficulty(),
        difficulty_source: 'HUMAN',
        overall_difficulty: 1.17,
      }),
    ).toEqual(defaultHumanDifficulty())
  })

  it('returns null when a dimension is out of range', () => {
    expect(extractDifficultyDims({ ...defaultHumanDifficulty(), trap_level: 0 })).toBeNull()
  })
})
