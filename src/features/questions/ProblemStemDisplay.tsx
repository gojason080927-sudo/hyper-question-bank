import { MixedKatexText } from '../../lib/math/MixedKatexText'
import { splitSharedRangePrompt } from '../../lib/questions/sharedPromptDisplay'

export function ProblemStemDisplay({ text, className }: { text: string; className?: string }) {
  if (!text?.trim()) return null
  const parts = splitSharedRangePrompt(text)
  if (!parts.shared) return <MixedKatexText text={text} className={className} />
  return (
    <span className={['problem-stem-display', className].filter(Boolean).join(' ')}>
      <span className="shared-prompt">
        <MixedKatexText text={parts.shared} />
      </span>
      {parts.body ? (
        <span className="stem-body">
          <MixedKatexText text={parts.body} />
        </span>
      ) : null}
    </span>
  )
}
