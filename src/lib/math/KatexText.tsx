import 'katex/dist/katex.min.css'
import { safeRenderKatex } from './safeKatex'

export function KatexText({
  tex,
  display = false,
  className,
}: {
  tex: string
  display?: boolean
  className?: string
}) {
  if (!tex.trim()) return null
  const result = safeRenderKatex(tex, display)
  if (!result.ok) {
    return (
      <span className={['math-fallback', className].filter(Boolean).join(' ')} title="수식을 표시하지 못해 원문을 보입니다.">
        {result.fallback}
      </span>
    )
  }
  return (
    <span
      className={[display ? 'math-block' : 'math-inline', className].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  )
}
