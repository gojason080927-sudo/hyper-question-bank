import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { useAuth } from '../../lib/auth/AuthProvider'
import { isFixtureSource, SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'
import { DOCUMENT_STATUS_KO, extractionStatusLabel, ocrStatusLabel } from '../../lib/outline/instructorLabels'
import type { SourceDocument } from './types'

type SourceRow = SourceDocument & { is_fixture?: boolean; visibility?: string }

export function SourceListPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<SourceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTests, setShowTests] = useState(false)
  const isAdmin = profile?.role === 'ADMIN'

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      const { data, error: fetchError } = await client
        .from('source_documents')
        .select(
          'id,title,publisher,document_type,original_filename,file_hash,file_size,mime_type,storage_bucket,storage_path,page_count,license_status,usage_scope,copyright_note,document_status,extraction_status,pdf_type,ocr_status,uploaded_at,created_at,is_fixture,visibility',
        )
        .is('archived_at', null)
        .order('created_at', { ascending: false })
      if (fetchError || !data) {
        setError('교재 목록을 불러오지 못했습니다.')
        setLoading(false)
        return
      }
      setRows(data as SourceRow[])
      setLoading(false)
    })()
  }, [])

  if (loading) return <main className="page"><p className="muted">교재를 불러오는 중입니다.</p></main>
  if (error) return <main className="page"><p className="banner error">{error}</p></main>

  const visible = rows.filter((row) => {
    const fixture = Boolean(row.is_fixture) || isFixtureSource(row)
    if (fixture && !(isAdmin && showTests)) return false
    return true
  })
  const hiddenCount = rows.length - visible.length

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">원본 교재</p>
          <h1>교재</h1>
          <p className="muted">기본 화면에는 실제 교재만 표시합니다. 테스트 자료 {hiddenCount}건은 숨겼습니다.</p>
        </div>
        <div className="actions">
          {isAdmin ? (
            <label>
              <input type="checkbox" checked={showTests} onChange={(event) => setShowTests(event.target.checked)} />
              테스트 자료 보기
            </label>
          ) : null}
          <Link className="btn" to="/sources/new">PDF 등록</Link>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="muted">표시할 교재가 없습니다.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>교재명</th>
              <th>라이선스</th>
              <th>페이지</th>
              <th>OCR</th>
              <th>추출</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const href = row.id === SSEN_SOURCE_DOCUMENT_ID || row.document_type === 'WORKBOOK' || row.document_type === 'TEXTBOOK'
                ? `/sources/${row.id}/browse`
                : `/sources/${row.id}`
              const linkedGuess = row.id === SSEN_SOURCE_DOCUMENT_ID
              return (
                <tr key={row.id}>
                  <td>
                    <Link to={href}>{row.title}</Link>
                    <div className="muted">{row.original_filename}</div>
                    {row.is_fixture || isFixtureSource(row) ? <div className="muted">테스트 자료</div> : null}
                  </td>
                  <td>{row.license_status}</td>
                  <td>{row.page_count ?? '—'}</td>
                  <td>{ocrStatusLabel(row.ocr_status, linkedGuess)}</td>
                  <td>{extractionStatusLabel(row.extraction_status, linkedGuess)}</td>
                  <td>{DOCUMENT_STATUS_KO[row.document_status] ?? row.document_status}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </main>
  )
}
