import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase } from '../../../lib/supabase/client'
import { SIGNED_URL_TTL_SEC, SOURCE_BUCKET } from '../../../lib/pdf/constants'
import { PdfPageViewer } from '../../sources/PdfPageViewer'
import type { SourceRegion } from '../../sources/types'

type SourceInfo = {
  source_document_id: string | null
  page_number: number
  bounding_box: { x: number; y: number; width: number; height: number } | null
}

type Props = {
  problemId: string
}

export function OriginalPane({ problemId }: Props) {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [scale, setScale] = useState(1.1)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<SourceInfo | null>(null)

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      const { data } = await client
        .from('problem_sources')
        .select('source_document_id, bounding_box, source_pages(page_number), source_documents(storage_path, storage_bucket)')
        .eq('problem_id', problemId)
        .eq('is_primary_source', true)
        .maybeSingle()
      if (!data?.source_document_id) {
        setError('연결된 원본 자료가 없습니다.')
        return
      }
      const page = data.source_pages as { page_number?: number } | null
      const doc = data.source_documents as { storage_path?: string; storage_bucket?: string } | null
      setSource({
        source_document_id: data.source_document_id,
        page_number: page?.page_number ?? 1,
        bounding_box: (data.bounding_box as SourceInfo['bounding_box']) ?? null,
      })
      if (!doc?.storage_path) {
        setError('원본 PDF 경로가 없습니다.')
        return
      }
      const signed = await client.storage
        .from(doc.storage_bucket || SOURCE_BUCKET)
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SEC)
      if (signed.error || !signed.data?.signedUrl) {
        setError('원본 PDF를 열 수 없습니다.')
        return
      }
      const response = await fetch(signed.data.signedUrl)
      if (!response.ok) {
        setError('원본 PDF를 내려받지 못했습니다.')
        return
      }
      setPdfData(await response.arrayBuffer())
    })()
  }, [problemId])

  const regions: SourceRegion[] = source?.bounding_box
    ? [
        {
          id: 'crop',
          source_document_id: source.source_document_id ?? '',
          source_page_id: 'crop',
          bbox: {
            ...source.bounding_box,
            unit: 'normalized',
            origin: 'top-left',
          },
          status: 'LINKED',
          original_problem_number: null,
          extracted_text_preview: null,
          created_at: '',
        },
      ]
    : []

  return (
    <aside className="editor-pane original-pane card">
      <h2>원본</h2>
      <div className="page-jump">
        <button type="button" className="btn ghost" onClick={() => setScale((n) => Math.max(0.6, n - 0.15))}>
          -
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" className="btn ghost" onClick={() => setScale((n) => Math.min(2.4, n + 0.15))}>
          +
        </button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      {pdfData && source ? (
        <PdfPageViewer
          pdfData={pdfData}
          pageNumber={source.page_number}
          scale={scale}
          regions={regions}
          selectedRegionId="crop"
          drawing={false}
          onSelectRegion={() => undefined}
          onDraftBBox={() => undefined}
        />
      ) : null}
      {source?.source_document_id ? (
        <p>
          <Link to={`/sources/${source.source_document_id}?page=${source.page_number}`}>자료 페이지 열기</Link>
        </p>
      ) : null}
    </aside>
  )
}
