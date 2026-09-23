import { describe, expect, it } from 'vitest'
import {
  answerQuality,
  classifyAnswerType,
  matchExtracts,
  parseQuickKeyPage,
  parseReprintExplainPage,
  stemOverlap,
} from './cm2AnswerRecover'

const GANYEOM_P294 = `
빠른 정답 찾기
$$143 \\frac{121}{5}$$
$$144 3x - 4y + 5 = 0, x = 1$$
$$145 \\frac{3}{2} \\quad 146 \\text{ ④}$$
• 본책 66~95쪽
# 원의 방정식
149 (1) 중심의 좌표: (0, 0), 반지름의 길이: $\\sqrt{11}$
(2) 중심의 좌표: (5, 0), 반지름의 길이: 3
$$150 (1) x^2 + y^2 = 9$$
294
`

const GANYEOM_PAIRS = `빠른 정답 찾기
200 50 201 14
202 -6 203 $\\frac{33}{2}$
`

const GANYEOM_P292 = `
빠른 정답 찾기
1 $\\sqrt{5}$ 2 7, 13
3 2 4 $\\frac{2\\sqrt{10}}{3}$
5 3 6 (1, 4)
7 1 8 1 9 5
10 32 11 9 12 8
13 풀이 3쪽 14 풀이 4쪽
`

const GANYEOM_TOC = `
### 빠른 정답 찾기
본책 뒤에 제시된 '빠른 정답 찾기'를 이용하면 정답을 빠르게 확인하고 채점할 수 있습니다.
`

const TYPELEVEL_DRILL = `
• 정답과 해설 2쪽
[0001~0004] 수직선 위의 다음 두 점 사이의 거리를 구하시오.
0001 A(2), B(6) 4
0004 A(-2), B(-8) 6
[0005~0008] 좌표평면 위의 다음 두 점 사이의 거리를 구하시오.
0005 A(-1, 1), B(3, 4) 5
`

const WANJA_P7 = `
정답과 해설 2쪽 ▶▶
# 0007
두 점 A(t, -4), B(-2, -t)에 대하여 선분 AB의 길이가 최소가 되도록 하는 t의 값은?
① -2 ② -1 ③ 0
√④ 1 ⑤ 2
따라서 선분 AB의 길이는 t=1일 때 최소이다.
# 0008
두 점 A(1, 4), B(4, 7)에서 같은 거리에 있는 x축 위의 점을 P, y축 위의 점을 Q라 할 때, 선분 PQ의 길이를 구하시오. 8√2
P(a, 0)이라 하면 AP = BP에서
`

const TYPELEVEL_P11 = `
• 정답과 해설 2쪽
# 0028 ③
두 점 A(2, 4), B(6, 8)에서 같은 거리에 있는 x축 위의 점 P와 y축 위의 점 Q에 대하여 선분 PQ의 길이를 구하시오. 10√2
P(a, 0)이라 하면 AP=BP에서
# 0029 ③
세 점 A(1, 2), B(0, -1), C(4, 3)을 꼭짓점으로 하는 삼각형 ABC의 외심을 P(a, b)라 할 때, a-b의 값은?
① 1 ② 2 ③ 3
☑ ④ 4 ⑤ 5
점 P(a, b)가 삼각형 ABC의 외심이므로
`

describe('cm2 answer recover', () => {
  it('parses 개념원리 quick-key pairs and multi-part answers', () => {
    const rows = [...parseQuickKeyPage(GANYEOM_P294, 294, 304), ...parseQuickKeyPage(GANYEOM_PAIRS, 295, 304)]
    const by = Object.fromEntries(rows.map((row) => [row.number, row.answer_text]))
    expect(by['0143']).toContain('121')
    expect(by['0146']).toContain('④')
    expect(by['0149']).toContain('(1)')
    expect(by['0200']).toBe('50')
    expect(by['0201']).toBe('14')
    expect(rows.every((row) => row.explanation === null)).toBe(true)
  })

  it('does not parse 빠른 정답 TOC pages and keeps pair values out of problem numbers', () => {
    expect(parseQuickKeyPage(GANYEOM_TOC, 5, 304)).toEqual([])
    const rows = parseQuickKeyPage(GANYEOM_P292, 292, 304)
    const by = Object.fromEntries(rows.map((row) => [row.number, row.answer_text]))
    expect(by['0001']).toContain('sqrt')
    expect(by['0002']).toBe('7, 13')
    expect(by['0005']).toBe('3')
    expect(by['0006']).toContain('1, 4')
    expect(by['0007']).toBe('1')
    expect(by['0013']).toContain('풀이')
  })

  it('reviews pointer answers instead of AUTO-saving 풀이 n쪽', () => {
    const extracts = parseQuickKeyPage(GANYEOM_P292, 292, 304).filter((row) => row.number === '0013')
    const matches = matchExtracts(
      extracts,
      [{ problem_id: 'p13', version_id: 'v13', number: '0013', problem_text: '13 다음 명제의 참 거짓을 판별하시오.' }],
      'doc',
    )
    expect(matches[0]?.verdict).toBe('REVIEW')
    expect(matches[0]?.reasons).toContain('POINTER_ANSWER')
    expect(matches[0]?.payload).toBeNull()
  })

  it('splits 완자 reprint pages and keeps marked choices', () => {
    const rows = parseReprintExplainPage(WANJA_P7, 7, false)
    expect(rows.map((row) => row.number)).toEqual(['0007', '0008'])
    expect(rows[0]?.answer_text).toBe('④')
    expect(rows[0]?.answer_type).toBe('CHOICE_LABEL')
    expect(rows[1]?.answer_text).toContain('8√2')
    expect(rows[0]?.explanation).toContain('따라서')
    expect(rows[0]?.reprint_stem).toContain('선분 AB')
  })

  it('splits 유형만렙 multi-item pages without treating heading ③ as the answer', () => {
    const rows = parseReprintExplainPage(TYPELEVEL_P11, 11, false)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.answer_text).toContain('10√2')
    expect(rows[1]?.answer_text).toBe('④')
  })

  it('matches unique overlapping stems as AUTO and duplicate numbers as REVIEW', () => {
    const extracts = parseReprintExplainPage(WANJA_P7, 7, false)
    const registered = [
      {
        problem_id: 'p7',
        version_id: 'v7',
        number: '0007',
        problem_text: '두 점 A(t, -4), B(-2, -t)에 대하여 선분 AB의 길이가 최소가 되도록 하는 t의 값은?',
      },
      {
        problem_id: 'p8a',
        version_id: 'v8a',
        number: '0008',
        problem_text: '완전히 다른 집합 문제',
      },
      {
        problem_id: 'p8b',
        version_id: 'v8b',
        number: '0008',
        problem_text: '두 점 A(1, 4), B(4, 7)에서 같은 거리에 있는 x축 위의 점을 P라 할 때',
      },
    ]
    const matches = matchExtracts(extracts, registered, 'doc')
    expect(matches[0]?.verdict).toBe('AUTO')
    expect(matches[0]?.payload?.answer).toMatchObject({ answer_text: '④' })
    expect((matches[0]?.payload?.explanation as { explanation_type: string }).explanation_type).toBe('ORIGINAL')
    expect(matches[1]?.verdict).toBe('AUTO')
    expect(matches[1]?.problem_id).toBe('p8b')
    expect(matches[1]?.reasons).toContain('DUPLICATE_NUMBER')
  })

  it('keeps ambiguous duplicate stems in REVIEW', () => {
    const extracts = parseReprintExplainPage(WANJA_P7, 7, false).slice(0, 1)
    const matches = matchExtracts(
      extracts,
      [
        {
          problem_id: 'a',
          version_id: 'va',
          number: '0007',
          problem_text: '두 점 A(t, -4), B(-2, -t)에 대하여 선분 AB의 길이가 최소가 되도록 하는 t의 값은?',
        },
        {
          problem_id: 'b',
          version_id: 'vb',
          number: '0007',
          problem_text: '두 점 A(t, -4), B(-2, -t)에 대하여 선분 AB의 길이가 최소가 되도록 하는 t의 값은? 다른 보기',
        },
      ],
      'doc',
    )
    expect(matches[0]?.verdict).toBe('REVIEW')
    expect(matches[0]?.reasons).toContain('AMBIGUOUS_DUPLICATE')
    expect(matches[0]?.payload).toBeNull()
  })

  it('splits typelevel drill lines and ignores [0001~0004] range headers', () => {
    const rows = parseReprintExplainPage(TYPELEVEL_DRILL, 9, false)
    expect(rows.map((row) => row.number)).toEqual(['0001', '0004', '0005'])
    expect(rows[0]?.answer_text).toBe('4')
    expect(rows[1]?.answer_text).toBe('6')
    expect(rows[0]?.reprint_stem).toContain('A(2)')
    expect(rows[1]?.reprint_stem).not.toContain('0005')
  })

  it('does not AUTO-match a unique number when reprint stem disagrees', () => {
    const overlap = stemOverlap('좌표평면 위의 두 점 A(2, 4)', '집합 A의 원소의 개수를 구하시오')
    expect(overlap).toBeLessThan(0.6)
    expect(classifyAnswerType('④')).toBe('CHOICE_LABEL')
  })

  it('treats short reprint stems as the same problem and does not flag \\pi as truncated', () => {
    expect(stemOverlap('다음 중 원의 방정식인 것은?', '0214 다음 중 원의 방정식인 것은? ① x²+y²=1')).toBe(1)
    expect(stemOverlap('A(2), B(6) 4', '[0001~0004] 수직선 위의 다음 두 점 사이의 거리를 구하시오. 0001 A(2), B(6) 4')).toBe(1)
    expect(answerQuality('10\\pi')).toBeNull()
    expect(answerQuality('\\frac{85}{8}\\pi')).toBeNull()
    expect(answerQuality('\\sqrt{')).toBe('TRUNCATED_ANSWER')
    const rows = parseReprintExplainPage(
      `정답과 해설\n# 0085\n세 점 A, B, C의 x좌표의 합을 구하시오. 18 (가) 삼각형 ABC의 넓이는 $$6\\sqrt{3}$$이다.\n`,
      21,
      false,
    )
    expect(rows[0]?.answer_text).toBe('18')
  })
})
