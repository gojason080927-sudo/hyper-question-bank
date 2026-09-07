import { describe, expect, it } from 'vitest'
import { recognitionDpi } from './renderRegion'
import { RECOGNITION_RENDER_SCALE } from './types'

describe('recognition render scale', () => {
  it('uses 2.5x = 180 DPI for region crops', () => {
    expect(recognitionDpi(RECOGNITION_RENDER_SCALE)).toBe(180)
    expect(recognitionDpi(1.5)).toBe(108)
    expect(recognitionDpi(4)).toBe(288)
  })
})
