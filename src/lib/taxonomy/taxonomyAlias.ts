import { typeIdFromBookHeading } from '../classification/hyperTaxonomy'

export type AliasRecord = {
  source: 'ssen-common-math1'
  alias: string
  theory_code?: string
  canonical_type_id: string | null
  status: 'ALIAS' | 'UNMAPPED_REVIEW'
  universal: false
}

export function aliasIsNotCanonical(alias: string, canonicalTypeId: string): boolean {
  return alias !== canonicalTypeId && !canonicalTypeId.startsWith('REVIEW_')
}

export function mapPublisherAlias(title: string, theoryCode?: string): AliasRecord {
  const mapped = typeIdFromBookHeading(title) ?? extraAliasMap(title)
  return {
    source: 'ssen-common-math1',
    alias: title,
    theory_code: theoryCode,
    canonical_type_id: mapped,
    status: mapped ? 'ALIAS' : 'UNMAPPED_REVIEW',
    universal: false,
  }
}

export function extraAliasMap(title: string): string | null {
  if (/계수\s*비교/.test(title)) return 'UNDETERMINED_COEFF'
  if (/음수의\s*제곱근/.test(title)) return 'COMPLEX_ARITHMETIC'
  if (/켤레근/.test(title)) return 'QUADRATIC_VIETAS'
  if (/그래프와\s*직선|직선의\s*위치/.test(title)) return 'QUAD_FN_RELATION'
  if (/삼차방정식|사차방정식/.test(title)) return 'CUBIC_QUARTIC_EQ'
  if (/A\s*<\s*B\s*<\s*C|부등식.*꼴/.test(title)) return 'LINEAR_INEQUALITY'
  if (/부등식\s*ax/.test(title)) return 'LINEAR_INEQUALITY'
  if (/부정방정식/.test(title)) return null
  if (/분할과\s*분배/.test(title)) return null
  return null
}

export function collectAliases(
  headings: Array<{ title: string; theory_code: string }>,
): AliasRecord[] {
  return headings.map((row) => mapPublisherAlias(row.title, row.theory_code))
}
