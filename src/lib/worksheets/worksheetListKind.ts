export type WorksheetListKind = 'OPERATIONAL' | 'TEST' | 'EMPTY'

export function worksheetListKind(input: { title: string; item_count: number; archived_at?: string | null }): WorksheetListKind {
  if (input.item_count <= 0) return 'EMPTY'
  if (/TEST|테스트|HYPER 문제지/i.test(input.title ?? '')) return 'TEST'
  return 'OPERATIONAL'
}

export function isArchiveCandidate(kind: WorksheetListKind): boolean {
  return kind === 'TEST' || kind === 'EMPTY'
}

export function shouldHideFromDefaultList(kind: WorksheetListKind, hideTestAndEmpty: boolean): boolean {
  if (!hideTestAndEmpty) return false
  return kind !== 'OPERATIONAL'
}
