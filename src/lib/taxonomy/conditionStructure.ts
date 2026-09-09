export type ConditionStructure = {
  p_of_a_zero: boolean
  remainder_after_division: boolean
  roots_alpha_beta: boolean
  vieta_sum: boolean
  vieta_product: boolean
  inequality: boolean
  simultaneous_conditions: boolean
  integer_restriction: boolean
  real_number_restriction: boolean
  distinct_roots: boolean
  repeated_roots: boolean
  ordering_restriction: boolean
  relations: string[]
  condition_count: number
}

export function extractConditionStructure(stem: string): ConditionStructure {
  const text = stem.replace(/\s+/g, ' ')
  const p_of_a_zero = /P\s*\([^)]+\)\s*=\s*0|f\s*\([^)]+\)\s*=\s*0/.test(text)
  const remainder_after_division = /나누었을\s*때|나머지가/.test(text)
  const roots_alpha_beta = /두\s*근|α|β/.test(text)
  const vieta_sum = /두\s*근의\s*합|α\s*\+\s*β|근과\s*계수/.test(text)
  const vieta_product = /두\s*근의\s*곱|αβ/.test(text)
  const inequality = /부등식|[<>≤≥]|\\le|\\ge/.test(text)
  const simultaneous_conditions = (text.match(/\(가\)|\(나\)|\(다\)/g) ?? []).length >= 2 || /연립/.test(text)
  const integer_restriction = /정수|자연수/.test(text)
  const real_number_restriction = /실수|실근/.test(text)
  const distinct_roots = /서로\s*다른/.test(text)
  const repeated_roots = /중근|중첩/.test(text)
  const ordering_restriction = /오름차순|내림차순|작은\s*수부터/.test(text)
  const relations = [
    p_of_a_zero ? 'P(a)=0' : null,
    remainder_after_division ? 'P(x) divided by ...' : null,
    roots_alpha_beta ? 'roots α, β' : null,
    vieta_sum ? 'α+β' : null,
    vieta_product ? 'αβ' : null,
    inequality ? 'inequality' : null,
    simultaneous_conditions ? 'simultaneous conditions' : null,
    integer_restriction ? 'integer restriction' : null,
    real_number_restriction ? 'real-number restriction' : null,
    distinct_roots ? 'distinct roots' : null,
    repeated_roots ? 'repeated roots' : null,
    ordering_restriction ? 'ordering restriction' : null,
  ].filter((row): row is string => Boolean(row))
  return {
    p_of_a_zero,
    remainder_after_division,
    roots_alpha_beta,
    vieta_sum,
    vieta_product,
    inequality,
    simultaneous_conditions,
    integer_restriction,
    real_number_restriction,
    distinct_roots,
    repeated_roots,
    ordering_restriction,
    relations,
    condition_count: relations.length + (text.match(/단,/g) ?? []).length,
  }
}
