import type { PublisherBadgeNorm } from './publisherBadge'
import type { IntrinsicInput } from './intrinsicDifficulty'
import type { PrimaryBand } from './difficulty813a'

export const CALIBRATION_MODEL_VERSION = 'HYPER_DIFFICULTY_CALIBRATION_v1'
export const INTRINSIC_ENGINE_ROLE = 'SUPPORTING_EVIDENCE' as const
export const INTRINSIC_PRODUCTION_MODEL = null
export const ABSOLUTE_NINE_LEVEL = false
export const FORCED_DISTRIBUTION = false
export const NUMERIC_WEIGHTS_FROZEN = false
export const SSEN_EXPERT_LOCK = { CONFIRMED: 261, LOW_BADGE: 31, MID_BADGE: 170, HIGH_BADGE: 60 } as const

export type SourceDifficultyOrigin =
  | 'PUBLISHER_PRINTED'
  | 'USER_DEFINED_BOOK_RULE'
  | 'VISUAL_DETECTED'
  | 'OCR_DETECTED'
  | 'INFERRED_FROM_SECTION'

export type SourceEvidenceStatus = 'EXPERT_CONFIRMED' | 'SOURCE_CONFIRMED' | 'REVIEW' | 'UNKNOWN'
export type LevelScope = 'STAGE' | 'ITEM' | 'SECTION' | 'STAR' | 'STEP'
export type SystemKind = 'STAGE' | 'ITEM_BADGE' | 'SECTION' | 'STEP' | 'STAR' | 'MIXED'
export type HyperPrimary = 'LOW' | 'MID' | 'HIGH'
export type HyperSecondaryRelative = 'RELATIVE_LOW' | 'RELATIVE_MID' | 'RELATIVE_HIGH'
export type HyperPrimaryDecision = HyperPrimary | 'REVIEW' | null

export type SourceDifficultyLevel = {
  raw_label: string
  normalized_order: number
  description: string
  visual_marker: string | null
  section_marker: string | null
  item_marker: string | null
  level_scope: LevelScope
}

export type BookDifficultySystem = {
  difficulty_system_id: string
  source_document_id: string | null
  series_identity: string
  publisher: string
  series: string
  edition: string | null
  subject: string | null
  system_name: string
  system_kind: SystemKind
  level_count: number
  ordered_levels: SourceDifficultyLevel[]
  dimensions: LevelScope[]
  created_from: SourceDifficultyOrigin[]
  confidence: number
  notes: string[]
}

export type ProblemSourceDifficulty = {
  problem_identity: string
  difficulty_system_id: string
  source_stage: string | null
  source_item_label: string | null
  source_item_label_raw: string | null
  source_level_order: number | null
  source_level_count: number | null
  source_visual_evidence: unknown
  source_difficulty_confidence: number
  source_difficulty_origin: SourceDifficultyOrigin[]
  evidence_status: SourceEvidenceStatus
  hyper_primary: HyperPrimaryDecision
  hyper_secondary: HyperSecondaryRelative | null
  hyper_continuous_score: number | null
  raw_label_immutable: true
  production_write: false
}

export type CalibrationAnchorPriority =
  | 'same_type'
  | 'same_subtype'
  | 'math_structure'
  | 'strategy'
  | 'intrinsic_features'
  | 'source_ordinal'

export type SourceScaleProfile = {
  difficulty_system_id: string
  levels: Array<{
    raw_label: string
    hyper_reference_distribution: { LOW: number; MID: number; HIGH: number; REVIEW: number } | null
    range: { min: number; max: number } | null
    confidence: number
    hard_mapped_to_hyper: false
  }>
}

export type CalibrationRecord = {
  calibration_version: typeof CALIBRATION_MODEL_VERSION
  source_system: string
  reference_systems: string[]
  anchor_problems: string[]
  same_type_anchors: Array<{ type_id: string; n: number }>
  coverage: { unit: number; type: number; anchor_count: number }
  confidence: number
  scale_relation: string
  known_bias: string[]
  synthetic_used_as_evidence: false
}

export const EVIDENCE_HIERARCHY = [
  { level: 1, name: 'SOURCE_EXPERT_DIFFICULTY', weight_policy: 'STRONG', numeric_weight: null },
  { level: 2, name: 'CROSS_PUBLISHER_CALIBRATION', weight_policy: 'STRONG_OR_MEDIUM_BY_CONFIDENCE', numeric_weight: null },
  { level: 3, name: 'INTRINSIC_MATHEMATICAL_DIFFICULTY', weight_policy: 'MEDIUM_OR_STRONG_BY_EXTRACTION_CONFIDENCE', numeric_weight: null },
  { level: 4, name: 'EMPIRICAL_STUDENT_DATA', weight_policy: 'FUTURE_NOT_IMPLEMENTED', numeric_weight: null },
] as const

export const SSEN_STAGE_LEVELS: SourceDifficultyLevel[] = [
  { raw_label: 'A_BASIC', normalized_order: 0, description: 'A단계 기본 다잡기', visual_marker: 'red/orange-red number, no 하/중/상 circle', section_marker: 'A단계 기본 다잡기', item_marker: null, level_scope: 'STAGE' },
  { raw_label: 'B_TYPE', normalized_order: 1, description: 'B단계 유형 뽀개기', visual_marker: 'green number + item 하/중/상 circles', section_marker: 'B단계 유형 뽀개기', item_marker: null, level_scope: 'STAGE' },
  { raw_label: 'B_SKILL', normalized_order: 2, description: 'B단계 실력 굳히기', visual_marker: 'blue number, 교육청 기출 / 서술형, no item badge', section_marker: 'B단계 실력 굳히기', item_marker: null, level_scope: 'STAGE' },
]

export const SSEN_ITEM_LEVELS: SourceDifficultyLevel[] = [
  { raw_label: '하', normalized_order: 0, description: 'B_TYPE item badge 하 (orange circle)', visual_marker: 'orange filled circle', section_marker: null, item_marker: '하', level_scope: 'ITEM' },
  { raw_label: '중', normalized_order: 1, description: 'B_TYPE item badge 중 (blue-violet circle)', visual_marker: 'blue-violet filled circle', section_marker: null, item_marker: '중', level_scope: 'ITEM' },
  { raw_label: '상', normalized_order: 2, description: 'B_TYPE item badge 상 (pink/magenta circle)', visual_marker: 'pink/magenta filled circle', section_marker: null, item_marker: '상', level_scope: 'ITEM' },
]

export function makeOrderedSystem(input: {
  difficulty_system_id: string
  publisher: string
  series: string
  system_name: string
  system_kind: SystemKind
  labels: string[]
  scope: LevelScope
  created_from?: SourceDifficultyOrigin[]
}): BookDifficultySystem {
  const ordered_levels = input.labels.map((raw_label, index) => ({
    raw_label,
    normalized_order: index,
    description: `${input.system_name} level ${index + 1}/${input.labels.length}`,
    visual_marker: input.scope === 'STAR' ? raw_label : null,
    section_marker: input.scope === 'STAGE' || input.scope === 'SECTION' || input.scope === 'STEP' ? raw_label : null,
    item_marker: input.scope === 'ITEM' ? raw_label : null,
    level_scope: input.scope,
  }))
  return {
    difficulty_system_id: input.difficulty_system_id,
    source_document_id: null,
    series_identity: `${input.publisher}|${input.series}`,
    publisher: input.publisher,
    series: input.series,
    edition: null,
    subject: null,
    system_name: input.system_name,
    system_kind: input.system_kind,
    level_count: ordered_levels.length,
    ordered_levels,
    dimensions: [input.scope],
    created_from: input.created_from ?? ['USER_DEFINED_BOOK_RULE'],
    confidence: 1,
    notes: ['Source order only. Not a HYPER LOW/MID/HIGH mapping.'],
  }
}

export const SSEN_DIFFICULTY_SYSTEM: BookDifficultySystem = {
  difficulty_system_id: 'ssen-cm1-v1',
  source_document_id: '9ff369b4-5b16-4cb8-bfc3-a6b180c18703',
  series_identity: '좋은책신사고|쎈|공통수학1',
  publisher: '좋은책신사고',
  series: '쎈',
  edition: '공통수학1',
  subject: '공통수학1',
  system_name: 'SSEN stage + item badge',
  system_kind: 'MIXED',
  level_count: SSEN_STAGE_LEVELS.length + SSEN_ITEM_LEVELS.length,
  ordered_levels: [...SSEN_STAGE_LEVELS, ...SSEN_ITEM_LEVELS],
  dimensions: ['STAGE', 'ITEM'],
  created_from: ['PUBLISHER_PRINTED', 'VISUAL_DETECTED'],
  confidence: 0.92,
  notes: [
    'Stage and item badge are different evidence dimensions.',
    'C단계 is not a visually confirmed section header; omitted as confirmed stage.',
    'A_BASIC and B_SKILL have no item 하/중/상 circles.',
    'SSEN 상 is not HYPER HIGH.',
  ],
}

export const SYNTHETIC_BOOK_X = makeOrderedSystem({
  difficulty_system_id: 'synthetic-book-x-v1',
  publisher: 'SYNTHETIC',
  series: 'BOOK_X',
  system_name: '기본 → 발전 → 심화',
  system_kind: 'SECTION',
  labels: ['기본', '발전', '심화'],
  scope: 'SECTION',
})

export const SYNTHETIC_STEP_SYSTEM = makeOrderedSystem({
  difficulty_system_id: 'synthetic-step-v1',
  publisher: 'SYNTHETIC',
  series: 'STEP_BOOK',
  system_name: 'STEP 1 → STEP 2 → STEP 3',
  system_kind: 'STEP',
  labels: ['STEP 1', 'STEP 2', 'STEP 3'],
  scope: 'STEP',
})

export const SYNTHETIC_STAR_SYSTEM = makeOrderedSystem({
  difficulty_system_id: 'synthetic-star-v1',
  publisher: 'SYNTHETIC',
  series: 'STAR_BOOK',
  system_name: '★ → ★★ → ★★★',
  system_kind: 'STAR',
  labels: ['★', '★★', '★★★'],
  scope: 'STAR',
})

export function sourceOrdinalPosition(order: number, count: number): number {
  if (count <= 1) return 0
  return order / (count - 1)
}

export function findLevel(system: BookDifficultySystem, raw: string, scope?: LevelScope): SourceDifficultyLevel | null {
  return system.ordered_levels.find((row) => row.raw_label === raw && (!scope || row.level_scope === scope)) ?? null
}

export function freezeRawLabel(raw: string | null): string | null {
  return raw
}

export function hardMapSourceToHyper(raw: string | null, system?: BookDifficultySystem): HyperPrimaryDecision {
  void raw
  void system
  return null
}

export function sourceLabelForcesHyper(raw: string | null, hyper: HyperPrimary): boolean {
  void raw
  void hyper
  return false
}

export function sourceDifficultyEqualsHyperField(sourceRaw: string | null, hyper: HyperPrimaryDecision): boolean {
  if (sourceRaw == null || hyper == null || hyper === 'REVIEW') return false
  return false
}

export function wouldCopySsenOntoHyper(raw: '하' | '중' | '상', hyper: HyperPrimary): boolean {
  return sourceLabelForcesHyper(raw, hyper)
}

export function secondaryWithinPrimary(primary: HyperPrimary, relative: HyperSecondaryRelative): `${HyperPrimary}-${'LOW' | 'MID' | 'HIGH'}` {
  const tail = relative.replace('RELATIVE_', '') as 'LOW' | 'MID' | 'HIGH'
  return `${primary}-${tail}`
}

export function isAbsoluteNineLevel(band: string): boolean {
  void band
  return ABSOLUTE_NINE_LEVEL
}

export function intrinsicInputAllowsSourceLabel(input: IntrinsicInput): boolean {
  return !('source_item_label' in input || 'publisher_badge' in input || 'source_difficulty_label' in input)
}

export function conflictDecision(input: {
  source_like: 'LOW_LIKE' | 'MID_LIKE' | 'HIGH_LIKE' | 'NONE'
  intrinsic_like: 'VERY_EASY' | 'MEDIUM' | 'VERY_HARD' | 'UNKNOWN'
  extraction_confidence: number
}): { status: 'KEEP_BOTH' | 'REVIEW'; code: 'SOURCE_INTRINSIC_CONFLICT' | 'NONE'; reasons: string[] } {
  if (input.source_like === 'NONE' || input.intrinsic_like === 'UNKNOWN') {
    return { status: 'KEEP_BOTH', code: 'NONE', reasons: ['insufficient_side_for_conflict'] }
  }
  const clash =
    (input.source_like === 'HIGH_LIKE' && input.intrinsic_like === 'VERY_EASY') ||
    (input.source_like === 'LOW_LIKE' && input.intrinsic_like === 'VERY_HARD')
  if (clash) {
    return {
      status: 'REVIEW',
      code: 'SOURCE_INTRINSIC_CONFLICT',
      reasons: ['do_not_drop_either_side', 'publisher_pedagogy_or_scale_or_ocr_or_model'],
    }
  }
  return { status: 'KEEP_BOTH', code: 'NONE', reasons: ['no_severe_clash'] }
}

export function unlabeledEstimatePath(): {
  source_difficulty: 'NONE'
  uses: string[]
  forbidden_reason: string
} {
  return {
    source_difficulty: 'NONE',
    uses: ['unit_subunit_type', 'similar_or_twin_anchors', 'intrinsic_structure', 'calibrated_multi_publisher_reference', 'type_relative_position'],
    forbidden_reason: 'Must not say SSEN 상이라서 상',
  }
}

export const ANCHOR_PRIORITY: CalibrationAnchorPriority[] = [
  'same_type',
  'same_subtype',
  'math_structure',
  'strategy',
  'intrinsic_features',
  'source_ordinal',
]

export function sameTypeAnchorsFirst(): boolean {
  return ANCHOR_PRIORITY[0] === 'same_type'
}

export function calibrationSupportsMultipleBooks(systemIds: string[]): boolean {
  return systemIds.length >= 2 && new Set(systemIds).size === systemIds.length
}

export function sourceScaleProfileFromSystem(system: BookDifficultySystem): SourceScaleProfile {
  return {
    difficulty_system_id: system.difficulty_system_id,
    levels: system.ordered_levels
      .filter((row) => row.level_scope !== 'STAGE')
      .map((row) => ({
        raw_label: row.raw_label,
        hyper_reference_distribution: null,
        range: null,
        confidence: 0,
        hard_mapped_to_hyper: false,
      })),
  }
}

export type SsenGoldenRow = {
  page: number
  problem_number: string
  problem_identity: string
  publisher_badge_normalized: PublisherBadgeNorm
  publisher_badge_raw: string | null
  source_stage: string
  source_type_heading: string | null
  badge_confidence?: number
  badge_bbox?: unknown
  evidence?: string[]
  pipeline_status?: string
}

export function projectSsenExpertRow(row: SsenGoldenRow): ProblemSourceDifficulty {
  const item = findLevel(SSEN_DIFFICULTY_SYSTEM, row.publisher_badge_raw ?? '', 'ITEM')
  return {
    problem_identity: row.problem_identity,
    difficulty_system_id: SSEN_DIFFICULTY_SYSTEM.difficulty_system_id,
    source_stage: row.source_stage,
    source_item_label: item?.raw_label ?? row.publisher_badge_raw,
    source_item_label_raw: freezeRawLabel(row.publisher_badge_raw),
    source_level_order: item?.normalized_order ?? null,
    source_level_count: SSEN_ITEM_LEVELS.length,
    source_visual_evidence: {
      bbox: row.badge_bbox ?? null,
      evidence: row.evidence ?? [],
      heading: row.source_type_heading,
    },
    source_difficulty_confidence: row.badge_confidence ?? 0.92,
    source_difficulty_origin: ['PUBLISHER_PRINTED', 'VISUAL_DETECTED'],
    evidence_status: 'EXPERT_CONFIRMED',
    hyper_primary: hardMapSourceToHyper(row.publisher_badge_raw),
    hyper_secondary: null,
    hyper_continuous_score: null,
    raw_label_immutable: true,
    production_write: false,
  }
}

export function stageAndItemAreSeparate(row: ProblemSourceDifficulty): boolean {
  return row.source_stage != null && row.source_item_label_raw != null && row.source_stage !== row.source_item_label_raw
}

export const WEIGHT_POLICY = {
  SOURCE_EXPERT: 'STRONG',
  CROSS_PUBLISHER_ANCHOR: 'STRONG_OR_MEDIUM_BY_CONFIDENCE',
  INTRINSIC_STRUCTURE: 'MEDIUM_OR_STRONG_BY_EXTRACTION_CONFIDENCE',
  OCR_ONLY_SOURCE_LABEL: 'WEAK',
  NO_SOURCE_LABEL: 'intrinsic_plus_calibrated_neighbors',
  production_numeric_weights: NUMERIC_WEIGHTS_FROZEN,
}

export const ONBOARDING_STEPS = [
  'A_PDF_REGISTER',
  'B_BOOK_DIFFICULTY_SYSTEM_INPUT',
  'C_VISUAL_LAYOUT_DETECTOR',
  'D_STORE_SOURCE_DIFFICULTY_EVIDENCE',
  'E_SAME_TYPE_ANCHOR_SEARCH',
  'F_CROSS_PUBLISHER_CALIBRATION_DRY_RUN',
  'G_CONFIDENCE_EVAL',
  'H_HYPER_CANDIDATE_IF_SUFFICIENT',
  'I_REVIEW_OR_ACCUMULATE_REFERENCE',
] as const

export const ADMIN_INPUT_CONTRACT = {
  has_difficulty_system: 'YES_NO',
  display_mode: ['STAGE_OR_CHAPTER', 'PER_ITEM', 'BOTH'],
  ordered_levels_free_text: true,
  maps_directly_to_hyper: false,
  stores: 'SOURCE_ORDER_AND_MEANING_ONLY',
}

export const SCHEMA_AUDIT_NOTES = {
  problem_difficulty: 'HYPER 1-5 HUMAN/MODEL/CALIBRATED. Cannot store SSEN 하/중/상 without mixing source and HYPER.',
  problem_sources_source_type_label: 'Textbook TYPE heading, not difficulty.',
  source_documents: 'Book identity. No difficulty system column.',
  source_pages: 'Page images. No item badge.',
  hyper_type_profiles: 'TYPE dictionary. Not difficulty.',
  school_exam_profiles: 'School exam metadata. source_difficulty = NONE path.',
  reuse: 'Keep all of the above. Add new tables rather than overload problem_difficulty.',
}

export const SCHEMA_PROPOSAL_TABLES = [
  {
    name: 'source_difficulty_systems',
    reason: 'Book-level ordered source scale. Not HYPER bands.',
    additive: true,
  },
  {
    name: 'source_difficulty_levels',
    reason: 'Stage vs item vs star/step levels with raw_label + normalized_order + scope.',
    additive: true,
  },
  {
    name: 'problem_source_difficulty',
    reason: 'Per-problem source evidence, origin, confidence, visual proof. Separate from problem_difficulty.',
    additive: true,
  },
  {
    name: 'source_difficulty_calibrations',
    reason: 'Versioned cross-publisher calibration. Raw source labels stay immutable.',
    additive: true,
  },
] as const

export function hyperCandidatePolicy(): {
  uses: string[]
  source_expert_copied: false
  review_on_severe_conflict: true
} {
  return {
    uses: ['source_expert', 'cross_publisher_position', 'intrinsic_structure', 'type_relative'],
    source_expert_copied: false,
    review_on_severe_conflict: true,
  }
}

export function badgeToSourceLike(badge: PublisherBadgeNorm): 'LOW_LIKE' | 'MID_LIKE' | 'HIGH_LIKE' | 'NONE' {
  if (badge === 'LOW_BADGE') return 'LOW_LIKE'
  if (badge === 'MID_BADGE') return 'MID_LIKE'
  if (badge === 'HIGH_BADGE') return 'HIGH_LIKE'
  return 'NONE'
}

export function bandToIntrinsicLike(band: PrimaryBand, score: number): 'VERY_EASY' | 'MEDIUM' | 'VERY_HARD' | 'UNKNOWN' {
  if (band === 'REVIEW') return 'UNKNOWN'
  if (score < 0.22 && band === 'LOW') return 'VERY_EASY'
  if (score >= 0.72) return 'VERY_HARD'
  return 'MEDIUM'
}
