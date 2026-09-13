import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { createEditorExtensions } from '../../../lib/editor/kit'
import { inspectClipboard } from '../../../lib/editor/paste'
import type { EditorNode } from '../../../lib/editor/schema'
import type { PasteWarning } from '../../../lib/editor/paste'
import { EditorToolbar } from './EditorToolbar'

type Props = {
  content: EditorNode
  contentKey: string
  onChange: (json: EditorNode) => void
  onSave: () => void
  onPreview: () => void
  onAddToWorksheet: () => void
  onImageFile: (file: File) => void
  onPasteWarnings: (warnings: PasteWarning[]) => void
  saving: boolean
  dirty: boolean
  onEditor?: (editor: Editor | null) => void
}

export function WysiwygEditor({
  content,
  contentKey,
  onChange,
  onSave,
  onPreview,
  onAddToWorksheet,
  onImageFile,
  onPasteWarnings,
  saving,
  dirty,
  onEditor,
}: Props) {
  const editorRef = useRef<Editor | null>(null)
  const editor = useEditor({
    extensions: createEditorExtensions(),
    content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'tiptap-surface', 'aria-label': '문제 본문 편집기' },
      handlePaste(_view, event) {
        const dt = event.clipboardData
        if (!dt) return false
        const files = [...dt.files]
        const image = files.find((file) => file.type.startsWith('image/'))
        if (image) {
          event.preventDefault()
          onImageFile(image)
          return true
        }
        const html = dt.getData('text/html')
        const text = dt.getData('text/plain')
        const inspected = inspectClipboard([...dt.types], html, text, files.length)
        onPasteWarnings(inspected.warnings)
        if (inspected.html) {
          event.preventDefault()
          editorRef.current?.commands.insertContent(inspected.html)
          return true
        }
        if (text.includes('$') || text.includes('\\(')) {
          event.preventDefault()
          editorRef.current?.commands.insertContent(text)
          return true
        }
        return false
      },
      handleDrop(_view, event) {
        const file = event.dataTransfer?.files?.[0]
        if (file?.type.startsWith('image/')) {
          event.preventDefault()
          onImageFile(file)
          return true
        }
        return false
      },
    },
    onCreate: ({ editor: instance }) => {
      editorRef.current = instance
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getJSON() as EditorNode)
    },
  })

  useEffect(() => {
    editorRef.current = editor
    onEditor?.(editor)
  }, [editor, onEditor])

  useEffect(() => {
    if (!editor) return
    const incoming = JSON.stringify(content)
    const current = JSON.stringify(editor.getJSON())
    if (incoming !== current) editor.commands.setContent(content)
    // contentKey remounts conversion from OCR/version restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, editor])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSave()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        editorRef.current?.chain().focus().insertMathInline('').run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSave])

  return (
    <section className="editor-center card">
      <EditorToolbar
        editor={editor}
        onSave={onSave}
        onPreview={onPreview}
        onAddToWorksheet={onAddToWorksheet}
        onImage={onImageFile}
        saving={saving}
        dirty={dirty}
      />
      <EditorContent editor={editor} />
    </section>
  )
}
