import { REVIEW_LABELS } from '../workflow/labels'
import { collapseDuplicateHeading } from '../outline/formatOutlineTitle'

export type ProblemListRow = {
  id: string
  public_code: string
  review_status: string
  current_version_id: string | null
  problem_text: string
  page_number: number | null
  original_problem_number: string | null
  source_title: string | null
  section_title: string | null
  major_title: string | null
  type_name: string | null
  overall_difficulty: number | null
  difficulty_source: string | null
}

export type ProblemListViewModel = {
  id: string
  publicCode: string
  sourceTitle: string
  unitPath: string
  pageLabel: string
  pageNumber: number | null
  originalProblemNumber: string | null
  typeName: string
  difficultyLabel: string
  reviewStatus: string
  reviewLabel: string
  stem: string
  editHref: string
  worksheetHref: string
  selectLabel: string
}

export function formatPageProblemLabel(pageNumber: number | null, originalProblemNumber: string | null): string {
  const page = pageNumber != null ? `p.${pageNumber}` : 'p.—'
  if (!originalProblemNumber) return `${page}번`
  return `${page} · ${originalProblemNumber}번`
}

export function formatUnitPath(majorTitle: string | null | undefined, sectionTitle: string | null | undefined): string {
  const major = collapseDuplicateHeading(majorTitle ?? '')
  const section = collapseDuplicateHeading(sectionTitle ?? '')
  return [major, section].filter(Boolean).join(' > ') || '단원 미지정'
}

export function toProblemListViewModel(row: ProblemListRow): ProblemListViewModel {
  const sourceTitle = row.source_title?.trim() || '교재 미지정'
  const unitPath = formatUnitPath(row.major_title, row.section_title)
  const pageLabel = formatPageProblemLabel(row.page_number, row.original_problem_number)
  const difficultyLabel =
    row.overall_difficulty != null
      ? `${Number(row.overall_difficulty).toFixed(1)}${row.difficulty_source === 'MODEL' ? ' (자동)' : ''}`
      : '난이도 미정'
  const reviewLabel = REVIEW_LABELS[row.review_status] ?? row.review_status
  return {
    id: row.id,
    publicCode: row.public_code,
    sourceTitle,
    unitPath,
    pageLabel,
    pageNumber: row.page_number,
    originalProblemNumber: row.original_problem_number,
    typeName: collapseDuplicateHeading(row.type_name?.trim() || '') || '유형 미정',
    difficultyLabel,
    reviewStatus: row.review_status,
    reviewLabel,
    stem: row.problem_text ?? '',
    editHref: `/questions/${row.id}/edit`,
    worksheetHref: `/worksheets/new?problemId=${row.id}&versionId=${row.current_version_id ?? ''}`,
    selectLabel: `${sourceTitle} ${pageLabel} ${unitPath}`,
  }
}

/** Preserve incoming order (server already sorts page → original_problem_number). */
export function toProblemListViewModels(rows: ProblemListRow[]): ProblemListViewModel[] {
  return rows.map(toProblemListViewModel)
}
