import type { DifficultyDims } from '../workflow/difficulty'
import { STEP811_THRESHOLDS } from './classificationPersistence'
import { CM2_DIFFICULTY_ENGINE, estimateCm2Difficulty } from './cm2DifficultyRubric'
import {
  CM2_ASSIGNED_BY,
  CM2_ARTIFACT,
  CM2_SUBUNIT_CODE,
  CM2_SUBUNIT_PARENT,
  CM2_TYPE_PROFILES,
  CM2_UNIT_CODE,
  cm2ProfileById,
  type Cm2TypeProfile,
} from './cm2Catalog'

export type Cm2PageSection = {
  unit: string | null
  subunit: string | null
  heading: string | null
  type_id: string | null
}

export type Cm2Decision = {
  problem_id: string
  page: number
  problem_number: string
  unit_id: string
  subunit_id: string
  type_id: string
  unit_confidence: number
  type_confidence: number
  difficulty_level: 1 | 2 | 3 | 4 | 5 | null
  difficulty_confidence: number
  difficulty_engine: typeof CM2_DIFFICULTY_ENGINE
  dim_levels: Record<keyof DifficultyDims, 1 | 2 | 3 | 4 | 5>
  type_used_for_difficulty: boolean
  key_test_points: string[]
  solution_strategies: string[]
  source_heading: string | null
  overall: 'AUTO' | 'REVIEW'
  reasons: string[]
}

const UNIT_TITLES: Array<{ re: RegExp; unit: string }> = [
  { re: /도형의\s*방정식/, unit: '도형의 방정식' },
  { re: /집합과\s*명제/, unit: '집합과 명제' },
  { re: /함수와\s*그래프/, unit: '함수와 그래프' },
]

const SUBUNIT_TITLES: Array<{ re: RegExp; subunit: string; unit: string }> = [
  { re: /평면좌표/, subunit: '평면좌표', unit: '도형의 방정식' },
  { re: /직선의\s*방정식/, subunit: '직선의 방정식', unit: '도형의 방정식' },
  { re: /원의\s*방정식/, subunit: '원의 방정식', unit: '도형의 방정식' },
  { re: /도형의\s*이동/, subunit: '도형의 이동', unit: '도형의 방정식' },
  { re: /유리함수와\s*무리함수/, subunit: '유리함수와 무리함수', unit: '함수와 그래프' },
  { re: /^(?:0?\d+\s+)?집합(?:의|\s|$)/, subunit: '집합', unit: '집합과 명제' },
  { re: /^(?:0?\d+\s+)?명제(?:와|\s|$)/, subunit: '명제', unit: '집합과 명제' },
  { re: /^(?:0?\d+\s+)?함수(?:의|\s|$)/, subunit: '함수', unit: '함수와 그래프' },
  { re: /유리함수/, subunit: '유리함수와 무리함수', unit: '함수와 그래프' },
  { re: /무리함수/, subunit: '유리함수와 무리함수', unit: '함수와 그래프' },
]

function normalizeLine(line: string): string {
  return line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
}

export function typeIdFromCm2Title(title: string): string | null {
  const text = normalizeLine(title)
  const scored = CM2_TYPE_PROFILES.map((row) => {
    const hit = row.aliases.some((alias) => text.includes(alias))
    return { id: row.type_id, hit, len: Math.max(...row.aliases.filter((alias) => text.includes(alias)).map((alias) => alias.length), 0) }
  }).filter((row) => row.hit)
  scored.sort((a, b) => b.len - a.len)
  return scored[0]?.id ?? null
}

export function cm2UnitFromStem(stem: string): { unit: string | null; subunit: string | null } {
  const text = stem.replace(/\s+/g, ' ')
  if (/유리함수/.test(text) || /무리함수/.test(text) || /점근선/.test(text)) return { unit: '함수와 그래프', subunit: '유리함수와 무리함수' }
  if (/합성함수|역함수/.test(text) || (/함수/.test(text) && /정의역|치역|대응/.test(text))) return { unit: '함수와 그래프', subunit: '함수' }
  if (/충분조건|필요조건|삼단논법|대우/.test(text) || (/명제/.test(text) && !/함수/.test(text))) return { unit: '집합과 명제', subunit: '명제' }
  if (/합집합|교집합|여집합|차집합|부분집합|원소의\s*개수|벤다이어그램/.test(text) || /집합\s*[A-Z]/.test(text)) {
    return { unit: '집합과 명제', subunit: '집합' }
  }
  if (/평행이동/.test(text)) return { unit: '도형의 방정식', subunit: '도형의 이동' }
  if (/대칭이동/.test(text)) return { unit: '도형의 방정식', subunit: '도형의 이동' }
  if (/원과\s*직선|접선|반지름|원의\s*방정식|중심이/.test(text) && /원/.test(text)) return { unit: '도형의 방정식', subunit: '원의 방정식' }
  if (/점과\s*직선\s*사이|직선의\s*방정식|기울기|x축에\s*평행|y축에\s*평행/.test(text) || /두\s*직선/.test(text)) {
    return { unit: '도형의 방정식', subunit: '직선의 방정식' }
  }
  if (/내분|외분|중점|두\s*점.{0,40}사이|사이의\s*거리|좌표평면/.test(text)) return { unit: '도형의 방정식', subunit: '평면좌표' }
  return { unit: null, subunit: null }
}

export function cm2TypeFromStem(stem: string): string | null {
  const text = stem.replace(/\s+/g, ' ')
  if (/무리함수/.test(text)) return 'IRRATIONAL_FN'
  if (/유리함수|점근선/.test(text)) return 'RATIONAL_FN'
  if (/합성함수|역함수/.test(text)) return 'COMPOSITE_INVERSE'
  if (/정의역|치역/.test(text) && /함수/.test(text)) return 'FUNCTION_BASIC'
  if (/충분조건|필요조건|삼단논법/.test(text)) return 'PROPOSITION_CONDITION'
  if (/명제|대우|참인지/.test(text)) return 'PROPOSITION_LOGIC'
  if (/원소의\s*개수|부분집합의\s*개수|n\s*\(/.test(text)) return 'SET_COUNT'
  if (/합집합|교집합|여집합|차집합/.test(text)) return 'SET_OPS'
  if (/집합의\s*뜻|원소나열|조건제시|포함\s*관계/.test(text)) return 'SET_BASIC'
  if (/대칭이동/.test(text)) return 'REFLECTION'
  if (/평행이동/.test(text)) return 'TRANSLATION'
  if (/접선|원과\s*직선/.test(text)) return 'CIRCLE_LINE'
  if (/원의\s*방정식|반지름/.test(text) && /원/.test(text)) return 'CIRCLE_EQUATION'
  if (/점과\s*직선\s*사이/.test(text)) return 'POINT_LINE_DISTANCE'
  if (/평행|수직/.test(text) && /직선/.test(text)) return 'LINE_PARALLEL_PERP'
  if (/직선의\s*방정식|기울기/.test(text)) return 'LINE_EQUATION'
  if (/내분|외분|중점/.test(text)) return 'SEGMENT_DIVISION'
  if ((/두\s*점.{0,40}사이|사이의\s*거리/.test(text) || (/거리/.test(text) && /점/.test(text))) && !/점과\s*직선/.test(text)) {
    return 'DISTANCE_TWO_POINTS'
  }
  return null
}

export function structureFromPageTexts(pages: Array<{ page: number; text: string }>): Map<number, Cm2PageSection> {
  const byPage = new Map<number, Cm2PageSection>()
  let current: Cm2PageSection = { unit: null, subunit: null, heading: null, type_id: null }
  const ordered = [...pages].sort((a, b) => a.page - b.page)
  for (const page of ordered) {
    for (const raw of page.text.split('\n')) {
      const line = normalizeLine(raw)
      if (!line || line.length > 80) continue
      for (const unit of UNIT_TITLES) {
        if (unit.re.test(line)) current = { ...current, unit: unit.unit }
      }
      for (const sub of SUBUNIT_TITLES) {
        if (sub.re.test(line) && line.length < 40) {
          current = { ...current, unit: current.unit ?? sub.unit, subunit: sub.subunit, heading: line }
        }
      }
      if (/유형/.test(line) || /^\d{2}-\d/.test(line) || /^\d{2}\s+\d\s+/.test(line)) {
        const typeId = typeIdFromCm2Title(line)
        if (typeId) {
          const profile = cm2ProfileById(typeId)
          current = {
            unit: current.unit ?? profile?.unit_id ?? null,
            subunit: current.subunit ?? profile?.subunit_id ?? null,
            heading: line,
            type_id: typeId,
          }
        }
      }
    }
    byPage.set(page.page, { ...current })
  }
  return byPage
}

export function classifyCm2Problem(input: {
  problem_id: string
  page: number
  problem_number: string
  stem: string
  section: Cm2PageSection | undefined
  choice_count?: number
}): Cm2Decision {
  const reasons: string[] = []
  const stem = input.stem.trim()
  if (stem.length < 8) reasons.push('EVIDENCE_INSUFFICIENT')
  const fromStem = cm2UnitFromStem(stem)
  const headingUnit = input.section?.unit ?? null
  const headingSub = input.section?.subunit ?? null
  let unit_id = '미정'
  let subunit_id = '미정'
  let unit_confidence = 0.3
  if (fromStem.unit && headingUnit === fromStem.unit) {
    unit_id = fromStem.unit
    subunit_id = fromStem.subunit ?? headingSub ?? '미정'
    unit_confidence = 0.97
  } else if (fromStem.unit && headingUnit && headingUnit !== fromStem.unit) {
    unit_id = fromStem.unit
    subunit_id = fromStem.subunit ?? '미정'
    unit_confidence = 0.42
    reasons.push('UNIT_CONFLICT')
  } else if (headingUnit) {
    unit_id = headingUnit
    subunit_id = headingSub ?? fromStem.subunit ?? '미정'
    unit_confidence = 0.88
  } else if (fromStem.unit) {
    unit_id = fromStem.unit
    subunit_id = fromStem.subunit ?? '미정'
    unit_confidence = 0.8
  }

  const headingType = input.section?.type_id ?? (input.section?.heading ? typeIdFromCm2Title(input.section.heading) : null)
  const stemType = cm2TypeFromStem(stem)
  let type_id = 'TYPE_UNCLEAR'
  let type_confidence = 0.28
  if (headingType && stemType && headingType === stemType) {
    type_id = headingType
    type_confidence = 0.94
  } else if (headingType && stemType && headingType !== stemType) {
    type_id = stemType
    type_confidence = 0.5
    reasons.push('TYPE_HEADING_STEM_MISMATCH')
  } else if (headingType) {
    type_id = headingType
    type_confidence = 0.8
  } else if (stemType) {
    type_id = stemType
    type_confidence = 0.72
  } else {
    reasons.push('TYPE_UNCLEAR')
  }

  const profile: Cm2TypeProfile | undefined = cm2ProfileById(type_id)
  if (!profile) reasons.push('TYPE_UNCLEAR')
  if (profile && profile.unit_id !== unit_id && unit_id !== '미정') {
    reasons.push('UNIT_TYPE_INCONSISTENT')
    type_confidence = Math.min(type_confidence, 0.5)
  }
  if (profile && subunit_id !== '미정' && profile.subunit_id !== subunit_id) {
    reasons.push('SUBUNIT_TYPE_INCONSISTENT')
    type_confidence = Math.min(type_confidence, 0.5)
  }

  const unitAuto = unit_confidence >= STEP811_THRESHOLDS.unit && !reasons.includes('UNIT_CONFLICT') && Boolean(CM2_UNIT_CODE[unit_id])
  const typeAuto =
    type_confidence >= STEP811_THRESHOLDS.type && type_id !== 'TYPE_UNCLEAR' && Boolean(profile) && !reasons.includes('TYPE_UNCLEAR')
  const keyAuto = Boolean(profile?.key_test_points.length) && typeAuto
  const overall = unitAuto && typeAuto && keyAuto && !reasons.includes('EVIDENCE_INSUFFICIENT') ? 'AUTO' : 'REVIEW'
  if (!unitAuto) reasons.push('UNIT_NOT_AUTO')
  if (!typeAuto) reasons.push('TYPE_NOT_AUTO')
  if (!keyAuto) reasons.push('KEY_POINT_NOT_AUTO')

  const typeUsed = typeAuto && type_id !== 'TYPE_UNCLEAR'
  const rubric = estimateCm2Difficulty({ stem, type_id: typeUsed ? type_id : null })
  const difficulty_confidence = stem.replace(/\s+/g, '').length < 12 ? 0.28 : typeUsed ? 0.82 : 0.74

  return {
    problem_id: input.problem_id,
    page: input.page,
    problem_number: input.problem_number,
    unit_id,
    subunit_id,
    type_id,
    unit_confidence: Number(unit_confidence.toFixed(3)),
    type_confidence: Number(type_confidence.toFixed(3)),
    difficulty_level: rubric.overall_level,
    difficulty_confidence: Number(difficulty_confidence.toFixed(3)),
    difficulty_engine: CM2_DIFFICULTY_ENGINE,
    dim_levels: rubric.dim_levels,
    type_used_for_difficulty: typeUsed,
    key_test_points: profile?.key_test_points ?? [],
    solution_strategies: profile?.solution_strategies ?? [],
    source_heading: input.section?.heading ?? null,
    overall,
    reasons: [...new Set(reasons)],
  }
}

export function cm2ClassificationPayload(input: {
  decision: Cm2Decision
  versionId: string
  sourceDocumentId: string
}): Record<string, unknown> {
  const persistSubunit =
    Boolean(CM2_SUBUNIT_CODE[input.decision.subunit_id]) &&
    CM2_SUBUNIT_PARENT[CM2_SUBUNIT_CODE[input.decision.subunit_id]!] === CM2_UNIT_CODE[input.decision.unit_id]
  const persistDifficulty =
    input.decision.difficulty_level != null && input.decision.difficulty_confidence >= STEP811_THRESHOLDS.difficulty
  return {
    problem_id: input.decision.problem_id,
    expected_version_id: input.versionId,
    source_document_id: input.sourceDocumentId,
    page_number: input.decision.page,
    original_problem_number: input.decision.problem_number,
    classification_status: 'AUTO',
    type_code: input.decision.type_id,
    unit_code: CM2_UNIT_CODE[input.decision.unit_id],
    subunit_code: persistSubunit ? CM2_SUBUNIT_CODE[input.decision.subunit_id] : '',
    subtype_code: '',
    persist_difficulty: persistDifficulty,
    difficulty_level: persistDifficulty ? input.decision.difficulty_level : null,
    concept_difficulty: persistDifficulty ? input.decision.dim_levels.concept_difficulty : null,
    calculation_complexity: persistDifficulty ? input.decision.dim_levels.calculation_complexity : null,
    reasoning_depth: persistDifficulty ? input.decision.dim_levels.reasoning_depth : null,
    condition_complexity: persistDifficulty ? input.decision.dim_levels.condition_complexity : null,
    representation_complexity: persistDifficulty ? input.decision.dim_levels.representation_complexity : null,
    trap_level: persistDifficulty ? input.decision.dim_levels.trap_level : null,
    overall_difficulty: persistDifficulty ? input.decision.difficulty_level : null,
    difficulty_engine: input.decision.difficulty_engine,
    type_used_for_difficulty: input.decision.type_used_for_difficulty,
    key_test_points: input.decision.key_test_points,
    solution_strategies: input.decision.solution_strategies,
    unit_confidence: input.decision.unit_confidence,
    type_confidence: input.decision.type_confidence,
    difficulty_confidence: input.decision.difficulty_confidence,
    source_heading: input.decision.source_heading,
    heading_distance: null,
    assigned_by: CM2_ASSIGNED_BY,
    artifact_step: CM2_ARTIFACT,
  }
}

export function cm2TypeRpcPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, persist_difficulty: false, difficulty_level: null }
}

export function cm2DifficultyRpcPayload(input: {
  decision: Cm2Decision
  versionId: string
}): Record<string, unknown> | null {
  if (input.decision.difficulty_level == null || input.decision.difficulty_confidence < STEP811_THRESHOLDS.difficulty) {
    return null
  }
  return {
    problem_id: input.decision.problem_id,
    expected_version_id: input.versionId,
    concept_difficulty: input.decision.dim_levels.concept_difficulty,
    calculation_complexity: input.decision.dim_levels.calculation_complexity,
    reasoning_depth: input.decision.dim_levels.reasoning_depth,
    condition_complexity: input.decision.dim_levels.condition_complexity,
    representation_complexity: input.decision.dim_levels.representation_complexity,
    trap_level: input.decision.dim_levels.trap_level,
    overall_difficulty: input.decision.difficulty_level,
    difficulty_confidence: input.decision.difficulty_confidence,
    assigned_by: CM2_ASSIGNED_BY,
    artifact_step: CM2_ARTIFACT,
    engine: input.decision.difficulty_engine,
  }
}
