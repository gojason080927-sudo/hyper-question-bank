import { describe, expect, it } from 'vitest'
import { collapseDuplicateHeading, formatOutlinePath, formatOutlineTitle } from './formatOutlineTitle'

describe('collapseDuplicateHeading', () => {
  it('removes duplicated roman, arabic, and 유형 prefixes', () => {
    expect(collapseDuplicateHeading('I I 다항식')).toBe('I 다항식')
    expect(collapseDuplicateHeading('II II 방정식')).toBe('II 방정식')
    expect(collapseDuplicateHeading('01 01 다항식의 연산')).toBe('01 다항식의 연산')
    expect(collapseDuplicateHeading('유형 01 유형 01 다항식의 덧셈과 뺄셈')).toBe('유형 01 다항식의 덧셈과 뺄셈')
  })

  it('does not strip a correct printed title', () => {
    expect(collapseDuplicateHeading('I 다항식')).toBe('I 다항식')
    expect(collapseDuplicateHeading('01 다항식의 연산')).toBe('01 다항식의 연산')
    expect(collapseDuplicateHeading('유형 01 다항식의 덧셈과 뺄셈')).toBe('유형 01 다항식의 덧셈과 뺄셈')
    expect(collapseDuplicateHeading('다항식의 연산')).toBe('다항식의 연산')
    expect(collapseDuplicateHeading('02 나머지 정리와 인수분해')).toBe('02 나머지 정리와 인수분해')
    expect(collapseDuplicateHeading('10 행렬과 그 연산')).toBe('10 행렬과 그 연산')
  })
})

describe('formatOutlineTitle', () => {
  it('does not double-prefix when the stored title already includes the code', () => {
    expect(formatOutlineTitle('I', 'I 다항식', 'MAJOR_UNIT')).toBe('I 다항식')
    expect(formatOutlineTitle('01', '01 다항식의 연산', 'SECTION')).toBe('01 다항식의 연산')
    expect(formatOutlineTitle('01', '유형 01 다항식의 덧셈과 뺄셈', 'TYPE_SEGMENT')).toBe(
      '유형 01 다항식의 덧셈과 뺄셈',
    )
  })

  it('adds a missing code without damaging the rest of the title', () => {
    expect(formatOutlineTitle('I', '다항식', 'MAJOR_UNIT')).toBe('I 다항식')
    expect(formatOutlineTitle('01', '다항식의 연산', 'SECTION')).toBe('01 다항식의 연산')
    expect(formatOutlineTitle('01', '다항식의 덧셈과 뺄셈', 'TYPE_SEGMENT')).toBe('유형 01 다항식의 덧셈과 뺄셈')
  })

  it('collapses concatenated display strings from the old tree renderer', () => {
    expect(formatOutlineTitle('I', 'I 다항식')).toBe('I 다항식')
    expect(collapseDuplicateHeading(`${'I'} ${'I 다항식'}`)).toBe('I 다항식')
    expect(collapseDuplicateHeading(`${'01'} ${'01 다항식의 연산'}`)).toBe('01 다항식의 연산')
    expect(collapseDuplicateHeading(`유형 ${'01'} ${'유형 01 다항식의 덧셈과 뺄셈'}`)).toBe(
      '유형 01 다항식의 덧셈과 뺄셈',
    )
  })
})

describe('formatOutlinePath', () => {
  it('joins ancestor titles without duplicated codes', () => {
    const nodes = [
      { id: 'book', parent_id: null, node_level: 'BOOK', code: null, title_normalized: '쎈수학 공통수학1' },
      { id: 'm', parent_id: 'book', node_level: 'MAJOR_UNIT', code: 'I', title_normalized: 'I 다항식' },
      { id: 's', parent_id: 'm', node_level: 'SECTION', code: '01', title_normalized: '01 다항식의 연산' },
    ]
    expect(formatOutlinePath(nodes, 's')).toBe('I 다항식 > 01 다항식의 연산')
    expect(formatOutlinePath(nodes, null)).toBe('전체')
  })
})
