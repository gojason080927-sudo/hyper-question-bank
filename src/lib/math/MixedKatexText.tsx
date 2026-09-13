import { Component, type ReactNode } from 'react'
import { splitMathForDisplay } from './splitMathForDisplay'
import { KatexText } from './KatexText'

class MathErrorBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <span className="math-fallback">{this.props.text}</span>
    }
    return this.props.children
  }
}

/** Render Hangul/English stem text with `$...$`, `$$...$$`, and unwrapped LaTeX as KaTeX. */
export function MixedKatexText({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null
  const parts = splitMathForDisplay(text)
  return (
    <MathErrorBoundary text={text}>
      <span className={['mixed-katex', className].filter(Boolean).join(' ')}>
        {parts.map((part, index) =>
          part.kind === 'math' ? (
            <KatexText key={`m${index}`} tex={part.value} display={part.display} />
          ) : (
            <span key={`t${index}`}>{part.value}</span>
          ),
        )}
      </span>
    </MathErrorBoundary>
  )
}
