import { describe, expect, it } from 'vitest'
import { isSameVersion, resolveReviewVersionId, reviewPath } from './reviewTarget'

const v1 = { id: 'v1', version_no: 1, review_status: 'VERIFIED' }
const v2 = { id: 'v2', version_no: 2, review_status: 'UNREVIEWED' }

describe('resolveReviewVersionId', () => {
  it('prefers an open draft over the verified current version', () => {
    expect(resolveReviewVersionId([v1, v2], 'v1')).toBe('v2')
  })

  it('falls back to current when every version is verified', () => {
    expect(resolveReviewVersionId([v1], 'v1')).toBe('v1')
  })
})

describe('reviewPath', () => {
  it('puts the exact version id in the URL', () => {
    expect(reviewPath('p1', 'v2')).toBe('/questions/p1/versions/v2/review')
  })
})

describe('isSameVersion', () => {
  it('rejects a preview/verify mismatch', () => {
    expect(isSameVersion('v2', 'v2')).toBe(true)
    expect(isSameVersion('v2', 'v1')).toBe(false)
  })
})
