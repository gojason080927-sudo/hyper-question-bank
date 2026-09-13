import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Placeholder } from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { MathBlock, MathInline } from './mathNodes'
import { EditorImage } from './editorImage'

export function createEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
    }),
    TextStyleKit,
    Highlight,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    TableKit.configure({
      table: { resizable: true },
    }),
    EditorImage,
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({
      placeholder: '문제 본문, 수식, 표, 그림을 입력하세요. $...$ 는 인라인 수식입니다.',
    }),
    MathInline,
    MathBlock,
  ]
}
