/**
 * Generic book split. Reuses 쎈2 markdown split / verdict helpers.
 * Uniqueness is page-local: identity is document|page|number.
 * Does not open SSEN / 쎈2 locks.
 */
import { extractMistralLatex } from '../ocr/normalizeMistral'
import { classifyBookPageV2, countAnchorsFromText } from '../recognition/bookClassify'
import { inspectNumberFlowV2 } from '../recognition/bookPipeline'
import { structureFromRegionText } from './fullBookIngest832'
import {
  attachSharedPrompts,
  extractMath2SectionLabel,
  extractSharedPrompts,
  isMath2ProblemStart,
  isMath2SplitStop,
  isPlausibleMath2ProblemNumber,
  math2EffectivePageKind,
  normalizeMath2Line,
  padMath2Number,
  repairMath2NumberSequence,
  splitSameLineProblemPair,
  verdictForCandidate,
  type Math2MarkdownSpan,
  type Math2PageInput,
  type Math2ProblemCandidate,
  type Math2SegmentReport,
  type Math2Verdict,
} from './math2Segment'
import { assertBookIngestSource, type BookIngestSpec } from './bookIngestSpec'

export const BOOK_SEGMENT_ENGINE = 'hqb-book-segment-dry-run'
const LABELED_START = /^(예제|유제|연습(?:문제)?|문제)\s*0*(\d{1,3})\b/
const GENERIC_SHARED = /^\[(\d{1,4})\s*[~～〜\-]\s*(\d{1,4})\]\s*(.+)$/
const NUMBERED_START = /^(\d{1,3})\b/
const NUMBER_BADGE =
  /^(\d{1,3})\s+(?:번호|서술형|선출식|비동식|고득점|선행)(?:\s*[,，|/]\s*(?:번호|서술형|선출식|비동식|고득점|선행|[\d.점]+))*\s*$/

export type BookSpan = Math2MarkdownSpan & { label: string }

export function assertBookSegmentSource(spec: BookIngestSpec, sourceId: string): void {
  assertBookIngestSource(spec, sourceId)
}

export function refuseBookPersist(argv: string[]): void {
  if (argv.some((flag) => /persist|apply|upsert|register/i.test(flag))) {
    throw new Error('BOOK_SEGMENT_NO_PERSIST: dry-run only; Production problem writes are forbidden')
  }
}

export function looksLikeProblemStemRest(rest: string, printed = 100): boolean {
  const text = rest.replace(/!\[[^\]]*]\([^)]*\)/g, ' ').trim()
  if (!text) return false
  const asked = /구하(?:시|십)|고르(?:시|십)|말하(?:시|십)|써넣|다음|것은|값을|고르면|보이(?:시|십)|나타내(?:시|십)|증명하|답하/.test(text)
  if (printed < 100) return asked
  if (asked) return true
  return (text.match(/[가-힣]/g) ?? []).length >= 16
}

export function looksLikeFollowingStem(text: string): boolean {
  const compact = text.replace(/!\[[^\]]*]\([^)]*\)/g, ' ').trim()
  if (!compact) return false
  if (
    /구하(?:시|십)|고르(?:시|십)|말하(?:시|십)|써넣|다음|것은|값을|고르면|보이(?:시|십)|나타내(?:시|십)|증명하|답하|서술하/.test(
      compact,
    )
  ) {
    return true
  }
  if (/[①-⑤]/.test(compact)) return true
  return /\$[^$]+\$/.test(compact) && (compact.match(/[가-힣]/g) ?? []).length >= 8
}

function followingStemText(lines: string[], from: number): string {
  const bits: string[] = []
  for (let i = from; i < lines.length && bits.join(' ').length < 240; i += 1) {
    const raw = lines[i] ?? ''
    const text = normalizeMath2Line(raw)
    if (!text) continue
    if (/^\d{1,3}$/.test(text) || NUMBER_BADGE.test(text) || LABELED_START.test(text) || isMath2ProblemStart(raw)) break
    if (isBookSplitStop(raw) && !/^\d{1,3}$/.test(text)) break
    bits.push(text)
  }
  return bits.join(' ')
}

export function isBookProblemStart(line: string, following = ''): { number: string; label: string } | null {
  const four = isMath2ProblemStart(line)
  if (four) return { number: four, label: 'four' }
  const text = normalizeMath2Line(line)
  if (!text) return null
  const labeled = LABELED_START.exec(text)
  if (labeled) return { number: padMath2Number(Number(labeled[2])), label: labeled[1]!.replace(/문제$/, '') }
  const badge = NUMBER_BADGE.exec(text)
  if (badge) return { number: padMath2Number(Number(badge[1])), label: 'numbered' }
  const numbered = NUMBERED_START.exec(text)
  if (!numbered) return null
  const printed = Number(numbered[1])
  const rest = text.slice(numbered[0].length).trim()
  if (!rest) {
    return looksLikeFollowingStem(following) ? { number: padMath2Number(printed), label: 'numbered' } : null
  }
  if (!looksLikeProblemStemRest(rest, printed)) return null
  return { number: padMath2Number(printed), label: 'numbered' }
}

export function isBookSplitStop(line: string): boolean {
  if (isMath2SplitStop(line)) return true
  const text = normalizeMath2Line(line)
  if (!text) return false
  if (LABELED_START.test(text)) return true
  if (/^(?:핵심\s*개념|개념\s*Plus|중단원|소단원|단원\s*마무리|알아(?:듭|듣)시다|생각해 봅시다|KEY\s*Point|실력\s*UP)/.test(text)) return true
  return false
}

export function looksLikeAnswerKeyPage(markdown: string): boolean {
  if (/빠른\s*정답|정답\s*찾기/.test(markdown)) return true
  const asked = (markdown.match(/구하(?:시\s*오|십시오)|고르(?:시\s*오|십시오)/g) ?? []).length
  if (asked >= 2) return false
  const spans = splitBookProblems(markdown)
  if (spans.length < 8) return false
  const stems = spans.filter((span) => /구하(?:시|십)|고르(?:시|십)|값은\?|것은\?/.test(span.text)).length
  const short = spans.filter((span) => span.text.replace(/\s+/g, '').length < 40).length
  return stems <= 1 && short >= 6
}

export function extractGenericSharedPrompts(markdown: string) {
  const found: Array<{ from: number; to: number; prompt: string }> = []
  for (const rawLine of markdown.split(/\n+/)) {
    const line = normalizeMath2Line(rawLine)
    const match = GENERIC_SHARED.exec(line)
    if (!match) continue
    found.push({ from: Number(match[1]), to: Number(match[2]), prompt: match[0] })
  }
  return found.length ? found : extractSharedPrompts(markdown)
}

export function splitBookProblems(markdown: string): BookSpan[] {
  const spans: BookSpan[] = []
  let current: BookSpan | null = null
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]!
    const pair = splitSameLineProblemPair(rawLine)
    if (pair) {
      if (current) spans.push(current)
      spans.push({ ...pair[0], label: 'four' })
      current = { ...pair[1], label: 'four' }
      continue
    }
    const start = isBookProblemStart(rawLine, followingStemText(lines, i + 1))
    if (start) {
      if (current) spans.push(current)
      current = { number: start.number, label: start.label, text: normalizeMath2Line(rawLine) }
      continue
    }
    if (current && isBookSplitStop(rawLine) && !start) {
      spans.push(current)
      current = null
      continue
    }
    if (current && rawLine.trim()) current.text += `\n${rawLine.trim()}`
  }
  if (current) spans.push(current)
  return spans
}

export function bookPagePreamble(markdown: string): string {
  const kept: string[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]!
    if (isBookProblemStart(rawLine, followingStemText(lines, i + 1))) break
    const text = normalizeMath2Line(rawLine)
    if (!text || /^정답\s*및\s*풀이/.test(text) || isBookSplitStop(rawLine)) continue
    kept.push(rawLine.trim())
  }
  return kept.join('\n').trim()
}

export function bookNextPageStartsNewSection(markdown: string): boolean {
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]!
    if (isBookProblemStart(rawLine, followingStemText(lines, i + 1))) return false
    const text = normalizeMath2Line(rawLine)
    if (/^(?:유형|핵심\s*개념|개념\s*Plus|중단원|소단원|실력\s*굳히기|기본\s*다잡기)/.test(text)) return true
  }
  return false
}

export function disambiguatePageNumbers(spans: BookSpan[]): BookSpan[] {
  const byNumber = new Map<string, BookSpan[]>()
  for (const span of spans) {
    const list = byNumber.get(span.number) ?? []
    list.push(span)
    byNumber.set(span.number, list)
  }
  const labels: string[] = []
  for (const span of spans) {
    if (!labels.includes(span.label)) labels.push(span.label)
  }
  return spans.map((span) => {
    if ((byNumber.get(span.number) ?? []).length <= 1) return span
    const rank = Math.max(labels.indexOf(span.label), 0)
    if (rank === 0) return span
    const printed = Number(span.number)
    const encoded = rank * 1000 + printed
    if (encoded > 9999) return span
    return { ...span, number: padMath2Number(encoded) }
  })
}

function circledChoiceCount(text: string): number {
  const body = text.replace(/^\s*#?\s*(?:\d{4}|예제|유제|확인|연습|문제)[^\n]{0,24}/, '')
  return new Set(body.match(/[①-⑤]/g) ?? []).size
}

function stemLooksFinished(stem: string, choiceCount: number): boolean {
  if (choiceCount >= 4) return true
  const compact = stem.replace(/\s+/g, ' ').trim()
  if (/구하(?:시\s*오|십시오)|고르(?:시\s*오|십시오)|쓰(?:시\s*오|십시오)|나타내(?:시\s*오|십시오)|말하(?:시\s*오|십시오)|설명하(?:시\s*오|십시오)|보이(?:시\s*오|십시오)/.test(compact)) return true
  return /값은\?$|합은\?$|개수는\?$|넓이는\?$|좌표$|길이는\?$/.test(compact)
}

export function bookEffectivePageKind(pageKind: string, markdown: string): string {
  if (looksLikeAnswerKeyPage(markdown)) return 'ANSWER'
  const asked = (markdown.match(/구하(?:시\s*오|십시오)|고르(?:시\s*오|십시오)/g) ?? []).length
  if (asked >= 2) return 'PROBLEM'
  const problemLike = splitBookProblems(markdown).filter((span) => {
    const compact = span.text.replace(/\s+/g, '')
    return compact.length >= 24 && /구하(?:시|십)|고르(?:시|십)|값은\?|것은\?|써넣|답하/.test(span.text)
  })
  if (problemLike.length >= 2) return 'PROBLEM'
  if (pageKind !== 'ANSWER') return pageKind
  if (problemLike.length >= 3) return 'PROBLEM'
  return math2EffectivePageKind(pageKind, markdown)
}

export function pickBookSamples(rows: Math2ProblemCandidate[]): Math2ProblemCandidate[] {
  const picked: Math2ProblemCandidate[] = []
  const used = new Set<string>()
  const key = (row: Math2ProblemCandidate) => `${row.page}:${row.problem_number}`
  const take = (row: Math2ProblemCandidate | undefined) => {
    if (!row || used.has(key(row))) return
    used.add(key(row))
    picked.push(row)
  }
  take(rows.find((row) => row.verdict === 'AUTO_SAFE'))
  take(rows.find((row) => row.verdict === 'NEEDS_REVIEW'))
  take(rows.find((row) => row.verdict === 'BLOCKED'))
  take(rows.find((row) => /예제|유제/.test(row.stem)))
  take(rows.find((row) => row.cross_page))
  return picked
}

export function runBookSegment(spec: BookIngestSpec, pages: Math2PageInput[]): Math2SegmentReport {
  assertBookSegmentSource(spec, spec.sourceId)
  if (pages.length !== spec.pageCount) {
    throw new Error(`BOOK_SEGMENT_PAGE_COUNT: expected ${spec.pageCount}, got ${pages.length}`)
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
      total_pages: spec.pageCount,
      ink_ratio: null,
      has_ocr: page.markdown.length > 0,
      cache_text: page.markdown,
      four_digit_count: anchors.four_digit,
      section_count: anchors.section,
      block_count: page.raw?.pages?.[0]?.blocks?.length ?? 0,
      image_count: page.raw?.pages?.[0]?.images?.length ?? 0,
    })
    const kind = { ...classified, page_kind: bookEffectivePageKind(classified.page_kind, page.markdown) }
    const section = extractMath2SectionLabel(page.markdown) ?? lastSection
    if (extractMath2SectionLabel(page.markdown)) lastSection = extractMath2SectionLabel(page.markdown)

    const prompts = extractGenericSharedPrompts(page.markdown)
    const split = splitBookProblems(page.markdown)
    const repaired = repairMath2NumberSequence(split).map((span, index) => ({
      ...span,
      label: split[index]?.label ?? 'four',
    }))
    let spans = disambiguatePageNumbers(attachSharedPrompts(repaired, prompts).map((span, index) => ({
      ...span,
      label: repaired[index]?.label ?? 'four',
    })))
    const preamble = nextPage ? bookPagePreamble(nextPage.markdown) : ''
    const nextHasProblems = nextPage ? splitBookProblems(nextPage.markdown).length > 0 : false
    const preambleIsAd = /갤러리|이어집니다|^MEMO\b/.test(preamble)
    if (
      spans.length &&
      preamble.length >= 20 &&
      nextPage &&
      nextHasProblems &&
      !preambleIsAd &&
      !bookNextPageStartsNewSection(nextPage.markdown)
    ) {
      const last = spans[spans.length - 1]!
      const lastChoices = circledChoiceCount(last.text)
      const nextFirst = Number(splitBookProblems(nextPage.markdown)[0]?.number ?? 0)
      const lastN = Number(last.number)
      const looksContinuation = !stemLooksFinished(last.text, lastChoices) && !isBookProblemStart(preamble.split('\n')[0] ?? '')
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
      const text = span.text
      const structured = structureFromRegionText(text)
      const choiceCount = Math.max(structured.choice_count, circledChoiceCount(text))
      raw.push({
        page: page.page,
        problem_number: span.number,
        page_kind: kind.page_kind,
        plausible: isPlausibleMath2ProblemNumber(span.number, text, page.page) || LABELED_START.test(normalizeMath2Line(text)),
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

  const pageCounts = new Map<string, number>()
  for (const row of raw) {
    const key = `${row.page}|${row.problem_number}`
    pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1)
  }
  const flow = inspectNumberFlowV2(raw.filter((row) => row.plausible).map((row) => ({ page: row.page, problem_number: row.problem_number })))
  const flowByKey = new Map(flow.rows.map((row) => [`${row.page}:${row.problem_number}`, row]))

  const candidates: Math2ProblemCandidate[] = raw.map((row) => {
    const flowRow = flowByKey.get(`${row.page}:${row.problem_number}`)
    const unique = (pageCounts.get(`${row.page}|${row.problem_number}`) ?? 0) <= 1
    const flowOk =
      !flowRow ||
      flowRow.status === 'NORMAL' ||
      flowRow.status === 'EXPECTED_BOOK_STRUCTURE' ||
      flowRow.note.startsWith('duplicate_on_pages:')
    const decided = verdictForCandidate({
      page_kind: row.page_kind,
      plausible: row.plausible,
      unique,
      flow_ok: flowOk,
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

  const reason_counts: Record<string, number> = {}
  for (const row of candidates) {
    for (const reason of row.reasons) reason_counts[reason] = (reason_counts[reason] ?? 0) + 1
  }

  return {
    sourceId: spec.sourceId,
    title: spec.title,
    persist_problems: false,
    pages: pages.length,
    candidates: candidates.length,
    auto_safe: candidates.filter((row) => row.verdict === 'AUTO_SAFE').length,
    needs_review: candidates.filter((row) => row.verdict === 'NEEDS_REVIEW').length,
    blocked: candidates.filter((row) => row.verdict === 'BLOCKED').length,
    duplicate_suspects: candidates.filter((row) => row.reasons.includes('DUPLICATE_NUMBER')).length,
    missing_suspects: 0,
    reverse_or_jump: 0,
    cross_page: candidates.filter((row) => row.cross_page).length,
    duplicate_numbers: [...new Set(candidates.filter((row) => row.reasons.includes('DUPLICATE_NUMBER')).map((row) => row.problem_number))],
    missing_numbers: [],
    reason_counts,
    samples: pickBookSamples(candidates),
    rows: candidates,
    stitches: candidates
      .filter((row) => row.stitched_from_page != null)
      .map((row) => ({ page: row.page, problem_number: row.problem_number, from: row.stitched_from_page as number })),
    issues: [],
  }
}

export function formatBookSegmentMarkdown(report: Math2SegmentReport): string {
  const sampleLines = report.samples.map(
    (row) =>
      `- p${row.page} #${row.problem_number} ${row.verdict} choices=${row.choice_count} latex=${row.latex_count} img=${row.image_count} section=${row.section ?? '—'} stitch=${row.stitched_from_page ?? 'no'}\n  ${row.reasons.join(', ') || 'clear'}\n  ${row.stem_preview}`,
  )
  return [
    `# ${report.title} problem split dry-run`,
    ``,
    `- document_id: ${report.sourceId}`,
    `- pages: ${report.pages}`,
    `- candidates: ${report.candidates}`,
    `- AUTO_SAFE / NEEDS_REVIEW / BLOCKED: ${report.auto_safe} / ${report.needs_review} / ${report.blocked}`,
    `- persist problems: false`,
    `- reasons: ${Object.entries(report.reason_counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'none'}`,
    ``,
    `## samples`,
    ...sampleLines,
    ``,
  ].join('\n')
}

export type { Math2PageInput, Math2ProblemCandidate, Math2SegmentReport, Math2Verdict }
