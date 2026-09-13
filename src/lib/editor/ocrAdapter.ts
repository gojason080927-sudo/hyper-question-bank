import { collectLatex, documentPlainText, emptyEditorDocument, withLatexIndex, type EditorDocument, type EditorNode } from './schema'
import { extractMathSpans } from './mathNormalize'
import { textToEditorDoc } from './paste'

export type ConversionDiff = {
  equal: boolean
  ocr: string
  converted: string
  ocrSha256: string
  convertedSha256: string
}

/** Stable browser-safe fingerprint (not a cryptographic claim in the UI). */
export function textFingerprint(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${text.length.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function ocrTextToDocument(ocrText: string, instruction?: string | null): EditorDocument {
  const doc = emptyEditorDocument()
  const body = textToEditorDoc(ocrText)
  const content: EditorNode[] = []
  if (instruction?.trim()) {
    content.push({
      type: 'paragraph',
      attrs: { block: 'instruction' },
      content: [{ type: 'text', text: instruction.trim() }],
    })
    doc.blocks.instruction = true
  }
  content.push(...(body.content ?? []))
  doc.tiptap_json = { type: 'doc', content }
  doc.converted_from_ocr = true
  doc.source_text_sha256 = textFingerprint(ocrText)
  doc.latex_index = collectLatex(doc.tiptap_json)
  doc.blocks.stem = true
  return withLatexIndex(doc)
}

export function conversionDiff(ocrText: string, converted: EditorNode): ConversionDiff {
  const ocr = ocrText.replace(/\s+/g, ' ').trim()
  const next = documentPlainText(converted).replace(/\s+/g, ' ').trim()
  return {
    equal: ocr === next,
    ocr,
    converted: next,
    ocrSha256: textFingerprint(ocr),
    convertedSha256: textFingerprint(next),
  }
}

export function ensureMathFromPlain(text: string): EditorNode {
  if (!extractMathSpans(text).length) return textToEditorDoc(text)
  return textToEditorDoc(text)
}
