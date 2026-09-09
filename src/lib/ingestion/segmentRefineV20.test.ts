import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import { classifyContextRole, detectExerciseRegions, inExerciseRegion } from './contextRoleV2'
import { detectFigureCandidates, scoreFigureOwnership } from './figureOwnershipV2'
import { AUTO_SCORE_MIN_V20, bodyAttachmentV2, refineSegmentationV20 } from './segmentRefineV20'
import { bboxIsNotIdentity, segmentProblemsV31 } from './problemAnchorV2'

const box = (x: number, y: number, width: number, height: number) =>
  validateBBox({ x, y, width, height, unit: 'normalized', origin: 'top-left' })

const exercisePage = [
  { content: '44두다항식A=3x의값을구하시오', bbox: box(0.13, 0.2, 0.5, 0.03) },
  { content: '45전개식의계수를구하시오', bbox: box(0.13, 0.4, 0.5, 0.03) },
  { content: '46다항식X를구하시오', bbox: box(0.13, 0.6, 0.5, 0.03) },
]

describe('STEP 8.20 context role + figure ownership refine', () => {
  it('classifies exercise, worked example, theory list, and solution steps', () => {
    const refined = refineSegmentationV20(exercisePage, { page: 33 })
    expect(refined.problems.every((row) => row.role === 'EXERCISE_PROBLEM')).toBe(true)
    const example = classifyContextRole({
      display_number: '10',
      body: '행렬의거듭제곱',
      until_next: '풀이 ㉠×2를하면 따라서 A=',
      bbox: box(0.18, 0.1, 0.4, 0.2),
      page_blocks: [
        { content: '10행렬의거듭제곱', bbox: box(0.18, 0.1, 0.4, 0.03) },
        { content: '풀이㉠×2를하면', bbox: box(0.18, 0.22, 0.4, 0.03) },
      ],
      in_exercise_region: false,
      sequence_hit: false,
      style_length: 2,
      header_or_footer: false,
      circled: false,
      step: false,
    })
    expect(example.role).toBe('WORKED_EXAMPLE')
    const theory = classifyContextRole({
      display_number: '1',
      body: '다항식에서사용하는용어',
      until_next: '항:수또는문자',
      bbox: box(0.12, 0.16, 0.3, 0.03),
      page_blocks: [{ content: '1다항식에서사용하는용어', bbox: box(0.12, 0.16, 0.3, 0.03) }],
      in_exercise_region: false,
      sequence_hit: true,
      style_length: 1,
      header_or_footer: false,
      circled: false,
      step: false,
    })
    expect(['THEORY_LIST', 'DEFINITION_ITEM', 'UNKNOWN']).toContain(theory.role)
    const solution = classifyContextRole({
      display_number: '1',
      body: '',
      until_next: '∴ x=1',
      bbox: box(0.2, 0.4, 0.1, 0.02),
      page_blocks: [{ content: '1', bbox: box(0.2, 0.4, 0.1, 0.02) }],
      in_exercise_region: false,
      sequence_hit: false,
      style_length: 1,
      header_or_footer: false,
      circled: false,
      step: false,
    })
    expect(['SOLUTION_STEP', 'UNKNOWN', 'THEORY_LIST']).toContain(solution.role)
  })

  it('protects choice and step markers and blocks UNKNOWN AUTO', () => {
    const choice = refineSegmentationV20([
      { content: '①-5', bbox: box(0.2, 0.3, 0.1, 0.02) },
      { content: '②-4', bbox: box(0.35, 0.3, 0.1, 0.02) },
    ])
    expect(choice.problems.length).toBe(0)
    const step = refineSegmentationV20([{ content: 'STEP1Ⅰ-1', bbox: box(0.14, 0.1, 0.3, 0.03) }])
    expect(step.problems.every((row) => !row.auto_safe)).toBe(true)
    const unknown = classifyContextRole({
      display_number: '9',
      body: 'x',
      until_next: 'x',
      bbox: box(0.4, 0.4, 0.05, 0.02),
      page_blocks: [],
      in_exercise_region: false,
      sequence_hit: false,
      style_length: 1,
      header_or_footer: false,
      circled: false,
      step: false,
    })
    expect(unknown.role).toBe('UNKNOWN')
    expect(AUTO_SCORE_MIN_V20).toBe(0.78)
  })

  it('treats sequence and cross-page continuity as evidence only', () => {
    const isolated = refineSegmentationV20([{ content: '381다음연립방정식을 푸시오.', bbox: box(0.14, 0.4, 0.5, 0.03) }])
    expect(isolated.problems[0]?.auto_safe).toBe(false)
    const continued = refineSegmentationV20([{ content: '144모든실수x의값을구하시오', bbox: box(0.13, 0.2, 0.5, 0.03) }], {
      previous_page_last: 143,
      page: 76,
    })
    expect(continued.problems[0]?.cross_page_continuity).toBe(true)
    expect(continued.problems[0]?.auto_safe).toBe(false)
    const regions = detectExerciseRegions(segmentProblemsV31(exercisePage).problems)
    expect(inExerciseRegion(0.4, regions)).toBe(true)
  })

  it('detects figures, requires high-confidence unique owners, supports shared figures, and blocks neighbor/cut cases', () => {
    const figures = detectFigureCandidates([
      { content: 'A', bbox: box(0.4, 0.25, 0.04, 0.03) },
      { content: 'B', bbox: box(0.5, 0.25, 0.04, 0.03) },
      { content: 'C', bbox: box(0.45, 0.32, 0.04, 0.03) },
    ])
    expect(figures.length).toBeGreaterThan(0)
    const problems = [
      {
        display_number: '32',
        bbox: box(0.12, 0.18, 0.5, 0.25),
        body_preview: '오른쪽그림과같이',
      },
      {
        display_number: '33',
        bbox: box(0.12, 0.5, 0.5, 0.2),
        body_preview: '다음함수',
      },
    ]
    const unique = scoreFigureOwnership({
      figure: figures[0],
      problems: problems as never,
      page_text: '오른쪽그림과같이',
    })
    if (unique.auto_associate) {
      expect(unique.ownership_score).toBeGreaterThanOrEqual(0.85)
      expect(unique.ambiguous).toBe(false)
    }
    const ambiguous = scoreFigureOwnership({
      figure: { bbox: box(0.2, 0.45, 0.3, 0.12), type: 'illustration', confidence: 0.5, evidence: [] },
      problems: [
        { display_number: '1', bbox: box(0.12, 0.2, 0.5, 0.3), body_preview: '오른쪽그림' },
        { display_number: '2', bbox: box(0.12, 0.4, 0.5, 0.3), body_preview: '오른쪽그림' },
      ] as never,
      page_text: '오른쪽그림',
    })
    expect(ambiguous.auto_associate).toBe(false)
    const shared = scoreFigureOwnership({
      figure: { bbox: box(0.2, 0.2, 0.4, 0.2), type: 'illustration', confidence: 0.5, evidence: [] },
      problems: [{ display_number: '1', bbox: box(0.12, 0.18, 0.5, 0.4), body_preview: 'x' }] as never,
      page_text: '다음 그림을 보고 1~3번',
    })
    expect(shared.shared).toBe(true)
    expect(shared.auto_associate).toBe(false)
    const figured = refineSegmentationV20([
      { content: '32오른쪽그림과같이넓이를구하시오', bbox: box(0.15, 0.2, 0.55, 0.03) },
      { content: '33값을구하시오', bbox: box(0.15, 0.7, 0.55, 0.03) },
    ])
    expect(figured.problems.find((row) => row.display_number === '32')?.auto_safe).toBe(false)
  })

  it('uses body attachment v2 and does not treat bbox as identity', () => {
    const attach = bodyAttachmentV2({
      body: '다항식',
      following: '값을구하시오',
      bbox_y: 0.2,
      next_block: { content: '값을구하시오', bbox: box(0.18, 0.23, 0.4, 0.03) },
    })
    expect(attach.attached).toBe(true)
    const a = { display_number: '44', bbox: box(0.1, 0.2, 0.4, 0.2) }
    const b = { display_number: '45', bbox: box(0.1, 0.2, 0.4, 0.2) }
    expect(bboxIsNotIdentity(a, b)).toBe(true)
  })

  it('does not weaken the 0.78 AUTO floor or 4-digit SSEN identities', () => {
    expect(AUTO_SCORE_MIN_V20).toBe(0.78)
    const ssen = refineSegmentationV20([
      { content: '0159 | 대표 문제 이차함수', bbox: box(0.12, 0.2, 0.4, 0.03) },
      { content: '0160 | 대표 문제 값을 구하시오', bbox: box(0.12, 0.45, 0.4, 0.03) },
      { content: '0161 • 다음 중 옳은 것은?', bbox: box(0.12, 0.7, 0.4, 0.03) },
    ])
    expect(ssen.problems.map((row) => row.display_number)).toEqual(['0159', '0160', '0161'])
    expect(ssen.problems.every((row) => row.role !== 'THEORY_LIST' && row.role !== 'SOLUTION_STEP')).toBe(true)
    const base = segmentProblemsV31(exercisePage, { auto_score_min: 0.78 })
    const refined = refineSegmentationV20(exercisePage)
    expect(refined.baseline_auto).toBe(base.problems.filter((row) => row.auto_safe).length)
    expect(AUTO_SCORE_MIN_V20).toBe(0.78)
  })

  it('blocks UNKNOWN from AUTO_SAFE even if the v31 baseline was auto', () => {
    const unknown = classifyContextRole({
      display_number: '9',
      body: 'x',
      until_next: 'x',
      bbox: box(0.4, 0.4, 0.05, 0.02),
      page_blocks: [],
      in_exercise_region: false,
      sequence_hit: false,
      style_length: 1,
      header_or_footer: false,
      circled: false,
      step: false,
    })
    expect(unknown.role).toBe('UNKNOWN')
    const page = refineSegmentationV20([{ content: '9x', bbox: box(0.4, 0.4, 0.05, 0.02) }])
    expect(page.problems.every((row) => !row.auto_safe)).toBe(true)
  })

  it('treats stem figure words as supporting evidence only, not owner proof', () => {
    const owner = scoreFigureOwnership({
      figure: { bbox: box(0.7, 0.7, 0.1, 0.1), type: 'illustration', confidence: 0.4, evidence: [] },
      problems: [{ display_number: '32', bbox: box(0.12, 0.18, 0.4, 0.2), body_preview: '오른쪽그림과같이' }] as never,
      page_text: '오른쪽그림과같이',
    })
    expect(owner.auto_associate).toBe(false)
    expect(owner.ownership_score).toBeLessThan(0.85)
  })

  it('blocks AUTO when a neighboring problem would own the same figure', () => {
    const neighbor = scoreFigureOwnership({
      figure: { bbox: box(0.2, 0.38, 0.4, 0.2), type: 'illustration', confidence: 0.6, evidence: ['overlap'] },
      problems: [
        { display_number: '1', bbox: box(0.12, 0.18, 0.5, 0.28), body_preview: '다음함수' },
        { display_number: '2', bbox: box(0.12, 0.42, 0.5, 0.28), body_preview: '다음함수' },
      ] as never,
      page_text: '',
    })
    expect(neighbor.auto_associate).toBe(false)
    expect(neighbor.ambiguous || neighbor.neighbor_intrusion || neighbor.ownership_score < 0.85).toBe(true)
  })

  it('uses generic exercise-region geometry and has no publisher or page-coordinate decision rules', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files = ['contextRoleV2.ts', 'figureOwnershipV2.ts', 'segmentRefineV20.ts', 'problemAnchorV2.ts', 'pageRegionV2.ts']
    for (const name of files) {
      const src = readFileSync(join(process.cwd(), 'src/lib/ingestion', name), 'utf8')
      expect(src).not.toMatch(/개념원리 공통수학1\(22개정\)/)
      expect(src).not.toMatch(/좋은책신사고|SSEN_NOTE|orange filled circle/)
      expect(src).not.toMatch(/gaenyeom|publisher_id/)
      expect(src).not.toMatch(/page_number\s*===\s*\d+|page\s*===\s*\d+/)
      expect(src).not.toMatch(/#[0-9A-Fa-f]{6}/)
    }
    const regions = detectExerciseRegions(segmentProblemsV31(exercisePage).problems)
    expect(regions.some((row) => row.count >= 2)).toBe(true)
  })
})
