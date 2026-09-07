import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { textItemsInBBox } from '../../lib/pdf/extractText'
import { openPdfDocument } from '../../lib/pdf/loadPdf'
import { recognizeRegionText } from '../../lib/recognition/pipeline'
import { renderRegionDataUrl } from '../../lib/recognition/renderRegion'
import { proposeAutoRegions } from '../../lib/recognition/segment'
import { toPositionedItems } from '../../lib/recognition/items'
import { RECOGNITION_RENDER_SCALE } from '../../lib/recognition/types'
import type { AutoRegionCandidate, RecognitionOutput } from '../../lib/recognition/types'
import { parseHqBError } from '../../lib/workflow/validation'
import { beginSubmit, releaseSubmit } from '../../lib/workflow/submitLock'
import type { SourceDocument, SourcePage, SourceRegion } from './types'

type SavedResult = {
  id: string
  verdict: string
  status: string
  engine: string
  created_at: string
  applied_to_version_id: string | null
}

type Props = {
  document: SourceDocument
  page: SourcePage
  region: SourceRegion
  pdfData: ArrayBuffer | null
  submitLock: { current: boolean }
  onRegionCreated?: (regionId: string) => void
}

export function RecognitionPanel({ document, page, region, pdfData, submitLock, onRegionCreated }: Props) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [output, setOutput] = useState<RecognitionOutput | null>(null)
  const [resultId, setResultId] = useState<string | null>(null)
  const [history, setHistory] = useState<SavedResult[]>([])
  const [candidates, setCandidates] = useState<AutoRegionCandidate[]>([])
  const [linkedVersionId, setLinkedVersionId] = useState<string | null>(null)
  const [linkedProblemId, setLinkedProblemId] = useState<string | null>(null)

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      const { data } = await client.rpc('hqb_list_recognition_results', { p_region_id: region.id })
      setHistory((data as SavedResult[]) ?? [])
      const { data: links } = await client
        .from('problem_sources')
        .select('problem_id')
        .eq('source_page_region_id', region.id)
        .limit(1)
        .maybeSingle()
      const problemId = links?.problem_id ?? null
      setLinkedProblemId(problemId)
      if (problemId) {
        const { data: problem } = await client
          .from('problems')
          .select('current_version_id')
          .eq('id', problemId)
          .maybeSingle()
        setLinkedVersionId(problem?.current_version_id ?? null)
      } else {
        setLinkedVersionId(null)
      }
    })()
  }, [region.id])

  async function runRecognize() {
    const client = getSupabase()
    if (!client || !pdfData) return
    if (!beginSubmit(submitLock)) return
    setBusy(true)
    setError(null)
    try {
      const pdf = await openPdfDocument(pdfData)
      const pdfPage = await pdf.getPage(page.page_number)
      const viewport = pdfPage.getViewport({ scale: 1 })
      const content = await pdfPage.getTextContent()
      const pageSize = { width: viewport.width, height: viewport.height }
      const raw = textItemsInBBox(content.items as Array<{ str?: string; transform?: number[] }>, region.bbox, pageSize)
      const recognized = recognizeRegionText({
        rawText: raw || region.extracted_text_preview || '',
        pageHint: page.pdf_type_hint || document.pdf_type,
        bbox: region.bbox,
        pageSize,
        items: content.items as Array<{ str?: string; transform?: number[] }>,
      })
      const crop = await renderRegionDataUrl(pdfData, page.page_number, region.bbox, RECOGNITION_RENDER_SCALE)
      setPreview(crop.dataUrl)
      setOutput(recognized)
      const saved = await client.rpc('hqb_save_recognition_result', {
        payload: {
          source_document_id: document.id,
          source_page_id: page.id,
          source_page_region_id: region.id,
          engine: recognized.engine,
          engine_version: recognized.engine_version,
          processing_mode: recognized.processing_mode,
          status: recognized.status,
          verdict: recognized.verdict,
          payload: { ...recognized.payload, confidence: null },
          warnings: recognized.payload.warnings,
          component_status: recognized.payload.component_status,
        },
      })
      await pdf.destroy()
      if (saved.error) throw saved.error
      const created = saved.data as { result_id?: string }
      setResultId(created.result_id ?? null)
      setInfo(`인식 결과를 보관했습니다. ${recognized.verdict} · 자동 VERIFIED/덮어쓰기 없음.`)
      const { data } = await client.rpc('hqb_list_recognition_results', { p_region_id: region.id })
      setHistory((data as SavedResult[]) ?? [])
    } catch (caught) {
      setError(parseHqBError(caught instanceof Error ? caught.message : String(caught)))
    } finally {
      releaseSubmit(submitLock)
      setBusy(false)
    }
  }

  async function applyToLinkedDraft() {
    const client = getSupabase()
    if (!client || !resultId || !linkedVersionId) return
    const { error: applyError } = await client.rpc('hqb_apply_recognition_to_draft', {
      p_result_id: resultId,
      p_version_id: linkedVersionId,
    })
    if (applyError) {
      setError(parseHqBError(applyError.message))
      return
    }
    if (linkedProblemId) navigate(`/questions/${linkedProblemId}/edit`)
  }

  async function createDraftFromRecognition() {
    const client = getSupabase()
    if (!client || !output) return
    const { data, error: createError } = await client.rpc('hqb_create_problem_draft_from_region', {
      p_region_id: region.id,
      payload: {
        version: {
          problem_text: output.payload.stem_text || output.payload.raw_text || '[PDF 원본을 보고 입력하세요]',
          origin: 'OCR',
          item_format: output.payload.choices.length ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
        },
        source: { original_problem_number: output.payload.problem_number || region.original_problem_number },
        choices: output.payload.choices.map((row) => ({
          choice_order: row.order,
          label: row.label,
          choice_text: row.text,
        })),
        expressions: output.payload.math_expressions
          .filter((row) => row.original)
          .map((row, index) => ({
            original_expression: row.original,
            latex_expression: row.latex_candidate ?? '',
            expression_role: 'TARGET',
            sort_order: index + 1,
          })),
      },
    })
    if (createError) {
      setError(parseHqBError(createError.message))
      return
    }
    const created = data as { problem_id?: string; version_id?: string }
    if (resultId && created.version_id) {
      await client.rpc('hqb_apply_recognition_to_draft', {
        p_result_id: resultId,
        p_version_id: created.version_id,
      })
    }
    if (created.problem_id) navigate(`/questions/${created.problem_id}/edit`)
  }

  async function saveCandidate(candidate: AutoRegionCandidate) {
    const client = getSupabase()
    if (!client) return
    const { data, error: saveError } = await client.rpc('hqb_create_source_page_region', {
      payload: {
        source_document_id: document.id,
        source_page_id: page.id,
        page_number: page.page_number,
        bbox: {
          ...candidate.bbox,
          pageWidth: page.page_width ?? undefined,
          pageHeight: page.page_height ?? undefined,
        },
        original_problem_number: candidate.problem_number,
        extracted_text_preview: candidate.preview,
      },
    })
    if (saveError) {
      setError(parseHqBError(saveError.message))
      return
    }
    const created = data as { region_id?: string }
    if (created.region_id) onRegionCreated?.(created.region_id)
  }

  async function proposeCandidates() {
    if (!pdfData) return
    const pdf = await openPdfDocument(pdfData)
    const pdfPage = await pdf.getPage(page.page_number)
    const viewport = pdfPage.getViewport({ scale: 1 })
    const content = await pdfPage.getTextContent()
    setCandidates(
      proposeAutoRegions(
        toPositionedItems(content.items as Array<{ str?: string; transform?: number[] }>, {
          width: viewport.width,
          height: viewport.height,
        }),
        { width: viewport.width, height: viewport.height },
      ),
    )
    await pdf.destroy()
  }

  return (
    <div className="form">
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !pdfData} onClick={() => void runRecognize()}>
          {busy ? '인식 중…' : '문제 인식'}
        </button>
        <button type="button" className="btn ghost" disabled={!pdfData} onClick={() => void proposeCandidates()}>
          자동 영역 후보
        </button>
      </div>
      <p className="hint">인식은 DRAFT 보조값입니다. VERIFIED를 바꾸지 않고, 이미 있는 초안을 자동 덮어쓰지 않습니다.</p>
      {error ? <p className="banner error">{error}</p> : null}
      {info ? <p className="banner success">{info}</p> : null}
      {candidates.length ? (
        <div className="preview-box">
          <p className="muted">자동 후보는 저장 전 확인이 필요합니다.</p>
          <ul>
            {candidates.map((row) => (
              <li key={`${row.problem_number}-${row.bbox.y}`}>
                {row.problem_number}. {row.preview} · y {row.bbox.y.toFixed(2)}
                <button type="button" className="btn ghost" onClick={() => void saveCandidate(row)}>
                  확인 후 저장
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {output ? (
        <div className="recognition-split">
          <div className="preview-box">
            <p className="muted">원본 region · {RECOGNITION_RENDER_SCALE}× (~{Math.round(72 * RECOGNITION_RENDER_SCALE)} DPI)</p>
            {preview ? <img className="region-preview" src={preview} alt="문제 영역 원본" /> : <p>미리보기 없음</p>}
          </div>
          <div className="preview-box">
            <p>
              <strong>{output.verdict}</strong> · {output.engine} {output.engine_version} · {output.processing_mode}
            </p>
            <p className="muted">confidence 숫자 없음 · {output.payload.component_status.join(', ')}</p>
            <p><strong>문제번호</strong> {output.payload.problem_number || '미분리'}</p>
            <p><strong>stem</strong> {output.payload.stem_text || '—'}</p>
            <p><strong>raw</strong> {output.payload.raw_text || '—'}</p>
            {output.payload.math_expressions.length ? (
              <ul>
                {output.payload.math_expressions.map((row) => (
                  <li key={row.original}>
                    {row.original}
                    {row.latex_candidate ? ` → ${row.latex_candidate}` : ''}
                    {row.structure_ok ? '' : ' · 구조 미확정'}
                  </li>
                ))}
              </ul>
            ) : null}
            {output.payload.choices.length ? (
              <ol>
                {output.payload.choices.map((row) => (
                  <li key={row.order}>{row.label} {row.text}</li>
                ))}
              </ol>
            ) : null}
            {output.payload.has_figure ? <p className="banner warn">도형 감지. 원본 이미지를 함께 보세요. 도형을 새로 그리지 않았습니다.</p> : null}
            {output.payload.has_table ? <p className="banner warn">표 형태 감지. 셀 구조는 복원하지 않았습니다.</p> : null}
            {output.payload.warnings.map((row) => (
              <p key={row} className="hint">{row}</p>
            ))}
            <div className="actions">
              <button type="button" className="btn" onClick={() => void createDraftFromRecognition()}>
                인식 결과로 새 초안
              </button>
              {linkedVersionId ? (
                <button type="button" className="btn ghost" onClick={() => void applyToLinkedDraft()}>
                  기존 초안에 적용
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {history.length ? (
        <p className="muted">
          이전 결과 {history.length}개 보관.
          {history[0]?.applied_to_version_id ? ' 최근 결과가 초안에 적용됨.' : ' 아직 자동 적용 없음.'}
        </p>
      ) : null}
    </div>
  )
}
