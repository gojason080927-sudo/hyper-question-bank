import { describe, expect, it } from 'vitest'
import { parseStaffProfile } from './parseStaffProfile'

describe('parseStaffProfile', () => {
  it('accepts a staff profile object', () => {
    expect(
      parseStaffProfile({
        user_id: 'u1',
        role: 'ADMIN',
        display_name: '원장',
      }),
    ).toEqual({ user_id: 'u1', role: 'ADMIN', display_name: '원장' })
  })

  it('rejects missing role or unknown role', () => {
    expect(parseStaffProfile({ user_id: 'u1' })).toBeNull()
    expect(parseStaffProfile({ user_id: 'u1', role: 'SYSTEM_PROCESS' })).toBeNull()
  })

  it('parses jsonb returned as a string', () => {
    expect(parseStaffProfile('{"user_id":"u1","role":"TEACHER","display_name":null}')).toEqual({
      user_id: 'u1',
      role: 'TEACHER',
      display_name: null,
    })
  })
})
