export const SSEN_PUBLISHER = '좋은책신사고'
export const SSEN_SERIES = '쎈'

export type SourceStageCode = 'A_BASIC' | 'B_TYPE' | 'B_SKILL' | 'UNKNOWN'
export type SourceItemLabel = '하' | '중' | '상' | '대표 문제' | null
export type EvidenceType = 'TEXT_HEADING' | 'VISUAL_HEADING' | 'BADGE' | 'PAGE_SECTION' | 'TOC' | 'LAYOUT_BOUNDARY' | 'UNKNOWN'

export type PageDifficultyRow = {
  page: number
  major_unit: string | null
  subunit: string | null
  section_heading: string | null
  source_stage_label: string | null
  source_stage_raw: string | null
  source_stage_code: SourceStageCode
  visual_marker: string | null
  confidence: number
  evidence_type: EvidenceType
  evidence_location: string
}

/** Pages where the original PNG was inspected and the A/B 단계 badge was visible. */
export const VISUAL_STAGE_PAGES: Array<{
  page: number
  code: SourceStageCode
  label: string
  raw: string
  marker: string
}> = [
  { page: 8, code: 'A_BASIC', label: 'A단계 기본 다잡기', raw: 'A단계 기본 다잡기', marker: '3D letter A + 단계 badge' },
  { page: 12, code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw: 'B단계 유형 뽀개기', marker: '3D letter B + 단계 badge' },
  { page: 20, code: 'B_SKILL', label: 'B단계 실력 굳히기', raw: 'B단계 실력 굳히기', marker: 'B단계 badge + 실력 굳히기' },
  { page: 24, code: 'A_BASIC', label: 'A단계 기본 다잡기', raw: 'A단계 기본 다잡기', marker: '3D letter A + 단계 badge' },
  { page: 28, code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw: 'B단계 유형 뽀개기', marker: '3D letter B + 단계 badge' },
  { page: 46, code: 'A_BASIC', label: 'A단계 기본 다잡기', raw: 'A단계 기본 다잡기', marker: 'letter A + 단계 badge' },
  { page: 62, code: 'A_BASIC', label: 'A단계 기본 다잡기', raw: 'A단계 기본 다잡기', marker: 'letter A + 단계 badge' },
  { page: 120, code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw: 'B단계 유형 뽀개기', marker: '3D letter B + 단계 badge' },
  { page: 156, code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw: '유형 뽀개기', marker: '유형 headings + 하/중/상 badges' },
  { page: 174, code: 'A_BASIC', label: 'A단계 기본 다잡기', raw: 'A단계 기본 다잡기', marker: 'letter A + 단계 badge' },
  { page: 180, code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw: '유형 04', marker: '유형 heading + 중/상 badges' },
]

export function extractStageFromText(text: string): {
  code: SourceStageCode
  label: string | null
  raw: string | null
  confidence: number
} | null {
  const compact = text.replace(/\s+/g, ' ')
  if (/C\s*단계|C단계/.test(compact) && /고난도|집중/.test(compact)) {
    return { code: 'UNKNOWN', label: null, raw: compact.match(/C\s*단계[^\n]{0,20}/)?.[0] ?? 'C단계', confidence: 0.4 }
  }
  if (/실력\s*굳히기/.test(compact) || (/B\s*단계/.test(compact) && /실력/.test(compact))) {
    const raw = compact.match(/B?\s*단계?\s*실력\s*굳히기|실력\s*굳히기/)?.[0] ?? '실력 굳히기'
    return { code: 'B_SKILL', label: 'B단계 실력 굳히기', raw, confidence: 0.9 }
  }
  if (/유형\s*뽀개기/.test(compact) || (/B\s*단계/.test(compact) && /유형/.test(compact))) {
    const raw = compact.match(/B?\s*단계?\s*유형\s*뽀개기|유형\s*뽀개기/)?.[0] ?? '유형 뽀개기'
    return { code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw, confidence: 0.9 }
  }
  if (/기본\s*다잡기/.test(compact) || (/A\s*단계/.test(compact) && /기본/.test(compact))) {
    const raw = compact.match(/A?\s*단계?\s*기본\s*다잡기|기본\s*다잡기/)?.[0] ?? '기본 다잡기'
    return { code: 'A_BASIC', label: 'A단계 기본 다잡기', raw, confidence: 0.9 }
  }
  if (/^#{0,3}\s*유형\s*\d{1,2}\b/.test(text) || /\n유형\s*\d{1,2}\s+/.test(text)) {
    return { code: 'B_TYPE', label: 'B단계 유형 뽀개기', raw: text.match(/유형\s*\d{1,2}[^\n]{0,24}/)?.[0] ?? '유형', confidence: 0.72 }
  }
  return null
}

export function extractItemBadge(stem: string): { label: SourceItemLabel; extras: string[] } {
  const text = stem.replace(/\s+/g, ' ')
  const extras: string[] = []
  if (/대표\s*문제/.test(text)) extras.push('대표 문제')
  if (/서술형/.test(text)) extras.push('서술형')
  if (/집중\s*공략/.test(text)) extras.push('집중 공략')
  if (/사고력의\s*기술|사고의\s*기술/.test(text)) extras.push('사고력의 기술')
  if (/교육청\s*기출/.test(text)) extras.push('교육청 기출')
  let label: SourceItemLabel = null
  if (extras.includes('대표 문제')) label = '대표 문제'
  else if (/(^|[^\w])상([^\w]|$)/.test(text) && /난이|배지|●|○/.test(text)) label = '상'
  else if (/(^|[^\w])중([^\w]|$)/.test(text) && /난이|배지/.test(text)) label = '중'
  else if (/(^|[^\w])하([^\w]|$)/.test(text) && /난이|배지/.test(text)) label = '하'
  return { label, extras }
}

export function normalizeSourceStage(code: SourceStageCode): 'LEVEL_1_OF_3' | 'LEVEL_2_OF_3' | 'LEVEL_3_OF_3' | 'UNKNOWN' {
  if (code === 'A_BASIC') return 'LEVEL_1_OF_3'
  if (code === 'B_TYPE' || code === 'B_SKILL') return 'LEVEL_2_OF_3'
  return 'UNKNOWN'
}

/** Publisher stage is never copied onto HYPER LOW/MID/HIGH. Distinct namespaces. */
export function sourceStageIsNotHyper(
  code: SourceStageCode,
  hyper: 'LOW' | 'MID' | 'HIGH' | 'REVIEW',
): boolean {
  return String(code) !== String(hyper)
}

export function hardMapForbidden(code: SourceStageCode, hyper: 'LOW' | 'MID' | 'HIGH'): boolean {
  return (code === 'A_BASIC' && hyper === 'LOW') || ((code === 'B_TYPE' || code === 'B_SKILL') && hyper === 'MID')
}

export function buildPageDifficultyMap(input: {
  lastPage?: number
  ocrByPage: Map<number, string>
  pngByPage: Map<number, string>
  sections: Array<{ unit: string; subunit: string; page_start: number; page_end: number }>
}): { pages: PageDifficultyRow[]; boundaries: Array<{ page_start: number; page_end: number; code: SourceStageCode; label: string; confidence: number }> } {
  const lastPage = input.lastPage ?? 192
  const hits: Array<{ page: number; code: SourceStageCode; label: string; raw: string; confidence: number; evidence_type: EvidenceType; marker: string | null }> = []
  for (const visual of VISUAL_STAGE_PAGES) {
    hits.push({
      page: visual.page,
      code: visual.code,
      label: visual.label,
      raw: visual.raw,
      confidence: 0.98,
      evidence_type: 'VISUAL_HEADING',
      marker: visual.marker,
    })
  }
  for (let page = 1; page <= lastPage; page += 1) {
    const ocr = input.ocrByPage.get(page) ?? ''
    const extracted = extractStageFromText(ocr)
    if (!extracted) continue
    if (page < 8) continue
    const existing = hits.find((hit) => hit.page === page)
    if (existing) continue
    hits.push({
      page,
      code: extracted.code,
      label: extracted.label ?? 'UNKNOWN',
      raw: extracted.raw ?? '',
      confidence: extracted.confidence,
      evidence_type: 'TEXT_HEADING',
      marker: extracted.raw,
    })
  }
  hits.sort((a, b) => a.page - b.page || b.confidence - a.confidence)
  const uniqueHits: typeof hits = []
  for (const hit of hits) {
    if (uniqueHits.some((row) => row.page === hit.page)) continue
    uniqueHits.push(hit)
  }

  const pages: PageDifficultyRow[] = []
  let cursor = uniqueHits[0] ?? null
  let hitIndex = 0
  for (let page = 1; page <= lastPage; page += 1) {
    if (uniqueHits[hitIndex] && uniqueHits[hitIndex].page === page) {
      cursor = uniqueHits[hitIndex]
      hitIndex += 1
    }
    const section = input.sections.find((row) => page >= row.page_start && page <= row.page_end)
    const filler = /마음\s*갤러리|꿈행자/.test(input.ocrByPage.get(page) ?? '')
    const active = filler ? null : cursor
    const png = input.pngByPage.get(page)
    pages.push({
      page,
      major_unit: section?.unit ?? null,
      subunit: section?.subunit ?? null,
      section_heading: section ? `${section.unit} / ${section.subunit}` : null,
      source_stage_label: active?.label ?? null,
      source_stage_raw: active?.raw ?? null,
      source_stage_code: active?.code ?? 'UNKNOWN',
      visual_marker: active?.marker ?? null,
      confidence: filler ? 0 : active ? (active.page === page ? active.confidence : Math.max(0.55, active.confidence - 0.08)) : 0,
      evidence_type: filler ? 'UNKNOWN' : active ? (active.page === page ? active.evidence_type : 'LAYOUT_BOUNDARY') : 'UNKNOWN',
      evidence_location: png ?? `page-${String(page).padStart(3, '0')}`,
    })
  }

  const boundaries: Array<{ page_start: number; page_end: number; code: SourceStageCode; label: string; confidence: number }> = []
  for (const hit of uniqueHits) {
    const following = uniqueHits.find((row) => row.page > hit.page)
    boundaries.push({
      page_start: hit.page,
      page_end: following ? following.page - 1 : lastPage,
      code: hit.code,
      label: hit.label,
      confidence: hit.confidence,
    })
  }
  return { pages, boundaries }
}
