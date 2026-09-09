import { describe, expect, it } from 'vitest'
import { buildBookStructure } from '../classification/bookStructure'
import { headingProximity, headingShouldNotOverrideStem } from './headingProximity'

const structure = buildBookStructure({
  pageTexts: [
    { page: 6, text: '# I 다항식\n01 다항식의 연산 8\n02 나머지 정리와 인수분해 24' },
    { page: 8, text: '### 01-1 다항식의 덧셈과 뺄셈\n유형 01' },
  ],
  lastPage: 192,
})

describe('heading proximity', () => {
  it('lowers confidence when the nearest heading is far or from a previous section', () => {
    const near = headingProximity(structure, 9)
    expect(near.page_distance).toBe(1)
    expect(near.proximity_score).toBeGreaterThan(0.9)
    expect(headingShouldNotOverrideStem(near)).toBe(false)
    const far = headingProximity(structure, 20)
    expect(far.stale_previous_section || (far.page_distance ?? 0) > 10).toBe(true)
    expect(headingShouldNotOverrideStem(far)).toBe(true)
  })
})
