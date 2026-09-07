import { describe, expect, it } from 'vitest'
import { beginSubmit, releaseSubmit } from './submitLock'

describe('beginSubmit', () => {
  it('rejects a second start until the lock is released', () => {
    const lock = { current: false }
    expect(beginSubmit(lock)).toBe(true)
    expect(beginSubmit(lock)).toBe(false)
    releaseSubmit(lock)
    expect(beginSubmit(lock)).toBe(true)
  })
})
