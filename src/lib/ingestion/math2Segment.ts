/**
 * 쎈 공통수학 2 problem split dry-run.
 * Reuses classifyBookPageV2 + layoutSegment + 4-digit anchors.
 * Does not call OCR, persist problems, or use SSEN 192/step832 persist.
 */
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import { extractMistralLatex } from '../ocr/normalizeMistral'
import type { LayoutPageInput } from '../recognition/layoutSegment'
import { layoutInputFromProviderLayout, segmentPageFromLayout } from '../recognition/layoutSegment'
import { blockedNonProblemKind, classifyBookPageV2, countAnchorsFromText } from '../recognition/bookClassify'
import { inspectNumberFlowV2 } from '../recognition/bookPipeline'
import {
  candidateIdFor,
  extractOverlappingText,
  looksIncompleteStem,
  stitchCrossPageProblems,
  structureFromRegionText,
  syntheticLayoutFromMarkdown,
} from './fullBookIngest832'
import {
  FORBIDDEN_SOURCE_IDS,
  MATH2_DOCUMENT_ID,
  MATH2_PAGE_COUNT,
  MATH2_TITLE,
  assertMath2Document,
} from './math2Ocr'

export const MATH2_SEGMENT_ENGINE = 'hqb-math2-segment-dry-run'
export type Math2Verdict = 'AUTO_SAFE' | 'NEEDS_REVIEW' | 'BLOCKED'

const TYPE_HEADING = /^(?:유형|부설)\s*0*(\d{1,2})\b/
const RATIO_FALSE_NUMBER = /^(\d{4})\s*[:：]\s*\d/
const WORKBOOK_NUMBER_MAX = 1999

export type Math2PageInput = {
  page: number
  markdown: string
  raw?: MistralOcrLike | null
}

export type Math2ProblemCandidate = {
  page: number
  problem_number: string
  verdict: Math2Verdict
  reasons: string[]
  stem_preview: string
  choice_count: number
  latex_count: number
  image_count: number
  section: string | null
  page_kind: string
  stitched_from_page: number | null
  cross_page: boolean
  segment_status: string
}

export type Math2SegmentReport = {
  sourceId: string
  title: string
  persist_problems: false
  pages: number
  candidates: number
  auto_safe: number
  needs_review: number
  blocked: number
  duplicate_suspects: number
  missing_suspects: number
  reverse_or_jump: number
  cross_page: number
  duplicate_numbers: string[]
  missing_numbers: number[]
  reason_counts: Record<string, number>
  samples: Math2ProblemCandidate[]
  issues: string[]
}

export function assertMath2SegmentSource(sourceId: string): void {
  assertMath2Document(sourceId)
  if (FORBIDDEN_SOURCE_IDS.includes(sourceId as (typeof FORBIDDEN_SOURCE_IDS)[number])) {
    throw new Error('MATH2_SEGMENT_FORBIDDEN: refusing 쎈 공통수학1 / SSEN document')
  }
}

export function refusePersist(argv: string[]): void {
  if (argv.some((flag) => /persist|apply|upsert|register/i.test(flag))) {
    throw new Error('MATH2_SEGMENT_NO_PERSIST: dry-run only; Production problem writes are forbidden')
  }
}

export function extractMath2SectionLabel(text: string): string | null {
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()
    if (!line || line.length > 48) continue
    const type = TYPE_HEADING.exec(line)
    if (type) return `유형 ${type[1]!.padStart(2, '0')}`
    const section = /^(\d{2}-\d)\b/.exec(line)
    if (section) return section[1]!
  }
  return null
}

export function isPlausibleMath2ProblemNumber(number: string, context: string, page: number): boolean {
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1 || n > WORKBOOK_NUMBER_MAX) return false
  const head = context.replace(/!\[[^\]]*]\([^)]*\)/g, ' ').replace(/^#+\s*/, '').trim()
  if (RATIO_FALSE_NUMBER.test(head) && n >= 1000) return false
  if (page <= 5 && n >= 1000) return false
  return true
}

export function layoutForMath2Page(markdown: string, raw?: MistralOcrLike | null): LayoutPageInput {
  const page = raw?.pages?.[0]
  const width = page?.dimensions?.width || 719
  const height = page?.dimensions?.height || 1017
  const images = (page?.images ?? []).flatMap((image, index) => {
    if (image.top_left_x == null || image.top_left_y == null || image.bottom_right_x == null || image.bottom_right_y == null) {
      return []
    }
    return [
      {
        id: image.id ?? `img-${index}`,
        bbox: {
          x: image.top_left_x / width,
          y: image.top_left_y / height,
          width: (image.bottom_right_x - image.top_left_x) / width,
          height: (image.bottom_right_y - image.top_left_y) / height,
          unit: 'normalized' as const,
          origin: 'top-left' as const,
        },
      },
    ]
  })
  if (page?.blocks && page.blocks.length > 0) {
    try {
      return layoutInputFromProviderLayout(
        {
          dimensions: { width, height },
          blocks: page.blocks,
          images: page.images ?? [],
        },
        { width, height },
      )
    } catch {
      /* markdown fallback */
    }
  }
  return syntheticLayoutFromMarkdown(markdown, width, height, images)
}

function stripDifficultyBadge(text: string): string {
  return text.replace(/^\s*#?\s*(\d{4})(?:\s*[•·ㆍ*]+\s*[①-⑤]?)+\s*/gm, '$1 ')
}

function circledChoiceCount(text: string): number {
  const body = stripDifficultyBadge(text).replace(/^\s*#?\s*\d{4}[^\n]{0,20}/, '')
  return new Set(body.match(/[①-⑤]/g) ?? []).size
}

function hasRunningFooter(stem: string): boolean {
  return /\n\s*\d{1,3}\s+[가-힣]{2,10}\s*$/.test(stem.trim())
}

function stemLooksFinished(stem: string, choiceCount: number): boolean {
  if (choiceCount >= 4) return true
  const compact = stem.replace(/\s+/g, ' ').trim()
  return /구하시오\.?$|고르시오\.?$|쓰시오\.?$|값은\?$|합은\?$|개수는\?$|넓이는\?$|좌표$|길이는\?$/.test(compact)
}

export function verdictForCandidate(input: {
  page_kind: string
  plausible: boolean
  unique: boolean
  flow_ok: boolean
  segment_status: string
  stem: string
  choice_count: number
  incomplete: boolean
  stitched: boolean
  page_tail?: boolean
}): { verdict: Math2Verdict; reasons: string[] } {
  const reasons: string[] = []
  if (!input.plausible) reasons.push('FALSE_OR_OUT_OF_RANGE_NUMBER')
  if (blockedNonProblemKind(input.page_kind as 'PROBLEM') && input.page_kind !== 'UNKNOWN') {
    reasons.push(`NON_PROBLEM_PAGE:${input.page_kind}`)
  }
  if (!input.unique) reasons.push('DUPLICATE_NUMBER')
  if (!input.flow_ok) reasons.push('NUMBER_FLOW')
  if (input.segment_status !== 'AUTO_OK') reasons.push('SEGMENT_REVIEW')
  if (input.stem.replace(/\s+/g, '').length < 8) reasons.push('THIN_STEM')
  if (hasRunningFooter(input.stem)) reasons.push('RUNNING_FOOTER')
  if (input.incomplete) reasons.push('INCOMPLETE_AT_PAGE_BREAK')
  if (input.stitched) reasons.push('CROSS_PAGE_STITCH')
  if (input.page_tail && input.choice_count < 4) reasons.push('PAGE_TAIL')
  if (input.choice_count > 0 && input.choice_count < 4) reasons.push('CHOICES_INCOMPLETE')
  if (!stemLooksFinished(input.stem, input.choice_count)) reasons.push('STEM_MAY_BE_CUT')

  if (
    reasons.includes('FALSE_OR_OUT_OF_RANGE_NUMBER') ||
    reasons.includes('DUPLICATE_NUMBER') ||
    reasons.includes('THIN_STEM') ||
    reasons.some((row) => row.startsWith('NON_PROBLEM_PAGE'))
  ) {
    return { verdict: 'BLOCKED', reasons }
  }
  if (reasons.length > 0) return { verdict: 'NEEDS_REVIEW', reasons }
  return { verdict: 'AUTO_SAFE', reasons: [] }
}

export function pickMath2Samples(rows: Math2ProblemCandidate[]): Math2ProblemCandidate[] {
  const groups: Array<(row: Math2ProblemCandidate) => boolean> = [
    (row) => row.page <= 20 && row.verdict === 'AUTO_SAFE',
    (row) => row.page >= 70 && row.page <= 110 && row.choice_count >= 4,
    (row) => row.page >= 150 && row.latex_count > 0,
    (row) => row.image_count > 0,
    (row) => row.cross_page,
    (row) => row.verdict === 'NEEDS_REVIEW',
    (row) => row.verdict === 'BLOCKED',
    (row) => Boolean(row.section),
  ]
  const picked: Math2ProblemCandidate[] = []
  const used = new Set<string>()
  const key = (row: Math2ProblemCandidate) => `${row.page}:${row.problem_number}`
  for (const match of groups) {
    const hit = rows.find((row) => match(row) && !used.has(key(row)))
    if (hit) {
      used.add(key(hit))
      picked.push(hit)
    }
  }
  return picked
}

export function runMath2Segment(pages: Math2PageInput[], sourceId = MATH2_DOCUMENT_ID): Math2SegmentReport {
  assertMath2SegmentSource(sourceId)
  if (pages.length !== MATH2_PAGE_COUNT) {
    throw new Error(`MATH2_SEGMENT_PAGE_COUNT: expected ${MATH2_PAGE_COUNT}, got ${pages.length}`)
  }

  let lastSection: string | null = null
  const rawCandidates: Array<{
    page: number
    problem_number: string
    page_kind: string
    plausible: boolean
    segment_status: string
    stem: string
    choice_count: number
    latex_count: number
    image_count: number
    section: string | null
    bbox: ReturnType<typeof layoutForMath2Page>['blocks'][number]['bbox']
    incomplete: boolean
    page_tail: boolean
    text: string
  }> = []

  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    const anchors = countAnchorsFromText(page.markdown)
    const kind = classifyBookPageV2({
      page_number: page.page,
      total_pages: MATH2_PAGE_COUNT,
      ink_ratio: null,
      has_ocr: page.markdown.length > 0,
      cache_text: page.markdown,
      four_digit_count: anchors.four_digit,
      section_count: anchors.section,
      block_count: page.raw?.pages?.[0]?.blocks?.length ?? 0,
      image_count: page.raw?.pages?.[0]?.images?.length ?? 0,
    })
    const section = extractMath2SectionLabel(page.markdown) ?? lastSection
    if (extractMath2SectionLabel(page.markdown)) lastSection = extractMath2SectionLabel(page.markdown)

    let layout = layoutForMath2Page(page.markdown, page.raw)
    let segmented
    try {
      segmented = segmentPageFromLayout(layout)
    } catch {
      try {
        layout = syntheticLayoutFromMarkdown(page.markdown, layout.pageWidth || 719, layout.pageHeight || 1017, [])
        segmented = segmentPageFromLayout(layout)
      } catch {
        continue
      }
    }
    const fourDigitRegions = segmented.regions.filter((region) => region.kind === 'four_digit' && region.detected_problem_number)
    const tailY = fourDigitRegions.reduce((max, region) => Math.max(max, region.bbox.y), -1)
    for (const region of fourDigitRegions) {
      const bbox = region.bbox
      const text = stripDifficultyBadge(extractOverlappingText(layout.blocks, bbox) || region.preview || '')
      const structured = structureFromRegionText(text)
      const choiceCount = Math.max(structured.choice_count, circledChoiceCount(text))
      rawCandidates.push({
        page: page.page,
        problem_number: region.detected_problem_number,
        page_kind: kind.page_kind,
        plausible: isPlausibleMath2ProblemNumber(region.detected_problem_number, text || region.preview, page.page),
        segment_status: region.status,
        stem: structured.stem,
        choice_count: choiceCount,
        latex_count: extractMistralLatex(text).length,
        image_count: region.assigned_images.length,
        section,
        bbox,
        incomplete: looksIncompleteStem(text, choiceCount, bbox),
        page_tail: region.bbox.y === tailY,
        text,
      })
    }
  }

  const stitched = stitchCrossPageProblems(
    rawCandidates.map((row) => ({
      candidate_id: candidateIdFor(row.page, row.problem_number, row.problem_number),
      page: row.page,
      problem_number: row.problem_number,
      canonical: row.problem_number,
      bbox: row.bbox,
      text: row.text,
      choice_count: row.choice_count,
      incomplete: row.incomplete,
    })),
  )
  const stitchedById = new Map(stitched.map((row) => [row.candidate_id, row]))
  const kept = rawCandidates.filter((row) => stitchedById.has(candidateIdFor(row.page, row.problem_number, row.problem_number)))

  const flow = inspectNumberFlowV2(kept.filter((row) => row.plausible).map((row) => ({ page: row.page, problem_number: row.problem_number })))
  const flowByKey = new Map(flow.rows.map((row) => [`${row.page}:${row.problem_number}`, row]))
  const counts = new Map<string, number>()
  for (const row of kept) counts.set(row.problem_number, (counts.get(row.problem_number) ?? 0) + 1)

  const candidates: Math2ProblemCandidate[] = kept.map((row) => {
    const id = candidateIdFor(row.page, row.problem_number, row.problem_number)
    const stitch = stitchedById.get(id)
    const flowRow = flowByKey.get(`${row.page}:${row.problem_number}`)
    const unique = (counts.get(row.problem_number) ?? 0) <= 1
    const decided = verdictForCandidate({
      page_kind: row.page_kind,
      plausible: row.plausible,
      unique,
      flow_ok: !flowRow || flowRow.status === 'NORMAL' || flowRow.status === 'EXPECTED_BOOK_STRUCTURE',
      segment_status: row.segment_status,
      stem: stitch?.text ?? row.stem,
      choice_count: stitch?.choice_count ?? row.choice_count,
      incomplete: Boolean(stitch?.incomplete ?? row.incomplete),
      stitched: Boolean(stitch?.stitched_from_page),
      page_tail: row.page_tail && !stitch?.stitched_from_page,
    })
    const preview = (stitch?.text ?? row.stem).replace(/\s+/g, ' ').trim().slice(0, 160)
    return {
      page: row.page,
      problem_number: row.problem_number,
      verdict: decided.verdict,
      reasons: decided.reasons,
      stem_preview: preview,
      choice_count: stitch?.choice_count ?? row.choice_count,
      latex_count: row.latex_count,
      image_count: row.image_count,
      section: row.section,
      page_kind: row.page_kind,
      stitched_from_page: stitch?.stitched_from_page ?? null,
      cross_page: Boolean(stitch?.stitched_from_page),
      segment_status: row.segment_status,
    }
  })

  const numbers = candidates
    .filter((row) => row.verdict !== 'BLOCKED')
    .map((row) => Number(row.problem_number))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
  const missing: number[] = []
  for (let i = 1; i < numbers.length; i += 1) {
    const prev = numbers[i - 1]!
    const cur = numbers[i]!
    if (cur - prev > 1 && cur - prev <= 8) {
      for (let n = prev + 1; n < cur; n += 1) missing.push(n)
    }
  }

  const issues: string[] = []
  if (flow.duplicate) issues.push(`duplicate_numbers:${flow.duplicate}`)
  if (flow.suspicious_jump) issues.push(`same_page_gaps:${flow.suspicious_jump}`)
  if (flow.reverse) issues.push(`reverse:${flow.reverse}`)
  if (missing.length) issues.push(`short_gaps:${missing.length}`)
  const reason_counts: Record<string, number> = {}
  for (const row of candidates) {
    for (const reason of row.reasons) reason_counts[reason] = (reason_counts[reason] ?? 0) + 1
  }
  const duplicate_numbers = [...new Set(candidates.filter((row) => row.reasons.includes('DUPLICATE_NUMBER')).map((row) => row.problem_number))]

  return {
    sourceId: MATH2_DOCUMENT_ID,
    title: MATH2_TITLE,
    persist_problems: false,
    pages: pages.length,
    candidates: candidates.length,
    auto_safe: candidates.filter((row) => row.verdict === 'AUTO_SAFE').length,
    needs_review: candidates.filter((row) => row.verdict === 'NEEDS_REVIEW').length,
    blocked: candidates.filter((row) => row.verdict === 'BLOCKED').length,
    duplicate_suspects: flow.duplicate,
    missing_suspects: missing.length,
    reverse_or_jump: flow.reverse + flow.suspicious_jump,
    cross_page: candidates.filter((row) => row.cross_page).length,
    duplicate_numbers,
    missing_numbers: missing.slice(0, 40),
    reason_counts,
    samples: pickMath2Samples(candidates),
    issues,
  }
}

export function formatMath2SegmentMarkdown(report: Math2SegmentReport): string {
  const sampleLines = report.samples.map(
    (row) =>
      `- p${row.page} #${row.problem_number} ${row.verdict} choices=${row.choice_count} latex=${row.latex_count} img=${row.image_count} section=${row.section ?? '—'} stitch=${row.stitched_from_page ?? 'no'}\n  ${row.reasons.join(', ') || 'clear'}\n  ${row.stem_preview}`,
  )
  return [
    `# 쎈 공통수학 2 problem split dry-run`,
    ``,
    `- document_id: ${report.sourceId}`,
    `- pages: ${report.pages}`,
    `- candidates: ${report.candidates}`,
    `- AUTO_SAFE / NEEDS_REVIEW / BLOCKED: ${report.auto_safe} / ${report.needs_review} / ${report.blocked}`,
    `- duplicate / missing-gap / reverse+jump / cross-page: ${report.duplicate_suspects} / ${report.missing_suspects} / ${report.reverse_or_jump} / ${report.cross_page}`,
    `- persist problems: false`,
    `- issues: ${report.issues.join('; ') || 'none'}`,
    `- duplicate numbers: ${report.duplicate_numbers.join(', ') || 'none'}`,
    `- missing (first 40 short gaps): ${report.missing_numbers.join(', ') || 'none'}`,
    `- reasons: ${Object.entries(report.reason_counts).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    ``,
    `## samples`,
    ...sampleLines,
    ``,
  ].join('\n')
}
