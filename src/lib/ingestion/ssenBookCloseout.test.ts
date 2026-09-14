import { describe, expect, it } from 'vitest'
import {
  estimatePaidCostUsd,
  isStubMcq,
  leftoverFrom840Payload,
  ocrAgreesWithGold,
  ocrCacheKey,
  ownItemSlice,
  P1_GOLD,
  pagesNeedingPaidOcr,
  paidBudgetAllows,
  planCloseout,
  rebuildStem,
  stripTrailingNextStub,
  type CatalogRowClose,
} from './ssenBookCloseout'
import type { Input839Record } from './ssenReviewMinimize840'

function row(partial: Partial<CatalogRowClose> & { problem_number: number; stem: string; id: string }): CatalogRowClose {
  return {
    public_code: `HQB-${partial.problem_number}`,
    original_problem_number: String(partial.problem_number).padStart(4, '0'),
    source_page: 49,
    section_code: '03',
    major_code: 'II',
    display_state: 'LISTED',
    origin: 'OCR',
    review_status: 'AUTO_CLASSIFIED',
    current_version_id: 'v1',
    teacher_edit: false,
    verified: false,
    ...partial,
  }
}

function leftover(partial: Partial<Input839Record> & { problem_id: string; current_number: string; stem: string }): Input839Record {
  return {
    public_code: `HQB-${partial.current_number}`,
    source_page: 49,
    section_code: '03',
    major_code: 'II',
    verdict: 'REVIEW_REQUIRED',
    priority: 'P2',
    root_cause: 'NEXT_NUMBER_LEAK',
    verdict_reason: 'x',
    signals: ['NEXT_NUMBER_LEAK'],
    proposed_stem: null,
    ...partial,
  }
}

describe('ssen book closeout', () => {
  it('detects P1 stubs and requires OCR agreement', () => {
    expect(isStubMcq('대표 문제 다음 중 옳은 것은?')).toBe(true)
    expect(ocrAgreesWithGold('0은 복소수가 아니다 허수부분은 6 실수부분은 0이다', P1_GOLD['0331']!)).toBe(true)
    expect(ocrAgreesWithGold('다음 중 옳은 것은', P1_GOLD['0331']!)).toBe(false)
    expect(ocrAgreesWithGold('다음 중 옳은 것은 $\\sqrt{-3}\\sqrt{7}=-\\sqrt{21}$', P1_GOLD['0381']!)).toBe(true)
  })

  it('strips trailing next-number difficulty stubs when next listed exists', () => {
    const stripped = stripTrailingNextStub('그릇의 두께는 무시한다.\n0736 ④', 735, true)
    expect(stripped?.text).toContain('무시한다')
    expect(stripped?.text).not.toContain('0736')
    expect(stripTrailingNextStub('본문\n0316 $$i^{100}$$', 315, false)).toBeNull()
  })

  it('drops homed siblings and later range leaks', () => {
    const catalog = [
      row({ id: 'a', problem_number: 321, stem: '0321 $$-\\sqrt{-8}$$ 0322 $$-\\sqrt{-9/4}$$ [0323~0326] 다음 수의 제곱근을 구하시오.' }),
      row({ id: 'b', problem_number: 322, stem: '0321 $$-\\sqrt{-8}$$ 0322 $$-\\sqrt{-9/4}$$' }),
      row({ id: 'c', problem_number: 323, stem: '[0323~0326] 다음 수의 제곱근을 구하시오. 0323 -3' }),
    ]
    const rebuilt = rebuildStem(catalog[0]!.stem, 321, catalog)
    expect(rebuilt?.text).toContain('0321')
    expect(rebuilt?.text).not.toContain('0323')
    expect(rebuilt?.text).not.toContain('0322')
    expect(ownItemSlice(catalog[0]!.stem, 321, catalog).droppedHomed).toContain(322)
  })

  it('keeps unhomed pair items on the listed parent', () => {
    const catalog = [row({ id: 'a', problem_number: 125, stem: '0125 $x - 1$ 0126 $x + 2$' })]
    const slice = ownItemSlice(catalog[0]!.stem, 125, catalog)
    expect(slice.keptUnhomed).toContain(126)
    const plan = planCloseout(
      [leftover({ problem_id: 'a', current_number: '0125', stem: catalog[0]!.stem, source_page: 25 })],
      catalog,
    )
    expect(plan.decisions[0]?.verdict).toBe('VERIFIED_BY_SOURCE')
    expect(plan.decisions[0]?.proposed_stem).toBeNull()
    expect(plan.applies).toHaveLength(0)
  })

  it('splits hidden-duplicate siblings onto both records', () => {
    const catalog = [
      row({ id: 'listed', problem_number: 315, stem: '0315 $$1-i+i^2-i^3$$\n0316 $$i^{100}+i^{101}$$' }),
      row({
        id: 'hidden',
        problem_number: 316,
        display_state: 'HIDDEN_DUPLICATE',
        stem: '0315 $$1-i+i^2-i^3$$\n0316 $$i^{100}+i^{101}$$',
      }),
    ]
    const plan = planCloseout(
      [leftover({ problem_id: 'listed', current_number: '0315', stem: catalog[0]!.stem })],
      catalog,
    )
    expect(plan.decisions[0]?.verdict).toBe('AUTO_SAFE')
    expect(plan.applies.some((row) => row.problem_id === 'listed')).toBe(true)
    expect(plan.applies.some((row) => row.problem_id === 'hidden')).toBe(true)
    const listed = plan.applies.find((row) => row.problem_id === 'listed')
    expect(listed?.to_stem).toContain('0315')
    expect(listed?.to_stem).not.toContain('0316')
  })

  it('restores P1 when OCR agrees and skips when it does not', () => {
    const catalog = [row({ id: 'p1', problem_number: 331, source_page: 50, stem: '대표 문제 다음 중 옳은 것은?' })]
    const miss = planCloseout(
      [leftover({ problem_id: 'p1', current_number: '0331', stem: catalog[0]!.stem, source_page: 50, priority: 'P1' })],
      catalog,
    )
    expect(miss.decisions[0]?.verdict).toBe('HUMAN_FINAL_CHECK')
    const hit = planCloseout(
      [leftover({ problem_id: 'p1', current_number: '0331', stem: catalog[0]!.stem, source_page: 50, priority: 'P1' })],
      catalog,
      { ocrByPage: new Map([[50, '0은 복소수가 아니다. 1-6i의 허수부분은 6이다. -3i의 실수부분은 0이다.']]) },
    )
    expect(hit.decisions[0]?.verdict).toBe('VERIFIED_BY_SOURCE')
    expect(hit.applies[0]?.to_stem).toContain('①')
  })

  it('marks already-clean next-leak leftovers as PASS_FALSE_POSITIVE', () => {
    const catalog = [row({ id: 'clean', problem_number: 94, stem: '그릇의 두께는 무시한다.' })]
    const plan = planCloseout(
      [leftover({ problem_id: 'clean', current_number: '0094', stem: catalog[0]!.stem, root_cause: 'NEXT_NUMBER_LEAK' })],
      catalog,
    )
    expect(plan.decisions[0]?.verdict).toBe('PASS_FALSE_POSITIVE')
    expect(plan.applies).toHaveLength(0)
  })

  it('reuses OCR cache keys and refuses to exceed the $1 cap', () => {
    expect(ocrCacheKey(50, 'abc')).toBe('p050-abc')
    expect(estimatePaidCostUsd({ newPageCalls: 2, dense: true })).toBe(0.01)
    expect(paidBudgetAllows(0.995, 0.005)).toBe(true)
    expect(paidBudgetAllows(0.996, 0.005)).toBe(false)
    const human = planCloseout(
      [leftover({ problem_id: 'p1', current_number: '0331', stem: '대표 문제 다음 중 옳은 것은?', source_page: 50, priority: 'P1' })],
      [row({ id: 'p1', problem_number: 331, source_page: 50, stem: '대표 문제 다음 중 옳은 것은?' })],
    )
    expect(pagesNeedingPaidOcr(human.decisions, new Map())).toEqual([50])
    expect(pagesNeedingPaidOcr(human.decisions, new Map([[50, 'already']]))).toEqual([])
  })

  it('reads the frozen 56 leftovers from the 8.40 payload once', () => {
    const rows = leftoverFrom840Payload({
      records: [
        leftover({ problem_id: 'a', current_number: '0331', stem: 'x', verdict: 'REVIEW_REQUIRED' }),
        leftover({ problem_id: 'a', current_number: '0331', stem: 'x', verdict: 'REVIEW_REQUIRED' }),
        leftover({ problem_id: 'b', current_number: '0094', stem: 'y', verdict: 'AUTO_SAFE' }),
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.problem_id).toBe('a')
  })

  it('ignores page-number references when splitting siblings', () => {
    const catalog = [
      row({ id: 'a', problem_number: 774, stem: '본문\n107쪽 유형 11\n0775 다음' }),
      row({ id: 'b', problem_number: 107, stem: '다른 단원 본문' }),
      row({ id: 'c', problem_number: 775, stem: '0775 다음' }),
    ]
    const rebuilt = rebuildStem(catalog[0]!.stem, 774, catalog)
    expect(rebuilt?.text).not.toContain('0775')
    expect(planCloseout([leftover({ problem_id: 'a', current_number: '0774', stem: catalog[0]!.stem })], catalog).applies.every((row) => row.problem_id !== 'b')).toBe(true)
  })

  it('does not overwrite a sibling that already has its own stem', () => {
    const catalog = [
      row({ id: 'a', problem_number: 94, stem: '0094 직육면체\n0095 다항식의 연산' }),
      row({ id: 'b', problem_number: 95, stem: '⑤ 정육면체에 구멍을 뚫은 입체도형의 부피는?' }),
    ]
    const plan = planCloseout([leftover({ problem_id: 'a', current_number: '0094', stem: catalog[0]!.stem })], catalog)
    expect(plan.applies.some((row) => row.problem_id === 'a')).toBe(true)
    expect(plan.applies.some((row) => row.problem_id === 'b')).toBe(false)
  })

  it('protects TEACHER_EDIT', () => {
    const catalog = [
      row({ id: 't', problem_number: 94, teacher_edit: true, stem: '본문\n0095 다항식의 연산' }),
    ]
    const plan = planCloseout(
      [leftover({ problem_id: 't', current_number: '0094', stem: catalog[0]!.stem, teacher_edit: true })],
      catalog,
    )
    expect(plan.applies).toHaveLength(0)
    expect(plan.decisions[0]?.verdict).toBe('HUMAN_FINAL_CHECK')
  })
})
