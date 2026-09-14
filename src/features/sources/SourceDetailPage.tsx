import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { SIGNED_URL_TTL_SEC, SOURCE_BUCKET } from '../../lib/pdf/constants'
import type { NormalizedBBox } from '../../lib/pdf/bbox'
import { parseHqBError } from '../../lib/workflow/validation'
import { beginSubmit, releaseSubmit } from '../../lib/workflow/submitLock'
import { PdfPageViewer } from './PdfPageViewer'
import { RecognitionPanel } from './RecognitionPanel'
import type { SourceBundle, SourceRegion } from './types'
import { bookReadyLabel, extractionStatusLabel, ocrStatusLabel, pipelineStatusLabel } from '../../lib/outline/instructorLabels'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'

export function SourceDetailPage() {
  const { documentId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const submitLock = useRef({ current: false })
  const [bundle, setBundle] = useState<SourceBundle | null>(null)
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [draftBBox, setDraftBBox] = useState<NormalizedBBox | null>(null)
  const [problemNumber, setProblemNumber] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(searchParams.get('region'))
  const [scale, setScale] = useState(1.15)
  const [pageInput, setPageInput] = useState(searchParams.get('page') ?? '1')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<{
    page_count?: number
    ocr_pages?: number
    linked_problems?: number
    listed_problems?: number
    auto_classified?: number
    needs_review?: number
    updated_at?: string
    pipeline_status?: string
    ocr_complete?: boolean
    extraction_complete?: boolean
    ocr_status?: string
    extraction_status?: string
  } | null>(null)
  const [bookStatus, setBookStatus] = useState<{
    qa_complete?: boolean
    ready_for_use?: boolean
    human_exceptions?: number
    banner?: string
    inspected_at?: string
    paid_ocr_usd?: number
    completed_items?: number
    total_items?: number
    counts?: { auto_safe?: number; verified_by_source?: number; human_final_check?: number }
  } | null>(null)

  const pageNumber = Math.max(1, Number(searchParams.get('page') || pageInput) || 1)

  async function reload() {
    const client = getSupabase()
    if (!client || !documentId) return
    const { data, error: fetchError } = await client.rpc('hqb_fetch_source_document', {
      p_document_id: documentId,
    })
    if (fetchError || !data) {
      setError(parseHqBError(fetchError?.message) || '자료를 불러오지 못했습니다.')
      return
    }
    setBundle(data as SourceBundle)
    const runtime = await client.rpc('hqb_source_runtime_stats', { p_document_id: documentId })
    if (!runtime.error && runtime.data) setStats(runtime.data as typeof stats)
    try {
      const res = await fetch(`/book-status/${documentId}.json`)
      if (res.ok) {
        setBookStatus((await res.json()) as typeof bookStatus)
      } else if (documentId === SSEN_SOURCE_DOCUMENT_ID) {
        const fallback = await fetch('/ssen-book-status.json')
        if (fallback.ok) setBookStatus((await fallback.json()) as typeof bookStatus)
        else setBookStatus(null)
      } else {
        setBookStatus(null)
      }
    } catch {
      setBookStatus(null)
    }
  }

  useEffect(() => {
    const client = getSupabase()
    if (!client || !documentId) return
    void (async () => {
      await reload()
      const { data, error: fetchError } = await client.rpc('hqb_fetch_source_document', {
        p_document_id: documentId,
      })
      if (fetchError || !data) return
      const doc = (data as SourceBundle).document
      if (!doc.storage_path) {
        setError('원본 PDF 경로가 없습니다.')
        return
      }
      const signed = await client.storage
        .from(doc.storage_bucket || SOURCE_BUCKET)
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SEC)
      if (signed.error || !signed.data?.signedUrl) {
        setError('원본 PDF를 열 권한이 없거나 파일을 찾지 못했습니다.')
        return
      }
      const response = await fetch(signed.data.signedUrl)
      if (!response.ok) {
        setError('PDF 원본을 내려받지 못했습니다.')
        return
      }
      setPdfData(await response.arrayBuffer())
    })()
    // reload is defined in the component; initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId])

  const page = bundle?.pages.find((row) => row.page_number === pageNumber)
  const pageRegions = useMemo(
    () => (bundle?.regions ?? []).filter((row) => row.source_page_id === page?.id),
    [bundle, page?.id],
  )
  const selected = pageRegions.find((row) => row.id === selectedRegionId) ?? null

  function goToPage(next: number) {
    if (!bundle?.document.page_count) return
    const clamped = Math.min(bundle.document.page_count, Math.max(1, next))
    setPageInput(String(clamped))
    setSearchParams((current) => {
      current.set('page', String(clamped))
      current.delete('region')
      return current
    })
    setSelectedRegionId(null)
    setDraftBBox(null)
    setDrawing(false)
  }

  async function saveRegion() {
    const client = getSupabase()
    if (!client || !documentId || !page || !draftBBox) return
    if (!beginSubmit(submitLock.current)) return
    setSaving(true)
    setError(null)
    const { data, error: saveError } = await client.rpc('hqb_create_source_page_region', {
      payload: {
        source_document_id: documentId,
        source_page_id: page.id,
        page_number: page.page_number,
        bbox: {
          ...draftBBox,
          pageWidth: page.page_width ?? undefined,
          pageHeight: page.page_height ?? undefined,
        },
        original_problem_number: problemNumber,
        extracted_text_preview: page.extracted_text,
      },
    })
    releaseSubmit(submitLock.current)
    setSaving(false)
    if (saveError) {
      setError(parseHqBError(saveError.message))
      return
    }
    const created = data as { region_id?: string }
    setDrawing(false)
    setDraftBBox(null)
    await reload()
    if (created.region_id) setSelectedRegionId(created.region_id)
    setInfo('문제 영역을 저장했습니다.')
  }

  async function deleteRegion(region: SourceRegion) {
    const client = getSupabase()
    if (!client) return
    const { error: deleteError } = await client.rpc('hqb_delete_source_page_region', {
      p_region_id: region.id,
    })
    if (deleteError) {
      setError(parseHqBError(deleteError.message))
      return
    }
    setSelectedRegionId(null)
    await reload()
    setInfo('영역을 삭제했습니다.')
  }

  async function createDraft(region: SourceRegion) {
    const client = getSupabase()
    if (!client) return
    if (!beginSubmit(submitLock.current)) return
    setSaving(true)
    const { data, error: createError } = await client.rpc('hqb_create_problem_draft_from_region', {
      p_region_id: region.id,
      payload: {
        version: {
          problem_text: region.extracted_text_preview || '[PDF 원본을 보고 입력하세요]',
        },
        source: {
          original_problem_number: region.original_problem_number,
        },
      },
    })
    if (createError) {
      releaseSubmit(submitLock.current)
      setSaving(false)
      setError(parseHqBError(createError.message))
      return
    }
    const created = data as { problem_id?: string }
    if (created.problem_id) navigate(`/questions/${created.problem_id}/edit`)
  }

  if (error && !bundle) return <main className="page"><p className="banner error">{error}</p></main>
  if (!bundle) return <main className="page"><p className="muted">자료를 불러오는 중입니다.</p></main>
  const doc = bundle.document

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">원본 자료</p>
          <h1>{doc.title}</h1>
        </div>
        <div className="actions">
          <Link className="btn ghost" to="/sources">교재 목록</Link>
          <Link className="btn primary" to={`/sources/${documentId}/browse`}>목차로 문제 찾기</Link>
          <Link className="btn ghost" to="/questions/new">수동 등록</Link>
        </div>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      {info ? <p className="banner success">{info}</p> : null}
      {doc.license_status === 'UNKNOWN' || doc.license_status === 'RESTRICTED' ? (
        <p className="banner warn">이 자료는 내부 검토용입니다. 외부 공개/배포 대상이 아닙니다.</p>
      ) : null}

      <section className="card">
        <p><strong>파일</strong> {doc.original_filename}</p>
        <p>
          <strong>라이선스</strong> {doc.license_status} · <strong>PDF 유형</strong> {doc.pdf_type}
        </p>
        <p>
          <strong>OCR</strong> {ocrStatusLabel(stats?.ocr_status ?? doc.ocr_status, Boolean(stats?.ocr_complete))} ·{' '}
          <strong>추출</strong> {extractionStatusLabel(stats?.extraction_status ?? doc.extraction_status, Boolean(stats?.extraction_complete))} ·{' '}
          <strong>자동 등록 작업</strong> {pipelineStatusLabel(stats?.pipeline_status ?? doc.document_status)}
        </p>
        <p>
          <strong>총 페이지</strong> {stats?.page_count ?? doc.page_count ?? '—'} · <strong>OCR 처리 페이지</strong> {stats?.ocr_pages ?? '—'} ·{' '}
          <strong>감지 문제</strong> {stats?.linked_problems ?? '—'} · <strong>활성 문제</strong> {stats?.listed_problems ?? '—'}
        </p>
        <p>
          <strong>자동분류</strong> {stats?.auto_classified ?? '—'} · <strong>확인 필요</strong> {stats?.needs_review ?? '—'} ·{' '}
          <strong>마지막 처리</strong> {stats?.updated_at ? new Date(stats.updated_at).toLocaleString('ko-KR') : '—'}
        </p>
        <p className="muted">SHA-256 {doc.file_hash} · {doc.file_size ? `${Math.round(doc.file_size / 1024)} KB` : ''}</p>
      </section>

      {bookStatus ? (
        <section className="card book-qa-status">
          <p className="kicker">교재 검사</p>
          <h2>{bookStatus.banner ?? bookReadyLabel(Boolean(bookStatus.ready_for_use), bookStatus.human_exceptions ?? 0)}</h2>
          <p>
            <strong>전체 문항</strong> {bookStatus.total_items ?? stats?.listed_problems ?? '—'} ·{' '}
            <strong>검사 완료율</strong>{' '}
            {bookStatus.qa_complete
              ? '100%'
              : `${Math.round((((bookStatus.total_items ?? 0) - (bookStatus.human_exceptions ?? 0)) / Math.max(1, bookStatus.total_items ?? 1)) * 100)}%`}
            {' · '}
            <strong>사용 가능</strong> {bookStatus.ready_for_use ? '예' : 'P1 잔여'}
          </p>
          <p>
            <strong>자동 복원</strong> {(bookStatus.counts?.auto_safe ?? 0) + (bookStatus.counts?.verified_by_source ?? 0)} ·{' '}
            <strong>사람 확인 잔여</strong> {bookStatus.human_exceptions ?? bookStatus.counts?.human_final_check ?? 0} ·{' '}
            <strong>마지막 검사</strong>{' '}
            {bookStatus.inspected_at ? new Date(bookStatus.inspected_at).toLocaleString('ko-KR') : '—'} ·{' '}
            <strong>OCR 비용</strong> ${Number(bookStatus.paid_ocr_usd ?? 0).toFixed(4)}
          </p>
          <div className="actions">
            <Link className="btn primary" to="/worksheets">문제지 만들기</Link>
            <Link className="btn ghost" to="/pipeline-review?source=closeout">예외 검수</Link>
          </div>
        </section>
      ) : null}

      <section className="source-workspace">
        <div className="card">
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}>이전</button>
            <label className="page-jump">
              페이지
              <input
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={() => goToPage(Number(pageInput) || 1)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') goToPage(Number(pageInput) || 1)
                }}
              />
              / {doc.page_count}
            </label>
            <button type="button" className="btn ghost" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= (doc.page_count ?? 1)}>다음</button>
            <button type="button" className="btn ghost" onClick={() => setScale((value) => Math.max(0.6, Number((value - 0.15).toFixed(2))))}>축소</button>
            <button type="button" className="btn ghost" onClick={() => setScale((value) => Math.min(2.4, Number((value + 0.15).toFixed(2))))}>확대 {Math.round(scale * 100)}%</button>
            <button
              type="button"
              className={`btn${drawing ? '' : ' ghost'}`}
              onClick={() => {
                setDrawing((value) => !value)
                setDraftBBox(null)
              }}
            >
              {drawing ? '지정 중' : '문제 영역 지정'}
            </button>
          </div>
          <p className="hint">
            페이지 번호는 사람이 보는 1부터입니다. 좌표는 화면 픽셀이 아니라 0–1 normalized / top-left 입니다.
            {page?.pdf_type_hint === 'SCAN_PDF' ? ' 이 페이지는 텍스트 층이 거의 없어 스캔 후보입니다.' : ''}
          </p>
          <PdfPageViewer
            pdfData={pdfData}
            pageNumber={pageNumber}
            scale={scale}
            regions={pageRegions}
            selectedRegionId={selectedRegionId}
            drawing={drawing}
            onSelectRegion={setSelectedRegionId}
            onDraftBBox={setDraftBBox}
          />
        </div>

        <aside className="card">
          <h2>이 페이지 영역</h2>
          {drawing ? (
            <div className="form">
              <p className="hint">마우스로 사각형을 그리세요. 확대/축소해도 같은 위치에 저장됩니다.</p>
              <label>
                원본 문제 번호
                <input value={problemNumber} onChange={(event) => setProblemNumber(event.target.value)} placeholder="1" />
              </label>
              {draftBBox ? (
                <p className="muted">
                  x {draftBBox.x.toFixed(3)} y {draftBBox.y.toFixed(3)} w {draftBBox.width.toFixed(3)} h {draftBBox.height.toFixed(3)}
                </p>
              ) : null}
              <div className="actions">
                <button type="button" className="btn" disabled={!draftBBox || saving} onClick={() => void saveRegion()}>영역 저장</button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setDrawing(false)
                    setDraftBBox(null)
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          ) : null}

          {pageRegions.length === 0 ? <p className="muted">저장된 영역이 없습니다.</p> : (
            <ul className="version-list">
              {pageRegions.map((region) => (
                <li key={region.id}>
                  <button
                    type="button"
                    className={`chip${selectedRegionId === region.id ? ' active' : ''}`}
                    onClick={() => setSelectedRegionId(region.id)}
                  >
                    {region.original_problem_number || '영역'} · {region.status}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && page ? (
            <div className="form">
              <p><strong>상태</strong> {selected.status}</p>
              {selected.extracted_text_preview ? (
                <div className="preview-box">
                  <p className="muted">추출 텍스트 미리보기 (본문 확정 아님)</p>
                  <p>{selected.extracted_text_preview}</p>
                </div>
              ) : (
                <p className="hint">이 영역에서 추출된 텍스트가 없습니다. PDF 원본이 기준입니다.</p>
              )}
              <RecognitionPanel
                document={doc}
                page={page}
                region={selected}
                pdfData={pdfData}
                submitLock={submitLock.current}
                onRegionCreated={(id) => {
                  void reload().then(() => setSelectedRegionId(id))
                }}
              />
              <div className="actions">
                <button type="button" className="btn" disabled={saving} onClick={() => void createDraft(selected)}>
                  빈 초안 만들기
                </button>
                {selected.status !== 'LINKED' ? (
                  <button type="button" className="btn ghost" onClick={() => void deleteRegion(selected)}>
                    영역 삭제
                  </button>
                ) : (
                  <button type="button" className="btn ghost" onClick={() => void deleteRegion(selected)}>
                    미확정 연결 삭제
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {page?.extracted_text ? (
            <div className="preview-box">
              <p className="muted">페이지 embedded text</p>
              <p>{page.extracted_text}</p>
            </div>
          ) : (
            <p className="hint">이 페이지에는 의미 있는 텍스트 층이 거의 없습니다. [OCR 테스트]는 선택한 영역 한 곳만 실행합니다. 192페이지 전체는 돌리지 않습니다.</p>
          )}
        </aside>
      </section>
    </main>
  )
}
