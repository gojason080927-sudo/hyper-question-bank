import { extractMathSpans } from './mathNormalize'
import { sanitizeHtml, looksLikeXss } from './sanitize'
import { EMPTY_DOC, type EditorNode } from './schema'

export type PasteWarning = {
  code: 'HWP_LOSSY' | 'XSS_STRIPPED' | 'DATA_IMAGE' | 'UNKNOWN_CLIPBOARD'
  message: string
}

export type PasteResult = {
  html: string | null
  text: string
  math: Array<{ latex: string; display: boolean }>
  images: Array<{ mime: string; bytes: number }>
  warnings: PasteWarning[]
  dropped: boolean
}

const HWP_HINTS = ['hwp', 'hancom', 'application/x-hwp', 'application/haansofthangul']

function textToParagraphs(text: string): EditorNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const content: EditorNode[] = []
  for (const line of lines) {
    const spans = extractMathSpans(line)
    if (!spans.length) {
      content.push({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })
      continue
    }
    const children: EditorNode[] = []
    let cursor = 0
    for (const span of spans) {
      if (span.start > cursor) children.push({ type: 'text', text: line.slice(cursor, span.start) })
      children.push({
        type: span.display ? 'mathBlock' : 'mathInline',
        attrs: { latex: span.latex },
      })
      cursor = span.end
    }
    if (cursor < line.length) children.push({ type: 'text', text: line.slice(cursor) })
    content.push({ type: 'paragraph', content: children })
  }
  return { type: 'doc', content: content.length ? content : EMPTY_DOC.content }
}

export function inspectClipboard(types: string[], html: string, text: string, imageCount: number): PasteResult {
  const warnings: PasteWarning[] = []
  const lower = types.map((row) => row.toLowerCase())
  if (lower.some((row) => HWP_HINTS.some((hint) => row.includes(hint)))) {
    warnings.push({
      code: 'HWP_LOSSY',
      message: 'HWP 클립보드는 브라우저가 주는 텍스트/이미지만 유지합니다. 원본 서식이 일부 손실될 수 있습니다.',
    })
  }
  if (looksLikeXss(html)) {
    warnings.push({ code: 'XSS_STRIPPED', message: '위험한 HTML(script/event handler)은 제거했습니다.' })
  }
  if (/data:image\//i.test(html) || imageCount > 0) {
    warnings.push({
      code: 'DATA_IMAGE',
      message: '이미지는 Storage에 올린 뒤 삽입합니다. 최종 본문에 base64를 남기지 않습니다.',
    })
  }
  const known = lower.some(
    (row) =>
      row.includes('text/html') ||
      row.includes('text/plain') ||
      row.includes('text/rtf') ||
      row.startsWith('image/') ||
      row.includes('application/xhtml'),
  )
  if (types.length && !known) {
    warnings.push({
      code: 'UNKNOWN_CLIPBOARD',
      message: `알 수 없는 클립보드 형식(${types.join(', ')})입니다. 텍스트/이미지는 유지하고 나머지는 버리지 않고 경고만 표시합니다.`,
    })
  }
  const clean = sanitizeHtml(html)
  return {
    html: clean.trim() ? clean : null,
    text,
    math: extractMathSpans(`${html}\n${text}`).map((row) => ({ latex: row.latex, display: row.display })),
    images: [],
    warnings,
    dropped: false,
  }
}

export function textToEditorDoc(text: string): EditorNode {
  return textToParagraphs(text)
}
