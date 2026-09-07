import { describe, expect, it } from 'vitest'
import { bboxToPercentStyle, isValidBBox, normalizeRect, validateBBox } from './bbox'

describe('bbox normalization', () => {
  it('stores ratios, not screen pixels', () => {
    const bbox = normalizeRect(
      { x: 50, y: 80, width: 400, height: 120 },
      { width: 500, height: 800 },
      { width: 612, height: 792 },
    )
    expect(bbox).toMatchObject({
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.15,
      unit: 'normalized',
      origin: 'top-left',
      pageWidth: 612,
      pageHeight: 792,
    })
  })

  it('is stable across zoom because it uses the current viewport size', () => {
    const at1x = normalizeRect({ x: 20, y: 40, width: 160, height: 80 }, { width: 200, height: 400 })
    const at2x = normalizeRect({ x: 40, y: 80, width: 320, height: 160 }, { width: 400, height: 800 })
    expect(at1x.x).toBeCloseTo(at2x.x)
    expect(at1x.y).toBeCloseTo(at2x.y)
    expect(at1x.width).toBeCloseTo(at2x.width)
    expect(at1x.height).toBeCloseTo(at2x.height)
    expect(bboxToPercentStyle(at1x)).toEqual(bboxToPercentStyle(at2x))
  })

  it('accepts dragged rectangles that start from any corner', () => {
    const bbox = normalizeRect({ x: 180, y: 220, width: -80, height: -40 }, { width: 200, height: 400 })
    expect(bbox.x).toBeCloseTo(0.5)
    expect(bbox.y).toBeCloseTo(0.45)
    expect(bbox.width).toBeCloseTo(0.4)
    expect(bbox.height).toBeCloseTo(0.1)
  })
})

describe('bbox validation', () => {
  const ok = { x: 0.1, y: 0.22, width: 0.78, height: 0.16, unit: 'normalized', origin: 'top-left' }

  it('accepts a canonical normalized box', () => {
    expect(validateBBox(ok)).toMatchObject(ok)
    expect(isValidBBox(ok)).toBe(true)
  })

  it('rejects out-of-range and empty boxes', () => {
    expect(isValidBBox({ ...ok, x: -0.01 })).toBe(false)
    expect(isValidBBox({ ...ok, y: -0.2 })).toBe(false)
    expect(isValidBBox({ ...ok, width: 0 })).toBe(false)
    expect(isValidBBox({ ...ok, height: -1 })).toBe(false)
    expect(isValidBBox({ ...ok, x: 0.4, width: 0.7 })).toBe(false)
    expect(isValidBBox({ ...ok, y: 0.9, height: 0.2 })).toBe(false)
  })

  it('rejects pixel-style or unknown units', () => {
    expect(isValidBBox({ ...ok, unit: 'px' })).toBe(false)
    expect(isValidBBox({ ...ok, origin: 'bottom-left' })).toBe(false)
    expect(isValidBBox(null)).toBe(false)
  })
})
