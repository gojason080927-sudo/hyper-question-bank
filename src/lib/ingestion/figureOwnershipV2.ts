import { bboxCenter, bboxCoverage, bboxIoU, validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { layoutFigureReference, sharedFigureCue } from './contextRoleV2'
import type { LayoutTextBlock } from './segmentationV3'

export type FigureKind = 'graph' | 'geometry' | 'table' | 'illustration' | 'boxed' | 'matrix' | 'unknown'

export type FigureCandidate = {
  bbox: NormalizedBBox
  type: FigureKind
  confidence: number
  evidence: string[]
}

export type FigureOwner = {
  owner_candidate: string | null
  ownership_score: number
  ownership_confidence: number
  evidence: string[]
  alternative_owners: Array<{ display_number: string; score: number }>
  shared: boolean
  auto_associate: boolean
  ambiguous: boolean
  boundary_risk: boolean
  neighbor_intrusion: boolean
}

const MATH_HEAVY = /[=^\\]|frac|sqrt|구하|값은/
const LABEL = /^(?:[A-Z]|[가-힣]|[0-9]{1,2}|[ABCDabcd])$/

export function detectFigureCandidates(blocks: LayoutTextBlock[]): FigureCandidate[] {
  const body = blocks.filter((block) => block.bbox.y > 0.07 && block.bbox.y < 0.93 && block.bbox.x >= 0 && block.bbox.x <= 1)
  const out: FigureCandidate[] = []
  const labels = body.filter((block) => {
    const text = (block.content ?? '').replace(/\s+/g, '')
    return text.length > 0 && text.length <= 3 && LABEL.test(text) && block.bbox.width < 0.12
  })
  const used = new Set<number>()
  for (let i = 0; i < labels.length; i += 1) {
    if (used.has(i)) continue
    const seed = labels[i]
    const cluster = labels.filter((other, index) => {
      const close = Math.abs(other.bbox.x - seed.bbox.x) < 0.22 && Math.abs(other.bbox.y - seed.bbox.y) < 0.18
      if (close) used.add(index)
      return close
    })
    if (cluster.length < 3) continue
    const xs = cluster.map((row) => row.bbox.x)
    const ys = cluster.map((row) => row.bbox.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const right = Math.max(...cluster.map((row) => row.bbox.x + row.bbox.width))
    const bottom = Math.max(...cluster.map((row) => row.bbox.y + row.bbox.height))
    out.push({
      bbox: validateBBox({ x, y, width: Math.max(0.08, right - x), height: Math.max(0.08, bottom - y), unit: 'normalized', origin: 'top-left' }),
      type: 'geometry',
      confidence: 0.62,
      evidence: ['label_cluster', `n_${cluster.length}`],
    })
  }
  for (const block of body) {
    const text = (block.content ?? '').replace(/\s+/g, '')
    if (MATH_HEAVY.test(text) && text.length > 16) continue
    if (/[①②③④⑤]/.test(text)) continue
    if (block.bbox.height >= 0.09 && block.bbox.width >= 0.12 && text.length <= 10) {
      out.push({
        bbox: block.bbox,
        type: /표|table/i.test(text) ? 'table' : text.length <= 2 ? 'illustration' : 'unknown',
        confidence: 0.45,
        evidence: ['sparse_block'],
      })
    }
  }
  return out
}

export function scoreFigureOwnership(input: {
  figure: FigureCandidate
  problems: Array<{ display_number: string; bbox: NormalizedBBox; body_preview: string }>
  page_text: string
}): FigureOwner {
  const center = bboxCenter(input.figure.bbox)
  const scored = input.problems.map((problem) => {
    const contained = bboxCoverage(input.figure.bbox, problem.bbox)
    const dist = Math.hypot(center.x - bboxCenter(problem.bbox).x, center.y - bboxCenter(problem.bbox).y)
    const sameCol = center.x >= problem.bbox.x - 0.02 && center.x <= problem.bbox.x + problem.bbox.width + 0.02
    const ref = layoutFigureReference(problem.body_preview)
    let score = 0
    if (sameCol) score += 0.3
    if (contained >= 0.7) score += 0.36
    else if (contained > 0) score += 0.1
    if (dist < 0.18) score += 0.18
    if (ref) score += 0.08
    if (bboxIoU(input.figure.bbox, problem.bbox) > 0 && contained < 0.7) score -= 0.25
    return { display_number: problem.display_number, score: Math.max(0, Math.min(1, score)), contained, problem }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  const shared = sharedFigureCue(input.page_text)
  const ambiguous = Boolean(best && second && Math.abs(best.score - second.score) < 0.08 && second.score >= 0.45)
  const owner = best && best.score >= 0.5 ? best : null
  const crosses = owner ? bboxCoverage(input.figure.bbox, owner.problem.bbox) < 0.7 && bboxIoU(input.figure.bbox, owner.problem.bbox) > 0 : false
  const neighbor = Boolean(
    owner &&
      second &&
      bboxCoverage(input.figure.bbox, second.problem.bbox) > 0.3 &&
      second.display_number !== owner.display_number,
  )
  const auto =
    owner != null &&
    !ambiguous &&
    !shared &&
    owner.score >= 0.85 &&
    owner.contained >= 0.7 &&
    !crosses &&
    !neighbor
  return {
    owner_candidate: owner?.display_number ?? null,
    ownership_score: owner?.score ?? 0,
    ownership_confidence: auto ? 0.88 : ambiguous ? 0.4 : owner ? 0.62 : 0.2,
    evidence: [
      owner ? `best_${owner.display_number}` : 'no_owner',
      `score_${(owner?.score ?? 0).toFixed(2)}`,
      shared ? 'shared_cue' : 'single_owner_model',
    ],
    alternative_owners: scored.slice(1, 3).map((row) => ({ display_number: row.display_number, score: Number(row.score.toFixed(3)) })),
    shared,
    auto_associate: auto,
    ambiguous: ambiguous || (shared && (owner?.score ?? 0) < 0.9),
    boundary_risk: crosses,
    neighbor_intrusion: neighbor,
  }
}

export function requiredLayoutFigure(text: string): boolean {
  return layoutFigureReference(text)
}
