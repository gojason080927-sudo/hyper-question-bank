export type SubmitLock = {
  current: boolean
}

export function beginSubmit(lock: SubmitLock): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function releaseSubmit(lock: SubmitLock): void {
  lock.current = false
}
