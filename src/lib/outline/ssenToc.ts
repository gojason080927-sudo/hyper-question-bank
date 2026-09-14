/** Frozen 쎈수학 공통수학1 TOC from the uploaded PDF (physical page 6 차례). */

export const SSEN_SOURCE_DOCUMENT_ID = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const SSEN_TITLE = '쎈수학 공통수학1'
export const SSEN_LAST_PAGE = 192

export type OutlineLevel = 'BOOK' | 'MAJOR_UNIT' | 'SECTION' | 'TYPE_SEGMENT'

export type FrozenSection = {
  code: string
  title: string
  printStart: number
  pdfStart: number
  majorCode: string
}

export type FrozenMajor = {
  code: string
  title: string
  roman: string
}

/** PDF page 6 차례, print page = PDF page. */
export const SSEN_MAJORS: FrozenMajor[] = [
  { code: 'I', roman: 'I', title: '다항식' },
  { code: 'II', roman: 'II', title: '방정식' },
  { code: 'III', roman: 'III', title: '부등식' },
  { code: 'IV', roman: 'IV', title: '순열과 조합' },
  { code: 'V', roman: 'V', title: '행렬' },
]

export const SSEN_SECTIONS: FrozenSection[] = [
  { code: '01', title: '다항식의 연산', printStart: 8, pdfStart: 8, majorCode: 'I' },
  { code: '02', title: '나머지 정리와 인수분해', printStart: 24, pdfStart: 24, majorCode: 'I' },
  { code: '03', title: '복소수', printStart: 46, pdfStart: 46, majorCode: 'II' },
  { code: '04', title: '이차방정식', printStart: 62, pdfStart: 62, majorCode: 'II' },
  { code: '05', title: '이차방정식과 이차함수', printStart: 82, pdfStart: 82, majorCode: 'II' },
  { code: '06', title: '여러 가지 방정식', printStart: 98, pdfStart: 98, majorCode: 'II' },
  { code: '07', title: '일차부등식', printStart: 116, pdfStart: 116, majorCode: 'III' },
  { code: '08', title: '이차부등식', printStart: 130, pdfStart: 130, majorCode: 'III' },
  { code: '09', title: '순열과 조합', printStart: 150, pdfStart: 150, majorCode: 'IV' },
  { code: '10', title: '행렬과 그 연산', printStart: 174, pdfStart: 174, majorCode: 'V' },
]

export type FrozenType = { sectionCode: string; typeCode: string; title: string; evidencePage: number }

/** Type titles from unit index pages (PDF 7, 45, 115, 149, 173). */
export const SSEN_TYPE_INDEX_PAGES = { I: 7, II: 45, III: 115, IV: 149, V: 173 } as const

export const SSEN_TYPES: FrozenType[] = [
  { sectionCode: '01', typeCode: '01', title: '다항식의 덧셈과 뺄셈', evidencePage: 7 },
  { sectionCode: '01', typeCode: '02', title: '다항식의 전개식에서 계수 구하기', evidencePage: 7 },
  { sectionCode: '01', typeCode: '03', title: '곱셈 공식을 이용한 다항식의 전개', evidencePage: 7 },
  { sectionCode: '01', typeCode: '04', title: '공통부분이 있는 다항식의 전개', evidencePage: 7 },
  { sectionCode: '01', typeCode: '05', title: '곱셈 공식의 변형: x²+y², x³+y³의 값', evidencePage: 7 },
  { sectionCode: '01', typeCode: '06', title: '곱셈 공식의 변형: x²+1/x², x³+1/x³의 값', evidencePage: 7 },
  { sectionCode: '01', typeCode: '07', title: '곱셈 공식의 변형: a²+b²+c², a³+b³+c³의 값', evidencePage: 7 },
  { sectionCode: '01', typeCode: '08', title: '곱셈 공식을 이용한 수의 계산', evidencePage: 7 },
  { sectionCode: '01', typeCode: '09', title: '다항식의 나눗셈: 몫과 나머지', evidencePage: 7 },
  { sectionCode: '01', typeCode: '10', title: '다항식의 나눗셈: A=BQ+R', evidencePage: 7 },
  { sectionCode: '01', typeCode: '11', title: '몫과 나머지의 변형', evidencePage: 7 },
  { sectionCode: '01', typeCode: '12', title: '다항식의 연산의 도형에의 활용', evidencePage: 7 },
  { sectionCode: '02', typeCode: '01', title: '계수 비교법', evidencePage: 7 },
  { sectionCode: '02', typeCode: '02', title: '수치 대입법', evidencePage: 7 },
  { sectionCode: '02', typeCode: '03', title: '항등식의 성질', evidencePage: 7 },
  { sectionCode: '02', typeCode: '04', title: '항등식에서 계수의 합 구하기', evidencePage: 7 },
  { sectionCode: '02', typeCode: '05', title: '다항식의 나눗셈과 항등식', evidencePage: 7 },
  { sectionCode: '02', typeCode: '06', title: '일차식으로 나누었을 때의 나머지', evidencePage: 7 },
  { sectionCode: '02', typeCode: '07', title: '일차식으로 나누었을 때의 나머지; 미정계수 구하기', evidencePage: 7 },
  { sectionCode: '02', typeCode: '08', title: '이차식으로 나누었을 때의 나머지', evidencePage: 7 },
  { sectionCode: '02', typeCode: '09', title: '삼차식으로 나누었을 때의 나머지', evidencePage: 7 },
  { sectionCode: '02', typeCode: '10', title: 'P(ax+b)를 x-a로 나누었을 때의 나머지', evidencePage: 7 },
  { sectionCode: '02', typeCode: '11', title: '몫 Q(x)를 x-a로 나누었을 때의 나머지', evidencePage: 7 },
  { sectionCode: '02', typeCode: '12', title: '나머지 정리를 활용한 수의 나눗셈', evidencePage: 7 },
  { sectionCode: '02', typeCode: '13', title: '일차식으로 나누어떨어지는 다항식', evidencePage: 7 },
  { sectionCode: '02', typeCode: '14', title: '이차식으로 나누어떨어지는 다항식', evidencePage: 7 },
  { sectionCode: '02', typeCode: '15', title: '조립제법', evidencePage: 7 },
  { sectionCode: '02', typeCode: '16', title: '조립제법을 이용하여 항등식의 미정계수 구하기', evidencePage: 7 },
  { sectionCode: '02', typeCode: '17', title: '인수분해 공식을 이용한 다항식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '18', title: '공통부분이 있는 다항식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '19', title: 'x³+ax²+b 꼴의 다항식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '20', title: '여러 개의 문자를 포함한 다항식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '21', title: '인수 정리를 이용한 다항식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '22', title: '계수가 대칭인 사차식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '23', title: '조건이 주어진 다항식의 인수분해', evidencePage: 7 },
  { sectionCode: '02', typeCode: '24', title: '인수분해와 삼각형의 모양', evidencePage: 7 },
  { sectionCode: '02', typeCode: '25', title: '인수분해를 이용하여 식의 값 구하기', evidencePage: 7 },
  { sectionCode: '02', typeCode: '26', title: '인수분해를 이용한 복잡한 수의 계산', evidencePage: 7 },
  { sectionCode: '03', typeCode: '01', title: '복소수의 뜻과 분류', evidencePage: 45 },
  { sectionCode: '03', typeCode: '02', title: '복소수의 사칙연산', evidencePage: 45 },
  { sectionCode: '03', typeCode: '03', title: '복소수가 주어질 때의 식의 값 구하기', evidencePage: 45 },
  { sectionCode: '03', typeCode: '04', title: '복소수 z 또는 z̅이 실수가 되기 위한 조건', evidencePage: 45 },
  { sectionCode: '03', typeCode: '05', title: '복소수가 서로 같을 조건', evidencePage: 45 },
  { sectionCode: '03', typeCode: '06', title: '켤레복소수의 계산', evidencePage: 45 },
  { sectionCode: '03', typeCode: '07', title: '켤레복소수의 성질', evidencePage: 45 },
  { sectionCode: '03', typeCode: '08', title: '켤레복소수의 성질을 이용한 계산', evidencePage: 45 },
  { sectionCode: '03', typeCode: '09', title: '조건을 만족시키는 복소수 구하기', evidencePage: 45 },
  { sectionCode: '03', typeCode: '10', title: '허수단위 i의 거듭제곱', evidencePage: 45 },
  { sectionCode: '03', typeCode: '11', title: '복소수의 거듭제곱', evidencePage: 45 },
  { sectionCode: '03', typeCode: '12', title: '음수의 제곱근의 계산', evidencePage: 45 },
  { sectionCode: '03', typeCode: '13', title: '음수의 제곱근의 성질', evidencePage: 45 },
  { sectionCode: '04', typeCode: '01', title: '이차방정식의 풀이', evidencePage: 45 },
  { sectionCode: '04', typeCode: '02', title: '한 근이 주어진 이차방정식', evidencePage: 45 },
  { sectionCode: '05', typeCode: '01', title: '이차함수의 그래프와 x축의 교점', evidencePage: 45 },
  { sectionCode: '05', typeCode: '02', title: '이차함수의 그래프와 x축의 위치 관계', evidencePage: 45 },
  { sectionCode: '06', typeCode: '01', title: '삼차방정식과 사차방정식의 풀이', evidencePage: 45 },
  { sectionCode: '06', typeCode: '02', title: '공통부분이 있는 사차방정식의 풀이', evidencePage: 45 },
  { sectionCode: '07', typeCode: '01', title: '부등식의 기본 성질', evidencePage: 115 },
  { sectionCode: '07', typeCode: '02', title: '부등식 ax>b의 풀이', evidencePage: 115 },
  { sectionCode: '07', typeCode: '03', title: '연립일차부등식의 풀이', evidencePage: 115 },
  { sectionCode: '08', typeCode: '01', title: '그래프를 이용한 부등식의 풀이', evidencePage: 115 },
  { sectionCode: '08', typeCode: '02', title: '이차부등식의 풀이', evidencePage: 115 },
  { sectionCode: '09', typeCode: '01', title: '합의 법칙', evidencePage: 149 },
  { sectionCode: '09', typeCode: '02', title: '방정식과 부등식의 해의 개수', evidencePage: 149 },
  { sectionCode: '09', typeCode: '03', title: '곱의 법칙', evidencePage: 149 },
  { sectionCode: '10', typeCode: '01', title: '행렬의 (i, j)성분', evidencePage: 173 },
  { sectionCode: '10', typeCode: '02', title: '두 행렬이 서로 같을 조건', evidencePage: 173 },
  { sectionCode: '10', typeCode: '03', title: '행렬의 덧셈, 뺄셈, 실수배', evidencePage: 173 },
]

export function sectionPageEnd(section: FrozenSection, all = SSEN_SECTIONS, lastPage = SSEN_LAST_PAGE): number {
  const index = all.findIndex((row) => row.code === section.code)
  const next = all[index + 1]
  return (next?.pdfStart ?? lastPage + 1) - 1
}

export function majorPageRange(majorCode: string, all = SSEN_SECTIONS, lastPage = SSEN_LAST_PAGE): { start: number; end: number } {
  const rows = all.filter((row) => row.majorCode === majorCode)
  const start = rows[0]?.pdfStart ?? 1
  const last = rows[rows.length - 1]
  return { start, end: last ? sectionPageEnd(last, all, lastPage) : lastPage }
}

export function sectionForPage(page: number, all = SSEN_SECTIONS): FrozenSection | null {
  for (const row of all) {
    if (page >= row.pdfStart && page <= sectionPageEnd(row, all)) return row
  }
  return null
}

export function parseTypeMarker(text: string): string | null {
  const match = text.match(/유형\s*0?(\d{1,2})/)
  return match ? match[1].padStart(2, '0') : null
}

export function isFixtureSource(row: { title?: string | null; document_type?: string | null; original_filename?: string | null }): boolean {
  const blob = `${row.title ?? ''} ${row.original_filename ?? ''} ${row.document_type ?? ''}`
  return /STEP\s*\d|fixture|regression|Internal STEP|Production UI Test|do not use/i.test(blob)
}

export function parseProblemNumbers(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\b(\d{3,4})\b/g)) {
    const n = Number(match[1])
    if (n >= 1 && n <= 2000) found.add(match[1].padStart(4, '0'))
  }
  const range = text.match(/\[(\d{3,4})\s*[~～-]\s*(\d{3,4})\]/)
  if (range) {
    found.add(range[1].padStart(4, '0'))
    found.add(range[2].padStart(4, '0'))
  }
  return [...found]
}

export function looksMergedStem(text: string): boolean {
  if (/\[[0-9]{3,4}\s*[~～-]\s*[0-9]{3,4}\]/.test(text)) return true
  const nums = parseProblemNumbers(text)
  return nums.length >= 2 && nums[0] !== nums[1]
}

export function bboxTop(box: unknown): number {
  if (!box || typeof box !== 'object') return 0
  const row = box as Record<string, number>
  if (typeof row.y === 'number') return row.y
  if (typeof row.top === 'number') return row.top
  if (typeof row.y0 === 'number') return row.y0
  return 0
}

export function bboxX(box: unknown): number {
  if (!box || typeof box !== 'object') return 0
  const row = box as Record<string, number>
  if (typeof row.x === 'number') return row.x
  if (typeof row.left === 'number') return row.left
  if (typeof row.x0 === 'number') return row.x0
  return 0
}

export function bboxH(box: unknown): number {
  if (!box || typeof box !== 'object') return 0
  const row = box as Record<string, number>
  if (typeof row.height === 'number') return row.height
  if (typeof row.h === 'number') return row.h
  return 0
}
