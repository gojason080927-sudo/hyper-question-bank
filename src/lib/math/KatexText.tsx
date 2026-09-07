import katex from 'katex'
import 'katex/dist/katex.min.css'

export function KatexText({ tex, className }: { tex: string; className?: string }) {
  if (!tex.trim()) return null
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: false,
    output: 'html',
  })
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
