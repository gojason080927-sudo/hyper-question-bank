import type { NormalizedBBox } from '../pdf/bbox'
import { validateBBox } from '../pdf/bbox'
import { openPdfDocument } from '../pdf/loadPdf'
import { RECOGNITION_RENDER_SCALE } from './types'

export async function renderRegionDataUrl(
  pdfData: ArrayBuffer,
  pageNumber: number,
  bbox: NormalizedBBox,
  scale = RECOGNITION_RENDER_SCALE,
): Promise<{ dataUrl: string; width: number; height: number; scale: number }> {
  const box = validateBBox(bbox)
  const pdf = await openPdfDocument(pdfData)
  try {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width * box.width))
    canvas.height = Math.max(1, Math.round(viewport.height * box.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('HQB_PDF_RENDER: 영역을 렌더하지 못했습니다.')
    ctx.save()
    ctx.translate(-Math.round(viewport.width * box.x), -Math.round(viewport.height * box.y))
    await page.render({ canvasContext: ctx, viewport }).promise
    ctx.restore()
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, scale }
  } finally {
    await pdf.destroy()
  }
}

export function recognitionDpi(scale: number): number {
  return Math.round(72 * scale)
}
