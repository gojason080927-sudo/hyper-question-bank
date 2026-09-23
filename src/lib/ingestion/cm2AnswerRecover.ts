/**
 * Recover publisher answers/explanations from existing source_pages OCR.
 * Does not write Production. Does not invent answers.
 */
import { padMath2Number } from './math2Segment'

export const CM2_ANSWER_ENGINE = 'cm2-answer-recover-v1'
export const CM2_ANSWER_ASSIGNED_BY = 'BOOK_ANSWER_OCR'

export type Cm2AnswerProfile = 'quick_key' | 'reprint_explain'

export type Cm2AnswerExtract = {
  page: number
  number: string
  answer_text: string | null
  answer_type: 'CHOICE_LABEL' | 'NUMBER' | 'EXPRESSION' | 'SET' | 'TEXT' | 'MULTI' | null
  explanation: string | null
  reprint_stem: string | null
  source_preview: string
}

export type Cm2RegisteredProblem = {
  problem_id: string
  version_id: string
  number: string
  problem_text: string
}

export type Cm2AnswerMatch = {
  extract: Cm2AnswerExtract
  verdict: 'AUTO' | 'REVIEW' | 'UNMATCHED'
  reasons: string[]
  problem_id: string | null
  version_id: string | null
  stem_preview: string | null
  overlap: number
  payload: Record<string, unknown> | null
}

const ASK = /구하(?:시\s*오|십시오)|고르(?:시\s*오|십시오)/
const QUICK_HEAD = /빠른\s*정답/
const EXPLAIN_HEAD = /정답과\s*해설/
const CHOICE_MARK = /[√✓☑✔]\s*([①-⑤])|([①-⑤])\s*[√✓☑✔]/
const CIRCLED = /\\textcircled\{\s*([1-5])\s*\}|[①-⑤]/

export function padAnswerNumber(value: string | number): string {
  return padMath2Number(Number(value))
}

export function normalizeForOverlap(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\$+/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase()
}

export function stemOverlap(reprint: string | null, problemText: string): number {
  const a = normalizeForOverlap(reprint ?? '')
  const b = normalizeForOverlap(problemText)
  if (a.length < 12 || b.length < 12) return 0
  const needle = a.slice(0, 28)
  if (b.includes(needle)) return 1
  const short = a.slice(0, 18)
  if (short.length >= 12 && b.includes(short)) return 0.8
  let hit = 0
  const window = Math.min(24, a.length)
  for (let i = 0; i <= window - 10; i += 1) {
    if (b.includes(a.slice(i, i + 10))) hit += 1
  }
  return Number((hit / Math.max(1, window - 9)).toFixed(3))
}

export function classifyAnswerType(answer: string | null): Cm2AnswerExtract['answer_type'] {
  if (!answer) return null
  const text = answer.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (/^\(?\s*[①-⑤1-5]\s*\)?$/.test(text) || /^\\textcircled/.test(text)) return 'CHOICE_LABEL'
  if (/\(1\)/.test(text) && /\(2\)/.test(text)) return 'MULTI'
  if (/\\{|\{/.test(text) && /\\}|\}/.test(text)) return 'SET'
  if (/\$|\\frac|=|\\sqrt|[√≤≥<>]/.test(text)) return 'EXPRESSION'
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return 'NUMBER'
  return 'TEXT'
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function looksLikeQuickKeyPage(text: string, page: number, pageCount: number): boolean {
  if (ASK.test(text) && (text.match(ASK) ?? []).length >= 2) return false
  if (QUICK_HEAD.test(text)) return true
  return page >= pageCount - 14 && !ASK.test(text) && compact(text).length >= 80
}

export function parseQuickKeyPage(text: string, page: number, pageCount: number): Cm2AnswerExtract[] {
  if (!looksLikeQuickKeyPage(text, page, pageCount)) return []
  let body = text
    .replace(/\$\$/g, ' ')
    .replace(/\\quad/g, ' ')
    .replace(/\\text\{([^}]*)\}/g, ' $1 ')
    .replace(/빠른\s*정답(?:\s*찾기)?/g, ' ')
    .replace(/•?\s*본책[^\n]*/g, ' ')
    .replace(/^#{1,3}\s+[^\n]+/gm, ' ')
    .replace(/^[IVX]+\.\s*[^\n]+/gm, ' ')
    .replace(new RegExp(`(?:^|\\n)\\s*${page}\\s*$`), ' ')
  const tokens: Array<{ n: number; index: number }> = []
  const re = /(?<![0-9])(\d{1,3})(?![0-9])/g
  let hit: RegExpExecArray | null
  while ((hit = re.exec(body))) {
    const n = Number(hit[1])
    if (n < 1 || n > 800 || n === page) continue
    tokens.push({ n, index: hit.index })
  }
  const starts: Array<{ n: number; index: number }> = []
  let expect = 0
  for (const token of tokens) {
    const sequential = expect > 0 && token.n >= expect && token.n <= expect + 3
    if (starts.length === 0 || sequential) {
      starts.push(token)
      expect = token.n + 1
    }
  }
  const out: Cm2AnswerExtract[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const cur = starts[i]!
    const next = starts[i + 1]
    const raw = body.slice(cur.index + String(cur.n).length, next?.index ?? body.length)
    const answer = raw.replace(/\$+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!answer || answer.length > 280) continue
    if (/^(?:평면좌표|원의\s*방정식|도형의\s*이동|집합|명제|함수)/.test(answer)) continue
    out.push({
      page,
      number: padAnswerNumber(cur.n),
      answer_text: answer,
      answer_type: classifyAnswerType(answer),
      explanation: null,
      reprint_stem: null,
      source_preview: compact(`${cur.n} ${answer}`).slice(0, 160),
    })
  }
  return dedupeExtracts(out)
}

function isReprintExplainPage(text: string, previousExplain: boolean): boolean {
  const trimmed = text.trim()
  if (/^(?:•\s*)?정답과\s*해설/.test(trimmed)) return true
  if (previousExplain && /^#{1,3}\s*\d{3,4}\b/.test(trimmed)) return true
  return false
}

function extractMarkedChoice(text: string): string | null {
  const marked = CHOICE_MARK.exec(text)
  if (marked) return marked[1] ?? marked[2] ?? null
  return null
}

function extractShortAnswer(text: string): string | null {
  const line = text.split('\n').slice(0, 6).join(' ')
  const asked = /구하(?:시\s*오|십시오)[^\n]{0,48}?(\$[^$]+\$|[①-⑤]|-?\d[^,\n]{0,24}|[√\d][^\n]{0,20})/.exec(line)
  if (!asked) return null
  const value = asked[1]!.replace(/\s+/g, ' ').trim()
  if (/[①-⑤]/.test(value) && !CHOICE_MARK.test(line)) return null
  return value.slice(0, 80)
}

function reprintStemOf(item: string): string {
  const withoutHeading = item.replace(/^#{0,3}\s*\d{3,4}[^\n]*/, '').trim()
  const cut = withoutHeading.split(/[①-⑤]|이므로|따라서|양변을|정답\s*:/)[0] ?? withoutHeading
  return compact(cut).slice(0, 180)
}

export function parseReprintExplainPage(text: string, page: number, previousExplain: boolean): Cm2AnswerExtract[] {
  if (!isReprintExplainPage(text, previousExplain)) return []
  const chunks: Array<{ number: string; body: string }> = []
  const re = /(?:^|\n)\s*#{0,3}\s*0*(\d{4})\b/g
  const hits = [...text.matchAll(re)]
  for (let i = 0; i < hits.length; i += 1) {
    const cur = hits[i]!
    const next = hits[i + 1]
    const start = cur.index ?? 0
    const end = next?.index ?? text.length
    chunks.push({ number: padAnswerNumber(cur[1]!), body: text.slice(start, end).trim() })
  }
  return chunks
    .map((chunk) => {
      const choice = extractMarkedChoice(chunk.body)
      const short = choice ? null : extractShortAnswer(chunk.body)
      const answer = choice ?? short
      const explanation = compact(chunk.body).slice(0, 4000)
      return {
        page,
        number: chunk.number,
        answer_text: answer,
        answer_type: classifyAnswerType(answer),
        explanation: explanation.length >= 40 ? explanation : null,
        reprint_stem: reprintStemOf(chunk.body),
        source_preview: compact(chunk.body).slice(0, 160),
      } satisfies Cm2AnswerExtract
    })
    .filter((row) => row.answer_text || row.explanation)
}

export function parseAnswerPages(
  pages: Array<{ page: number; text: string }>,
  profile: Cm2AnswerProfile,
  pageCount: number,
): Cm2AnswerExtract[] {
  const out: Cm2AnswerExtract[] = []
  let previousExplain = false
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    if (profile === 'quick_key') {
      out.push(...parseQuickKeyPage(page.text, page.page, pageCount))
      previousExplain = false
      continue
    }
    const rows = parseReprintExplainPage(page.text, page.page, previousExplain)
    previousExplain = rows.length > 0
    out.push(...rows)
  }
  return dedupeExtracts(out)
}

function dedupeExtracts(rows: Cm2AnswerExtract[]): Cm2AnswerExtract[] {
  const seen = new Map<string, Cm2AnswerExtract>()
  for (const row of rows) {
    const key = `${row.page}:${row.number}`
    const prev = seen.get(key)
    if (!prev || (row.answer_text && !prev.answer_text) || (row.explanation && row.explanation.length > (prev.explanation?.length ?? 0))) {
      seen.set(key, row)
    }
  }
  return [...seen.values()]
}

export function matchExtracts(
  extracts: Cm2AnswerExtract[],
  registered: Cm2RegisteredProblem[],
  sourceDocumentId: string,
): Cm2AnswerMatch[] {
  const byNumber = new Map<string, Cm2RegisteredProblem[]>()
  for (const row of registered) {
    const list = byNumber.get(row.number) ?? []
    list.push(row)
    byNumber.set(row.number, list)
  }
  return extracts.map((extract) => {
    const hits = byNumber.get(extract.number) ?? []
    const reasons: string[] = []
    if (!extract.answer_text && !extract.explanation) reasons.push('EMPTY_EXTRACT')
    if (hits.length === 0) {
      return {
        extract,
        verdict: 'UNMATCHED',
        reasons: [...reasons, 'NO_REGISTERED_NUMBER'],
        problem_id: null,
        version_id: null,
        stem_preview: null,
        overlap: 0,
        payload: null,
      }
    }
    if (hits.length > 1) reasons.push('DUPLICATE_NUMBER')
    const scored = hits
      .map((row) => ({ row, overlap: stemOverlap(extract.reprint_stem, row.problem_text) }))
      .sort((a, b) => b.overlap - a.overlap)
    const best = scored[0]!
    if (extract.reprint_stem && best.overlap < 0.6) reasons.push('STEM_MISMATCH')
    if (!extract.reprint_stem && hits.length === 1) reasons.push('NUMBER_ONLY_UNIQUE')
    if (!extract.answer_text) reasons.push('ANSWER_MISSING')
    const auto =
      hits.length === 1 &&
      !reasons.includes('STEM_MISMATCH') &&
      !reasons.includes('EMPTY_EXTRACT') &&
      Boolean(extract.answer_text || extract.explanation) &&
      (extract.reprint_stem ? best.overlap >= 0.6 : true)
    const verdict: Cm2AnswerMatch['verdict'] = auto ? 'AUTO' : 'REVIEW'
    if (!auto && !reasons.includes('DUPLICATE_NUMBER') && !reasons.includes('STEM_MISMATCH')) reasons.push('NEEDS_REVIEW')
    return {
      extract,
      verdict,
      reasons,
      problem_id: best.row.problem_id,
      version_id: best.row.version_id,
      stem_preview: compact(best.row.problem_text).slice(0, 140),
      overlap: best.overlap,
      payload: auto ? buildPayload(extract, best.row, sourceDocumentId) : null,
    }
  })
}

function buildPayload(extract: Cm2AnswerExtract, problem: Cm2RegisteredProblem, sourceDocumentId: string) {
  const metadata = {
    source_document_id: sourceDocumentId,
    source_page: extract.page,
    original_problem_number: extract.number,
    engine: CM2_ANSWER_ENGINE,
    assigned_by: CM2_ANSWER_ASSIGNED_BY,
  }
  return {
    problem_id: problem.problem_id,
    version_id: problem.version_id,
    answer: extract.answer_text
      ? {
          answer_type: extract.answer_type ?? 'TEXT',
          answer_text: extract.answer_text,
          metadata,
        }
      : null,
    explanation: extract.explanation
      ? {
          explanation_type: 'ORIGINAL',
          content: extract.explanation,
          created_by: CM2_ANSWER_ASSIGNED_BY,
          metadata,
        }
      : null,
    problem_text_mutated: false,
    types_mutated: false,
  }
}

export function summarizeMatches(book: string, profile: Cm2AnswerProfile, matches: Cm2AnswerMatch[]) {
  const auto = matches.filter((row) => row.verdict === 'AUTO')
  return {
    book,
    profile,
    extracted: matches.length,
    answers: matches.filter((row) => row.extract.answer_text).length,
    explanations: matches.filter((row) => row.extract.explanation).length,
    auto: auto.length,
    review: matches.filter((row) => row.verdict === 'REVIEW').length,
    unmatched: matches.filter((row) => row.verdict === 'UNMATCHED').length,
    written: 0,
    student_care_accessed: false,
  }
}
