export type VersionReviewRow = {
  id: string
  version_no: number
  review_status: string
}

export function resolveReviewVersionId(
  versions: VersionReviewRow[],
  currentVersionId: string | null,
): string | null {
  const open = [...versions]
    .filter((row) => row.review_status !== 'VERIFIED' && row.review_status !== 'REJECTED')
    .sort((a, b) => b.version_no - a.version_no)
  if (open[0]) return open[0].id
  if (currentVersionId && versions.some((row) => row.id === currentVersionId)) return currentVersionId
  return versions[0]?.id ?? null
}

export function reviewPath(problemId: string, versionId: string): string {
  return `/questions/${problemId}/versions/${versionId}/review`
}

export function isSameVersion(previewVersionId: string, verifyVersionId: string): boolean {
  return previewVersionId === verifyVersionId
}
