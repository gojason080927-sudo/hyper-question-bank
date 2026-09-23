import { describe, expect, it } from 'vitest'
import { emptyPageTextHint } from './sourceDetailHints'
import { estimatePageScenario } from '../../lib/ocr/costModel'

describe('emptyPageTextHint', () => {
  it('uses this document page count instead of leftover SSEN 192', () => {
    const hint = emptyPageTextHint(200)
    expect(hint).toContain('200페이지 전체는 돌리지 않습니다')
    expect(hint).not.toContain('192')
    expect(emptyPageTextHint(192)).toContain('192페이지 전체는 돌리지 않습니다')
    expect(emptyPageTextHint(null)).toContain('문서 전체는 돌리지 않습니다')
    expect(emptyPageTextHint(undefined)).not.toContain('192')
  })
})

describe('scan book OCR estimate', () => {
  it('prices a 200-page scan at Mathpix PDF page rate with zero cache', () => {
    const plan = estimatePageScenario('쎈 공통수학 2 200p', 200)
    expect(plan.units).toBe(200)
    expect(plan.typical.usd).toBe(1)
    expect(plan.conservative.usd).toBe(1)
  })
})
