import { MAX_PDF_BYTES } from './constants'

const PDF_MIME = new Set(['application/pdf', 'application/x-pdf'])

export function hasPdfExtension(filename: string): boolean {
  return filename.trim().toLowerCase().endsWith('.pdf')
}

export function isAllowedPdfMime(mime: string | null | undefined): boolean {
  if (!mime) return true
  return PDF_MIME.has(mime.toLowerCase())
}

export function hasPdfMagic(bytes: ArrayBuffer | Uint8Array): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view.byteLength < 5) return false
  return (
    view[0] === 0x25 &&
    view[1] === 0x50 &&
    view[2] === 0x44 &&
    view[3] === 0x46 &&
    view[4] === 0x2d
  )
}

export function rejectPdfFile(file: File): string | null {
  if (!hasPdfExtension(file.name)) return 'PDF 파일만 업로드할 수 있습니다.'
  if (!isAllowedPdfMime(file.type)) return 'PDF 파일만 업로드할 수 있습니다.'
  if (file.size <= 0) return '파일 크기가 올바르지 않습니다.'
  if (file.size > MAX_PDF_BYTES) return 'PDF는 50MB 이하여야 합니다.'
  return null
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
}
