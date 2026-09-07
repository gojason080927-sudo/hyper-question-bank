import { describe, expect, it } from 'vitest'
import { parseStaffProfile, profileGateMessage } from './parseStaffProfile'

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
    expect(parseStaffProfile({ user_id: 'u1', role: 'PENDING' })).toBeNull()
  })

  it('explains PENDING accounts', () => {
    expect(profileGateMessage({ user_id: 'u1', role: 'PENDING' })).toContain('아직 권한이 없습니다')
  })

  it('parses jsonb returned as a string', () => {
    expect(parseStaffProfile('{"user_id":"u1","role":"TEACHER","display_name":null}')).toEqual({
      user_id: 'u1',
      role: 'TEACHER',
      display_name: null,
    })
  })
})
