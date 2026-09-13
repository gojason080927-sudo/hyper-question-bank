import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'
import { dash, ITEM_FORMAT_KO } from '../../lib/outline/instructorLabels'
import { collapseDuplicateHeading } from '../../lib/outline/formatOutlineTitle'
import { toProblemListViewModels } from '../../lib/questions/problemCardModel'
import { ProblemCardList } from './ProblemCardList'
import { ProblemStemDisplay } from './ProblemStemDisplay'

export type ListedProblem = {
  id: string
  public_code: string
  review_status: string
  updated_at: string
  current_version_id: string | null
  version_no: number | null
  problem_text: string
  item_format: string | null
  page_number: number | null
  original_problem_number: string | null
  source_document_id: string | null
  source_title: string | null
  section_title: string | null
  major_title: string | null
  concept_name: string | null
  type_name: string | null
  curriculum_name: string | null
  overall_difficulty: number | null
  difficulty_source: string | null
  bounding_box: { x?: number; y?: number; width?: number; height?: number } | null
}

type ListResult = { total: number; page: number; page_size: number; sort?: string; items: ListedProblem[] }

export function QuestionListPage() {
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<ListedProblem[]>([])
  const [total, setTotal] = useState(0)
  const [sortLabel, setSortLabel] = useState('교재 순서')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [books, setBooks] = useState<Array<{ id: string; title: string }>>([])
  const [selected, setSelected] = useState<string[]>([])
  const [info, setInfo] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const query = params.get('q') ?? ''
  const status = params.get('review') ?? ''
  const sourceId = params.get('source') ?? ''
  const page = Math.max(1, Number(params.get('page') || '1') || 1)
  const pageSize = [20, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 50
  const showTrash = params.get('trash') === '1'
  const format = params.get('format') ?? ''

  function patchParams(next: Record<string, string | number | null>) {
    setParams((current) => {
      const copy = new URLSearchParams(current)
      for (const [key, value] of Object.entries(next)) {
        if (value == null || value === '') copy.delete(key)
        else copy.set(key, String(value))
      }
      return copy
    }, { replace: true })
  }

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      const { data } = await client
        .from('source_documents')
        .select('id,title,is_fixture')
        .is('archived_at', null)
        .order('title')
      setBooks(
        ((data ?? []) as Array<{ id: string; title: string; is_fixture?: boolean }>)
          .filter((row) => !row.is_fixture)
          .map((row) => ({ id: row.id, title: row.title })),
      )
    })()
  }, [])

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      setLoading(true)
      const { data, error: listError } = await client.rpc('hqb_list_problems', {
        payload: {
          page,
          page_size: pageSize,
          query,
          review_status: status || null,
          source_document_id: sourceId || null,
          trash: showTrash,
          listed_only: !showTrash,
          item_format: format || null,
          sort: sourceId ? 'book' : 'updated',
          show_fixtures: false,
        },
      } as never)
      if (listError || !data) {
        setError('문제 목록을 불러오지 못했습니다.')
        setLoading(false)
        return
      }
      const result = data as ListResult
      setRows((result.items ?? []) as ListedProblem[])
      setTotal(result.total ?? 0)
      setSortLabel(result.sort === 'book' ? '교재 페이지·문제번호 순' : '최근 수정 순')
      setError(null)
      setLoading(false)
    })()
  }, [format, page, pageSize, query, showTrash, sourceId, status, tick])

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const filtered = rows
  const cards = useMemo(() => toProblemListViewModels(filtered), [filtered])
  const activeFilters = [
    query ? `검색 ${query}` : null,
    sourceId ? books.find((book) => book.id === sourceId)?.title ?? '교재' : null,
    status ? REVIEW_LABELS[status] ?? status : null,
    format ? ITEM_FORMAT_KO[format] ?? format : null,
    showTrash ? '휴지통' : null,
  ].filter(Boolean) as string[]

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">문제 데이터베이스</p>
          <h1>문제 목록</h1>
          <p className="muted">
            전체 {total.toLocaleString('ko-KR')}문항 · 이 페이지 {filtered.length}개 · 정렬 {sortLabel}
          </p>
        </div>
        <Link className="btn primary" to="/questions/new">
          신규 등록
        </Link>
        <Link className="btn" to={`/sources/${SSEN_SOURCE_DOCUMENT_ID}/browse`}>
          쎈수학 목차
        </Link>
        <Link className="btn" to="/worksheets">
          문제지
        </Link>
      </div>
      <div className="browse-mobile-bar mobile-only">
        <div className="actions">
          <button
            type="button"
            className="btn"
            aria-expanded={filtersOpen}
            aria-controls="question-filters"
            onClick={() => setFiltersOpen((value) => !value)}
          >
            필터{activeFilters.length ? ` (${activeFilters.length})` : ''}
          </button>
        </div>
        {activeFilters.length ? (
          <ul className="filter-chips" aria-label="적용된 필터">
            {activeFilters.map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <form id="question-filters" className={`filters filters-wide ${filtersOpen ? 'is-open' : ''}`} onSubmit={(event) => event.preventDefault()}>
        <input
          placeholder="코드, 문제번호 또는 본문 검색"
          value={query}
          onChange={(event) => patchParams({ q: event.target.value, page: 1 })}
          aria-label="문제 검색"
        />
        <select value={sourceId} onChange={(event) => patchParams({ source: event.target.value, page: 1 })} aria-label="교재">
          <option value="">모든 교재</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <select value={status} onChange={(event) => patchParams({ review: event.target.value, page: 1 })} aria-label="검수 상태">
          <option value="">모든 검수 상태</option>
          {Object.entries(REVIEW_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={format} onChange={(event) => patchParams({ format: event.target.value, page: 1 })} aria-label="문항 형식">
          <option value="">객관식/단답/서술</option>
          {Object.entries(ITEM_FORMAT_KO).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={String(pageSize)} onChange={(event) => patchParams({ size: event.target.value, page: 1 })} aria-label="페이지 크기">
          <option value="20">20개</option>
          <option value="50">50개</option>
          <option value="100">100개</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={showTrash}
            onChange={(event) => patchParams({ trash: event.target.checked ? '1' : null, page: 1 })}
          />
          휴지통
        </label>
      </form>
      {info ? <p className="banner success">{info}</p> : null}
      {selected.length ? (
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const client = getSupabase()
              if (!client) return
              void Promise.all(
                selected.map((id) =>
                  showTrash
                    ? client.rpc('hqb_restore_archived_problem', { p_problem_id: id })
                    : client.rpc('hqb_archive_problem', { p_problem_id: id }),
                ),
              ).then(() => {
                setSelected([])
                setInfo(showTrash ? '보관 해제했습니다.' : '보관(휴지통)으로 옮겼습니다. 원본은 삭제하지 않습니다.')
                setTick((n) => n + 1)
              })
            }}
          >
            {showTrash ? '복원' : '보관'}
          </button>
          <Link className="btn" to="/worksheets">
            선택한 문제는 문제지 화면에서 추가하세요
          </Link>
        </div>
      ) : null}
      {loading ? <p className="muted">목록을 불러오는 중입니다.</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {!loading && filtered.length === 0 ? (
        <p className="banner">등록된 문제가 없거나 필터와 맞는 문제가 없습니다.</p>
      ) : (
        <table className="data-table desktop-only">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={filtered.length > 0 && filtered.every((row) => selected.includes(row.id))}
                  onChange={(event) => setSelected(event.target.checked ? filtered.map((row) => row.id) : [])}
                />
              </th>
              <th>코드</th>
              <th>교재</th>
              <th>페이지</th>
              <th>번호</th>
              <th>대단원</th>
              <th>소단원</th>
              <th>본문</th>
              <th>교육과정</th>
              <th>개념</th>
              <th>유형</th>
              <th>난이도</th>
              <th>검수</th>
              <th>편집</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card, index) => {
              const row = filtered[index]
              if (!row) return null
              return (
                <tr key={card.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${card.publicCode} 선택`}
                      checked={selected.includes(card.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <Link to={`/questions/${card.id}`}>{card.publicCode}</Link>
                  </td>
                  <td>{card.sourceTitle}</td>
                  <td>{dash(card.pageNumber)}</td>
                  <td>{dash(card.originalProblemNumber)}</td>
                  <td>{collapseDuplicateHeading(row.major_title ?? '') || '—'}</td>
                  <td>{collapseDuplicateHeading(row.section_title ?? '') || '—'}</td>
                  <td className="stem-cell">{card.stem ? <ProblemStemDisplay text={card.stem} /> : '—'}</td>
                  <td>{dash(row.curriculum_name)}</td>
                  <td>{dash(row.concept_name)}</td>
                  <td>{card.typeName === '유형 미정' ? dash(row.type_name) : card.typeName}</td>
                  <td>{card.difficultyLabel === '난이도 미정' ? '—' : card.difficultyLabel}</td>
                  <td>
                    <span className={`status-pill ${card.reviewStatus.toLowerCase()}`}>{card.reviewLabel}</span>
                  </td>
                  <td>
                    <Link to={card.editHref} aria-label={`${card.pageLabel} 편집`}>
                      편집
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {!loading && filtered.length ? (
        <ProblemCardList
          items={cards}
          showCheckbox
          checkedIds={selected}
          onToggleCheck={(id, checked) =>
            setSelected((current) => (checked ? [...current, id] : current.filter((value) => value !== id)))
          }
        />
      ) : null}
      <div className="pagination sticky-page">
        <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => patchParams({ page: page - 1 })}>
          이전
        </button>
        <span>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="btn ghost"
          disabled={page >= pageCount}
          onClick={() => patchParams({ page: page + 1 })}
        >
          다음
        </button>
      </div>
    </main>
  )
}
