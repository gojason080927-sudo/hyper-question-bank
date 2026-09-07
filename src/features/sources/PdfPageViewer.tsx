import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { NormalizedBBox } from '../../lib/pdf/bbox'
import { bboxToPercentStyle, normalizeRect, rectFromPoints, validateBBox } from '../../lib/pdf/bbox'
import { openPdfDocument } from '../../lib/pdf/loadPdf'
import type { SourceRegion } from './types'

type Props = {
  pdfData: ArrayBuffer | null
  pageNumber: number
  scale: number
  regions: SourceRegion[]
  selectedRegionId: string | null
  drawing: boolean
  onSelectRegion: (id: string | null) => void
  onDraftBBox: (bbox: NormalizedBBox | null) => void
}

export function PdfPageViewer({
  pdfData,
  pageNumber,
  scale,
  regions,
  selectedRegionId,
  drawing,
  onSelectRegion,
  onDraftBBox,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!pdfData || !canvasRef.current) return
    let cancelled = false
    void (async () => {
      setError(null)
      try {
        const pdf = await openPdfDocument(pdfData)
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas || cancelled) {
          await pdf.destroy()
          return
        }
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas')
        await page.render({ canvasContext: ctx, viewport }).promise
        await pdf.destroy()
      } catch {
        if (!cancelled) setError('PDF 페이지를 표시하지 못했습니다.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfData, pageNumber, scale])

  function pointFromEvent(event: MouseEvent<HTMLDivElement>) {
    const stage = stageRef.current
    if (!stage) return null
    const rect = stage.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function handleDown(event: MouseEvent<HTMLDivElement>) {
    if (!drawing) return
    const point = pointFromEvent(event)
    if (!point) return
    event.preventDefault()
    drag.current = point
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 })
    onDraftBBox(null)
    onSelectRegion(null)
  }

  function handleMove(event: MouseEvent<HTMLDivElement>) {
    if (!drawing || !drag.current) return
    const point = pointFromEvent(event)
    if (!point) return
    setDraft(rectFromPoints(drag.current, point))
  }

  function handleUp(event: MouseEvent<HTMLDivElement>) {
    if (!drawing || !drag.current || !stageRef.current) return
    const point = pointFromEvent(event)
    const pixel = point ? rectFromPoints(drag.current, point) : draft
    drag.current = null
    if (!pixel || pixel.width < 4 || pixel.height < 4) {
      setDraft(null)
      onDraftBBox(null)
      return
    }
    const stage = stageRef.current
    try {
      const bbox = normalizeRect(pixel, { width: stage.clientWidth, height: stage.clientHeight })
      setDraft(pixel)
      onDraftBBox(validateBBox(bbox))
    } catch {
      setDraft(null)
      onDraftBBox(null)
    }
  }

  return (
    <div className="pdf-viewer">
      {error ? <p className="banner error">{error}</p> : null}
      <div
        ref={stageRef}
        className={`pdf-stage${drawing ? ' drawing' : ''}`}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={() => {
          if (drag.current) {
            drag.current = null
          }
        }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div className="pdf-overlay">
          {regions.map((region) => {
            let bbox: NormalizedBBox
            try {
              bbox = validateBBox(region.bbox)
            } catch {
              return null
            }
            return (
              <button
                key={region.id}
                type="button"
                className={`region-box${selectedRegionId === region.id ? ' selected' : ''}`}
                style={bboxToPercentStyle(bbox)}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!drawing) onSelectRegion(region.id)
                }}
              >
                {region.original_problem_number || '영역'}
              </button>
            )
          })}
          {draft ? (
            <div
              className="region-box draft"
              style={{
                left: `${draft.x}px`,
                top: `${draft.y}px`,
                width: `${draft.width}px`,
                height: `${draft.height}px`,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
