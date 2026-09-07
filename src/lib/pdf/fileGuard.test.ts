import { describe, expect, it } from 'vitest'
import { hasPdfExtension, hasPdfMagic, isAllowedPdfMime, rejectPdfFile } from './fileGuard'

describe('non-PDF rejection', () => {
  it('requires a .pdf extension and PDF mime when present', () => {
    expect(hasPdfExtension('paper.PDF')).toBe(true)
    expect(hasPdfExtension('paper.png')).toBe(false)
    expect(isAllowedPdfMime('application/pdf')).toBe(true)
    expect(isAllowedPdfMime('image/png')).toBe(false)
    expect(isAllowedPdfMime('')).toBe(true)
  })

  it('checks %PDF- magic bytes', () => {
    expect(hasPdfMagic(new TextEncoder().encode('%PDF-1.4\n'))).toBe(true)
    expect(hasPdfMagic(new TextEncoder().encode('PNG'))).toBe(false)
  })

  it('rejects non-PDF files in the upload guard', () => {
    const png = new File(['x'], 'notes.png', { type: 'image/png' })
    expect(rejectPdfFile(png)).toBe('PDF 파일만 업로드할 수 있습니다.')
    const pdf = new File(['%PDF-1.4'], 'owned.pdf', { type: 'application/pdf' })
    expect(rejectPdfFile(pdf)).toBeNull()
  })
})
