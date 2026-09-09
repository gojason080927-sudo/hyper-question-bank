export const SSEN_PUBLISHER = '좋은책신사고'
export const SSEN_SERIES = '쎈'

export type SourceDifficultyNormalized = 'LEVEL_1_OF_3' | 'LEVEL_2_OF_3' | 'LEVEL_3_OF_3' | 'UNKNOWN'

export type PublisherDifficultyEvidence = {
  problem_id: string
  page_number: number
  publisher: typeof SSEN_PUBLISHER
  publisher_series: typeof SSEN_SERIES
  source_difficulty_label: string | null
  source_difficulty_normalized: SourceDifficultyNormalized
  source_difficulty_confidence: number
  source_difficulty_evidence: string[]
  source_difficulty_heading: string | null
  source_difficulty_page_range: string | null
  letter_abc: 'A' | 'B' | 'C' | null
}

const KOREAN_LABEL = /기본\s*다잡기|핵심\s*개념|개념\s*(?:Plus|정리)|실력\s*UP|고난도|대표\s*문제/
const LETTER_ABC = /(?:난이도|단계|Level|LEVEL)\s*(?::|-)?\s*([ABC])\b|\b([ABC])\s*(?:단계|코스|레벨)\b/

export function normalizePublisherLabel(label: string | null): SourceDifficultyNormalized {
  if (!label) return 'UNKNOWN'
  if (/기본\s*다잡기|핵심\s*개념|개념\s*(?:Plus|정리)/.test(label) || label === 'A') return 'LEVEL_1_OF_3'
  if (/대표\s*문제/.test(label) || label === 'B') return 'LEVEL_2_OF_3'
  if (/실력\s*UP|고난도/.test(label) || label === 'C') return 'LEVEL_3_OF_3'
  return 'UNKNOWN'
}

export function extractKoreanPublisherLabel(text: string): string | null {
  const match = compact(text).match(KOREAN_LABEL)
  return match ? match[0].replace(/\s+/g, ' ') : null
}

export function extractLetterAbc(text: string): 'A' | 'B' | 'C' | null {
  const match = compact(text).match(LETTER_ABC)
  const letter = (match?.[1] ?? match?.[2]) as 'A' | 'B' | 'C' | undefined
  return letter ?? null
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/** Publisher A/B/C is never copied onto HYPER LOW/MID/HIGH. */
export function publisherLabelIsNotHyperDifficulty(label: string | null, hyper: 'LOW' | 'MID' | 'HIGH' | 'REVIEW' | null): boolean {
  if (!label || !hyper) return true
  if (label === 'A' && hyper === 'LOW') return true
  if (label === 'B' && hyper === 'MID') return true
  if (label === 'C' && hyper === 'HIGH') return true
  return label !== hyper
}

export function buildPublisherEvidence(input: {
  problem_id: string
  page_number: number
  stem: string
  source_heading: string | null
  page_ocr: string
  heading_label: string | null
  page_range: string | null
}): PublisherDifficultyEvidence {
  const letter = extractLetterAbc(input.page_ocr) ?? extractLetterAbc(input.stem)
  const korean =
    extractKoreanPublisherLabel(input.stem) ??
    extractKoreanPublisherLabel(input.heading_label ?? '') ??
    extractKoreanPublisherLabel(input.page_ocr)
  const label = letter ?? korean
  const evidence: string[] = []
  if (letter) evidence.push(`ocr_or_stem_letter=${letter}`)
  if (korean) evidence.push(`publisher_heading=${korean}`)
  if (!label) evidence.push('UNKNOWN: no A/B/C letter and no 기본/대표/실력/고난도 label in cache')
  const confidence = letter ? 0.98 : korean ? 0.86 : 0
  return {
    problem_id: input.problem_id,
    page_number: input.page_number,
    publisher: SSEN_PUBLISHER,
    publisher_series: SSEN_SERIES,
    source_difficulty_label: label,
    source_difficulty_normalized: normalizePublisherLabel(label),
    source_difficulty_confidence: confidence,
    source_difficulty_evidence: evidence,
    source_difficulty_heading: korean ?? input.heading_label ?? input.source_heading,
    source_difficulty_page_range: input.page_range,
    letter_abc: letter,
  }
}

export function scanPagesForAbc(pageTexts: Array<{ page: number; text: string }>): {
  letter_hits: Array<{ page: number; letter: 'A' | 'B' | 'C'; snippet: string }>
  korean_hits: Array<{ page: number; label: string; snippet: string }>
  boundary_confidence: number
  extraction_method: string
} {
  const letter_hits: Array<{ page: number; letter: 'A' | 'B' | 'C'; snippet: string }> = []
  const korean_hits: Array<{ page: number; label: string; snippet: string }> = []
  for (const row of pageTexts) {
    const letter = extractLetterAbc(row.text)
    if (letter) letter_hits.push({ page: row.page, letter, snippet: compact(row.text).slice(0, 80) })
    const korean = extractKoreanPublisherLabel(row.text)
    if (korean) korean_hits.push({ page: row.page, label: korean, snippet: compact(row.text).slice(0, 80) })
  }
  const boundary_confidence = letter_hits.length >= 6 ? 0.9 : korean_hits.length >= 8 ? 0.72 : letter_hits.length ? 0.4 : 0.15
  return {
    letter_hits,
    korean_hits,
    boundary_confidence,
    extraction_method: letter_hits.length
      ? 'strict letter regex on cached OCR/headings'
      : korean_hits.length
        ? 'Korean SSEN labels in stem/OCR cache; letter A/B/C not found'
        : 'no publisher difficulty markers in cache',
  }
}
