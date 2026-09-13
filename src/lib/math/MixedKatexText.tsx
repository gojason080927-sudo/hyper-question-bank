import type { ReactNode } from 'react'
import { extractMathSpans } from '../editor/mathNormalize'
import { KatexText } from './KatexText'

/** Render Hangul/English stem text with `$...$` / `$$...$$` islands as KaTeX. */
export function MixedKatexText({ text }: { text: string }) {
  if (!text.trim()) return null
  const spans = extractMathSpans(text)
  if (!spans.length) return <>{text}</>
  const parts: Array<{ key: string; node: ReactNode }> = []
  let cursor = 0
  spans.forEach((span, index) => {
    if (span.start > cursor) {
      parts.push({ key: `t${cursor}`, node: text.slice(cursor, span.start) })
    }
    parts.push({
      key: `m${index}`,
      node: <KatexText tex={span.latex} />,
    })
    cursor = span.end
  })
  if (cursor < text.length) parts.push({ key: `t${cursor}`, node: text.slice(cursor) })
  return (
    <>
      {parts.map((part) => (
        <span key={part.key}>{part.node}</span>
      ))}
    </>
  )
}
