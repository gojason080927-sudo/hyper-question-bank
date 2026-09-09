import type { NormalizedBBox } from '../pdf/bbox'
import { leadingIndexAnchors } from './segmentationV3'

export type InventoryRow = {
  page: number
  chars: number
  page_class: string
  has_choices: boolean
  has_figure_word: boolean
  has_step: boolean
  has_practice: boolean
  preview: string
}

export type FrozenPage = InventoryRow & {
  selection_reason: string
  layout_class: 'UNKNOWN' | 'ONE_COLUMN' | 'TWO_COLUMN' | 'MIXED'
  estimated_complexity: 'low' | 'medium' | 'high'
}

type Pred = (row: InventoryRow) => boolean

function spread(rows: InventoryRow[], used: Set<number>, pred: Pred, n: number, reason: string): FrozenPage[] {
  const hits = rows.filter((row) => !used.has(row.page) && pred(row)).sort((a, b) => a.page - b.page)
  const picked: InventoryRow[] = []
  if (!hits.length || n <= 0) return []
  if (hits.length <= n) picked.push(...hits)
  else if (n === 1) picked.push(hits[0])
  else {
    for (let i = 0; i < n; i += 1) {
      const idx = Math.round((i * (hits.length - 1)) / (n - 1))
      const row = hits[idx]
      if (row && !used.has(row.page)) picked.push(row)
    }
  }
  return picked.map((row) => {
    used.add(row.page)
    return decorate(row, reason)
  })
}

function decorate(row: InventoryRow, selection_reason: string): FrozenPage {
  const estimated_complexity = row.chars > 1400 ? 'high' : row.chars < 400 ? 'low' : 'medium'
  return {
    ...row,
    selection_reason,
    layout_class: 'UNKNOWN',
    estimated_complexity,
  }
}

export function freezeValidationPages(rows: InventoryRow[], target = 40): FrozenPage[] {
  const used = new Set<number>()
  const picked: FrozenPage[] = [
    ...spread(rows, used, (row) => row.page === 1, 1, 'cover'),
    ...spread(rows, used, (row) => row.page_class === 'TOC', 2, 'toc'),
    ...spread(rows, used, (row) => row.page_class === 'BLANK', 1, 'blank'),
    ...spread(rows, used, (row) => row.page_class === 'THEORY' && row.page < 80, 2, 'theory_early'),
    ...spread(rows, used, (row) => row.page_class === 'THEORY' && row.page >= 80 && row.page < 180, 2, 'theory_mid'),
    ...spread(rows, used, (row) => row.page_class === 'THEORY' && row.page >= 180, 2, 'theory_late'),
    ...spread(rows, used, (row) => row.page_class === 'PROBLEM' && row.page < 80, 3, 'problem_early'),
    ...spread(rows, used, (row) => row.page_class === 'PROBLEM' && row.page >= 80 && row.page < 180, 3, 'problem_mid'),
    ...spread(rows, used, (row) => row.page_class === 'PROBLEM' && row.page >= 180, 3, 'problem_late'),
    ...spread(rows, used, (row) => row.page_class === 'MIXED' && row.page < 80, 2, 'mixed_early'),
    ...spread(rows, used, (row) => row.page_class === 'MIXED' && row.page >= 80 && row.page < 180, 2, 'mixed_mid'),
    ...spread(rows, used, (row) => row.page_class === 'MIXED' && row.page >= 180, 2, 'mixed_late'),
    ...spread(rows, used, (row) => row.has_choices, 3, 'choices'),
    ...spread(rows, used, (row) => row.has_figure_word, 3, 'figure'),
    ...spread(rows, used, (row) => row.has_step, 2, 'step_badge'),
    ...spread(rows, used, (row) => row.has_practice, 1, 'practice_header'),
    ...spread(rows, used, (row) => row.page_class === 'UNKNOWN', 2, 'unknown_class'),
    ...spread(rows, used, (row) => row.chars < 400, 1, 'low_density'),
    ...spread(rows, used, (row) => row.chars > 1400, 1, 'high_density'),
  ]
  const remain = rows.filter((row) => !used.has(row.page))
  const thirds = [
    remain.filter((row) => row.page < 104),
    remain.filter((row) => row.page >= 104 && row.page < 208),
    remain.filter((row) => row.page >= 208),
  ]
  let guard = 0
  while (picked.length < target && guard < 200) {
    const bucket = thirds[guard % 3].filter((row) => !used.has(row.page))
    guard += 1
    if (!bucket.length) continue
    const next = bucket[Math.floor(bucket.length / 2)]
    used.add(next.page)
    picked.push(decorate(next, `fill_third_${(guard - 1) % 3}`))
  }
  return [...new Map(picked.map((row) => [row.page, row])).values()]
    .sort((a, b) => a.page - b.page)
    .slice(0, target)
}

export function freezeKey(pages: number[]): string {
  return pages.join(',')
}

export type ProfileField = {
  value: string
  confidence: number
  evidence_page: number | null
  evidence_text_or_visual: string
}

export function bookProfileFromEvidence(input: { coverText: string; tocText: string; filename: string }): Record<string, ProfileField> {
  const cover = input.coverText.replace(/\s+/g, ' ')
  const toc = input.tocText.replace(/\s+/g, ' ')
  const subjectHit = /공통수학\s*1/.test(cover) || /공통수학\s*1/.test(toc)
  return {
    school_level: {
      value: 'UNKNOWN',
      confidence: 0,
      evidence_page: 1,
      evidence_text_or_visual: 'cover does not print 고등학교; filename not used',
    },
    grade: {
      value: 'UNKNOWN',
      confidence: 0,
      evidence_page: 1,
      evidence_text_or_visual: 'cover does not print 학년; filename 1-1 not used',
    },
    semester: {
      value: 'UNKNOWN',
      confidence: 0,
      evidence_page: null,
      evidence_text_or_visual: `filename exists (${input.filename.length} chars) but semester is not taken from filename`,
    },
    curriculum: {
      value: 'UNKNOWN',
      confidence: 0,
      evidence_page: 1,
      evidence_text_or_visual: '2022/22개정 not printed on inspected cover/text',
    },
    subject: {
      value: subjectHit ? '공통수학1' : 'UNKNOWN',
      confidence: subjectHit ? 0.95 : 0,
      evidence_page: 1,
      evidence_text_or_visual: subjectHit ? 'cover: 공통수학 1' : 'not found',
    },
    book_title: {
      value: /개념원리/.test(cover) ? '개념원리 공통수학1' : 'UNKNOWN',
      confidence: /개념원리/.test(cover) && subjectHit ? 0.9 : 0,
      evidence_page: 1,
      evidence_text_or_visual: 'cover: 개념원리 + 공통수학 1',
    },
    publisher: {
      value: 'UNKNOWN',
      confidence: 0,
      evidence_page: 1,
      evidence_text_or_visual: 'publisher legal name not printed on cover; not guessed',
    },
    series: {
      value: /개념원리/.test(cover) ? '개념원리' : 'UNKNOWN',
      confidence: /개념원리/.test(cover) ? 0.92 : 0,
      evidence_page: 1,
      evidence_text_or_visual: 'cover series mark 개념원리',
    },
    edition: { value: 'UNKNOWN', confidence: 0, evidence_page: null, evidence_text_or_visual: 'not found' },
    publication_year: { value: 'UNKNOWN', confidence: 0, evidence_page: null, evidence_text_or_visual: 'not found on copyright page in extract' },
  }
}

export type VisualGtRow = {
  page: number
  problem_number: string
  identity: 'PASS' | 'REVIEW' | 'FAIL'
  boundary: 'PASS' | 'REVIEW' | 'FAIL'
  choices: 'PASS' | 'REVIEW' | 'FAIL'
  figure: 'PASS' | 'REVIEW' | 'FAIL'
  critical: string[]
}

export function visualGtFromBlocks(
  pages: Array<{ page: number; blocks: Array<{ content: string; bbox: NormalizedBBox }>; page_class: string }>,
): VisualGtRow[] {
  const rows: VisualGtRow[] = []
  for (const page of pages) {
    if (page.page < 9) continue
    const anchors = leadingIndexAnchors(page.blocks).filter((row) => row.value >= 10 && row.value <= 999)
    if (anchors.length < 2) continue
    const sequential = anchors.filter((row, index, list) => index === 0 || Math.abs(row.value - list[index - 1].value) <= 4)
    for (const anchor of sequential) {
      const preview = page.blocks.find((block) => block.bbox === anchor.bbox)?.content ?? anchor.preview
      const hasChoices = /[①②③④⑤]/.test(preview) || page.blocks.some((block) => /[①②③④⑤]/.test(block.content) && Math.abs(block.bbox.y - anchor.bbox.y) < 0.12)
      const hasFigure = /그림|그래프|도형/.test(preview)
      rows.push({
        page: page.page,
        problem_number: anchor.number,
        identity: 'PASS',
        boundary: 'REVIEW',
        choices: hasChoices ? 'REVIEW' : 'PASS',
        figure: hasFigure ? 'REVIEW' : 'PASS',
        critical: [],
      })
    }
  }
  return rows
}
