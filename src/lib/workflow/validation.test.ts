import { describe, expect, it } from 'vitest'
import { canVerify, parseHqBError, verifyGateIssues, type VerifyInput } from './validation'
import { defaultHumanDifficulty } from './difficulty'

function validInput(overrides: Partial<VerifyInput> = {}): VerifyInput {
  return {
    problemText: '3x + 7 = 22',
    hasSource: true,
    hasLicense: true,
    hasCurrentVersion: true,
    hasCurriculum: true,
    primaryConceptCount: 1,
    hyperTypeCount: 1,
    strategyCount: 1,
    targetCount: 1,
    hasHumanDifficulty: true,
    difficulty: defaultHumanDifficulty(),
    hasAnswer: true,
    hasExpression: true,
    ...overrides,
  }
}

describe('verifyGateIssues', () => {
  it('passes a complete problem', () => {
    expect(verifyGateIssues(validInput())).toEqual([])
    expect(canVerify(validInput())).toBe(true)
  })

  it('requires a primary concept and an answer', () => {
    const issues = verifyGateIssues(validInput({ primaryConceptCount: 0, hasAnswer: false }))
    expect(issues).toContain('핵심 개념을 하나 이상 선택해 주세요.')
    expect(issues).toContain('정답을 입력해 주세요.')
  })
})

describe('parseHqBError', () => {
  it('extracts the Korean message after the error code', () => {
    expect(parseHqBError('HQB_MISSING_ANSWER: 정답을 입력해 주세요.')).toBe('정답을 입력해 주세요.')
  })
})
