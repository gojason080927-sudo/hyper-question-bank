import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import type { SourceDocument } from './types'

export function SourceListPage() {
  const [rows, setRows] = useState<SourceDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      const { data, error: fetchError } = await client
        .from('source_documents')
        .select(
          'id,title,publisher,document_type,original_filename,file_hash,file_size,mime_type,storage_bucket,storage_path,page_count,license_status,usage_scope,copyright_note,document_status,extraction_status,pdf_type,ocr_status,uploaded_at,created_at',
        )
        .is('archived_at', null)
        .order('created_at', { ascending: false })
      if (fetchError || !data) {
        setError('자료 목록을 불러오지 못했습니다.')
        setLoading(false)
        return
      }
      setRows(data as SourceDocument[])
      setLoading(false)
    })()
  }, [])

  if (loading) return <main className="page"><p className="muted">자료를 불러오는 중입니다.</p></main>
  if (error) return <main className="page"><p className="banner error">{error}</p></main>

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">원본 자료</p>
          <h1>PDF 자료</h1>
        </div>
        <div className="actions">
          <Link className="btn" to="/sources/new">PDF 등록</Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted">등록된 PDF가 없습니다. 저작권이 명확한 자료만 업로드하세요.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>자료명</th>
              <th>라이선스</th>
              <th>PDF 유형</th>
              <th>페이지</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/sources/${row.id}`}>{row.title}</Link>
                  <div className="muted">{row.original_filename}</div>
                </td>
                <td>{row.license_status}</td>
                <td>{row.pdf_type}</td>
                <td>{row.page_count ?? '—'}</td>
                <td>{row.document_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
