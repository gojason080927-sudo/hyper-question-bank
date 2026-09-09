import { describe, expect, it } from 'vitest'
import { canonicalizeProblemNumber, draftIdentityKey } from './draftUpsert'

describe('STEP 8.5A problem identity', () => {
  it('canonicalizes 쎈 4-digit numbers without treating section labels as identity', () => {
    expect(canonicalizeProblemNumber('0159')).toBe('0159')
    expect(canonicalizeProblemNumber(' 0159 ')).toBe('0159')
    expect(canonicalizeProblemNumber('0159.')).toBe('0159')
    expect(canonicalizeProblemNumber('159')).toBe('0159')
    expect(canonicalizeProblemNumber('05-3')).toBeNull()
    expect(canonicalizeProblemNumber('SIDEBAR')).toBeNull()
    expect(canonicalizeProblemNumber('')).toBeNull()
  })

  it('builds identity from document + page + number and excludes bbox', () => {
    const a = draftIdentityKey({
      source_document_id: 'doc-a',
      page_number: 28,
      original_problem_number: ' 0159. ',
    })
    const b = draftIdentityKey({
      source_document_id: 'doc-a',
      page_number: 28,
      original_problem_number: '159',
    })
    expect(a).toBe('doc-a|28|0159')
    expect(a).toBe(b)
    expect(a?.includes('0.012')).toBe(false)
  })
})
