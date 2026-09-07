import { describe, expect, it } from 'vitest'
import { recognizeRegionText } from './pipeline'

describe('region recognition pipeline', () => {
  it('clips embedded items in a bbox instead of using the whole page', () => {
    const result = recognizeRegionText({
      rawText: '',
      pageHint: 'TEXT_PDF',
      bbox: { x: 0.05, y: 0.08, width: 0.8, height: 0.15, unit: 'normalized', origin: 'top-left' },
      pageSize: { width: 100, height: 100 },
      items: [
        { str: '7. Solve x² - 5x + 6 = 0 for real x.', transform: [1, 0, 0, 1, 10, 88] },
        { str: 'outside region noise 999', transform: [1, 0, 0, 1, 10, 10] },
      ],
    })
    expect(result.engine).toBe('hqb-embedded-text-v1')
    expect(result.payload.raw_text).toContain('x²')
    expect(result.payload.raw_text).not.toContain('999')
  })

  it('does not invent text for an empty scan region', () => {
    const result = recognizeRegionText({ rawText: '', pageHint: 'SCAN_PDF' })
    expect(result.engine).toBe('hqb-scan-unavailable-v1')
    expect(result.payload.stem_text).toBe('')
    expect(result.payload.answer_candidate).toBeNull()
    expect(result.verdict).toBe('RED')
  })
})
