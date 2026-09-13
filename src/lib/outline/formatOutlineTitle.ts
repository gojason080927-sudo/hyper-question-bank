const ROMAN = '(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)'
const TYPE_DUP = /^(유형\s+(\d{1,3}))\s+(?:\1|유형\s+\2)(\s|$)/
const ROMAN_DUP = new RegExp(`^(${ROMAN})\\s+\\1(\\s|$)`)
const ARABIC_DUP = /^(\d{1,3})\s+\1(\s|$)/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeHeadingSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Display-only: collapse duplicated printed codes.
 * Does not mutate stored outline titles.
 */
export function collapseDuplicateHeading(text: string): string {
  let out = normalizeHeadingSpace(text)
  let prev = ''
  while (out !== prev) {
    prev = out
    out = out.replace(TYPE_DUP, '유형 $2$3')
    out = out.replace(ROMAN_DUP, '$1$2')
    out = out.replace(ARABIC_DUP, '$1$2')
    out = normalizeHeadingSpace(out)
  }
  return out
}

export type OutlineTitleKind = 'BOOK' | 'MAJOR_UNIT' | 'SECTION' | 'TYPE_SEGMENT' | string

function titleAlreadyHasCode(title: string, code: string): boolean {
  if (!code) return false
  const escaped = escapeRegExp(code)
  return new RegExp(`^(?:유형\\s+)?${escaped}(?:\\s|$)`).test(title)
}

/**
 * Join outline code + stored title without duplicating "I I 다항식",
 * "01 01 …", or "유형 01 유형 01 …".
 */
export function formatOutlineTitle(
  code: string | null | undefined,
  title: string | null | undefined,
  kind?: OutlineTitleKind,
): string {
  const rawCode = (code ?? '').trim()
  const rawTitle = collapseDuplicateHeading(title ?? '')
  if (!rawCode && !rawTitle) return ''
  if (!rawCode) {
    if (kind === 'TYPE_SEGMENT' && rawTitle && !rawTitle.startsWith('유형 ')) {
      return collapseDuplicateHeading(`유형 ${rawTitle}`)
    }
    return rawTitle
  }
  if (!rawTitle) {
    return kind === 'TYPE_SEGMENT' ? `유형 ${rawCode}` : rawCode
  }

  if (kind === 'TYPE_SEGMENT') {
    if (titleAlreadyHasCode(rawTitle, rawCode) || rawTitle.startsWith('유형 ')) {
      return collapseDuplicateHeading(rawTitle.startsWith('유형 ') ? rawTitle : `유형 ${rawTitle}`)
    }
    return collapseDuplicateHeading(`유형 ${rawCode} ${rawTitle}`)
  }

  if (titleAlreadyHasCode(rawTitle, rawCode)) return rawTitle
  return collapseDuplicateHeading(`${rawCode} ${rawTitle}`)
}

export function formatOutlinePath(
  nodes: Array<{
    id: string
    parent_id: string | null
    node_level: string
    code: string | null
    title_normalized: string
  }>,
  selectedId: string | null | undefined,
): string {
  if (!selectedId) return '전체'
  const byId = new Map(nodes.map((row) => [row.id, row]))
  const parts: string[] = []
  let current = byId.get(selectedId)
  while (current && current.node_level !== 'BOOK') {
    parts.unshift(formatOutlineTitle(current.code, current.title_normalized, current.node_level))
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return parts.length ? parts.join(' > ') : '전체'
}
