import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { parseHqBError } from '../../lib/workflow/validation'
import { isArchiveCandidate, shouldHideFromDefaultList, worksheetListKind } from '../../lib/worksheets/worksheetListKind'

type Row = { id: string; title: string; purpose: string | null; exam_kind: string; created_at: string; archived_at: string | null; item_count: number }

export function WorksheetListPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [title, setTitle] = useState('HYPER 문제지')
  const [error, setError] = useState<string | null>(null)
  const [hideTestAndEmpty, setHideTestAndEmpty] = useState(true)
  const [showArchived, setShowArchived] = useState(false)

  async function reload() {
    const client = getSupabase()
    if (!client) return
    let query = client.from('worksheets').select('id,title,purpose,exam_kind,created_at,archived_at').order('created_at', { ascending: false })
    if (!showArchived) query = query.is('archived_at', null)
    const { data, error: loadError } = await query
    if (loadError) setError('문제지 목록을 불러오지 못했습니다.')
    const list = (data ?? []) as Omit<Row, 'item_count'>[]
    const { data: items } = await client.from('worksheet_items').select('worksheet_id')
    const counts = new Map<string, number>()
    for (const item of items ?? []) {
      const id = String((item as { worksheet_id: string }).worksheet_id)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    setRows(list.map((row) => ({ ...row, item_count: counts.get(row.id) ?? 0 })))
  }

  useEffect(() => {
    void reload()
  }, [showArchived])

  const visible = useMemo(() => {
    return rows.filter((row) => {
      const kind = worksheetListKind(row)
      if (shouldHideFromDefaultList(kind, hideTestAndEmpty)) return false
      return true
    })
  }, [rows, hideTestAndEmpty])

  async function archiveRow(id: string) {
    const client = getSupabase()
    if (!client) return
    const { error: archiveError } = await client.rpc('hqb_archive_worksheet', { p_worksheet_id: id })
    if (archiveError) {
      setError(parseHqBError(archiveError.message))
      return
    }
    await reload()
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">문제지</p>
          <h1>A4 문제지</h1>
        </div>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault()
          const client = getSupabase()
          if (!client) return
          void (async () => {
            const { data, error: saveError } = await client.rpc('hqb_create_worksheet', {
              payload: { title, exam_kind: 'EXAM', layout: { columns: 1 } },
            })
            if (saveError) {
              setError(parseHqBError(saveError.message))
              return
            }
            const id = (data as { worksheet_id?: string })?.worksheet_id
            if (id) navigate(`/worksheets/${id}`)
          })()
        }}
      >
        <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="문제지 제목" />
        <button className="btn primary" type="submit">
          새 문제지
        </button>
      </form>
      <div className="filters worksheet-filters">
        <label>
          <input type="checkbox" checked={hideTestAndEmpty} onChange={(event) => setHideTestAndEmpty(event.target.checked)} />
          테스트·빈 문제지 숨기기
        </label>
        <label>
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          보관함 보기
        </label>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>종류</th>
            <th>문항</th>
            <th>만든 시각</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const kind = worksheetListKind(row)
            return (
              <tr key={row.id}>
                <td>
                  <Link to={`/worksheets/${row.id}`}>{row.title}</Link>
                  {isArchiveCandidate(kind) ? <span className="status-pill archive_candidate">보관 후보</span> : null}
                </td>
                <td>
                  {kind === 'TEST' ? 'TEST' : kind === 'EMPTY' ? '빈 문제지' : row.exam_kind === 'ANSWER_SHEET' ? '정답지' : '운영'}
                </td>
                <td>{row.item_count}</td>
                <td>{new Date(row.created_at).toLocaleString('ko-KR')}</td>
                <td>
                  {isArchiveCandidate(kind) && !row.archived_at ? (
                    <button type="button" className="btn ghost" onClick={() => void archiveRow(row.id)}>
                      보관
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
