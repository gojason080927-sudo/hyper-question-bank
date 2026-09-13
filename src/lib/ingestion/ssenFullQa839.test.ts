import { describe, expect, it } from 'vitest'
import { safeRenderKatex } from '../math/safeKatex'
import { splitMathForDisplay } from '../math/splitMathForDisplay'
import { parseRangeTokens } from './rangeStemRestore838'
import {
  buildPageCensus,
  cacheKey839,
  censusKatex,
  dollarBalanceSerious,
  dryRunSafety839,
  inspectCatalog,
  latexEnvBalance,
  overlapIds,
  paidOcrPlan839,
  problem839,
  proposeAutoSafeStem,
  splitNextNumberLeak,
  withAppliedStems839,
  SSEN_LISTED_FROZEN,
  SSEN_PAGE_COUNT,
  INSPECTOR_VERSION_839,
  RULES_VERSION_839,
  type CatalogProblem839,
} from './ssenFullQa839'

function pack(rows: CatalogProblem839[]) {
  return inspectCatalog(rows)
}

describe('range and math false positives', () => {
  it('parses [0003~0004] and one-digit ranges', () => {
    expect(parseRangeTokens('[0003~0004] 다음')[0]).toMatchObject({ start: 3, end: 4 })
    expect(parseRangeTokens('[3~4] 다음을 구하시오')[0]).toMatchObject({ start: 3, end: 4 })
  })

  it('does not treat $[0,1]$ as a range leak', () => {
    const row = problem839({ id: 'm', problem_number: 2, stem: '구간 $[0,1]$ 에서 $\\frac{1}{2}$' })
    const plan = pack([row])
    expect(plan.records[0]?.signals.some((s) => s.code === 'RANGE_LEAK')).toBe(false)
  })
})

describe('GATE 2 stem structure', () => {
  it('splits a next-number leak off the previous stem', () => {
    const split = splitNextNumberLeak('본문 내용\n0003 $x$에 대한 내림차순', 2, '$x$에 대한 내림차순')
    expect(split?.keep).toBe('본문 내용')
    expect(split?.leaked).toContain('내림차순')
  })

  it('AUTO_SAFE strips OCR packaging and next-number leak', () => {
    const donor = problem839({
      id: 'd',
      problem_number: 2,
      stem: '### 본문 $$x+1$$\n0003 다음을 구하시오',
    })
    const next = problem839({ id: 'n', problem_number: 3, stem: '다음을 구하시오' })
    const proposed = proposeAutoSafeStem(donor, [donor, next])
    expect(proposed?.stem).toContain('본문')
    expect(proposed?.stem).not.toContain('###')
    expect(proposed?.stem).not.toContain('0003')
    const plan = pack([donor, next])
    const rec = plan.records.find((row) => row.problem_id === 'd')
    expect(rec?.verdict).toBe('AUTO_SAFE')
    expect(plan.applies).toHaveLength(1)
  })

  it('does not strip a short major title out of a longer section name', () => {
    const row = problem839({
      id: 'eq',
      problem_number: 703,
      stem: '실근은? 06 여러 가지 방정식',
      source_page: 103,
      section_code: '06',
    })
    expect(proposeAutoSafeStem(row, [row])?.stem).toBe('실근은?')
    expect(proposeAutoSafeStem(row, [row])?.stem).not.toContain('여러 가지')
  })

  it('does not AUTO_SAFE remaining range leaks (8.38 leftover)', () => {
    const donor = problem839({
      id: 'r',
      problem_number: 2,
      stem: '오름차순\n[0003~0004] 다항식을 정리하시오.',
    })
    const a = problem839({ id: 'a', problem_number: 3, stem: '내림차순' })
    const b = problem839({ id: 'b', problem_number: 4, stem: '오름차순' })
    const rec = pack([donor, a, b]).records[0]
    expect(rec?.verdict).toBe('REVIEW_REQUIRED')
    expect(rec?.signals.some((s) => s.code === 'RANGE_LEAK')).toBe(true)
  })

  it('flags missing multiple-choice options as P0', () => {
    const row = problem839({
      id: 'mc',
      problem_number: 10,
      stem: '다음 중 옳은 것은?',
      item_format: 'MULTIPLE_CHOICE',
      choices: [],
    })
    const rec = pack([row]).records[0]
    expect(rec?.signals.some((s) => s.code === 'MISSING_CHOICES')).toBe(true)
    expect(rec?.priority).toBe('P0')
  })

  it('does not invent figure assets when a graph is mentioned', () => {
    const row = problem839({
      id: 'fig',
      problem_number: 11,
      stem: '오른쪽 그림과 같은 이차함수의 그래프에서 교점을 구하시오.',
      crop_present: false,
      step832_preview: null,
    })
    const rec = pack([row]).records[0]
    expect(rec?.signals.some((s) => s.code === 'POSSIBLE_FIGURE_MISSING')).toBe(true)
    expect(rec?.verdict).toBe('PAID_OCR_CANDIDATE')
    expect(rec?.has_figure).toBe(false)
  })
})

describe('GATE 4 KaTeX census', () => {
  it('renders a healthy fraction and records overflow px', () => {
    const census = censusKatex('$\\frac{1}{2}$ 값을 구하시오')
    expect(census.render_fail).toBe(0)
    expect(census.render_ok).toBeGreaterThan(0)
    expect(typeof census.max_width_px).toBe('number')
  })

  it('records a broken matrix as fallback without guessing coefficients', () => {
    const tex = '\\begin{pmatrix} 1 & 2 \\\\ 3'
    const rendered = safeRenderKatex(tex, true)
    expect(rendered.ok).toBe(false)
    const rec = pack([problem839({ id: 'k', problem_number: 12, stem: `$$${tex}$$` })]).records[0]
    expect(rec?.signals.some((s) => s.code === 'BROKEN_LATEX' || s.code === 'LATEX_ENV_MISMATCH')).toBe(true)
  })

  it('detects pmatrix env mismatch', () => {
    expect(latexEnvBalance('\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}').ok).toBe(true)
    expect(latexEnvBalance('\\begin{pmatrix} 1 \\\\ 2').ok).toBe(false)
  })

  it('ignores healthy math dollars', () => {
    expect(dollarBalanceSerious('$x$와 $y$')).toBe(false)
    expect(dollarBalanceSerious('$x 그리고 y')).toBe(true)
  })

  it('splitMathForDisplay still sees display math', () => {
    const parts = splitMathForDisplay('값 $$x^2$$')
    expect(parts.some((part) => part.kind === 'math' && part.display)).toBe(true)
  })
})

describe('protections and idempotency', () => {
  it('never AUTO_SAFE TEACHER_EDIT', () => {
    const row = problem839({
      id: 't',
      problem_number: 2,
      origin: 'TEACHER_EDIT',
      stem: '### 교사가 고친 본문\n0003 다음',
    })
    const next = problem839({ id: 'n', problem_number: 3, stem: '다음' })
    expect(proposeAutoSafeStem(row, [row, next])).toBeNull()
    expect(pack([row, next]).records[0]?.verdict).not.toBe('AUTO_SAFE')
  })

  it('never AUTO_SAFE VERIFIED', () => {
    const row = problem839({
      id: 'v',
      problem_number: 2,
      review_status: 'VERIFIED',
      stem: '### 확정 본문',
    })
    expect(proposeAutoSafeStem(row, [row])).toBeNull()
    expect(pack([row]).applies).toHaveLength(0)
  })

  it('idempotent re-inspect after apply writes 0', () => {
    const donor = problem839({
      id: 'd',
      problem_number: 2,
      stem: '본문입니다.\n0003 다음을 구하시오',
    })
    const next = problem839({ id: 'n', problem_number: 3, stem: '다음을 구하시오' })
    const plan = pack([donor, next])
    expect(plan.applies.length).toBeGreaterThan(0)
    const again = inspectCatalog(withAppliedStems839([donor, next], plan.applies))
    expect(again.applies).toHaveLength(0)
  })
})

describe('coverage, merge, cache, paid OCR plan', () => {
  it('does not mark a page reverse just because catalog order is unsorted', () => {
    const a = problem839({ id: 'b', problem_number: 2, stem: '$y$', source_page: 9 })
    const b = problem839({ id: 'a', problem_number: 1, stem: '$x$', source_page: 9 })
    const plan = pack([a, b])
    expect(plan.records.every((row) => !row.signals.some((s) => s.code === 'PAGE_REVERSE'))).toBe(true)
    expect(plan.pages[8]?.listed_count).toBe(2)
  })

  it('emits a census row for all 192 pages', () => {
    const pages = buildPageCensus([problem839({ id: 'a', problem_number: 1, stem: '$x$', source_page: 9 })])
    expect(pages).toHaveLength(SSEN_PAGE_COUNT)
    expect(pages[0]?.page).toBe(1)
    expect(pages[191]?.page).toBe(192)
  })

  it('inspects every listed row (synthetic 1,242 would be CLI; here unique merge)', () => {
    const a = problem839({ id: 'a', problem_number: 1, stem: '### x\n0002 y' })
    const b = problem839({ id: 'b', problem_number: 2, stem: 'y' })
    const plan = pack([a, b])
    expect(plan.records).toHaveLength(2)
    expect(plan.records.every((row) => row.inspected)).toBe(true)
    const rec = plan.records[0]
    expect(rec?.signals.length).toBeGreaterThan(1)
    expect(rec?.root_cause).toBeTruthy()
  })

  it('cache key is stable for same version+stem+inspector', () => {
    const a = cacheKey839({ versionId: 'v1', stem: 'abc', pageSha: 'p', pdfSha: 'f' })
    const b = cacheKey839({ versionId: 'v1', stem: 'abc', pageSha: 'p', pdfSha: 'f' })
    const c = cacheKey839({ versionId: 'v2', stem: 'abc', pageSha: 'p', pdfSha: 'f' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith(`${INSPECTOR_VERSION_839}|${RULES_VERSION_839}`)).toBe(true)
  })

  it('second inspect hits cache', () => {
    const row = problem839({ id: 'c', problem_number: 5, stem: '$x+1$' })
    const first = inspectCatalog([row])
    const cache = { [first.records[0]!.cache_key]: { record: first.records[0]!, inspector: INSPECTOR_VERSION_839, rules: RULES_VERSION_839 } }
    const second = inspectCatalog([row], { cache })
    expect(second.records[0]?.cache_hit).toBe(true)
    expect(second.summary.cache_hits).toBe(1)
  })

  it('overlap of 8.38 leftovers and live queue is ID-based', () => {
    const overlap = overlapIds(['a', 'b', 'c'], ['b', 'd'])
    expect(overlap.both).toEqual(['b'])
    expect(overlap.onlyLeft).toEqual(['a', 'c'])
    expect(overlap.onlyRight).toEqual(['d'])
  })

  it('paid OCR plan uses official unit prices and 0 calls', () => {
    const row = problem839({
      id: 'p',
      problem_number: 20,
      source_page: 12,
      stem: '오른쪽 그림에서 교점을 구하시오.',
      crop_present: false,
      step832_preview: null,
    })
    const plan = pack([row])
    const paid = paidOcrPlan839(plan)
    expect(plan.summary.paid_ocr_calls).toBe(0)
    expect(paid.mathpix_usd_per_image).toBe(0.002)
    expect(paid.mistral_usd_per_page).toBe(0.004)
    expect(paid.unique_pages).toBe(1)
  })

  it('dry-run safety holds for a tiny catalog when not claiming 1,242', () => {
    const plan = pack([problem839({ id: 'z', problem_number: 1, stem: '$x$' })])
    const safety = dryRunSafety839(plan, plan.integrity.listed)
    expect(safety.ok).toBe(true)
  })

  it('frozen listed constant remains 1,242', () => {
    expect(SSEN_LISTED_FROZEN).toBe(1242)
  })
})
