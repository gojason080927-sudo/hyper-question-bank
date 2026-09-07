import { describe, expect, it } from 'vitest'
import { charErrorRate, scoreRecognition } from './score'
import { recognizeFromText } from './structure'

describe('accuracy scoring', () => {
  it('uses CER for text but treats x2 vs x² as a math structure miss', () => {
    expect(charErrorRate('x2 - 5x + 6 = 0', 'x² - 5x + 6 = 0')).toBeLessThan(0.2)
    const scored = scoreRecognition(recognizeFromText('4. x2 - 5x + 6 = 0'), {
      id: 'G',
      category: 'quadratic',
      problem_number: '4',
      stem_includes: ['5x', '6'],
      math_must_not_collapse: [{ from: 'x²', not: 'x2' }],
    })
    expect(scored.math_structure).toBe(false)
  })
})
