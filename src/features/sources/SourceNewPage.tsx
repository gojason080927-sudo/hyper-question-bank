import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DOCUMENT_TYPES, LICENSE_STATUSES } from '../../lib/workflow/labels'
import { getSupabase } from '../../lib/supabase/client'
import { SOURCE_BUCKET } from '../../lib/pdf/constants'
import { hasPdfMagic, rejectPdfFile, sha256Hex } from '../../lib/pdf/fileGuard'
import { inspectPdf } from '../../lib/pdf/loadPdf'
import { parseHqBError } from '../../lib/workflow/validation'
import { beginSubmit, releaseSubmit } from '../../lib/workflow/submitLock'

export function SourceNewPage() {
  const navigate = useNavigate()
  const submitLock = useRef({ current: false })
  const [title, setTitle] = useState('')
  const [documentType, setDocumentType] = useState('TEACHER_CREATED')
  const [licenseStatus, setLicenseStatus] = useState('OWNED')
  const [publisher, setPublisher] = useState('HYPER')
  const [copyrightNote, setCopyrightNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  return (
    <main className="page">
      <p className="kicker">원본 자료</p>
      <h1>PDF 등록</h1>
      <p className="hint">원본 PDF는 변형하지 않고 private Storage에 보존합니다. 공개 URL은 만들지 않습니다.</p>
      {error ? <p className="banner error">{error}</p> : null}
      {duplicateId ? (
        <p className="banner warn">
          같은 SHA-256 PDF가 이미 있습니다.{' '}
          <Link to={`/sources/${duplicateId}`}>기존 자료 보기</Link>
        </p>
      ) : null}
      <form
        className="card form"
        onSubmit={(event) => {
          event.preventDefault()
          void (async () => {
            const client = getSupabase()
            if (!client || !file) {
              setError('PDF 파일을 선택해 주세요.')
              return
            }
            const guard = rejectPdfFile(file)
            if (guard) {
              setError(guard)
              return
            }
            if (!beginSubmit(submitLock.current)) return
            setSubmitting(true)
            setError(null)
            setDuplicateId(null)
            try {
              const bytes = await file.arrayBuffer()
              if (!hasPdfMagic(bytes)) {
                throw new Error('HQB_NOT_PDF: PDF 파일이 아니거나 손상되었습니다.')
              }
              const sha256 = await sha256Hex(bytes)
              const existing = await client.rpc('hqb_find_source_by_sha256', { p_sha256: sha256 })
              if (existing.error) throw existing.error
              if (existing.data) {
                const found = existing.data as { id?: string }
                setDuplicateId(found.id ?? null)
                throw new Error('HQB_DUPLICATE_PDF: 같은 PDF가 이미 등록되어 있습니다.')
              }
              let inspected
              try {
                inspected = await inspectPdf(bytes)
              } catch (inspectError) {
                const message = inspectError instanceof Error ? inspectError.message : ''
                throw new Error(message.includes('HQB_') ? message : 'HQB_PAGE_COUNT: 페이지 수를 확인하지 못했습니다.')
              }
              const begun = await client.rpc('hqb_begin_source_document', {
                payload: {
                  title: title.trim() || file.name.replace(/\.pdf$/i, ''),
                  document_type: documentType,
                  license_status: licenseStatus,
                  publisher,
                  copyright_note: copyrightNote,
                  original_filename: file.name,
                  mime_type: file.type || 'application/pdf',
                  file_size: file.size,
                  sha256,
                },
              })
              if (begun.error) throw begun.error
              const started = begun.data as { document_id: string; storage_path: string }
              const uploaded = await client.storage.from(SOURCE_BUCKET).upload(started.storage_path, file, {
                contentType: 'application/pdf',
                upsert: false,
              })
              if (uploaded.error) {
                throw new Error('HQB_UPLOAD_FAILED: PDF 업로드에 실패했습니다.')
              }
              const finalized = await client.rpc('hqb_finalize_source_document', {
                p_document_id: started.document_id,
                payload: {
                  page_count: inspected.pageCount,
                  pdf_type: inspected.classification.pdfType,
                  ocr_status: inspected.classification.ocrStatus,
                  extraction_status: inspected.classification.extractionStatus,
                  pages: inspected.pages.map((page) => {
                    const hint = inspected.classification.pages.find((row) => row.pageNumber === page.pageNumber)
                    return {
                      page_number: page.pageNumber,
                      page_width: page.pageWidth,
                      page_height: page.pageHeight,
                      extracted_text: page.extractedText,
                      text_char_count: hint?.textCharCount ?? 0,
                      pdf_type_hint: hint?.pdfTypeHint ?? 'UNKNOWN',
                      extraction_status: hint?.extractionStatus ?? 'PENDING',
                      ocr_status: hint?.ocrStatus ?? 'NOT_NEEDED',
                    }
                  }),
                },
              })
              if (finalized.error) throw finalized.error
              navigate(`/sources/${started.document_id}`)
            } catch (caught) {
              releaseSubmit(submitLock.current)
              setSubmitting(false)
              const message = caught instanceof Error ? caught.message : String(caught)
              setError(parseHqBError(message))
            }
          })()
        }}
      >
        <label>
          자료명
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="HYPER STEP 5 Synthetic" required />
        </label>
        <div className="grid-2">
          <label>
            자료 유형
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              {DOCUMENT_TYPES.map((row) => (
                <option key={row.value} value={row.value}>{row.label}</option>
              ))}
            </select>
          </label>
          <label>
            저작권/라이선스
            <select value={licenseStatus} onChange={(event) => setLicenseStatus(event.target.value)}>
              {LICENSE_STATUSES.map((row) => (
                <option key={row.value} value={row.value}>{row.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          발행/제작
          <input value={publisher} onChange={(event) => setPublisher(event.target.value)} />
        </label>
        <label>
          권리 메모
          <textarea value={copyrightNote} onChange={(event) => setCopyrightNote(event.target.value)} rows={3} />
        </label>
        <label>
          PDF 파일
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="hint">UNKNOWN 자료는 내부 검토만 가능하며 외부 배포 대상이 아닙니다. 최대 50MB.</p>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={submitting}>{submitting ? '업로드 중…' : '자료 등록'}</button>
          <Link className="btn ghost" to="/sources">취소</Link>
        </div>
      </form>
    </main>
  )
}
