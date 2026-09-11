import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIGURE_NEGATIVE_FREEZE, FIGURE_VALIDATION_FREEZE } from './figureGtFreeze'
import { bboxQuality, matchDetectedToTruth, type VisualFigureCandidate } from './visualFigureV1'
import { bboxCoverage, bboxIoU, expandBBox, validateBBox, type NormalizedBBox } from '../pdf/bbox'

const ROOT = process.cwd()
const DETECTOR = path.join(ROOT, 'scripts/visual-figure-detect.py')

function resolvePython(): string[] | null {
  for (const cmd of [['py', '-3'], ['python3'], ['python']]) {
    const probe = spawnSync(cmd[0], [...cmd.slice(1), '-c', 'from PIL import Image'], { encoding: 'utf8' })
    if (probe.status === 0) return cmd
  }
  return null
}

function ssenPage(page: number): string {
  return path.join(ROOT, 'ocr-tests/taxonomy/step8-22/pages/ssen', `page-${String(page).padStart(3, '0')}.png`)
}

function detectSsen(py: string[]): VisualFigureCandidate[] {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hqb-822-'))
  const pages = [...new Set(FIGURE_VALIDATION_FREEZE.filter((row) => row.book === 'SSEN').map((row) => row.page))]
    .filter((page) => existsSync(ssenPage(page)))
    .map((page) => ({ book: 'SSEN', page, path: ssenPage(page), text_boxes: [] }))
  const pagesJson = path.join(tmp, 'pages.json')
  const outJson = path.join(tmp, 'out.json')
  writeFileSync(pagesJson, JSON.stringify(pages))
  const result = spawnSync(py[0], [...py.slice(1), DETECTOR, '--pages-json', pagesJson, '--out', outJson], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0 || !existsSync(outJson)) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error(result.stderr || result.stdout || 'detector failed')
  }
  const raw = JSON.parse(readFileSync(outJson, 'utf8')) as {
    pages: Array<{ page: number; candidates: VisualFigureCandidate[] }>
  }
  rmSync(tmp, { recursive: true, force: true })
  const out: VisualFigureCandidate[] = []
  for (const page of raw.pages ?? []) {
    for (const cand of page.candidates ?? []) {
      out.push({ ...cand, page: cand.page ?? page.page, bbox: validateBBox(cand.bbox) })
    }
  }
  return out
}

function negativeHit(cands: VisualFigureCandidate[], box: NormalizedBBox): boolean {
  return cands.some(
    (cand) =>
      cand.figure_confidence >= 0.7 &&
      bboxIoU(cand.bbox, box) > 0.35 &&
      bboxCoverage(cand.bbox, expandBBox(box, 0.04)) > 0.55,
  )
}

describe('STEP 8.22 SSEN visual detector recovery', () => {
  it('does not alter frozen GT ids', () => {
    const committed = JSON.parse(readFileSync(path.join(ROOT, 'ocr-tests/taxonomy/step8-22/figure-gt.json'), 'utf8')) as {
      rows: Array<{ id: string }>
    }
    expect(FIGURE_VALIDATION_FREEZE.map((row) => row.id)).toEqual(committed.rows.map((row) => row.id))
    expect(FIGURE_VALIDATION_FREEZE).toHaveLength(25)
  })

  it('raises SSEN recall and bbox completeness without inventing SECOND pages', () => {
    const py = resolvePython()
    if (!py) return
    const ssenGt = FIGURE_VALIDATION_FREEZE.filter((row) => row.book === 'SSEN' && existsSync(ssenPage(row.page)))
    expect(ssenGt).toHaveLength(15)
    const cands = detectSsen(py)
    const judged = ssenGt.map((gt) => {
      const matched = matchDetectedToTruth(cands.filter((row) => row.page === gt.page), gt.figure_bbox)
      return {
        id: gt.id,
        detected: Boolean(matched),
        quality: matched ? bboxQuality(matched.bbox, gt.figure_bbox) : null,
      }
    })
    const tp = judged.filter((row) => row.detected).length
    const fn = judged.filter((row) => !row.detected).length
    const complete = judged.filter((row) => row.quality === 'FULLY_CONTAINED' || row.quality === 'MINOR_EDGE_ERROR').length
    const wrong = judged.filter((row) => row.quality === 'WRONG_REGION').length
    const major = judged.filter((row) => row.quality === 'MAJOR_CUT').length
    const fp = FIGURE_NEGATIVE_FREEZE.filter(
      (neg) => neg.book === 'SSEN' && existsSync(ssenPage(neg.page)) && negativeHit(cands.filter((row) => row.page === neg.page), neg.problem_bbox),
    ).length
    expect(judged.find((row) => row.id === '189|1300')?.detected).toBe(true)
    expect(judged.find((row) => row.id === '134|0926')?.quality).toMatch(/FULLY_CONTAINED|MINOR_EDGE_ERROR/)
    expect(fn).toBe(0)
    expect(tp).toBe(15)
    expect(complete).toBeGreaterThanOrEqual(11)
    expect(wrong).toBe(0)
    expect(major).toBeLessThanOrEqual(4)
    expect(fp).toBeLessThanOrEqual(12)
    const secondPage = path.join(ROOT, 'ocr-tests/taxonomy/step8-18/pages/page-026.png')
    expect(existsSync(secondPage)).toBe(false)
  })
})
