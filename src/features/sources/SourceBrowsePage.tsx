import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { SIGNED_URL_TTL_SEC, SOURCE_BUCKET } from '../../lib/pdf/constants'
import { PdfPageViewer } from './PdfPageViewer'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { dash, ITEM_FORMAT_KO } from '../../lib/outline/instructorLabels'
import type { ListedProblem } from '../questions/QuestionListPage'
import type { SourceRegion } from './types'

type OutlineNode = {
  id: string
  parent_id: string | null
  node_level: string
  code: string | null
  title_original: string
  title_normalized: string
  sort_order: number
  pdf_page_start: number | null
  pdf_page_end: number | null
  listed_count: number
}

type ListResult = { total: number; page: number; page_size: number; sort?: string; items: ListedProblem[] }

export function SourceBrowsePage() {
  const { documentId } = useParams()
  const [params, setParams] = useSearchParams()
  const [nodes, setNodes] = useState<OutlineNode[]>([])
  const [title, setTitle] = useState('교재')
  const [rows, setRows] = useState<ListedProblem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ListedProblem | null>(null)
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [fullPage, setFullPage] = useState(false)

  const outlineId = params.get('unit') ?? ''
  const review = params.get('review') ?? ''
  const format = params.get('format') ?? ''
  const query = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') || '1') || 1)
  const pageSize = [20, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 50
  const numberQ = params.get('num') ?? ''
  const pageFrom = params.get('pfrom') ?? ''
  const pageTo = params.get('pto') ?? ''

  function patch(next: Record<string, string | number | null>) {
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
    if (!client || !documentId) return
    void (async () => {
      const outline = await client.rpc('hqb_list_source_outline', { p_document_id: documentId })
      const doc = await client.from('source_documents').select('title,storage_path,storage_bucket').eq('id', documentId).maybeSingle()
      if (outline.error) {
        setError('목차를 불러오지 못했습니다.')
        return
      }
      const payload = outline.data as { nodes?: OutlineNode[] }
      setNodes(payload.nodes ?? [])
      if (doc.data?.title) setTitle(doc.data.title)
      if (doc.data?.storage_path) {
        const signed = await client.storage
          .from(doc.data.storage_bucket || SOURCE_BUCKET)
          .createSignedUrl(doc.data.storage_path, SIGNED_URL_TTL_SEC)
        if (signed.data?.signedUrl) {
          const response = await fetch(signed.data.signedUrl)
          if (response.ok) setPdfData(await response.arrayBuffer())
        }
      }
    })()
  }, [documentId])

  useEffect(() => {
    const client = getSupabase()
    if (!client || !documentId) return
    void (async () => {
      setLoading(true)
      const { data, error: listError } = await client.rpc('hqb_list_problems', {
        payload: {
          page,
          page_size: pageSize,
          source_document_id: documentId,
          outline_node_id: outlineId || null,
          query,
          review_status: review || null,
          item_format: format || null,
          original_problem_number: numberQ || null,
          page_from: pageFrom || null,
          page_to: pageTo || null,
          sort: 'book',
          listed_only: true,
          show_fixtures: true,
        },
      } as never)
      if (listError || !data) {
        setError('문제 목록을 불러오지 못했습니다.')
        setLoading(false)
        return
      }
      const result = data as ListResult
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setSelected((current) => result.items?.find((row) => row.id === current?.id) ?? result.items?.[0] ?? null)
      setError(null)
      setLoading(false)
    })()
  }, [documentId, format, numberQ, outlineId, page, pageFrom, pageSize, pageTo, query, review])

  const majors = nodes.filter((row) => row.node_level === 'MAJOR_UNIT')
  const sectionsOf = (majorId: string) => nodes.filter((row) => row.parent_id === majorId && row.node_level === 'SECTION')
  const typesOf = (sectionId: string) => nodes.filter((row) => row.parent_id === sectionId && row.node_level === 'TYPE_SEGMENT')
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selectedIndex = rows.findIndex((row) => row.id === selected?.id)
  const regions: SourceRegion[] =
    !fullPage && selected?.bounding_box
      ? [
          {
            id: 'crop',
            source_document_id: documentId ?? '',
            source_page_id: 'crop',
            bbox: {
              x: selected.bounding_box.x ?? 0,
              y: selected.bounding_box.y ?? 0,
              width: selected.bounding_box.width ?? 1,
              height: selected.bounding_box.height ?? 1,
              unit: 'normalized',
              origin: 'top-left',
            },
            status: 'LINKED',
            original_problem_number: selected.original_problem_number,
            extracted_text_preview: null,
            created_at: '',
          },
        ]
      : []

  const activeNode = nodes.find((row) => row.id === outlineId)
  const bookNode = nodes.find((row) => row.node_level === 'BOOK')

  const neighbor = useMemo(() => {
    return {
      prev: selectedIndex > 0 ? rows[selectedIndex - 1] : null,
      next: selectedIndex >= 0 && selectedIndex < rows.length - 1 ? rows[selectedIndex + 1] : null,
    }
  }, [rows, selectedIndex])

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">교재 탐색</p>
          <h1>{title}</h1>
          <p className="muted">
            {activeNode ? `${activeNode.title_normalized} · ` : '전체 · '}
            {total.toLocaleString('ko-KR')}문항 · 교재 페이지 순서
          </p>
        </div>
        <div className="actions">
          <Link className="btn ghost" to="/sources">
            교재 목록
          </Link>
          <Link className="btn ghost" to={`/sources/${documentId}`}>
            원본 PDF
          </Link>
          <Link className="btn" to={`/questions?source=${documentId}`}>
            목록으로
          </Link>
        </div>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      <form className="filters filters-wide" onSubmit={(event) => event.preventDefault()}>
        <input
          placeholder="문제번호 또는 본문"
          value={query}
          onChange={(event) => patch({ q: event.target.value, page: 1 })}
          aria-label="검색"
        />
        <input
          placeholder="문제번호"
          value={numberQ}
          onChange={(event) => patch({ num: event.target.value, page: 1 })}
          aria-label="문제번호"
        />
        <input
          placeholder="시작 페이지"
          value={pageFrom}
          onChange={(event) => patch({ pfrom: event.target.value, page: 1 })}
          aria-label="시작 페이지"
        />
        <input
          placeholder="끝 페이지"
          value={pageTo}
          onChange={(event) => patch({ pto: event.target.value, page: 1 })}
          aria-label="끝 페이지"
        />
        <select value={review} onChange={(event) => patch({ review: event.target.value, page: 1 })} aria-label="검수 상태">
          <option value="">모든 검수 상태</option>
          {Object.entries(REVIEW_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={format} onChange={(event) => patch({ format: event.target.value, page: 1 })} aria-label="문항 형식">
          <option value="">객관식/단답/서술</option>
          {Object.entries(ITEM_FORMAT_KO).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={String(pageSize)} onChange={(event) => patch({ size: event.target.value, page: 1 })} aria-label="페이지 크기">
          <option value="20">20개</option>
          <option value="50">50개</option>
          <option value="100">100개</option>
        </select>
      </form>
      <div className="outline-browse">
        <nav className="card outline-tree" aria-label="대단원 목차">
          <button type="button" className={`tree-link ${!outlineId ? 'is-active' : ''}`} onClick={() => patch({ unit: null, page: 1 })}>
            전체 {bookNode?.listed_count ?? total}
          </button>
          {majors.map((major) => (
            <details key={major.id} open={outlineId === major.id || sectionsOf(major.id).some((row) => row.id === outlineId || typesOf(row.id).some((type) => type.id === outlineId))}>
              <summary>
                <button type="button" className={`tree-link ${outlineId === major.id ? 'is-active' : ''}`} onClick={() => patch({ unit: major.id, page: 1 })}>
                  {major.code} {major.title_normalized}
                  <span className="muted"> {major.listed_count}</span>
                </button>
              </summary>
              <ul>
                {sectionsOf(major.id).map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      className={`tree-link ${outlineId === section.id ? 'is-active' : ''}`}
                      onClick={() => patch({ unit: section.id, page: 1 })}
                    >
                      {section.code} {section.title_normalized}
                      <span className="muted"> {section.listed_count}</span>
                    </button>
                    {typesOf(section.id).length ? (
                      <ul>
                        {typesOf(section.id).map((type) => (
                          <li key={type.id}>
                            <button
                              type="button"
                              className={`tree-link nested ${outlineId === type.id ? 'is-active' : ''}`}
                              onClick={() => patch({ unit: type.id, page: 1 })}
                            >
                              유형 {type.code} {type.title_normalized}
                              <span className="muted"> {type.listed_count}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </nav>
        <section>
          {loading ? <p className="muted">문제를 불러오는 중입니다.</p> : null}
          <table className="data-table">
            <thead>
              <tr>
                <th>페이지</th>
                <th>번호</th>
                <th>유형</th>
                <th>난이도</th>
                <th>검수</th>
                <th>본문</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selected?.id ? 'is-selected' : undefined}
                  onClick={() => setSelected(row)}
                >
                  <td>{dash(row.page_number)}</td>
                  <td>{dash(row.original_problem_number)}</td>
                  <td>{dash(row.type_name)}</td>
                  <td>
                    {row.overall_difficulty != null ? Number(row.overall_difficulty).toFixed(1) : '—'}
                  </td>
                  <td>
                    <span className={`status-pill ${row.review_status.toLowerCase()}`}>
                      {REVIEW_LABELS[row.review_status] ?? row.review_status}
                    </span>
                  </td>
                  <td>{(row.problem_text ?? '').slice(0, 48) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => patch({ page: page - 1 })}>
              이전
            </button>
            <span>
              {page} / {pageCount} · {total.toLocaleString('ko-KR')}문항
            </span>
            <button type="button" className="btn ghost" disabled={page >= pageCount} onClick={() => patch({ page: page + 1 })}>
              다음
            </button>
          </div>
        </section>
        <aside className="card">
          {selected ? (
            <>
              <p className="kicker">
                p.{selected.page_number} · {selected.original_problem_number} · {selected.public_code}
              </p>
              <h2>
                {dash(selected.major_title)} / {dash(selected.section_title)}
              </h2>
              {selected.review_status === 'NEEDS_REVIEW' ? <p className="banner warn">확인 필요</p> : null}
              <p>
                난이도 {selected.overall_difficulty != null ? Number(selected.overall_difficulty).toFixed(1) : '—'} ·{' '}
                {ITEM_FORMAT_KO[selected.item_format ?? ''] ?? '형식 미정'}
              </p>
              <label>
                <input type="checkbox" checked={fullPage} onChange={(event) => setFullPage(event.target.checked)} />
                전체 페이지 보기
              </label>
              {pdfData && selected.page_number ? (
                <PdfPageViewer
                  pdfData={pdfData}
                  pageNumber={selected.page_number}
                  scale={0.9}
                  regions={regions}
                  selectedRegionId="crop"
                  drawing={false}
                  onSelectRegion={() => undefined}
                  onDraftBBox={() => undefined}
                />
              ) : (
                <p className="muted">원본 미리보기를 불러오는 중입니다.</p>
              )}
              <p className="stem">{selected.problem_text || '—'}</p>
              <div className="actions">
                <button type="button" className="btn ghost" disabled={!neighbor.prev} onClick={() => neighbor.prev && setSelected(neighbor.prev)}>
                  이전 문제
                </button>
                <button type="button" className="btn ghost" disabled={!neighbor.next} onClick={() => neighbor.next && setSelected(neighbor.next)}>
                  다음 문제
                </button>
              </div>
              <div className="actions">
                <Link className="btn" to={`/questions/${selected.id}/edit`}>
                  편집
                </Link>
                <Link
                  className="btn primary"
                  to={`/worksheets/new?problemId=${selected.id}&versionId=${selected.current_version_id ?? ''}`}
                >
                  문제지 추가
                </Link>
              </div>
            </>
          ) : (
            <p className="muted">단원을 선택하면 교재 순서대로 문제가 나타납니다.</p>
          )}
        </aside>
      </div>
    </main>
  )
}
