import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { isValidBBox, type NormalizedBBox } from '../pdf/bbox'
import { canonicalizeProblemNumber, draftIdentityKey } from '../recognition/draftUpsert'
import { bboxIsNotIdentity } from './problemAnchorV2'
import { neighborBlocksAutoSafe, type LayoutTextBlock } from './segmentationV3'
import { layoutFigureReference } from './contextRoleV2'
import { requiredLayoutFigure } from './figureOwnershipV2'
import { lastDisplayNumber, refineSegmentationV20, type RefinedProblem } from './segmentRefineV20'

export const STEP821 = '8.21'
export const STEP821_DIR = 'ocr-tests/taxonomy/step8-21'
export const EXPECTED_PDF_SHA256 = '3b4e789ea8165f0473975d70de8d40658a391b65d21607997b77b468f124a5e9'
export const EXPECTED_PDF_BYTES = 44_554_172
export const EXPECTED_PDF_PAGES = 312
export const PILOT_MAX = 10
export const ROLLBACK_MARKER = 'STEP821-ROLLBACK-TEST'
export const ROLLBACK_NUMBER = '9999'

export type GtRow = {
  page: number
  problem_number: string
  identity: string
  boundary: string
  choices: string
  figure: string
}

export type PilotCandidate = {
  page: number
  display_number: string
  canonical: string
  identity_key_stub: string
  bbox: NormalizedBBox
  role: string
  role_confidence: number
  identity_v3: number
  boundary_confidence: number
  auto_safe: boolean
  auto_blockers: string[]
  stem: string
  figure_status: 'none' | 'unresolved' | 'high_confidence'
  choice_status: 'none' | 'complete' | 'incomplete'
  circled_choice_count: number
  gt_figure: string | null
  crop_page_png: boolean
}

export type PreflightRow = {
  id: string
  pass: boolean
  reasons: string[]
}

function circledCount(text: string): number {
  return [...'①②③④⑤'].filter((mark) => text.includes(mark)).length
}

export function stemFromLayout(blocks: LayoutTextBlock[], problem: RefinedProblem, next?: RefinedProblem): string {
  const untilY = next ? next.bbox.y - 0.002 : 1
  const rows = blocks.filter((block) => {
    if (block.bbox.y < problem.bbox.y - 0.004) return false
    if (block.bbox.y >= untilY) return false
    const sameCol = Math.abs(block.bbox.x - problem.bbox.x) < 0.28 || block.bbox.x >= problem.bbox.x - 0.02
    return sameCol
  })
  return rows
    .map((row) => (row.content ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function listAutoSafeCandidates(input: {
  pages: Array<{ page: number; blocks: LayoutTextBlock[] }>
  gt: GtRow[]
  pagePngExists: (page: number) => boolean
}): { auto_safe_gt: PilotCandidate[]; blocked: Array<{ id: string; reasons: string[] }> } {
  const gtMap = new Map(input.gt.map((row) => [`${row.page}|${row.problem_number}`, row]))
  const auto: PilotCandidate[] = []
  const blocked: Array<{ id: string; reasons: string[] }> = []
  let prevPage: number | null = null
  let prevLast: number | null = null
  const sorted = [...input.pages].sort((a, b) => a.page - b.page)
  for (const page of sorted) {
    const previous = prevPage != null && page.page === prevPage + 1 ? prevLast : null
    const refined = refineSegmentationV20(page.blocks, { page: page.page, previous_page_last: previous })
    prevPage = page.page
    prevLast = lastDisplayNumber(refined.problems)
    for (let i = 0; i < refined.problems.length; i += 1) {
      const problem = refined.problems[i]
      const next = refined.problems[i + 1]
      const id = `${page.page}|${problem.display_number}`
      const gt = gtMap.get(id)
      const stem = stemFromLayout(page.blocks, problem, next)
      const reasons: string[] = []
      if (!problem.auto_safe) reasons.push('NOT_AUTO_SAFE')
      if (problem.role !== 'EXERCISE_PROBLEM') reasons.push('ROLE_NOT_EXERCISE')
      if (problem.role === 'WORKED_EXAMPLE' || problem.role === 'THEORY_LIST' || problem.role === 'SOLUTION_STEP') {
        reasons.push('THEORY_OR_EXAMPLE')
      }
      if (problem.role === 'UNKNOWN') reasons.push('UNKNOWN_ROLE')
      if (!gt) reasons.push('NOT_IN_FROZEN_GT')
      if (gt?.identity === 'FAIL') reasons.push('GT_IDENTITY_FAIL')
      if (gt?.figure === 'REVIEW' || gt?.figure === 'FAIL') reasons.push('FIGURE_AMBIGUOUS')
      if (layoutFigureReference(stem) || requiredLayoutFigure(problem.body_preview)) reasons.push('REQUIRED_FIGURE')
      if (problem.auto_blockers.includes('figure_unresolved') || problem.auto_blockers.includes('figure_owner_ambiguous')) {
        reasons.push('FIGURE_UNRESOLVED')
      }
      if (neighborBlocksAutoSafe(problem.neighbor)) reasons.push('NEIGHBOR_INTRUSION')
      if (!problem.body_attached) reasons.push('BODY_NOT_ATTACHED')
      if (problem.identity_v3 < 0.78) reasons.push('IDENTITY_BELOW_AUTO')
      if (problem.display_number.length < 2) reasons.push('UNSTABLE_DISPLAY')
      if (!canonicalizeProblemNumber(problem.display_number)) reasons.push('CANONICAL_UNSTABLE')
      if (!isValidBBox(problem.bbox)) reasons.push('INVALID_BBOX')
      if (stem.replace(/\s+/g, '').length < 8) reasons.push('STEM_EMPTY')
      if (!input.pagePngExists(page.page)) reasons.push('CROP_PAGE_MISSING')
      const circled = circledCount(stem)
      if (circled > 0) reasons.push('MCQ_NO_CHOICE_PERSIST_PATH')
      const figureStatus: PilotCandidate['figure_status'] =
        layoutFigureReference(stem) || problem.auto_blockers.includes('figure_unresolved')
          ? 'unresolved'
          : problem.figure_owner?.auto_associate
            ? 'high_confidence'
            : 'none'
      if (reasons.length) {
        blocked.push({ id, reasons })
        continue
      }
      auto.push({
        page: page.page,
        display_number: problem.display_number,
        canonical: canonicalizeProblemNumber(problem.display_number) ?? problem.display_number,
        identity_key_stub: `${page.page}|${canonicalizeProblemNumber(problem.display_number)}`,
        bbox: problem.bbox,
        role: problem.role,
        role_confidence: problem.role_confidence,
        identity_v3: problem.identity_v3,
        boundary_confidence: problem.boundary_confidence,
        auto_safe: true,
        auto_blockers: problem.auto_blockers,
        stem,
        figure_status: figureStatus,
        choice_status: circled >= 5 ? 'complete' : circled > 0 ? 'incomplete' : 'none',
        circled_choice_count: circled,
        gt_figure: gt?.figure ?? null,
        crop_page_png: true,
      })
    }
  }
  return { auto_safe_gt: auto, blocked }
}

export function pickPilot(valid: PilotCandidate[], max = PILOT_MAX): PilotCandidate[] {
  if (valid.length <= max) return valid
  const sorted = [...valid].sort((a, b) => a.page - b.page || Number(a.display_number) - Number(b.display_number))
  const pages = sorted.map((row) => row.page)
  const lo = pages[0]
  const hi = pages[pages.length - 1]
  const a = lo + (hi - lo) / 3
  const b = lo + (2 * (hi - lo)) / 3
  const buckets = [
    sorted.filter((row) => row.page <= a),
    sorted.filter((row) => row.page > a && row.page <= b),
    sorted.filter((row) => row.page > b),
  ]
  const picked: PilotCandidate[] = []
  const used = new Set<string>()
  const take = (row: PilotCandidate) => {
    const key = `${row.page}|${row.display_number}`
    if (used.has(key) || picked.length >= max) return
    used.add(key)
    picked.push(row)
  }
  const score = (row: PilotCandidate) => {
    let n = 0
    if (/[=^\\]|frac/.test(row.stem)) n += 2
    if (row.choice_status === 'complete') n += 2
    if (row.display_number.length >= 3) n += 1
    return n
  }
  for (const bucket of buckets) {
    const ranked = [...bucket].sort((x, y) => score(y) - score(x))
    const quota = Math.max(1, Math.floor(max / 3))
    for (const row of ranked.slice(0, quota)) take(row)
  }
  for (const row of sorted) take(row)
  return picked.slice(0, max)
}

export function freezeHash(rows: PilotCandidate[]): string {
  return createHash('sha256')
    .update(rows.map((row) => `${row.page}|${row.canonical}|${row.identity_v3.toFixed(3)}`).join('\n'))
    .digest('hex')
}

export function contentPreflight(row: PilotCandidate, nextDisplay?: string): PreflightRow {
  const reasons: string[] = []
  const id = `${row.page}|${row.display_number}`
  if (!row.auto_safe) reasons.push('NOT_AUTO_SAFE')
  if (row.role !== 'EXERCISE_PROBLEM') reasons.push('ROLE_NOT_EXERCISE')
  if (row.figure_status === 'unresolved') reasons.push('FIGURE_UNRESOLVED')
  if (layoutFigureReference(row.stem)) reasons.push('REQUIRED_FIGURE')
  if (!row.crop_page_png) reasons.push('CROP_MISSING')
  if (!isValidBBox(row.bbox)) reasons.push('INVALID_BBOX')
  if (row.stem.replace(/\s+/g, '').length < 8) reasons.push('STEM_EMPTY')
  if (nextDisplay && new RegExp(`(?:^|\\n)${nextDisplay}[^0-9]`).test(row.stem.slice(Math.floor(row.stem.length * 0.7)))) {
    reasons.push('NEIGHBOR_BODY')
  }
  if (row.choice_status === 'incomplete') reasons.push('CHOICES_INCOMPLETE')
  if (row.identity_v3 < 0.78) reasons.push('IDENTITY_UNSTABLE')
  if (!canonicalizeProblemNumber(row.display_number)) reasons.push('IDENTITY_UNSTABLE')
  return { id, pass: reasons.length === 0, reasons }
}

export function identityExcludesBbox(): boolean {
  const a = { display_number: '44', bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.2, unit: 'normalized' as const, origin: 'top-left' as const } }
  const b = { display_number: '45', bbox: a.bbox }
  return bboxIsNotIdentity(a, b)
}

export function pagePngPath(root: string, page: number): string {
  return path.join(root, 'ocr-tests/taxonomy/step8-18/pages', `page-${String(page).padStart(3, '0')}.png`)
}

export function loadSecondBookInputs(root: string): {
  gt: GtRow[]
  pages: Array<{ page: number; blocks: LayoutTextBlock[] }>
} {
  const gtFile = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-18/visual-ground-truth.json'), 'utf8')) as {
    n: number
    rows: GtRow[]
  }
  if (gtFile.n !== 86) throw new Error('GT 86 mutated')
  const sampleRaw = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-18/_sample-layout-raw.json'), 'utf8')) as {
    pages: Array<{ page: number; blocks: LayoutTextBlock[] }>
  }
  return { gt: gtFile.rows, pages: sampleRaw.pages }
}

export function findPdfByHash(dir: string, expected: string): string | null {
  if (!existsSync(dir)) return null
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.pdf')) continue
    const full = path.join(dir, name)
    if (!statSync(full).isFile()) continue
    const hash = createHash('sha256').update(readFileSync(full)).digest('hex')
    if (hash === expected) return full
  }
  return null
}

export function draftKey(documentId: string, page: number, display: string): string | null {
  return draftIdentityKey({
    source_document_id: documentId,
    page_number: page,
    original_problem_number: display,
  })
}
