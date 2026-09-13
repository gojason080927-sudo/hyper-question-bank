export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297

export type ExamKind = 'EXAM' | 'ANSWER_SHEET'

export type WorksheetHeader = {
  title: string
  school: string
  grade: string
  examName: string
  studentNameLabel: string
}

export type A4Layout = {
  columns: 1 | 2
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  fontSizePt: number
  lineHeight: number
  header: WorksheetHeader
  examKind: ExamKind
}

export type WorksheetItemModel = {
  id: string
  problemId: string
  versionId: string
  orderNo: number
  points: number | null
  spacingMm: number | null
  forcePageBreak: boolean
  stem: string
  hasFigure: boolean
  figureHeightMm: number
  choiceCount: number
  explanation: string
  answer: string
}

export type LaidOutItem = WorksheetItemModel & {
  number: number
  heightMm: number
  column: 0 | 1
}

export type A4Page = {
  pageNo: number
  columns: [LaidOutItem[], LaidOutItem[]]
}

export const DEFAULT_A4_LAYOUT: A4Layout = {
  columns: 1,
  marginTopMm: 18,
  marginRightMm: 14,
  marginBottomMm: 16,
  marginLeftMm: 14,
  fontSizePt: 11,
  lineHeight: 1.45,
  header: {
    title: 'HYPER 문제지',
    school: '',
    grade: '',
    examName: '',
    studentNameLabel: '이름',
  },
  examKind: 'EXAM',
}

export function usableHeightMm(layout: A4Layout): number {
  const headerMm = 22
  return A4_HEIGHT_MM - layout.marginTopMm - layout.marginBottomMm - headerMm
}

export function usableWidthMm(layout: A4Layout): number {
  const gap = layout.columns === 2 ? 8 : 0
  return A4_WIDTH_MM - layout.marginLeftMm - layout.marginRightMm - gap
}

export function estimateItemHeightMm(item: WorksheetItemModel, layout: A4Layout): number {
  const charsPerLine = Math.max(12, Math.floor((usableWidthMm(layout) / layout.columns) / (layout.fontSizePt * 0.35)))
  const stemLines = Math.max(1, Math.ceil(item.stem.length / charsPerLine))
  const choiceLines = layout.examKind === 'EXAM' ? item.choiceCount : 0
  const extra =
    layout.examKind === 'ANSWER_SHEET'
      ? Math.ceil((item.answer.length + item.explanation.length) / charsPerLine)
      : 0
  const figure = item.hasFigure ? item.figureHeightMm : 0
  const spacing = item.spacingMm ?? 6
  const mmPerLine = layout.fontSizePt * layout.lineHeight * 0.3528
  return Math.min(
    usableHeightMm(layout),
    stemLines * mmPerLine + choiceLines * mmPerLine + extra * mmPerLine + figure + spacing + 8,
  )
}

export function paginateItems(items: WorksheetItemModel[], layout: A4Layout): A4Page[] {
  const pages: A4Page[] = []
  const limit = usableHeightMm(layout)
  let page: A4Page = { pageNo: 1, columns: [[], []] }
  const used = [0, 0]

  function flush(): void {
    if (page.columns[0].length || page.columns[1].length) {
      pages.push(page)
      page = { pageNo: pages.length + 1, columns: [[], []] }
      used[0] = 0
      used[1] = 0
    }
  }

  items.forEach((item, index) => {
    const height = estimateItemHeightMm(item, layout)
    if (item.forcePageBreak && (page.columns[0].length || page.columns[1].length)) flush()
    const target: 0 | 1 = layout.columns === 2 && used[0] > used[1] ? 1 : 0
    if (used[target] + height > limit && (page.columns[0].length || page.columns[1].length)) {
      flush()
    }
    const column: 0 | 1 = layout.columns === 2 && used[0] > used[1] ? 1 : 0
    const laid: LaidOutItem = { ...item, number: index + 1, heightMm: height, column }
    page.columns[column].push(laid)
    used[column] += height
  })
  flush()
  return pages
}

export function figureStaysWithProblem(pages: A4Page[]): boolean {
  return pages.every((page) =>
    page.columns.every((col) => col.every((item) => !item.hasFigure || item.heightMm <= usableHeightMm(DEFAULT_A4_LAYOUT) + 0.01)),
  )
}
