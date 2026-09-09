export type NormalizedBBox = {
  x: number
  y: number
  width: number
  height: number
  unit: 'normalized'
  origin: 'top-left'
  pageWidth?: number
  pageHeight?: number
}

export type PixelRect = {
  x: number
  y: number
  width: number
  height: number
}

const EPS = 1e-9

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function normalizeRect(
  rect: PixelRect,
  viewport: { width: number; height: number },
  pageSize?: { width: number; height: number },
): NormalizedBBox {
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error('viewport must have positive width and height')
  }
  const left = Math.min(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const width = Math.abs(rect.width)
  const height = Math.abs(rect.height)
  return validateBBox({
    x: left / viewport.width,
    y: top / viewport.height,
    width: width / viewport.width,
    height: height / viewport.height,
    unit: 'normalized',
    origin: 'top-left',
    pageWidth: pageSize?.width,
    pageHeight: pageSize?.height,
  })
}

export function bboxToPercentStyle(bbox: NormalizedBBox): {
  left: string
  top: string
  width: string
  height: string
} {
  return {
    left: `${bbox.x * 100}%`,
    top: `${bbox.y * 100}%`,
    width: `${bbox.width * 100}%`,
    height: `${bbox.height * 100}%`,
  }
}

export function validateBBox(input: unknown): NormalizedBBox {
  if (!input || typeof input !== 'object') {
    throw new Error('영역 좌표가 올바르지 않습니다.')
  }
  const raw = input as Record<string, unknown>
  const x = asFiniteNumber(raw.x)
  const y = asFiniteNumber(raw.y)
  const width = asFiniteNumber(raw.width)
  const height = asFiniteNumber(raw.height)
  if (x === null || y === null || width === null || height === null) {
    throw new Error('영역 좌표가 올바르지 않습니다.')
  }
  const unit = raw.unit == null || raw.unit === '' ? 'normalized' : raw.unit
  const origin = raw.origin == null || raw.origin === '' ? 'top-left' : raw.origin
  if (unit !== 'normalized') {
    throw new Error('좌표 단위는 normalized 여야 합니다.')
  }
  if (origin !== 'top-left') {
    throw new Error('좌표 원점은 top-left 여야 합니다.')
  }
  if (x < -EPS || y < -EPS || width <= EPS || height <= EPS || x + width > 1 + EPS || y + height > 1 + EPS) {
    throw new Error('영역 좌표가 페이지 범위를 벗어났습니다.')
  }
  const pageWidth = asFiniteNumber(raw.pageWidth) ?? undefined
  const pageHeight = asFiniteNumber(raw.pageHeight) ?? undefined
  const result: NormalizedBBox = {
    x: clamp01(x),
    y: clamp01(y),
    width: Math.min(width, 1 - clamp01(x)),
    height: Math.min(height, 1 - clamp01(y)),
    unit: 'normalized',
    origin: 'top-left',
  }
  if (pageWidth && pageWidth > 0) result.pageWidth = pageWidth
  if (pageHeight && pageHeight > 0) result.pageHeight = pageHeight
  return result
}

export function isValidBBox(input: unknown): boolean {
  try {
    validateBBox(input)
    return true
  } catch {
    return false
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): PixelRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

export function pixelCornersToNormalized(
  corners: { left: number; top: number; right: number; bottom: number },
  page: { width: number; height: number },
): NormalizedBBox {
  return normalizeRect(
    {
      x: corners.left,
      y: corners.top,
      width: corners.right - corners.left,
      height: corners.bottom - corners.top,
    },
    page,
    page,
  )
}

export function bboxArea(bbox: NormalizedBBox): number {
  return bbox.width * bbox.height
}

export function bboxCenter(bbox: NormalizedBBox): { x: number; y: number } {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }
}

export function bboxIntersectionArea(a: NormalizedBBox, b: NormalizedBBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= left || bottom <= top) return 0
  return (right - left) * (bottom - top)
}

export function bboxIoU(a: NormalizedBBox, b: NormalizedBBox): number {
  const inter = bboxIntersectionArea(a, b)
  if (inter <= 0) return 0
  const union = bboxArea(a) + bboxArea(b) - inter
  return union <= 0 ? 0 : inter / union
}

export function bboxCoverage(inner: NormalizedBBox, outer: NormalizedBBox): number {
  const area = bboxArea(inner)
  if (area <= 0) return 0
  return bboxIntersectionArea(inner, outer) / area
}

export function unionBBoxes(boxes: NormalizedBBox[]): NormalizedBBox {
  if (boxes.length === 0) {
    throw new Error('영역 좌표가 올바르지 않습니다.')
  }
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return validateBBox({
    x: left,
    y: top,
    width: Math.max(right - left, EPS),
    height: Math.max(bottom - top, EPS),
    unit: 'normalized',
    origin: 'top-left',
  })
}

export function pixelRectFromNormalized(
  bbox: NormalizedBBox,
  page: { width: number; height: number },
): PixelRect {
  if (page.width <= 0 || page.height <= 0) {
    throw new Error('page must have positive width and height')
  }
  const valid = validateBBox(bbox)
  const x = Math.max(0, Math.round(valid.x * page.width))
  const y = Math.max(0, Math.round(valid.y * page.height))
  const right = Math.min(page.width, Math.round((valid.x + valid.width) * page.width))
  const bottom = Math.min(page.height, Math.round((valid.y + valid.height) * page.height))
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  }
}

export function expandBBox(bbox: NormalizedBBox, margin: number): NormalizedBBox {
  const x = Math.max(0, bbox.x - margin)
  const y = Math.max(0, bbox.y - margin)
  return validateBBox({
    x,
    y,
    width: Math.min(1 - x, bbox.width + margin * 2),
    height: Math.min(1 - y, bbox.height + margin * 2),
    unit: 'normalized',
    origin: 'top-left',
    pageWidth: bbox.pageWidth,
    pageHeight: bbox.pageHeight,
  })
}
