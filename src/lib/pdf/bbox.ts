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
