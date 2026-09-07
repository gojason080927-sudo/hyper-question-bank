import type { NormalizedBBox } from '../pdf/bbox'
import type { PositionedTextItem } from './types'

type PdfTextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

export function toPositionedItems(
  items: PdfTextItem[],
  pageSize: { width: number; height: number },
): PositionedTextItem[] {
  if (pageSize.width <= 0 || pageSize.height <= 0) return []
  return items.flatMap((item) => {
    const text = item.str?.trim()
    const t = item.transform
    if (!text || !t || t.length < 6) return []
    return [{
      str: text,
      x: t[4] / pageSize.width,
      y: 1 - t[5] / pageSize.height,
      width: item.width,
      height: item.height,
      fontSize: Math.abs(t[3] || t[0] || 0),
    }]
  })
}

export function itemsInside(
  items: PositionedTextItem[],
  bbox: NormalizedBBox,
): PositionedTextItem[] {
  return items.filter(
    (item) =>
      item.x >= bbox.x &&
      item.x <= bbox.x + bbox.width &&
      item.y >= bbox.y &&
      item.y <= bbox.y + bbox.height,
  )
}
