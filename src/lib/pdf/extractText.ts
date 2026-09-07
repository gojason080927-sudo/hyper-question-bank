import type { NormalizedBBox } from './bbox'
import { EXTRACT_TEXT_LIMIT } from './constants'

type TextItem = {
  str?: string
  transform?: number[]
}

export function clipExtractedText(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= EXTRACT_TEXT_LIMIT) return trimmed
  return trimmed.slice(0, EXTRACT_TEXT_LIMIT)
}

export function textItemsInBBox(
  items: TextItem[],
  bbox: NormalizedBBox,
  pageSize: { width: number; height: number },
): string {
  if (pageSize.width <= 0 || pageSize.height <= 0) return ''
  const parts: string[] = []
  for (const item of items) {
    const text = item.str?.trim()
    const t = item.transform
    if (!text || !t || t.length < 6) continue
    const x = t[4] / pageSize.width
    const y = 1 - t[5] / pageSize.height
    if (x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height) {
      parts.push(text)
    }
  }
  return clipExtractedText(parts.join(' '))
}

export function joinPageText(items: TextItem[]): string {
  return clipExtractedText(items.map((item) => item.str ?? '').join(' '))
}
