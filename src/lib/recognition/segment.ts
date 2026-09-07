import type { AutoRegionCandidate, PositionedTextItem } from './types'
import { extractProblemNumber } from './structure'

const CHOICE_START = /^[①-⑩]|\(\d{1,2}\)\s|\d{1,2}\)\s/

export function proposeAutoRegions(
  items: PositionedTextItem[],
  pageSize: { width: number; height: number },
): AutoRegionCandidate[] {
  if (pageSize.width <= 0 || pageSize.height <= 0 || items.length === 0) return []
  const heads = items
    .map((item) => {
      const parsed = extractProblemNumber(item.str)
      if (!parsed.number || CHOICE_START.test(item.str) && !/^\d{1,2}[.)]/.test(item.str)) return null
      if (!/^\s*(?:문제\s*)?\d{1,2}\s*[.)]|^\s*\[\d{1,2}\]/.test(item.str)) return null
      return { item, number: parsed.number }
    })
    .filter((row): row is { item: PositionedTextItem; number: string } => Boolean(row))
    .sort((a, b) => a.item.y - b.item.y)

  if (heads.length < 2) {
    return heads.map((head) => ({
      problem_number: head.number,
      bbox: clampBox(0.05, Math.max(0, head.item.y - 0.02), 0.9, 0.2),
      preview: head.item.str,
      needs_review: true,
    }))
  }

  return heads.map((head, index) => {
    const next = heads[index + 1]
    const top = Math.max(0, head.item.y - 0.01)
    const bottom = next ? Math.max(top + 0.04, next.item.y - 0.01) : Math.min(1, top + 0.22)
    return {
      problem_number: head.number,
      bbox: clampBox(0.05, top, 0.9, bottom - top),
      preview: head.item.str,
      needs_review: true,
    }
  })
}

function clampBox(x: number, y: number, width: number, height: number): AutoRegionCandidate['bbox'] {
  const safeX = Math.min(Math.max(x, 0), 0.95)
  const safeY = Math.min(Math.max(y, 0), 0.95)
  const safeW = Math.min(Math.max(width, 0.05), 1 - safeX)
  const safeH = Math.min(Math.max(height, 0.04), 1 - safeY)
  return { x: safeX, y: safeY, width: safeW, height: safeH, unit: 'normalized', origin: 'top-left' }
}
