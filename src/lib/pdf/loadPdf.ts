import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { classifyPdfPages, type PdfClassification } from './classifyPdf'
import { joinPageText } from './extractText'
import { pdfIndexToPageNumber } from './pageNumber'

let workerReady = false

export function ensurePdfWorker(): void {
  if (workerReady) return
  GlobalWorkerOptions.workerSrc = pdfWorker
  workerReady = true
}

export async function openPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  ensurePdfWorker()
  try {
    return await getDocument({ data, isEvalSupported: false, disableAutoFetch: true }).promise
  } catch {
    throw new Error('HQB_PDF_RENDER: PDF를 열 수 없습니다. 파일이 손상되었을 수 있습니다.')
  }
}

export async function inspectPdf(data: ArrayBuffer): Promise<{
  pageCount: number
  classification: PdfClassification
  pages: Array<{
    pageNumber: number
    pageWidth: number
    pageHeight: number
    extractedText: string
  }>
}> {
  const pdf = await openPdfDocument(data)
  try {
    const pageCount = pdf.numPages
    if (!pageCount || pageCount < 1) {
      throw new Error('HQB_PAGE_COUNT: 페이지 수를 확인하지 못했습니다.')
    }
    const pages = []
    const signals = []
    for (let index = 0; index < pageCount; index += 1) {
      const pageNumber = pdfIndexToPageNumber(index)
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const textContent = await page.getTextContent()
      const extractedText = joinPageText(textContent.items as Array<{ str?: string }>)
      pages.push({
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        extractedText,
      })
      signals.push({ pageNumber, text: extractedText })
    }
    return {
      pageCount,
      classification: classifyPdfPages(signals),
      pages,
    }
  } finally {
    await pdf.destroy()
  }
}
