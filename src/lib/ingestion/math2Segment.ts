/**
 * 쎈 공통수학 2 problem split dry-run.
 * Markdown spans to the next 4-digit / 유형 heading; layoutSegment is not rewritten.
 * No OCR, no Production persist, no SSEN 192 path.
 */
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import { extractMistralLatex } from '../ocr/normalizeMistral'
import { blockedNonProblemKind, classifyBookPageV2, countAnchorsFromText } from '../recognition/bookClassify'
import { inspectNumberFlowV2 } from '../recognition/bookPipeline'
import { structureFromRegionText } from './fullBookIngest832'
import {
  FORBIDDEN_SOURCE_IDS,
  MATH2_DOCUMENT_ID,
  MATH2_PAGE_COUNT,
  MATH2_TITLE,
  assertMath2Document,
} from './math2Ocr'

export const MATH2_SEGMENT_ENGINE = 'hqb-math2-segment-dry-run'
export type Math2Verdict = 'AUTO_SAFE' | 'NEEDS_REVIEW' | 'BLOCKED'

const TYPE_HEADING = /^(?:유형|부설|문헌|영향|부위|용량)\s*0*(\d{1,2})\b/
const RATIO_FALSE_NUMBER = /^(\d{4})\s*[:：]\s*\d/
const SHARED_PROMPT = /^\[(\d{4})\s*[~～〜\-]\s*(\d{4})\]\s*(.+)$/
const WORKBOOK_NUMBER_MAX = 1999

export type Math2PageInput = {
  page: number
  markdown: string
  raw?: MistralOcrLike | null
}

export type Math2MarkdownSpan = {
  number: string
  text: string
}

export type Math2SharedPrompt = {
  from: number
  to: number
  prompt: string
}

export type Math2ProblemCandidate = {
  page: number
  problem_number: string
  verdict: Math2Verdict
  reasons: string[]
  stem_preview: string
  stem: string
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
  stitches: Array<{ page: number; problem_number: string; from: number }>
  issues: string[]
  rows: Math2ProblemCandidate[]
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

export function normalizeMath2Line(line: string): string {
  return line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/__/g, '').replace(/\s+/g, ' ').trim()
}

export function padMath2Number(n: number): string {
  return String(n).padStart(4, '0')
}

export function extractMath2SectionLabel(text: string): string | null {
  for (const rawLine of text.split(/\n+/)) {
    const line = normalizeMath2Line(rawLine)
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
  const head = normalizeMath2Line(context.replace(/!\[[^\]]*]\([^)]*\)/g, ' '))
  if (RATIO_FALSE_NUMBER.test(head) && n >= 1000) return false
  if (page <= 5 && n >= 1000) return false
  return true
}

export function isMath2ProblemStart(line: string): string | null {
  const text = normalizeMath2Line(line)
  if (!text || TYPE_HEADING.test(text) || SHARED_PROMPT.test(text)) return null
  if (RATIO_FALSE_NUMBER.test(text)) return null
  const match = /^(\d{4})\b/.exec(text)
  return match?.[1] ?? null
}

export function isMath2SplitStop(line: string): boolean {
  const text = normalizeMath2Line(line)
  if (!text) return false
  if (TYPE_HEADING.test(text)) return true
  if (/^개념\s*\d/.test(text)) return true
  if (/^정답\s*및\s*풀이/.test(text)) return true
  if (SHARED_PROMPT.test(text)) return true
  if (/^\d{2}-\d\b/.test(text)) return true
  if (/^\d{1,3}\s+[IVX]+\b/.test(text)) return true
  if (/^(?:평면좌표|직선의 방정식|원의 방정식|도형의 이동|집합의 뜻과 표현|집합의 연산)$/.test(text)) return true
  if (/^\d{1,3}$/.test(text)) return true
  return false
}

export function extractSharedPrompts(markdown: string): Math2SharedPrompt[] {
  const found: Math2SharedPrompt[] = []
  for (const rawLine of markdown.split(/\n+/)) {
    const line = normalizeMath2Line(rawLine)
    const match = SHARED_PROMPT.exec(line)
    if (!match) continue
    found.push({ from: Number(match[1]), to: Number(match[2]), prompt: match[0] })
  }
  return found
}

export function splitSameLineProblemPair(line: string): [Math2MarkdownSpan, Math2MarkdownSpan] | null {
  const text = normalizeMath2Line(line)
  const match = /^(\d{4})\s+(.+?)\s+(\d{4})\s+(.+)$/.exec(text)
  if (!match) return null
  const left = Number(match[1])
  const right = Number(match[3])
  if (!Number.isInteger(left) || !Number.isInteger(right) || right !== left + 1) return null
  if (left < 1 || right > WORKBOOK_NUMBER_MAX) return null
  return [
    { number: match[1]!, text: `${match[1]} ${match[2]}`.trim() },
    { number: match[3]!, text: `${match[3]} ${match[4]}`.trim() },
  ]
}

export function splitMarkdownProblems(markdown: string): Math2MarkdownSpan[] {
  const spans: Math2MarkdownSpan[] = []
  let current: Math2MarkdownSpan | null = null
  for (const rawLine of markdown.split('\n')) {
    const pair = splitSameLineProblemPair(rawLine)
    if (pair) {
      if (current) spans.push(current)
      spans.push(pair[0])
      current = pair[1]
      continue
    }
    const number = isMath2ProblemStart(rawLine)
    if (number) {
      if (current) spans.push(current)
      current = { number, text: normalizeMath2Line(rawLine) }
      continue
    }
    if (current && isMath2SplitStop(rawLine)) {
      spans.push(current)
      current = null
      continue
    }
    if (current && rawLine.trim()) current.text += `\n${rawLine.trim()}`
  }
  if (current) spans.push(current)
  return spans
}

export function attachSharedPrompts(spans: Math2MarkdownSpan[], prompts: Math2SharedPrompt[]): Math2MarkdownSpan[] {
  return spans.map((span) => {
    const n = Number(span.number)
    const hit = prompts.find((row) => n >= row.from && n <= row.to)
    if (!hit || span.text.includes(hit.prompt.slice(0, 16))) return span
    return { ...span, text: `${hit.prompt}\n${span.text}` }
  })
}

export function repairMath2NumberSequence(spans: Math2MarkdownSpan[]): Math2MarkdownSpan[] {
  const used = new Set(spans.map((row) => row.number))
  const out = spans.map((row) => ({ ...row }))
  for (let i = 0; i < out.length; i += 1) {
    const prev = i > 0 ? Number(out[i - 1]!.number) : null
    const cur = Number(out[i]!.number)
    const next = i + 1 < out.length ? Number(out[i + 1]!.number) : null
    let nextNumber: number | null = null
    if (prev != null && next != null && next === prev + 2 && cur !== prev + 1) nextNumber = prev + 1
    else if (next != null && next === cur - 1 && Number(out[i + 2]?.number) === cur) nextNumber = next - 1
    if (nextNumber == null || nextNumber < 1 || nextNumber > WORKBOOK_NUMBER_MAX) continue
    const labeled = padMath2Number(nextNumber)
    if (used.has(labeled) && labeled !== out[i]!.number) continue
    used.delete(out[i]!.number)
    used.add(labeled)
    out[i] = { ...out[i]!, number: labeled }
  }
  return out
}

export function pagePreamble(markdown: string): string {
  const lines: string[] = []
  for (const rawLine of markdown.split('\n')) {
    if (isMath2ProblemStart(rawLine)) break
    const text = normalizeMath2Line(rawLine)
    if (!text || /^정답\s*및\s*풀이/.test(text) || TYPE_HEADING.test(text) || /^개념\s*\d/.test(text)) continue
    if (isMath2SplitStop(rawLine)) continue
    lines.push(rawLine.trim())
  }
  return lines.join('\n').trim()
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
  if (/구하(?:시\s*오|십시오)|고르(?:시\s*오|십시오)|쓰(?:시\s*오|십시오)|나타내(?:시\s*오|십시오)|말하(?:시\s*오|십시오)|설명하(?:시\s*오|십시오)|보이(?:시\s*오|십시오)/.test(compact)) return true
  return /값은\?$|합은\?$|개수는\?$|넓이는\?$|좌표$|길이는\?$/.test(compact)
}

export function math2EffectivePageKind(pageKind: string, markdown: string): string {
  if (pageKind !== 'ANSWER') return pageKind
  const problemLike = splitMarkdownProblems(markdown).filter((span) => {
    const compact = span.text.replace(/\s+/g, '')
    return compact.length >= 40 && /구하시\s*오|고르시\s*오|값은\?|것은\?/.test(span.text)
  })
  return problemLike.length >= 3 ? 'PROBLEM' : pageKind
}

export function nextPageStartsNewSection(markdown: string): boolean {
  for (const rawLine of markdown.split('\n')) {
    if (isMath2ProblemStart(rawLine)) return false
    const text = normalizeMath2Line(rawLine)
    if (TYPE_HEADING.test(text) || /^실력\s*굳히기|^기본\s*다잡기|^유형\s*뽀개기/.test(text)) return true
  }
  return false
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
  if (input.page_tail && input.choice_count < 4 && !stemLooksFinished(input.stem, input.choice_count)) {
    reasons.push('PAGE_TAIL')
  }
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
  const wanted = ['0020', '0001', '0422', '0972', '0024', '0026', '0439', '0458']
  const picked: Math2ProblemCandidate[] = []
  const used = new Set<string>()
  const key = (row: Math2ProblemCandidate) => `${row.page}:${row.problem_number}`
  for (const number of wanted) {
    const hit = rows.find((row) => row.problem_number === number && !used.has(key(row)))
    if (hit) {
      used.add(key(hit))
      picked.push(hit)
    }
  }
  for (const row of rows) {
    if (row.cross_page && !used.has(key(row))) {
      used.add(key(row))
      picked.push(row)
      break
    }
  }
  return picked
}

export function runMath2Segment(pages: Math2PageInput[], sourceId = MATH2_DOCUMENT_ID): Math2SegmentReport {
  assertMath2SegmentSource(sourceId)
  if (pages.length !== MATH2_PAGE_COUNT) {
    throw new Error(`MATH2_SEGMENT_PAGE_COUNT: expected ${MATH2_PAGE_COUNT}, got ${pages.length}`)
  }

  const ordered = [...pages].sort((a, b) => a.page - b.page)
  let lastSection: string | null = null
  const raw: Array<{
    page: number
    problem_number: string
    page_kind: string
    plausible: boolean
    stem: string
    choice_count: number
    latex_count: number
    image_count: number
    section: string | null
    page_tail: boolean
    text: string
    stitched_from_page: number | null
  }> = []

  for (let i = 0; i < ordered.length; i += 1) {
    const page = ordered[i]!
    const nextPage = ordered[i + 1]
    const anchors = countAnchorsFromText(page.markdown)
    const classified = classifyBookPageV2({
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
    const kind = { ...classified, page_kind: math2EffectivePageKind(classified.page_kind, page.markdown) }
    const section = extractMath2SectionLabel(page.markdown) ?? lastSection
    if (extractMath2SectionLabel(page.markdown)) lastSection = extractMath2SectionLabel(page.markdown)

    const prompts = extractSharedPrompts(page.markdown)
    let spans = attachSharedPrompts(repairMath2NumberSequence(splitMarkdownProblems(page.markdown)), prompts)
    const preamble = nextPage ? pagePreamble(nextPage.markdown) : ''
    const nextHasProblems = nextPage ? splitMarkdownProblems(nextPage.markdown).length > 0 : false
    const preambleIsAd = /갤러리|이어집니다|^MEMO\b/.test(preamble)
    if (
      spans.length &&
      preamble.length >= 20 &&
      nextPage &&
      nextHasProblems &&
      !preambleIsAd &&
      !nextPageStartsNewSection(nextPage.markdown)
    ) {
      const last = spans[spans.length - 1]!
      const lastChoices = circledChoiceCount(last.text)
      const nextFirst = Number(splitMarkdownProblems(nextPage.markdown)[0]?.number ?? 0)
      const lastN = Number(last.number)
      const looksContinuation = !stemLooksFinished(last.text, lastChoices) && !isMath2ProblemStart(preamble.split('\n')[0] ?? '')
      const flowOk = !nextFirst || nextFirst === lastN + 1
      if (looksContinuation && flowOk) {
        last.text = `${last.text}\n${preamble}`
        raw.push({
          page: page.page,
          problem_number: last.number,
          page_kind: kind.page_kind,
          plausible: isPlausibleMath2ProblemNumber(last.number, last.text, page.page),
          stem: last.text,
          choice_count: Math.max(structureFromRegionText(last.text).choice_count, circledChoiceCount(last.text)),
          latex_count: extractMistralLatex(last.text).length,
          image_count: (last.text.match(/!\[[^\]]*\]/g) ?? []).length,
          section,
          page_tail: true,
          text: last.text,
          stitched_from_page: nextPage.page,
        })
        spans = spans.slice(0, -1)
      }
    }

    for (let s = 0; s < spans.length; s += 1) {
      const span = spans[s]!
      const text = stripDifficultyBadge(span.text)
      const structured = structureFromRegionText(text)
      const choiceCount = Math.max(structured.choice_count, circledChoiceCount(text))
      raw.push({
        page: page.page,
        problem_number: span.number,
        page_kind: kind.page_kind,
        plausible: isPlausibleMath2ProblemNumber(span.number, text, page.page),
        stem: structured.stem,
        choice_count: choiceCount,
        latex_count: extractMistralLatex(text).length,
        image_count: (text.match(/!\[[^\]]*\]/g) ?? []).length,
        section,
        page_tail: s === spans.length - 1,
        text,
        stitched_from_page: null,
      })
    }
  }

  const flow = inspectNumberFlowV2(raw.filter((row) => row.plausible).map((row) => ({ page: row.page, problem_number: row.problem_number })))
  const flowByKey = new Map(flow.rows.map((row) => [`${row.page}:${row.problem_number}`, row]))
  const counts = new Map<string, number>()
  for (const row of raw) counts.set(row.problem_number, (counts.get(row.problem_number) ?? 0) + 1)

  const candidates: Math2ProblemCandidate[] = raw.map((row) => {
    const flowRow = flowByKey.get(`${row.page}:${row.problem_number}`)
    const unique = (counts.get(row.problem_number) ?? 0) <= 1
    const decided = verdictForCandidate({
      page_kind: row.page_kind,
      plausible: row.plausible,
      unique,
      flow_ok: !flowRow || flowRow.status === 'NORMAL' || flowRow.status === 'EXPECTED_BOOK_STRUCTURE',
      segment_status: 'AUTO_OK',
      stem: row.text,
      choice_count: row.choice_count,
      incomplete: Boolean(row.stitched_from_page) ? false : row.page_tail && !stemLooksFinished(row.text, row.choice_count),
      stitched: Boolean(row.stitched_from_page),
      page_tail: row.page_tail && !row.stitched_from_page,
    })
    return {
      page: row.page,
      problem_number: row.problem_number,
      verdict: decided.verdict,
      reasons: decided.reasons,
      stem_preview: row.text.replace(/\s+/g, ' ').trim().slice(0, 180),
      stem: row.text,
      choice_count: row.choice_count,
      latex_count: row.latex_count,
      image_count: row.image_count,
      section: row.section,
      page_kind: row.page_kind,
      stitched_from_page: row.stitched_from_page,
      cross_page: Boolean(row.stitched_from_page),
      segment_status: 'AUTO_OK',
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
    duplicate_numbers: [...new Set(candidates.filter((row) => row.reasons.includes('DUPLICATE_NUMBER')).map((row) => row.problem_number))],
    missing_numbers: missing.slice(0, 40),
    reason_counts,
    samples: pickMath2Samples(candidates),
    rows: candidates,
    stitches: candidates
      .filter((row) => row.stitched_from_page != null)
      .map((row) => ({ page: row.page, problem_number: row.problem_number, from: row.stitched_from_page as number })),
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
    `- stitches: ${report.stitches.map((row) => `p${row.page}#${row.problem_number}←${row.from}`).join(', ') || 'none'}`,
    `- persist problems: false`,
    `- issues: ${report.issues.join('; ') || 'none'}`,
    `- duplicate numbers: ${report.duplicate_numbers.join(', ') || 'none'}`,
    `- missing (first 40 short gaps): ${report.missing_numbers.join(', ') || 'none'}`,
    `- reasons: ${Object.entries(report.reason_counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'none'}`,
    ``,
    `## samples`,
    ...sampleLines,
    ``,
  ].join('\n')
}
