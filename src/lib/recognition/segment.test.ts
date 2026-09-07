import { describe, expect, it } from 'vitest'
import { proposeAutoRegions } from './segment'

describe('auto segmentation pilot', () => {
  it('proposes candidates from 1. and 2. and does not treat ① as a new problem', () => {
    const candidates = proposeAutoRegions(
      [
        { str: '1. 2x + 3 = 11', x: 0.1, y: 0.1 },
        { str: '2. x + y = 10', x: 0.1, y: 0.4 },
        { str: '① 2', x: 0.12, y: 0.5 },
      ],
      { width: 612, height: 792 },
    )
    expect(candidates.map((row) => row.problem_number)).toEqual(['1', '2'])
    expect(candidates.every((row) => row.needs_review)).toBe(true)
    expect(candidates[0].bbox.y).toBeLessThan(candidates[1].bbox.y)
  })
})
