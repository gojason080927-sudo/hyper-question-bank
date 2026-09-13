export type VersionPick = {
  id: string
  version_no: number
  review_status: string
}

export function isEditableReviewStatus(status: string): boolean {
  return status !== 'VERIFIED' && status !== 'REJECTED'
}

/**
 * Open the current version when it is still a draft. Never fall back to an older
 * UNREVIEWED row — that discarded later TEACHER_EDIT JSON and made Save look like a no-op.
 * If current is VERIFIED, the editor must clone rather than mutate.
 */
export function pickOpenEditorVersion<T extends VersionPick>(
  versions: T[],
  currentVersionId: string | null | undefined,
): { action: 'edit' | 'clone' | 'missing'; version: T | null } {
  const current = currentVersionId ? (versions.find((row) => row.id === currentVersionId) ?? null) : null
  if (current && isEditableReviewStatus(current.review_status)) {
    return { action: 'edit', version: current }
  }
  if (current?.review_status === 'VERIFIED') {
    return { action: 'clone', version: current }
  }
  const newestEditable =
    [...versions].filter((row) => isEditableReviewStatus(row.review_status)).at(-1) ?? null
  if (newestEditable) return { action: 'edit', version: newestEditable }
  return { action: 'missing', version: current }
}

export function chunkIds<T>(ids: T[], size = 80): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}
