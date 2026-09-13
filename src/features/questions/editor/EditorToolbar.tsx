import type { Editor } from '@tiptap/react'
import { MATH_TEMPLATES } from '../../../lib/editor/mathNormalize'

type Props = {
  editor: Editor | null
  onSave: () => void
  onPreview: () => void
  onAddToWorksheet: () => void
  onImage: (file: File) => void
  saving: boolean
  dirty: boolean
}

export function EditorToolbar({ editor, onSave, onPreview, onAddToWorksheet, onImage, saving, dirty }: Props) {
  if (!editor) return null
  const fileRef = { current: null as HTMLInputElement | null }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="문제 편집 도구">
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().undo().run()} title="실행 취소">
        되돌리기
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().redo().run()} title="다시 실행">
        다시실행
      </button>
      <button type="button" className={editor.isActive('bold') ? 'btn' : 'btn ghost'} onClick={() => editor.chain().focus().toggleBold().run()}>
        B
      </button>
      <button type="button" className={editor.isActive('italic') ? 'btn' : 'btn ghost'} onClick={() => editor.chain().focus().toggleItalic().run()}>
        I
      </button>
      <button type="button" className={editor.isActive('underline') ? 'btn' : 'btn ghost'} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        U
      </button>
      <button type="button" className={editor.isActive('strike') ? 'btn' : 'btn ghost'} onClick={() => editor.chain().focus().toggleStrike().run()}>
        S
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().toggleSuperscript().run()}>
        x²
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().toggleSubscript().run()}>
        x₂
      </button>
      <select
        aria-label="글꼴"
        onChange={(event) => editor.chain().focus().setFontFamily(event.target.value).run()}
        defaultValue=""
      >
        <option value="">글꼴</option>
        <option value="Pretendard">Pretendard</option>
        <option value="Noto Sans KR">Noto Sans KR</option>
        <option value="serif">명조</option>
        <option value="monospace">고정폭</option>
      </select>
      <select
        aria-label="글자 크기"
        onChange={(event) => editor.chain().focus().setFontSize(event.target.value).run()}
        defaultValue=""
      >
        <option value="">크기</option>
        {['12px', '14px', '16px', '18px', '20px', '24px'].map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <input
        aria-label="글자 색"
        type="color"
        onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
      />
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        좌
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        중
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        우
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        • 목록
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1. 목록
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().sinkListItem('listItem').run()}>
        들여쓰기
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().liftListItem('listItem').run()}>
        내어쓰기
      </button>
      <label className="btn ghost">
        특수문자
        <select
          aria-label="특수문자 삽입"
          defaultValue=""
          onChange={(event) => {
            if (!event.target.value) return
            editor.chain().focus().insertContent(event.target.value).run()
            event.target.value = ''
          }}
        >
          <option value="">삽입</option>
          {['·', '…', '±', '×', '÷', '≠', '≤', '≥', '∞', '°', 'π', '∠', '⊥', '∥', '∵', '∴', '∈', '⊂'].map((ch) => (
            <option key={ch} value={ch}>
              {ch}
            </option>
          ))}
        </select>
      </label>
      <select
        aria-label="수식 템플릿"
        defaultValue=""
        onChange={(event) => {
          const tpl = MATH_TEMPLATES.find((row) => row.id === event.target.value)
          event.target.value = ''
          if (!tpl) return
          if (tpl.display) editor.chain().focus().insertMathBlock(tpl.latex).run()
          else editor.chain().focus().insertMathInline(tpl.latex).run()
        }}
      >
        <option value="">수식</option>
        {MATH_TEMPLATES.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
      </select>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().insertMathInline('').run()}>
        인라인 수식
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().insertMathBlock('').run()}>
        블록 수식
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        표
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().addRowAfter().run()}>
        행+
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().deleteRow().run()}>
        행-
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().addColumnAfter().run()}>
        열+
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().deleteColumn().run()}>
        열-
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().mergeCells().run()}>
        셀 병합
      </button>
      <button type="button" className="btn ghost" onClick={() => editor.chain().focus().splitCell().run()}>
        셀 분할
      </button>
      <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
        이미지
      </button>
      <input
        ref={(node) => {
          fileRef.current = node
        }}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImage(file)
          event.target.value = ''
        }}
      />
      <button type="button" className="btn primary" onClick={onSave} disabled={saving || !dirty}>
        {saving ? '저장 중…' : '저장'}
      </button>
      <button type="button" className="btn" onClick={onPreview}>
        미리보기
      </button>
      <button type="button" className="btn" onClick={onAddToWorksheet}>
        문제지 추가
      </button>
    </div>
  )
}
