/** Display-only split of a shared [n~m] prompt from an individual stem body. */

const RANGE_AT_START = /^\[(\d{1,4})\s*[~～-]\s*(\d{1,4})\]/

export type SharedPromptParts = {
  shared: string | null
  body: string
}

export function splitSharedRangePrompt(text: string): SharedPromptParts {
  const raw = String(text ?? '')
  if (!RANGE_AT_START.test(raw.trimStart())) return { shared: null, body: raw }
  const trimmed = raw.trimStart()
  const newline = trimmed.indexOf('\n')
  if (newline < 0) return { shared: trimmed, body: '' }
  return {
    shared: trimmed.slice(0, newline).trim(),
    body: trimmed.slice(newline + 1).trim(),
  }
}

export function worksheetItemHasSharedCondition(stem: string): boolean {
  const parts = splitSharedRangePrompt(stem)
  return Boolean(parts.shared && parts.body)
}
