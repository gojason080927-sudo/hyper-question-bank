import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import { neighborBlocksAutoSafe } from './segmentationV3'
import { detectPageRegions, sidebarOwnership } from './pageRegionV2'
import {
  bboxIsNotIdentity,
  parseGluedDisplayNumber,
  resolveAmbiguousDigits,
  segmentProblemsV31,
} from './problemAnchorV2'

const box = (x: number, y: number, width: number, height: number) =>
  validateBBox({ x, y, width, height, unit: 'normalized', origin: 'top-left' })

describe('STEP 8.19 generic problem-anchor v2', () => {
  it('supports 1/2/3/4 digit display numbers without treating digit count as identity', () => {
    const parsed = [
      parseGluedDisplayNumber('7다음함수의값은?'),
      parseGluedDisplayNumber('44두다항식A=3x'),
      parseGluedDisplayNumber('142a-b=3일때'),
      parseGluedDisplayNumber('0159 | 대표 문제'),
    ]
    expect(parsed.map((row) => row.style)).toEqual(['1_DIGIT', '2_DIGIT', '3_DIGIT', '4_DIGIT'])
    expect(parsed.every((row) => row.display_number)).toBe(true)
    const lone = segmentProblemsV31([{ content: '7', bbox: box(0.5, 0.5, 0.04, 0.02) }])
    expect(lone.problems.some((row) => row.auto_safe)).toBe(false)
    expect(lone.anchors.some((row) => row.display_number === '7' && row.anchor_class === 'PROBLEM_ANCHOR' && row.score > 0.7)).toBe(false)
  })

  it('parses glued number+stem and keeps ambiguous digit runs as REVIEW', () => {
    const glued = parseGluedDisplayNumber('44두다항식A=')
    expect(glued.display_number).toBe('44')
    expect(glued.glued).toBe(true)
    expect(glued.ambiguous).toBe(false)
    const raw = parseGluedDisplayNumber('1452')
    expect(raw.display_number).toBe('1452')
    const resolved = resolveAmbiguousDigits({ run: '1452', rest: '이상의네자연수', sequence: [142, 143, 144, 146] })
    expect(resolved.display_number).toBe('145')
    expect(resolved.ambiguous).toBe(false)
    const still = resolveAmbiguousDigits({ run: '1452', rest: '', sequence: [] })
    expect(still.ambiguous).toBe(true)
    const page = segmentProblemsV31([
      { content: '144모든실수x에대하여값을구하시오', bbox: box(0.13, 0.5, 0.5, 0.03) },
      { content: '1452이상의네자연수a,b값을구하시오', bbox: box(0.13, 0.67, 0.5, 0.03) },
      { content: '146다항식x^3의값을구하시오', bbox: box(0.13, 0.82, 0.5, 0.03) },
    ])
    const hit = page.problems.find((row) => row.display_number === '145')
    expect(hit).toBeTruthy()
    expect(hit?.ambiguous_glue).toBe(false)
    const isolated = segmentProblemsV31([{ content: '1452', bbox: box(0.13, 0.3, 0.2, 0.03) }])
    expect(isolated.problems.some((row) => row.auto_safe && row.display_number === '1452')).toBe(false)
  })

  it('treats sequence as evidence not a hard rule and does not promote theory/choice/step', () => {
    const isolated = segmentProblemsV31([
      { content: '381다음연립방정식을 푸시오.', bbox: box(0.14, 0.4, 0.5, 0.03) },
    ])
    expect(isolated.problems.some((row) => row.display_number === '381')).toBe(true)
    expect(isolated.problems.find((row) => row.display_number === '381')?.auto_safe).toBe(false)
    const oneDigit = segmentProblemsV31([
      { content: '7다음함수의값을구하시오', bbox: box(0.14, 0.3, 0.5, 0.03) },
      { content: '8다음식을전개하시오', bbox: box(0.14, 0.5, 0.5, 0.03) },
    ])
    expect(oneDigit.problems.every((row) => !row.auto_safe)).toBe(true)
    expect(oneDigit.problems.some((row) => row.display_number === '7')).toBe(true)

    const theory = segmentProblemsV31([
      { content: '1다항식에서사용하는용어', bbox: box(0.12, 0.16, 0.4, 0.03) },
      { content: '⑴항:수또는문자의곱', bbox: box(0.13, 0.2, 0.5, 0.03) },
      { content: '2다항식의정리', bbox: box(0.12, 0.7, 0.3, 0.03) },
    ])
    expect(theory.problems.filter((row) => ['1', '2'].includes(row.display_number)).length).toBe(0)
    expect(theory.anchors.some((row) => row.anchor_class === 'THEORY_LIST')).toBe(true)

    const choice = segmentProblemsV31([
      { content: '①-5', bbox: box(0.2, 0.4, 0.1, 0.02) },
      { content: '②-4', bbox: box(0.35, 0.4, 0.1, 0.02) },
    ])
    expect(choice.problems.length).toBe(0)
    expect(choice.anchors.every((row) => row.anchor_class === 'CHOICE_MARKER' || row.anchor_class === 'UNKNOWN')).toBe(true)

    const step = segmentProblemsV31([{ content: 'STEP1Ⅰ-1', bbox: box(0.14, 0.1, 0.3, 0.03) }])
    expect(step.anchors.some((row) => row.anchor_class === 'STEP_MARKER')).toBe(true)
    expect(step.problems.length).toBe(0)
  })

  it('detects a generic sidebar without discarding it and blocks AUTO when rail merges into the stem', () => {
    const blocks = [
      { content: '44두다항식A=3x의값을구하시오', bbox: box(0.13, 0.2, 0.5, 0.03) },
      { content: '45전개식의계수를구하시오', bbox: box(0.13, 0.4, 0.5, 0.03) },
      { content: '46다항식을전개하여값을구하시오', bbox: box(0.13, 0.6, 0.5, 0.03) },
      { content: '생각해봅시다', bbox: box(0.78, 0.22, 0.16, 0.35) },
    ]
    const regions = detectPageRegions(blocks)
    expect(['MAIN_PLUS_SIDEBAR', 'MIXED', 'ONE_COLUMN']).toContain(regions.layout_class)
    expect(regions.sidebar === null || regions.sidebar.kind === 'SIDEBAR').toBe(true)
    const own = regions.sidebar
      ? sidebarOwnership({
          sidebar: regions.sidebar,
          problem_boxes: [
            { display_number: '44', bbox: box(0.12, 0.18, 0.5, 0.18) },
            { display_number: '45', bbox: box(0.12, 0.38, 0.5, 0.18) },
          ],
        })
      : null
    if (own) {
      expect(own.merge_into_stem).toBe(false)
      expect(own.ambiguous ? own.auto_allowed : true).toBe(own.ambiguous ? false : own.auto_allowed)
    }
    const segmented = segmentProblemsV31(blocks)
    expect(segmented.problems.length).toBeGreaterThanOrEqual(2)
    const merged = segmented.problems.filter((row) => row.auto_blockers.includes('sidebar_merged_into_bbox') || row.sidebar_ownership_uncertain)
    expect(merged.length + segmented.problems.filter((row) => row.auto_safe).length).toBeGreaterThanOrEqual(1)
  })

  it('uses the next PROBLEM_ANCHOR for bottom bounds and does not cut figures or ingest neighbor bodies', () => {
    const page = segmentProblemsV31([
      { content: '44두다항식A의값을구하시오', bbox: box(0.13, 0.2, 0.5, 0.03) },
      { content: '① 1 ② 2 ③ 3 ④ 4 ⑤ 5', bbox: box(0.18, 0.32, 0.4, 0.03) },
      { content: '45전개식에서계수를구하시오', bbox: box(0.13, 0.55, 0.5, 0.03) },
      { content: '46다항식X를구하시오', bbox: box(0.13, 0.75, 0.5, 0.03) },
    ])
    const first = page.problems.find((row) => row.display_number === '44')
    expect(first?.next_anchor_class).toBe('PROBLEM_ANCHOR')
    expect(first && first.bbox.y + first.bbox.height).toBeLessThan(0.56)
    const figured = segmentProblemsV31([
      { content: '32오른쪽그림과같이넓이를구하시오', bbox: box(0.15, 0.2, 0.55, 0.03) },
      { content: '33오른쪽그림과같은직육면체을구하시오', bbox: box(0.15, 0.7, 0.55, 0.03) },
    ])
    expect(figured.problems.every((row) => !row.auto_safe)).toBe(true)
    expect(figured.problems[0].bbox.y + figured.problems[0].bbox.height).toBeGreaterThan(0.5)
    expect(neighborBlocksAutoSafe('NEIGHBOR_BODY_INTRUSION')).toBe(true)
    const a = { display_number: '44', bbox: box(0.1, 0.2, 0.4, 0.2) }
    const b = { display_number: '45', bbox: box(0.1, 0.2, 0.4, 0.2) }
    expect(bboxIsNotIdentity(a, b)).toBe(true)
  })

  it('keeps 4-digit workbook anchors as problems so SSEN identities are not demoted to theory', () => {
    const page = segmentProblemsV31([
      { content: '0159 | 대표 문제 이차함수', bbox: box(0.12, 0.2, 0.4, 0.03) },
      { content: '0160 | 대표 문제 값을 구하시오', bbox: box(0.12, 0.45, 0.4, 0.03) },
      { content: '0161 • 다음 중 옳은 것은?', bbox: box(0.12, 0.7, 0.4, 0.03) },
    ])
    expect(page.problems.map((row) => row.display_number)).toEqual(['0159', '0160', '0161'])
    expect(page.anchors.every((row) => row.anchor_class !== 'THEORY_LIST')).toBe(true)
  })
})
