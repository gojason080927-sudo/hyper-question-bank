export const CIRCLED_CHOICE_LABELS = ['①', '②', '③', '④', '⑤'] as const

export type ChoiceDraft = {
  label: string
  choice_text: string
  math_expression: string
  is_answer?: boolean
}

export function defaultChoices(count = 5): ChoiceDraft[] {
  return CIRCLED_CHOICE_LABELS.slice(0, count).map((label) => ({
    label,
    choice_text: '',
    math_expression: '',
    is_answer: false,
  }))
}

export function addChoice(choices: ChoiceDraft[]): ChoiceDraft[] {
  const nextIndex = Math.min(choices.length, CIRCLED_CHOICE_LABELS.length - 1)
  const label = CIRCLED_CHOICE_LABELS[nextIndex] ?? String(choices.length + 1)
  return [...choices, { label, choice_text: '', math_expression: '', is_answer: false }]
}

export function removeChoice(choices: ChoiceDraft[], index: number): ChoiceDraft[] {
  return choices.filter((_, i) => i !== index).map((row, i) => ({
    ...row,
    label: CIRCLED_CHOICE_LABELS[i] ?? String(i + 1),
  }))
}

export function moveChoice(choices: ChoiceDraft[], from: number, to: number): ChoiceDraft[] {
  if (from < 0 || to < 0 || from >= choices.length || to >= choices.length) return choices
  const next = [...choices]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row)
  return next.map((item, i) => ({ ...item, label: CIRCLED_CHOICE_LABELS[i] ?? String(i + 1) }))
}

export function markAnswer(choices: ChoiceDraft[], index: number): ChoiceDraft[] {
  return choices.map((row, i) => ({ ...row, is_answer: i === index }))
}

export function shouldShowChoices(itemFormat: string): boolean {
  return itemFormat === 'MULTIPLE_CHOICE' || itemFormat === 'MIXED'
}

export function examHidesExplanation(examKind: string): boolean {
  return examKind === 'EXAM'
}
