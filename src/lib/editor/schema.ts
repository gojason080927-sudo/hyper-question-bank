export const EDITOR_SCHEMA_VERSION = 1 as const
export const ASSET_BUCKET = 'question-bank-assets'
export const ASSET_MAX_BYTES = 8 * 1024 * 1024
export const ASSET_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export type ChoiceLayout = 'VERTICAL' | 'TWO_COLUMN' | 'HORIZONTAL'
export type ItemFormat = 'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'CONSTRUCTED_RESPONSE' | 'MIXED'
export type ProblemBlockId = 'stem' | 'instruction' | 'condition' | 'choices' | 'figure' | 'explanation'

export type EditorMark = {
  type: string
  attrs?: Record<string, unknown>
}

export type EditorNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: EditorNode[]
  text?: string
  marks?: EditorMark[]
}

export type LatexHit = {
  latex: string
  display: boolean
  path: string
}

export type EditorDocument = {
  schema_version: typeof EDITOR_SCHEMA_VERSION
  tiptap_json: EditorNode
  latex_index: LatexHit[]
  blocks: Record<ProblemBlockId, boolean>
  choice_layout: ChoiceLayout
  converted_from_ocr: boolean
  source_text_sha256: string | null
}

export const EMPTY_DOC: EditorNode = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export function emptyEditorDocument(): EditorDocument {
  return {
    schema_version: EDITOR_SCHEMA_VERSION,
    tiptap_json: structuredClone(EMPTY_DOC),
    latex_index: [],
    blocks: {
      stem: true,
      instruction: false,
      condition: false,
      choices: false,
      figure: false,
      explanation: false,
    },
    choice_layout: 'VERTICAL',
    converted_from_ocr: false,
    source_text_sha256: null,
  }
}

export function isEditorDocument(value: unknown): value is EditorDocument {
  if (!value || typeof value !== 'object') return false
  const row = value as EditorDocument
  return row.schema_version === EDITOR_SCHEMA_VERSION && row.tiptap_json?.type === 'doc'
}

export function walkNodes(node: EditorNode, visit: (node: EditorNode, path: string) => void, path = '0'): void {
  visit(node, path)
  node.content?.forEach((child, index) => walkNodes(child, visit, `${path}.${index}`))
}

export function collectLatex(node: EditorNode): LatexHit[] {
  const hits: LatexHit[] = []
  walkNodes(node, (current, path) => {
    if (current.type === 'mathInline' || current.type === 'mathBlock') {
      const latex = String(current.attrs?.latex ?? '')
      hits.push({ latex, display: current.type === 'mathBlock', path })
    }
  })
  return hits
}

export function nodePlainText(node: EditorNode): string {
  if (node.type === 'mathInline' || node.type === 'mathBlock') {
    const latex = String(node.attrs?.latex ?? '')
    return node.type === 'mathBlock' ? `$$${latex}$$` : `$${latex}$`
  }
  if (node.type === 'hardBreak') return '\n'
  if (typeof node.text === 'string') return node.text
  const inner = (node.content ?? []).map(nodePlainText).join('')
  if (['paragraph', 'heading', 'blockquote', 'listItem', 'tableRow'].includes(node.type)) return inner ? `${inner}\n` : ''
  return inner
}

export function documentPlainText(doc: EditorNode): string {
  return nodePlainText(doc).replace(/\n+$/, '')
}

export function stripTransientImageSrc(node: EditorNode): EditorNode {
  const next: EditorNode = { ...node }
  if (node.attrs && (node.type === 'image' || node.type === 'editorImage')) {
    const attrs = { ...node.attrs }
    const src = String(attrs.src ?? '')
    if (src.startsWith('data:') || src.includes('token=')) delete attrs.src
    next.attrs = attrs
  }
  if (node.content) next.content = node.content.map(stripTransientImageSrc)
  if (node.marks) next.marks = node.marks.map((mark) => ({ ...mark }))
  return next
}

export function copyImageStoragePaths(from: EditorNode, to: EditorNode): EditorNode {
  const paths: string[] = []
  walkNodes(from, (current) => {
    if ((current.type === 'image' || current.type === 'editorImage') && current.attrs?.storagePath) {
      paths.push(String(current.attrs.storagePath))
    }
  })
  let index = 0
  const visit = (node: EditorNode): EditorNode => {
    const next: EditorNode = { ...node, attrs: node.attrs ? { ...node.attrs } : undefined }
    if (node.type === 'image' || node.type === 'editorImage') {
      if (!next.attrs?.storagePath && paths[index]) {
        next.attrs = { ...next.attrs, storagePath: paths[index] }
      }
      index += 1
    }
    if (node.content) next.content = node.content.map(visit)
    return next
  }
  return visit(to)
}

export function containsBase64Image(node: EditorNode): boolean {
  let found = false
  walkNodes(node, (current) => {
    const src = String(current.attrs?.src ?? '')
    if (src.startsWith('data:image')) found = true
  })
  return found
}

export function withLatexIndex(doc: EditorDocument): EditorDocument {
  return { ...doc, latex_index: collectLatex(doc.tiptap_json) }
}
