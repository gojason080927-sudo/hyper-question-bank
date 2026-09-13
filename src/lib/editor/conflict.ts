export type SaveConflict = {
  expectedRevision: number
  actualRevision: number | null
}

export function isRevisionConflict(expected: number, actual: number): boolean {
  return expected !== actual
}

export function parseConflictMessage(message: string | null | undefined): boolean {
  return Boolean(message && message.includes('HQB_EDIT_CONFLICT'))
}

const AUTOSAVE_PREFIX = 'hqb.editor.autosave.'

export function localAutosaveKey(problemId: string, staffId: string): string {
  return `${AUTOSAVE_PREFIX}${problemId}.${staffId}`
}

export function readLocalAutosave(storage: Pick<Storage, 'getItem'>, problemId: string, staffId: string): string | null {
  return storage.getItem(localAutosaveKey(problemId, staffId))
}

export function writeLocalAutosave(
  storage: Pick<Storage, 'setItem'>,
  problemId: string,
  staffId: string,
  payload: string,
): void {
  storage.setItem(localAutosaveKey(problemId, staffId), payload)
}

export function clearLocalAutosave(storage: Pick<Storage, 'removeItem'>, problemId: string, staffId: string): void {
  storage.removeItem(localAutosaveKey(problemId, staffId))
}
