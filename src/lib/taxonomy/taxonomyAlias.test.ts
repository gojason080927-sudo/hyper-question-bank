import { describe, expect, it } from 'vitest'
import { aliasIsNotCanonical, mapPublisherAlias } from './taxonomyAlias'

describe('taxonomy alias policy', () => {
  it('keeps publisher headings as aliases and never as canonical type_id', () => {
    const mapped = mapPublisherAlias('계수 비교형', '02-2')
    expect(mapped.canonical_type_id).toBe('UNDETERMINED_COEFF')
    expect(mapped.universal).toBe(false)
    expect(aliasIsNotCanonical('계수 비교형', mapped.canonical_type_id!)).toBe(true)
    const unmapped = mapPublisherAlias('분할과 분배', '09-4')
    expect(unmapped.status).toBe('UNMAPPED_REVIEW')
    expect(unmapped.canonical_type_id).toBeNull()
  })
})
