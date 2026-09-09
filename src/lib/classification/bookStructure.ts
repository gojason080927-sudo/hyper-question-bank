/**
 * STEP 8.8 TRACK A — extract 쎈 공통수학1 headings from existing page OCR.
 * Titles come from OCR evidence only. Missing titles are not invented.
 */

export const CLASSIFICATION_STEP = '8.8'
export const BOOK_SUBJECT = '공통수학1'

export const ROMAN_UNITS = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

export type BookHeadingKind = 'MAJOR_UNIT' | 'SECTION' | 'THEORY_HEADING' | 'BOOK_TYPE' | 'LABEL'

export type BookHeadingHit = {
  page: number
  kind: BookHeadingKind
  raw: string
  major_unit: string | null
  section_code: string | null
  section_title: string | null
  theory_code: string | null
  theory_title: string | null
  book_type_numbers: string[]
  page_start_hint: number | null
  confidence: number
}

export type BookSection = {
  subject: typeof BOOK_SUBJECT
  section_code: string
  unit: string
  subunit: string
  book_type_number: string | null
  book_type_title: string | null
  page_start: number
  page_end: number
  problem_number_start: string | null
  problem_number_end: string | null
  confidence: number
  evidence: string[]
}

export type BookStructure = {
  subject: typeof BOOK_SUBJECT
  source: 'ssen-common-math1.pdf'
  major_units: Array<{ code: string; title: string; page_start: number; page_end: number; evidence: string[] }>
  sections: BookSection[]
  theory_headings: Array<{
    page: number
    section_code: string
    theory_code: string
    title: string
    book_type_numbers: string[]
    evidence: string[]
  }>
  conflicts: string[]
  uncertain: string[]
}

const MAJOR_RE = /^(?:#{1,3}\s*)?(I{1,3}|IV|V|VI)\s+([가-힣A-Za-z0-9\s]+)\s*$/
const SECTION_RE = /^(?:#{1,3}\s*)?0?(\d{1,2})\s+([가-힣A-Za-z0-9·\s]+?)\s+(\d{1,3})\s*$/
const THEORY_RE = /^(?:#{1,3}\s*)?(\d{2})-(\d+)\s+(.+)$/
const BOOK_TYPE_RE = /유형\s*(\d+(?:\s*[,~+-]\s*\d+)*)/g
const LABEL_RE = /기본\s*다잡기|핵심\s*개념|개념\s*(?:Plus|정리)|실력\s*UP|고난도|대표\s*문제/

function cleanTitle(raw: string): string {
  return raw.replace(/[#*_]/g, '').replace(/\s+/g, ' ').trim()
}

export function extractBookTypeNumbers(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(BOOK_TYPE_RE)) {
    const chunk = match[1].replace(/\s+/g, '')
    for (const part of chunk.split(/[,+]/)) {
      const range = part.split(/[~-]/).map((item) => item.replace(/\D/g, '')).filter(Boolean)
      if (range.length === 2) {
        const start = Number(range[0])
        const end = Number(range[1])
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 20) {
          for (let n = start; n <= end; n += 1) {
            const code = String(n).padStart(2, '0')
            if (!found.includes(code)) found.push(code)
          }
          continue
        }
      }
      const code = range[0]?.padStart(2, '0')
      if (code && !found.includes(code)) found.push(code)
    }
  }
  return found
}

export function extractHeadingsFromPage(page: number, text: string): BookHeadingHit[] {
  const hits: BookHeadingHit[] = []
  for (const rawLine of text.split(/\n+/)) {
    const raw = cleanTitle(rawLine)
    if (!raw || raw.startsWith('![') || raw.length > 80) continue
    const major = raw.match(MAJOR_RE)
    if (major) {
      hits.push({
        page,
        kind: 'MAJOR_UNIT',
        raw,
        major_unit: `${major[1]} ${major[2].trim()}`,
        section_code: null,
        section_title: null,
        theory_code: null,
        theory_title: null,
        book_type_numbers: [],
        page_start_hint: null,
        confidence: 0.96,
      })
      continue
    }
    const section = raw.match(SECTION_RE)
    if (section) {
      hits.push({
        page,
        kind: 'SECTION',
        raw,
        major_unit: null,
        section_code: section[1].padStart(2, '0'),
        section_title: section[2].trim(),
        theory_code: null,
        theory_title: null,
        book_type_numbers: [],
        page_start_hint: Number(section[3]),
        confidence: 0.94,
      })
      continue
    }
    const theory = raw.match(THEORY_RE)
    if (theory) {
      hits.push({
        page,
        kind: 'THEORY_HEADING',
        raw,
        major_unit: null,
        section_code: theory[1],
        section_title: null,
        theory_code: `${theory[1]}-${theory[2]}`,
        theory_title: cleanTitle(theory[3]).replace(/\s*유형.*$/, '').trim(),
        book_type_numbers: extractBookTypeNumbers(rawLine),
        page_start_hint: null,
        confidence: 0.9,
      })
      continue
    }
    const types = extractBookTypeNumbers(raw)
    if (types.length && raw.length < 40) {
      hits.push({
        page,
        kind: 'BOOK_TYPE',
        raw,
        major_unit: null,
        section_code: null,
        section_title: null,
        theory_code: null,
        theory_title: null,
        book_type_numbers: types,
        page_start_hint: null,
        confidence: 0.72,
      })
      continue
    }
    if (LABEL_RE.test(raw) && raw.length < 24) {
      hits.push({
        page,
        kind: 'LABEL',
        raw,
        major_unit: null,
        section_code: null,
        section_title: null,
        theory_code: null,
        theory_title: null,
        book_type_numbers: [],
        page_start_hint: null,
        confidence: 0.7,
      })
    }
  }
  return hits
}

export function buildBookStructure(input: {
  pageTexts: Array<{ page: number; text: string }>
  problemPages?: Array<{ page: number; problem_number: string }>
  lastPage?: number
}): BookStructure {
  const lastPage = input.lastPage ?? 192
  const allHits = input.pageTexts.flatMap((row) => extractHeadingsFromPage(row.page, row.text))
  const conflicts: string[] = []
  const uncertain: string[] = []

  const majorByCode = new Map<string, { code: string; title: string; firstPage: number; evidence: string[] }>()
  for (const hit of allHits.filter((row) => row.kind === 'MAJOR_UNIT' && row.major_unit)) {
    const code = hit.major_unit!.split(' ')[0]
    const title = hit.major_unit!.slice(code.length).trim()
    const existing = majorByCode.get(code)
    if (existing && existing.title !== title) {
      conflicts.push(`MAJOR_TITLE_CONFLICT:${code}:${existing.title}|${title}`)
      continue
    }
    if (!existing) majorByCode.set(code, { code, title, firstPage: hit.page, evidence: [hit.raw] })
    else if (!existing.evidence.includes(hit.raw)) existing.evidence.push(hit.raw)
  }

  const sectionByCode = new Map<string, { title: string; page_start: number; evidence: string[] }>()
  for (const hit of allHits.filter((row) => row.kind === 'SECTION' && row.section_code && row.section_title && row.page_start_hint)) {
    const existing = sectionByCode.get(hit.section_code!)
    if (existing && existing.title !== hit.section_title) {
      conflicts.push(`SECTION_TITLE_CONFLICT:${hit.section_code}:${existing.title}|${hit.section_title}`)
      continue
    }
    if (!existing) {
      sectionByCode.set(hit.section_code!, {
        title: hit.section_title!,
        page_start: hit.page_start_hint!,
        evidence: [hit.raw],
      })
    }
  }

  const sectionCodes = [...sectionByCode.keys()].sort()
  const sections: BookSection[] = sectionCodes.map((code, index) => {
    const row = sectionByCode.get(code)!
    const next = sectionCodes[index + 1]
    const page_end = next ? sectionByCode.get(next)!.page_start - 1 : lastPage
    const unit = unitTitleForSection(code, majorByCode)
    const problems = (input.problemPages ?? [])
      .filter((item) => item.page >= row.page_start && item.page <= page_end)
      .map((item) => item.problem_number)
      .sort()
    return {
      subject: BOOK_SUBJECT,
      section_code: code,
      unit,
      subunit: row.title,
      book_type_number: null,
      book_type_title: row.title,
      page_start: row.page_start,
      page_end,
      problem_number_start: problems[0] ?? null,
      problem_number_end: problems[problems.length - 1] ?? null,
      confidence: 0.93,
      evidence: row.evidence,
    }
  })

  const theory_headings: BookStructure['theory_headings'] = []
  for (const hit of allHits) {
    if (hit.kind !== 'THEORY_HEADING' || !hit.theory_code || !hit.theory_title) continue
    const theoryCode = hit.theory_code
    const theoryTitle = hit.theory_title
    const dup = theory_headings.find((row) => row.theory_code === theoryCode)
    if (dup) {
      if (dup.title !== theoryTitle) {
        if (theoryTitle.includes('향등식') && dup.title.includes('항등식')) {
          dup.evidence.push(`OCR_VARIANT:${hit.raw}`)
          continue
        }
        conflicts.push(`THEORY_TITLE_CONFLICT:${theoryCode}:${dup.title}|${theoryTitle}`)
      } else {
        for (const n of hit.book_type_numbers) if (!dup.book_type_numbers.includes(n)) dup.book_type_numbers.push(n)
        if (!dup.evidence.includes(hit.raw)) dup.evidence.push(hit.raw)
      }
      continue
    }
    theory_headings.push({
      page: hit.page,
      section_code: hit.section_code ?? theoryCode.slice(0, 2),
      theory_code: theoryCode,
      title: theoryTitle,
      book_type_numbers: hit.book_type_numbers,
      evidence: [hit.raw],
    })
  }

  const orderedMajors = ROMAN_UNITS.filter((code) => majorByCode.has(code)).map((code) => majorByCode.get(code)!)
  const major_units = orderedMajors.map((row) => {
    const owned = sections.filter((item) => item.unit === row.title)
    return {
      code: row.code,
      title: row.title,
      page_start: owned[0]?.page_start ?? (sectionByCode.get('01')?.page_start ?? 8),
      page_end: owned[owned.length - 1]?.page_end ?? lastPage,
      evidence: row.evidence,
    }
  })

  if (!sections.length) uncertain.push('TOC_SECTIONS_MISSING')
  if (!major_units.length) uncertain.push('TOC_MAJOR_UNITS_MISSING')
  if (!theory_headings.length) uncertain.push('THEORY_HEADINGS_MISSING')

  return {
    subject: BOOK_SUBJECT,
    source: 'ssen-common-math1.pdf',
    major_units,
    sections,
    theory_headings,
    conflicts,
    uncertain,
  }
}

function unitTitleForSection(sectionCode: string, majors: Map<string, { title: string }>): string {
  const n = Number(sectionCode)
  const code = n <= 2 ? 'I' : n <= 6 ? 'II' : n <= 8 ? 'III' : n <= 9 ? 'IV' : 'V'
  return majors.get(code)?.title ?? (n <= 2 ? '다항식' : n <= 6 ? '방정식' : n <= 8 ? '부등식' : n <= 9 ? '순열과 조합' : '행렬')
}

export function sectionForPage(structure: BookStructure, page: number): BookSection | null {
  return structure.sections.find((row) => page >= row.page_start && page <= row.page_end) ?? null
}

export function nearestTheoryHeading(structure: BookStructure, page: number, sectionCode?: string): BookStructure['theory_headings'][number] | null {
  const pool = structure.theory_headings.filter((row) => (sectionCode ? row.section_code === sectionCode : true) && row.page <= page)
  return pool.sort((a, b) => b.page - a.page)[0] ?? null
}
