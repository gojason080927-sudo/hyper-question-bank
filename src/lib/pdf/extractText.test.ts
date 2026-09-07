import { describe, expect, it } from 'vitest'
import { clipExtractedText, textItemsInBBox } from './extractText'

describe('embedded text helpers', () => {
  it('clips long text and keeps items whose PDF origin falls in the bbox', () => {
    expect(clipExtractedText('  2x + 3 = 11  ')).toBe('2x + 3 = 11')
    const text = textItemsInBBox(
      [
        { str: 'inside', transform: [1, 0, 0, 1, 80, 600] },
        { str: 'outside', transform: [1, 0, 0, 1, 500, 80] },
      ],
      { x: 0.05, y: 0.1, width: 0.4, height: 0.3, unit: 'normalized', origin: 'top-left' },
      { width: 612, height: 792 },
    )
    expect(text).toContain('inside')
    expect(text).not.toContain('outside')
  })
})
