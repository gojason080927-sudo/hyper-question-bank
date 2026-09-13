import { describe, expect, it } from 'vitest'
import { formatPageProblemLabel, formatUnitPath, toProblemListViewModels, type ProblemListRow } from './problemCardModel'

function row(partial: Partial<ProblemListRow> & Pick<ProblemListRow, 'id'>): ProblemListRow {
  return {
    public_code: `HQB-${partial.id}`,
    review_status: 'UNREVIEWED',
    current_version_id: `v-${partial.id}`,
    problem_text: '식 $x^2+1$',
    page_number: 9,
    original_problem_number: '0001',
    source_title: '쎈수학 공통수학1',
    section_title: '01 다항식의 연산',
    major_title: 'I 다항식',
    type_name: '유형 01 다항식의 덧셈과 뺄셈',
    overall_difficulty: 2,
    difficulty_source: null,
    ...partial,
  }
}

describe('problem list view model', () => {
  it('builds the same display fields for table and card', () => {
    const model = toProblemListViewModels([row({ id: 'a' })])[0]
    expect(model.sourceTitle).toBe('쎈수학 공통수학1')
    expect(model.unitPath).toBe('I 다항식 > 01 다항식의 연산')
    expect(model.pageLabel).toBe('p.9 · 0001번')
    expect(model.stem).toBe('식 $x^2+1$')
    expect(model.selectLabel).toContain('쎈수학 공통수학1')
    expect(model.selectLabel).not.toContain('I I ')
    expect(model.selectLabel).not.toContain('01 01 ')
  })

  it('collapses duplicated unit titles without changing order', () => {
    const rows = [
      row({ id: '1', page_number: 9, original_problem_number: '0001', major_title: 'I I 다항식', section_title: '01 01 다항식의 연산' }),
      row({ id: '2', page_number: 9, original_problem_number: '0002' }),
      row({ id: '3', page_number: 10, original_problem_number: '0003' }),
    ]
    const models = toProblemListViewModels(rows)
    expect(models.map((item) => item.id)).toEqual(['1', '2', '3'])
    expect(models.map((item) => item.originalProblemNumber)).toEqual(['0001', '0002', '0003'])
    expect(models[0]?.unitPath).toBe('I 다항식 > 01 다항식의 연산')
  })

  it('keeps already-correct titles', () => {
    expect(formatUnitPath('I 다항식', '01 다항식의 연산')).toBe('I 다항식 > 01 다항식의 연산')
    expect(formatPageProblemLabel(9, '0001')).toBe('p.9 · 0001번')
  })
})
