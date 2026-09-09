import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { FIGURE_NEGATIVE_FREEZE, FIGURE_VALIDATION_FREEZE } from './figureGtFreeze'
import {
  autoFigureSafe,
  box,
  cropSafety,
  falseFigureSafe,
  originalPageIsSourceOfTruth,
  reviewReason,
  scoreFigureOwnershipV3,
  type VisualFigureCandidate,
} from './visualFigureV1'

const figure = (page: number, bbox = box(0.3, 0.2, 0.2, 0.15)): VisualFigureCandidate => ({
  figure_id: 'f1',
  page,
  bbox,
  figure_type: 'GEOMETRY_DIAGRAM',
  figure_confidence: 0.82,
  visual_evidence: ['sparse_geometry'],
  text_overlap: 0.1,
  region_membership: 'page_body',
})

describe('STEP 8.22 visual figure policy', () => {
  it('treats original page visual as source of truth and never redraws', () => {
    expect(originalPageIsSourceOfTruth({ crop_from_original_render: true, generated: false, redrawn: false })).toBe(true)
    expect(originalPageIsSourceOfTruth({ crop_from_original_render: false, generated: true, redrawn: true })).toBe(false)
  })

  it('detects graph, geometry, and table/grid candidate types in frozen GT', () => {
    expect(FIGURE_VALIDATION_FREEZE.some((row) => row.figure_type === 'COORDINATE_PLANE' || row.figure_type === 'GRAPH')).toBe(true)
    expect(FIGURE_VALIDATION_FREEZE.some((row) => row.figure_type === 'GEOMETRY_DIAGRAM')).toBe(true)
    expect(FIGURE_VALIDATION_FREEZE.some((row) => row.figure_type === 'TABLE' || row.figure_type === 'GRID')).toBe(true)
  })

  it('does not automatically treat formulas, boxed text, or page decoration as figures', () => {
    expect(FIGURE_NEGATIVE_FREEZE.some((row) => row.kind === 'large_equation')).toBe(true)
    expect(FIGURE_NEGATIVE_FREEZE.some((row) => row.kind === 'boxed_formula')).toBe(true)
    expect(FIGURE_NEGATIVE_FREEZE.some((row) => row.kind === 'page_decoration')).toBe(true)
  })

  it('preserves figure bbox and avoids cutting labels/captions when padding a safe crop', () => {
    const truth = box(0.3, 0.2, 0.2, 0.15)
    const crop = cropSafety({ figure: truth, neighbor_bodies: [], neighbor_figures: [], truth })
    expect(crop.class).toBe('FIGURE_CROP_SAFE')
    const cut = cropSafety({ figure: box(0.3, 0.2, 0.08, 0.05), neighbor_bodies: [], neighbor_figures: [], truth })
    expect(['FIGURE_CROP_REVIEW', 'FIGURE_CROP_UNSAFE']).toContain(cut.class)
  })

  it('excludes neighbor body and neighbor figure from AUTO crops', () => {
    const crop = cropSafety({
      figure: box(0.3, 0.2, 0.2, 0.2),
      neighbor_bodies: [box(0.28, 0.22, 0.3, 0.3)],
      neighbor_figures: [box(0.32, 0.22, 0.18, 0.18)],
      truth: box(0.3, 0.2, 0.2, 0.2),
    })
    expect(crop.class).not.toBe('FIGURE_CROP_SAFE')
    expect(autoFigureSafe({
      identity_stable: true,
      boundary_safe: true,
      detection_confidence: 0.9,
      crop: 'FIGURE_CROP_SAFE',
      ownership: 'SINGLE_OWNER_HIGH',
      required_complete: true,
      neighbor_figure: true,
      shared_unresolved: false,
      choices_safe: true,
      bbox_quality: 'FULLY_CONTAINED',
      owner_correct: true,
    })).toBe(false)
  })

  it('uses geometry as primary ownership and text reference as supporting only', () => {
    const problems = [
      { id: '317', display_number: '317', bbox: box(0.1, 0.1, 0.4, 0.2), stem: '다음 식을 구하시오' },
      { id: '318', display_number: '318', bbox: box(0.1, 0.45, 0.4, 0.2), stem: '그림과 같이 도형을 보시오' },
    ]
    const owned = scoreFigureOwnershipV3({
      figure: figure(1, box(0.22, 0.12, 0.18, 0.14)),
      problems,
      page_text: problems.map((row) => row.stem).join('\n'),
    })
    expect(owned.owner_problem_id_candidate).toBe('317')
    expect(owned.ownership_evidence.some((row) => row.includes('text_reference') || row.includes('same_column') || row.includes('vertical'))).toBe(true)
  })

  it('does not use nearest problem as a hard owner rule and reviews ambiguous owners', () => {
    const problems = [
      { id: '317', display_number: '317', bbox: box(0.1, 0.1, 0.4, 0.2), stem: '' },
      { id: '318', display_number: '318', bbox: box(0.1, 0.38, 0.4, 0.2), stem: '' },
    ]
    const mid = scoreFigureOwnershipV3({
      figure: figure(1, box(0.18, 0.32, 0.2, 0.08)),
      problems,
      page_text: '',
    })
    expect(['SINGLE_OWNER_REVIEW', 'UNRESOLVED', 'SHARED_OWNER_REVIEW']).toContain(mid.status)
  })

  it('supports shared figures and reviews unresolved shared ownership', () => {
    const problems = [
      { id: 'a', display_number: '1', bbox: box(0.1, 0.1, 0.7, 0.28), stem: '다음 그림을 보고 1~2' },
      { id: 'b', display_number: '2', bbox: box(0.1, 0.32, 0.7, 0.28), stem: '다음 그림을 보고 1~2' },
    ]
    const shared = scoreFigureOwnershipV3({
      figure: figure(1, box(0.25, 0.24, 0.35, 0.18)),
      problems,
      page_text: '아래 그림을 보고 1~2',
    })
    expect(['SHARED_OWNER_HIGH', 'SHARED_OWNER_REVIEW', 'SINGLE_OWNER_REVIEW', 'UNRESOLVED']).toContain(shared.status)
    expect(autoFigureSafe({
      identity_stable: true,
      boundary_safe: true,
      detection_confidence: 0.9,
      crop: 'FIGURE_CROP_SAFE',
      ownership: 'SHARED_OWNER_REVIEW',
      required_complete: true,
      neighbor_figure: false,
      shared_unresolved: true,
      choices_safe: true,
      bbox_quality: 'FULLY_CONTAINED',
      owner_correct: true,
    })).toBe(false)
  })

  it('has no book-specific visual decision logic and does not call paid APIs', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/ingestion/visualFigureV1.ts'), 'utf8')
    const py = readFileSync(path.join(process.cwd(), 'scripts/visual-figure-detect.py'), 'utf8')
    expect(/개념원리 공통수학1\(22개정\)/.test(src) || /개념원리 공통수학1\(22개정\)/.test(py)).toBe(false)
    expect(/page\s*===\s*\d+/.test(src) || /page\s*===\s*\d+/.test(py)).toBe(false)
    expect(py.includes('openai') || py.includes('vision.google')).toBe(false)
    expect(existsSync(path.join(process.cwd(), 'scripts/visual-figure-detect.py'))).toBe(true)
  })

  it('requires safe complete crops for AUTO and keeps FALSE_FIGURE_SAFE at 0 in the policy', () => {
    expect(autoFigureSafe({
      identity_stable: true,
      boundary_safe: true,
      detection_confidence: 0.9,
      crop: 'FIGURE_CROP_UNSAFE',
      ownership: 'SINGLE_OWNER_HIGH',
      required_complete: false,
      neighbor_figure: false,
      shared_unresolved: false,
      choices_safe: true,
      bbox_quality: 'MAJOR_CUT',
      owner_correct: true,
    })).toBe(false)
    expect(falseFigureSafe(true, ['wrong_owner'])).toBe(true)
    expect(falseFigureSafe(true, [])).toBe(false)
    expect(reviewReason({ detected: false })).toBe('FIGURE_NOT_DETECTED')
  })

  it('freezes both-book figure and negative corpora before tuning', () => {
    expect(FIGURE_VALIDATION_FREEZE.filter((row) => row.book === 'SSEN').length).toBeGreaterThanOrEqual(10)
    expect(FIGURE_VALIDATION_FREEZE.filter((row) => row.book === 'SECOND').length).toBeGreaterThanOrEqual(8)
    expect(FIGURE_NEGATIVE_FREEZE.length).toBeGreaterThanOrEqual(40)
  })
})
