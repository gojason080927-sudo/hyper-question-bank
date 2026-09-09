export type CriticalKind = 'CRITICAL' | 'COSMETIC' | 'NONE'

export type CriticalDiff = {
  kind: CriticalKind
  code: string
  detail: string
}

const COSMETIC_PREFIX = /^(?:[#\s]*)\d{4}(?:\s*[|•]\s*(?:대표 문제)?)?\s*/
const COSMETIC_BADGE = /(?:사실형|시술형|서술형|섭서술형)/g

export function stripCosmetic(text: string): string {
  return text
    .replace(COSMETIC_PREFIX, '')
    .replace(COSMETIC_BADGE, '')
    .replace(/문서구의 기출/g, '')
    .replace(/\$\$/g, '$')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function numbers(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? []
}

function exponents(text: string): string[] {
  return [...text.matchAll(/([A-Za-z])\^\{?(\d+)/g)].map((row) => `${row[1]}^${row[2]}`)
}

export function compareBaselineOptimized(baseline: string, optimized: string): CriticalDiff[] {
  const a = stripCosmetic(baseline)
  const b = stripCosmetic(optimized)
  const diffs: CriticalDiff[] = []
  if (a === b) return diffs

  const aNums = numbers(a).join(',')
  const bNums = numbers(b).join(',')
  if (aNums !== bNums) diffs.push({ kind: 'CRITICAL', code: 'number_change', detail: `${aNums} vs ${bNums}` })

  const aExp = exponents(a).join(',')
  const bExp = exponents(b).join(',')
  if (aExp !== bExp) diffs.push({ kind: 'CRITICAL', code: 'exponent_change', detail: `${aExp} vs ${bExp}` })

  const ops = (text: string) => (text.match(/[=+\-<>≤≥]/g) ?? []).join('')
  if (ops(a) !== ops(b)) diffs.push({ kind: 'CRITICAL', code: 'operator_change', detail: `${ops(a)} vs ${ops(b)}` })

  if (!diffs.length) {
    diffs.push({ kind: 'COSMETIC', code: 'wording_or_spacing', detail: 'normalized text differs only cosmetically' })
  }
  return diffs
}

export function worstCritical(diffs: CriticalDiff[]): CriticalKind {
  if (diffs.some((row) => row.kind === 'CRITICAL')) return 'CRITICAL'
  if (diffs.some((row) => row.kind === 'COSMETIC')) return 'COSMETIC'
  return 'NONE'
}
