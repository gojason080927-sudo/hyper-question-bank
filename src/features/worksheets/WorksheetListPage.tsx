import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { parseHqBError } from '../../lib/workflow/validation'

type Row = { id: string; title: string; purpose: string | null; exam_kind: string; created_at: string; archived_at: string | null }

export function WorksheetListPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [title, setTitle] = useState('HYPER 문제지')
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const client = getSupabase()
    if (!client) return
    const { data, error: loadError } = await client
      .from('worksheets')
      .select('id,title,purpose,exam_kind,created_at,archived_at')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
    if (loadError) setError('문제지 목록을 불러오지 못했습니다.')
    setRows((data ?? []) as Row[])
  }

  useEffect(() => {
    void reload()
  }, [])

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
      <table className="data-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>종류</th>
            <th>만든 시각</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/worksheets/${row.id}`}>{row.title}</Link>
              </td>
              <td>{row.exam_kind === 'ANSWER_SHEET' ? '정답지' : '시험지'}</td>
              <td>{new Date(row.created_at).toLocaleString('ko-KR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
