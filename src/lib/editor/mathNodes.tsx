import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import { MathfieldElement } from 'mathlive'

function renderKatex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex || '', {
      throwOnError: false,
      displayMode: display,
      output: 'html',
    })
  } catch {
    return latex
  }
}

function MathView({ node, updateAttributes, selected, display }: ReactNodeViewProps & { display: boolean }) {
  const [editing, setEditing] = useState(false)
  const host = useRef<HTMLSpanElement>(null)
  const latex = String(node.attrs.latex ?? '')

  useEffect(() => {
    if (!editing || !host.current) return
    const field = new MathfieldElement()
    field.value = latex
    field.mathVirtualKeyboardPolicy = 'auto'
    field.style.minWidth = display ? '100%' : '4em'
    const onInput = () => {
      updateAttributes({ latex: field.value })
    }
    field.addEventListener('input', onInput)
    host.current.replaceChildren(field)
    field.focus()
    return () => {
      field.removeEventListener('input', onInput)
    }
  }, [display, editing, latex, updateAttributes])

  if (editing) {
    return (
      <NodeViewWrapper as={display ? 'div' : 'span'} className={display ? 'math-block editing' : 'math-inline editing'}>
        <span ref={host} />
        <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
          완료
        </button>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      className={`${display ? 'math-block' : 'math-inline'}${selected ? ' is-selected' : ''}`}
      onClick={() => setEditing(true)}
      title={latex}
    >
      <span dangerouslySetInnerHTML={{ __html: renderKatex(latex, display) }} />
    </NodeViewWrapper>
  )
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '', 'data-latex': HTMLAttributes.latex })]
  },
  addNodeView() {
    return ReactNodeViewRenderer((props) => <MathView {...props} display={false} />, { as: 'span' })
  },
  addCommands() {
    return {
      insertMathInline:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '', 'data-latex': HTMLAttributes.latex })]
  },
  addNodeView() {
    return ReactNodeViewRenderer((props) => <MathView {...props} display />, { as: 'div' })
  },
  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: { insertMathInline: (latex?: string) => ReturnType }
    mathBlock: { insertMathBlock: (latex?: string) => ReturnType }
  }
}
