import { describe, expect, it } from 'vitest'
import { isArchiveCandidate, shouldHideFromDefaultList, worksheetListKind } from './worksheetListKind'

describe('worksheet list kinds', () => {
  it('classifies operational, test, and empty without deleting', () => {
    expect(worksheetListKind({ title: '1학기 중간', item_count: 12 })).toBe('OPERATIONAL')
    expect(worksheetListKind({ title: 'TEST SSEN CLOSEOUT', item_count: 5 })).toBe('TEST')
    expect(worksheetListKind({ title: 'HYPER 문제지', item_count: 3 })).toBe('TEST')
    expect(worksheetListKind({ title: '1학기 중간', item_count: 0 })).toBe('EMPTY')
    expect(isArchiveCandidate('TEST')).toBe(true)
    expect(isArchiveCandidate('OPERATIONAL')).toBe(false)
    expect(shouldHideFromDefaultList('TEST', true)).toBe(true)
    expect(shouldHideFromDefaultList('OPERATIONAL', true)).toBe(false)
  })
})
