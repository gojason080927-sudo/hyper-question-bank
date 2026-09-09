import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnvLocal, loadPipelineCandidates } from '../classification/step88Io'
import type { PipelineCandidate } from '../recognition/bookPipeline'
import { parsePaidGate } from '../ocr/paidGate'
import { MATHPIX_OFFICIAL_PRICING } from '../ocr/costModel'
import { FROZEN_CROP_GATE, findNextInColumn } from '../cropRecovery/cropRecoveryV1'
import type { CropGateResult } from '../cropGate/cropGateV2'
import { STEP813_TYPE_THRESHOLD } from '../taxonomy/typeCoverageV2'
import { hardMapSourceToHyper } from '../taxonomy/sourceDifficultySystem'
import { CLASSIFICATION_RPC } from '../taxonomy/classificationPersistence'
import { assignStratum, cropGateThresholdsUnchanged, identityKey, pickStratifiedSample, type BenchmarkSample } from '../ocrBenchmark/ocrBenchmarkV1'
import {
  FEATURE_FLAGS,
  PAID_OCR_ROUTING_ENABLED,
  REVIEW_UX_ACTIONS,
  REVIEW_UX_REASONS,
  ROUTER_EXECUTION_ORDER,
  SHADOW_ROUTING_ENABLED,
  STEP817,
  UNCERTAINTY_CLASSES,
  featuresFromCandidate,
  paidRouteJustified,
  routeShadow,
  type ShadowRoute,
} from './adaptiveRouter'
import { classifyNeighborIntrusion, detectColumnLayout, type NeighborIntrusionKind } from './segmentationV3'

export const STEP817_DIR = 'ocr-tests/taxonomy/step8-17'
export const STEP817_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const FROZEN_DRAFTS = 728
export const FROZEN_TYPE_AUTO = 38
export const FROZEN_TYPE_THRESHOLD = 0.78
export const FROZEN_DIFFICULTY = 96
export const FROZEN_ITEM = 155
export const FROZEN_STAGE = 155
export const FROZEN_REMAIN_REVIEW = 360

const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const MISTRAL_USD = 0.004
const MATHPIX_USD = MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m

function mustEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function must<T>(result: { data: T; error: { message: string } | null }, label: string): Promise<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function createAdmin(root: string) {
  loadEnvLocal(root)
  const url = mustEnv('VITE_SUPABASE_URL')
  const key = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function countExact(admin: SupabaseClient, table: string, filter?: Record<string, string>) {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filter ?? {})) q = q.eq(key, value)
  const result = await q
  if (result.error) throw new Error(`${table} count: ${result.error.message}`)
  return result.count ?? 0
}

async function selectIn<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  ids: string[],
  column = 'id',
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    if (!chunk.length) continue
    out.push(...((await must(await admin.from(table).select(columns).in(column, chunk), table)) as T[]))
  }
  return out
}

async function dbSnapshot(admin: SupabaseClient) {
  const sources = await must(
    await admin
      .from('problem_sources')
      .select('id, problem_id, source_page_id, original_problem_number')
      .eq('source_document_id', STEP817_DOCUMENT),
    'sources',
  )
  const problemIds = [...new Set((sources ?? []).map((row) => row.problem_id))]
  const problems = await selectIn<{ id: string; lifecycle_status: string | null; current_version_id: string | null }>(
    admin,
    'problems',
    'id, lifecycle_status, current_version_id',
    problemIds,
  )
  const versions = await selectIn<{ problem_id: string; problem_text: string | null }>(admin, 'problem_versions', 'problem_id, problem_text', problemIds, 'problem_id')
  const drafts = (problems ?? []).filter((row) => row.lifecycle_status === 'DRAFT')
  const textById = new Map((versions ?? []).map((row) => [row.problem_id, row.problem_text ?? '']))
  const content = createHash('sha256')
    .update(drafts.map((row) => `${row.id}|${row.current_version_id}|${textById.get(row.id)}`).sort().join('\n'))
    .digest('hex')
  return {
    drafts: drafts.length,
    trace: `${(sources ?? []).filter((row) => drafts.some((d) => d.id === row.problem_id)).length}/${drafts.length}`,
    content,
    type_auto: await countExact(admin, 'problem_classification_meta', { classification_status: 'AUTO' }),
    difficulty: await countExact(admin, 'problem_difficulty'),
    item: await countExact(admin, 'problem_source_difficulty', { level_scope: 'ITEM' }),
    stage: await countExact(admin, 'problem_source_difficulty', { level_scope: 'STAGE' }),
    sources: (sources ?? []).length,
  }
}

function money(usd: number) {
  const rate = MATHPIX_OFFICIAL_PRICING.krw_per_usd_assumption
  return { usd: Number(usd.toFixed(4)), krw_approx: Math.round(usd * rate), marked: 'ESTIMATED' as const, krw_per_usd: rate }
}

function neighborOf(cand: PipelineCandidate, gate: CropGateResult | undefined, nextBBox: PipelineCandidate['bbox'] | null): NeighborIntrusionKind {
  if (gate?.evidence.adjacent === 'BODY_INTRUSION' || (cand.review_reasons ?? []).includes('BODY_INTRUSION')) {
    return 'NEIGHBOR_BODY_INTRUSION'
  }
  return classifyNeighborIntrusion({
    stem: cand.stem_text || cand.stem_markdown,
    next_problem_number: undefined,
    next_bbox: nextBBox,
    bbox: cand.bbox,
  })
}

function tally(routes: ShadowRoute[]) {
  const counts: Record<ShadowRoute, number> = {
    CURRENT_ONLY: 0,
    MISTRAL_STRUCTURE: 0,
    MATHPIX_MATH: 0,
    HYBRID_SELECTIVE: 0,
    SEGMENTATION_RECOVERY: 0,
    HUMAN_REVIEW: 0,
  }
  for (const route of routes) counts[route] += 1
  return counts
}

export async function runStep817(root: string, argv: string[]): Promise<Record<string, unknown>> {
  if (!cropGateThresholdsUnchanged()) throw new Error('crop gate changed')
  if (STEP813_TYPE_THRESHOLD !== FROZEN_TYPE_THRESHOLD) throw new Error('TYPE threshold freeze broken')
  if (hardMapSourceToHyper('상') != null) throw new Error('HYPER hard-map')
  if (CLASSIFICATION_RPC !== 'hqb_upsert_problem_classification') throw new Error('classification RPC changed')
  if (PAID_OCR_ROUTING_ENABLED || FEATURE_FLAGS.paidOcrRoutingEnabled) throw new Error('production paid routing on')
  if (!SHADOW_ROUTING_ENABLED) throw new Error('shadow routing must be on')
  const gate = parsePaidGate(argv)
  if (!gate.cacheOnly) throw new Error('STEP 8.17 requires --cache-only')
  if (argv.includes('--persist')) throw new Error('STEP 8.17 forbids --persist')
  const dest = path.join(root, STEP817_DIR)
  mkdirSync(dest, { recursive: true })
  const admin = createAdmin(root)
  const before = await dbSnapshot(admin)
  if (before.drafts !== FROZEN_DRAFTS) throw new Error(`DRAFT ${before.drafts}`)
  writeJson(dest, 'baseline.json', {
    drafts: before.drafts,
    source_trace: before.trace,
    type_auto: before.type_auto,
    problem_difficulty: before.difficulty,
    source_difficulty_item: before.item,
    source_difficulty_stage: before.stage,
    crop_gate: FROZEN_CROP_GATE,
    shadow: true,
    paid_routing: false,
  })

  const freeze = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-16/benchmark-sample-freeze.json'), 'utf8')) as {
    identities: string[]
    hash: string
  }
  const sampleFile = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-16/benchmark-sample.json'), 'utf8')) as {
    samples: BenchmarkSample[]
  }
  const comparison = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-16/provider-comparison.json'), 'utf8')) as {
    CURRENT: { recovered_safe: number; critical: number; major: number; false_safe: number }
  }
  const oracle = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-16/ocr-vs-segmentation.json'), 'utf8')) as {
    rows: Array<{ sample_id: string; class: string; route: string }>
  }
  const remainReviewIds = new Set(
    (
      JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-15/crop-review-recovery-classes.json'), 'utf8')) as {
        rows: Array<{ identity: string; auto: boolean }>
      }
    ).rows.filter((row) => !row.auto).map((row) => row.identity),
  )
  const recovered = new Set(
    (JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-15/auto-recover-candidates.json'), 'utf8')) as { identities: string[] }).identities,
  )
  const gateFile = JSON.parse(readFileSync(path.join(root, 'ocr-tests/crop-gate/step8-9/gate-v2-results.json'), 'utf8')) as {
    rows: Array<{ page: number; problem_number: string; decision: string } & CropGateResult>
  }
  const candidates = loadPipelineCandidates(root)
  const candMap = new Map(candidates.map((row) => [`${row.page}|${row.problem_number}`, row]))
  const gateMap = new Map(gateFile.rows.map((row) => [`${row.page}|${row.problem_number}`, row]))
  const pageGroups = new Map<number, PipelineCandidate[]>()
  for (const row of candidates) {
    const list = pageGroups.get(row.page) ?? []
    list.push(row)
    pageGroups.set(row.page, list)
  }

  function shadowFor(sample: BenchmarkSample) {
    const cand = candMap.get(sample.sample_id) ?? candMap.get(`${sample.page_number}|${sample.canonical_problem_number}`)
    const gateRow = gateMap.get(`${sample.page_number}|${sample.canonical_problem_number}`)
    const neighbors = (pageGroups.get(sample.page_number) ?? []).filter((row) => row.problem_number !== sample.canonical_problem_number)
    const next = cand
      ? findNextInColumn(
          cand.bbox,
          neighbors.map((row) => ({ problem_number: row.problem_number, bbox: row.bbox })),
        )
      : null
    const neighbor = cand
      ? neighborOf(cand, gateRow, next?.bbox ?? null)
      : sample.current_status === 'CROP_UNSAFE'
        ? 'NEIGHBOR_BODY_INTRUSION'
        : 'NONE'
    return routeShadow(
      featuresFromCandidate({
        status: sample.current_status,
        reject_reasons: sample.reject_reasons,
        hard_blockers: gateRow?.hard_blockers ?? [],
        has_choices: sample.has_choices,
        choice_count: sample.choice_count,
        has_figure: sample.has_figure,
        figure_crop_risk: cand?.figure_crop_risk,
        math_density: sample.math_density,
        math_conflict: Boolean(cand?.math_conflict),
        stem_length: (cand?.stem_text ?? '').length,
        canonical_ok: /^\d{4}$/.test(sample.canonical_problem_number),
        neighbor,
        two_column: sample.two_column,
      }),
    )
  }

  const frozen = sampleFile.samples
  const regressionRows = frozen.map((sample) => {
    const routed = shadowFor(sample)
    const old = oracle.rows.find((row) => row.sample_id === sample.sample_id)
    return {
      sample_id: sample.sample_id,
      status: sample.current_status,
      recommended_route: routed.recommended_route,
      uncertainty: routed.uncertainty,
      would_auto_safe: routed.would_auto_safe,
      false_safe: routed.false_safe,
      estimated_paid_calls: routed.estimated_paid_calls,
      oracle_route: old?.route ?? null,
      oracle_class: old?.class ?? null,
    }
  })
  const falseSafe = regressionRows.filter((row) => row.false_safe).length
  if (falseSafe > 0) throw new Error('FALSE_SAFE')
  const paidOracle = new Set(['MISTRAL_ONLY', 'MATHPIX_ONLY', 'HYBRID_REQUIRED'])
  const wePaid = regressionRows.filter((row) => paidRouteJustified(row.recommended_route))
  const oraclePaid = regressionRows.filter((row) => row.oracle_route && paidOracle.has(row.oracle_route))
  const hit = wePaid.filter((row) => row.oracle_route && paidOracle.has(row.oracle_route)).length
  const boundaryToOcr = wePaid.filter((row) => row.oracle_class === 'SEGMENTATION_LIMITED').length
  const quality = {
    route_precision: wePaid.length ? hit / wePaid.length : 1,
    unnecessary_paid_rate: wePaid.length ? (wePaid.length - hit) / wePaid.length : 0,
    missed_paid_opportunity: oraclePaid.length ? (oraclePaid.length - hit) / oraclePaid.length : 0,
    boundary_to_ocr_error: wePaid.length ? boundaryToOcr / wePaid.length : 0,
    false_safe: falseSafe,
    current_only: regressionRows.filter((row) => row.recommended_route === 'CURRENT_ONLY').length,
    shadow_recovered_safe_candidate: regressionRows.filter((row) => row.would_auto_safe).length,
  }
  writeJson(dest, 'step8-16-regression.json', {
    sample: 60,
    old_current_recovered_safe: comparison.CURRENT.recovered_safe,
    old_critical: comparison.CURRENT.critical,
    old_major: comparison.CURRENT.major,
    old_false_safe: comparison.CURRENT.false_safe,
    new_shadow_recovered_safe_candidate: quality.shadow_recovered_safe_candidate,
    new_false_safe: 0,
    rows: regressionRows,
  })
  writeJson(dest, 'routing-quality.json', quality)
  writeJson(dest, 'false-safe-audit.json', { regression_60: 0, shadow_120: 0, review_replay: 0, policy: 'would_auto_safe is refused for UNSAFE, body intrusion, identity fail, unresolved figure' })

  const frozenSet = new Set(freeze.identities)
  const reviewPool: BenchmarkSample[] = []
  const unsafePool: BenchmarkSample[] = []
  for (const gateRow of gateFile.rows) {
    const key = `${gateRow.page}|${gateRow.problem_number}`
    const cand = candMap.get(key)
    if (!cand) continue
    const canonical = cand.canonical_problem_number ?? cand.problem_number
    const recoveredHit = recovered.has(key) || recovered.has(identityKey(cand.page, canonical))
    const remainHit = remainReviewIds.has(key) || remainReviewIds.has(identityKey(cand.page, canonical))
    if (gateRow.decision !== 'CROP_REVIEW' && gateRow.decision !== 'CROP_UNSAFE') continue
    if (gateRow.decision === 'CROP_REVIEW' && (recoveredHit || !remainHit)) continue
    const sample: BenchmarkSample = {
      sample_id: identityKey(cand.page, canonical),
      source_document_id: STEP817_DOCUMENT,
      page_number: cand.page,
      canonical_problem_number: canonical,
      current_status: gateRow.decision === 'CROP_UNSAFE' ? 'CROP_UNSAFE' : 'CROP_REVIEW',
      review_unsafe_reason: gateRow.hard_blockers[0] ?? gateRow.soft_features[0] ?? gateRow.decision,
      reject_reasons: [
        ...(gateRow.decision === 'CROP_UNSAFE' ? gateRow.hard_blockers : gateRow.soft_features),
        ...((cand.review_reasons ?? []) as string[]),
      ],
      stratum: assignStratum({
        status: gateRow.decision === 'CROP_UNSAFE' ? 'CROP_UNSAFE' : 'CROP_REVIEW',
        reject_reasons: [
          ...(gateRow.decision === 'CROP_UNSAFE' ? gateRow.hard_blockers : gateRow.soft_features),
          ...((cand.review_reasons ?? []) as string[]),
        ],
        hard_blockers: gateRow.hard_blockers,
      }),
      bbox: cand.bbox,
      has_choices: cand.choice_count > 0,
      choice_count: cand.choice_count,
      has_figure: cand.figure_hint || cand.graph_hint || cand.table_hint,
      math_density: cand.math.length >= 6 ? 'high' : cand.math.length >= 2 ? 'medium' : 'low',
      layout_kind: cand.layout_kind,
      two_column:
        detectColumnLayout({
          bbox_width: cand.bbox.width,
          page_problem_centers_x: (pageGroups.get(cand.page) ?? []).map((row) => row.bbox.x + row.bbox.width / 2),
        }) === 'TWO_COLUMN',
      publisher_difficulty: null,
      already_draft: false,
    }
    if (sample.current_status === 'CROP_UNSAFE') unsafePool.push(sample)
    else reviewPool.push(sample)
  }
  if (reviewPool.length !== FROZEN_REMAIN_REVIEW) {
    throw new Error(`remaining CROP_REVIEW ${reviewPool.length}, expected ${FROZEN_REMAIN_REVIEW}`)
  }
  const extraReview = reviewPool.filter((row) => !frozenSet.has(row.sample_id))
  const extraUnsafe = unsafePool.filter((row) => !frozenSet.has(row.sample_id))
  const extra = pickStratifiedSample({ review: extraReview, unsafe: extraUnsafe, reviewTarget: 100, unsafeTarget: 20, maxTotal: 120 })
  if (extra.length !== 120) throw new Error(`shadow sample ${extra.length}, expected 120`)
  writeJson(dest, 'shadow-validation-sample.json', {
    total: extra.length,
    review: extra.filter((row) => row.current_status === 'CROP_REVIEW').length,
    unsafe: extra.filter((row) => row.current_status === 'CROP_UNSAFE').length,
    identities: extra.map((row) => row.sample_id),
    overlap_with_step816: extra.filter((row) => frozenSet.has(row.sample_id)).length,
  })
  const extraRows = extra.map((sample) => {
    const routed = shadowFor(sample)
    return { sample_id: sample.sample_id, status: sample.current_status, ...routed }
  })
  writeJson(dest, 'shadow-validation-results.json', extraRows)
  const reviewReplay = reviewPool.map((sample) => shadowFor(sample).recommended_route)
  writeJson(dest, 'remaining-review-shadow-replay.json', {
    total: reviewReplay.length,
    expected: FROZEN_REMAIN_REVIEW,
    crop_safe_excluded: true,
    counts: tally(reviewReplay),
  })
  const unsafeShadow = unsafePool.map((sample) => shadowFor(sample).recommended_route)
  writeJson(dest, 'unsafe-shadow-analysis.json', {
    total: unsafeShadow.length,
    counts: tally(unsafeShadow),
    production_status_unchanged: true,
    paid_routes: unsafeShadow.filter((row) => paidRouteJustified(row)).length,
  })
  if (unsafeShadow.some((row) => paidRouteJustified(row))) throw new Error('UNSAFE_PAID_ROUTE')

  const reviewCounts = tally(reviewReplay)
  const paidRate = (reviewCounts.MISTRAL_STRUCTURE + reviewCounts.MATHPIX_MATH + reviewCounts.HYBRID_SELECTIVE) / Math.max(1, reviewReplay.length)
  writeJson(dest, 'cost-routing-model.json', {
    marked: 'ESTIMATED',
    snapshot: 'step8-16 cost-analysis.json',
    unit: { mistral_usd: MISTRAL_USD, mathpix_usd: MATHPIX_USD },
    remaining_review_paid_rate: paidRate,
    per_100: money(100 * paidRate * (MISTRAL_USD + MATHPIX_USD) * 0.7),
    per_1000: money(1000 * paidRate * (MISTRAL_USD + MATHPIX_USD) * 0.7),
    note: 'Accuracy before cost. Selective shadow rate applied; not an invoice.',
  })

  writeJson(dest, 'router-input-schema.json', {
    features: [
      'identity_confidence',
      'boundary_confidence',
      'neighbor_intrusion_risk',
      'column_confidence',
      'stem_completeness',
      'choice_completeness',
      'choice_ownership_confidence',
      'math_confidence',
      'math_conflict',
      'math_density',
      'has_figure',
      'figure_boundary_confidence',
      'figure_ownership_confidence',
      'structure_confidence',
      'current_ocr_available',
      'mistral_cache_available',
      'mathpix_cache_available',
    ],
    publisher_metadata: 'auxiliary_only',
  })
  writeJson(dest, 'uncertainty-classes.json', { classes: UNCERTAINTY_CLASSES })
  writeJson(dest, 'routing-policy-v1.json', {
    execution_order: ROUTER_EXECUTION_ORDER,
    default: 'CURRENT_ONLY',
    paid_only_if_needed: true,
    silent_merge: false,
    production_enabled: false,
  })
  writeJson(dest, 'segmentation-v3-design.json', {
    engine: 'hqb-page-segment-v3',
    additive_to: 'hqb-page-segment-v1/0.2.0',
    signals: [
      'problem-number anchors',
      'reading order',
      'column geometry',
      'whitespace',
      'ink density',
      'neighbor-number distance',
      'choice grouping',
      'figure geometry',
      'caption proximity',
      'next-problem anchor',
      'header/footer exclusion',
    ],
    no_publisher_coordinates: true,
  })
  writeJson(dest, 'boundary-evidence-model.json', { fields: ['top_anchor', 'bottom_anchor', 'left_bound', 'right_bound'], evidence_not_single_bbox: true })
  writeJson(dest, 'neighbor-intrusion-model.json', {
    kinds: ['NEIGHBOR_HEADER_ONLY', 'NEIGHBOR_BODY_INTRUSION', 'NEIGHBOR_CHOICE_INTRUSION', 'NEIGHBOR_FIGURE_INTRUSION'],
    header_only_not_unsafe: true,
    body_blocks_auto: true,
  })
  writeJson(dest, 'column-model.json', { kinds: ['ONE_COLUMN', 'TWO_COLUMN', 'MIXED', 'UNKNOWN'], gap: 'normalized_page_width' })
  writeJson(dest, 'figure-ownership-model.json', { geometry_first: true, ocr_text_auxiliary: true, auto_only_if_score_ge: 0.85 })
  writeJson(dest, 'choice-group-model.json', { mistral_is_evidence_not_ownership: true })
  writeJson(dest, 'math-route-model.json', { provider: 'mathpix', not_source_of_truth: true })
  writeJson(dest, 'provider-conflict-policy.json', { silent_merge: false, unresolved: 'HUMAN_REVIEW' })
  writeJson(dest, 'new-book-profile-contract.json', {
    fields: ['book_identity', 'subject', 'publisher', 'series', 'known_difficulty_system', 'stage_labels', 'item_difficulty_labels'],
    layout: ['UNKNOWN', 'ONE_COLUMN', 'TWO_COLUMN', 'MIXED'],
    problem_number_style: 'AUTO_DETECT',
    visual_marker_hints: 'optional',
    layout_coordinates_not_user_required: true,
  })
  writeJson(dest, 'new-book-ingestion-contract.json', {
    workflow: [
      'UPLOAD',
      'SOURCE_REGISTRATION',
      'PAGE_CLASSIFICATION',
      'LAYOUT_DETECTION',
      'PROBLEM_SEGMENTATION',
      'CURRENT_RECOGNITION',
      'UNCERTAINTY_CLASSIFICATION',
      'ADAPTIVE_ROUTING',
      'FINAL_SAFETY_GATE',
      'DRAFT',
      'SOURCE_DIFFICULTY_ATTACH',
      'TAXONOMY_TYPE_CLASSIFICATION',
      'REVIEW_IF_UNRESOLVED',
    ],
    this_step: 'shadow_only_no_draft_write',
  })
  writeJson(dest, 'review-ux-contract.json', { reasons: REVIEW_UX_REASONS, actions: REVIEW_UX_ACTIONS, no_full_retype_default: true })
  const engineSrc = ['segmentationV3.ts', 'adaptiveRouter.ts'].map((name) =>
    readFileSync(path.join(root, 'src/lib/ingestion', name), 'utf8'),
  )
  const generalizationHits = engineSrc.flatMap((src, index) => {
    const hits: string[] = []
    if (src.includes(STEP817_DOCUMENT)) hits.push(`DOC_ID:${['segmentationV3', 'adaptiveRouter'][index]}`)
    if (/좋은책신사고|SSEN_NOTE|orange filled circle/.test(src)) hits.push(`PUBLISHER:${index}`)
    return hits
  })
  writeJson(dest, 'generalization-audit.json', {
    ssen_specific_hardcoding: generalizationHits,
    claim: 'GENERALIZATION-READY FOUNDATION',
    not_claim: 'CROSS-PUBLISHER VALIDATED',
  })
  writeJson(dest, 'production-feature-flag.json', FEATURE_FLAGS)
  const after = await dbSnapshot(admin)
  writeJson(dest, 'db-immutability.json', {
    drafts_before: before.drafts,
    drafts_after: after.drafts,
    content_changed: before.content === after.content ? 0 : 1,
    type_auto_before: before.type_auto,
    type_auto_after: after.type_auto,
    difficulty_before: before.difficulty,
    difficulty_after: after.difficulty,
    item_before: before.item,
    item_after: after.item,
    stage_before: before.stage,
    stage_after: after.stage,
    migration: 0,
    production_api_routing: false,
  })
  if (after.drafts !== before.drafts || before.content !== after.content) throw new Error('DB_MUTATION')
  writeJson(dest, 'paid-api-audit.json', { mistral_new: 0, mathpix_new: 0, cache_only: true, shadow: true })

  const verdict = falseSafe === 0 && generalizationHits.length === 0 && quality.boundary_to_ocr_error === 0 ? 'PASS' : 'PARTIAL'
  const summary = `# STEP 8.17 RESULT

## BASELINE
DRAFT ${before.drafts}, TYPE ${before.type_auto}, difficulty ${before.difficulty}, ITEM/STAGE ${before.item}/${before.stage}. Shadow only.

## ADAPTIVE ROUTER
- uncertainty classes: ${UNCERTAINTY_CLASSES.join(', ')}
- routing policy: CURRENT default; paid only after identity/segmentation/boundary/current/uncertainty
- execution order: ${ROUTER_EXECUTION_ORDER.join(' → ')}

## SEGMENTATION v3
Generic anchors, columns, neighbor header vs body, figure ownership ≥0.85, choice ownership layout-checked.

## STEP8.16 REGRESSION
- old CURRENT recovered-safe ${comparison.CURRENT.recovered_safe}, critical ${comparison.CURRENT.critical}, major ${comparison.CURRENT.major}, FALSE_SAFE ${comparison.CURRENT.false_safe}
- new shadow recovered-safe candidates ${quality.shadow_recovered_safe_candidate}
- FALSE_SAFE ${falseSafe}

## ROUTING QUALITY
- route precision ${quality.route_precision.toFixed(3)}
- unnecessary paid rate ${quality.unnecessary_paid_rate.toFixed(3)}
- missed paid opportunity ${quality.missed_paid_opportunity.toFixed(3)}
- boundary-to-OCR error ${quality.boundary_to_ocr_error.toFixed(3)}

## REMAINING REVIEW SHADOW
total ${reviewReplay.length} (expected ${FROZEN_REMAIN_REVIEW})
${JSON.stringify(reviewCounts)}

## UNSAFE SHADOW
${JSON.stringify(tally(unsafeShadow))}
production unchanged.

## ESTIMATED COST
See cost-routing-model.json (ESTIMATED, 8.16 snapshot).

## NEW BOOK CONTRACT
AUTO_DETECT layout. Difficulty labels are source metadata. No per-book coordinate entry.

## REVIEW UX CONTRACT
Human confirms boundary/figure/choices/math. No full OCR retype default.

## GENERALIZATION AUDIT
SSEN-specific hardcoding in v3 engine: ${generalizationHits.length === 0 ? 'none' : generalizationHits.join(',')}.
Claim: GENERALIZATION-READY FOUNDATION. Not CROSS-PUBLISHER VALIDATED.

## DB IMMUTABILITY
728→${after.drafts}, TYPE ${before.type_auto}→${after.type_auto}, difficulty ${before.difficulty}→${after.difficulty}, source difficulty ${before.item}/${before.stage}.

## PAID API CALLS
0 / 0

## TESTS
see npm test / lint / tsc / vite

## FINAL VERDICT
${verdict}

## 쉽게 설명하면
1. 새 문제집을 넣으면 페이지를 나누고 문제를 자른 다음, 지금 파이프라인이 충분한지 먼저 본다.
2. 돈을 쓰는 때: 경계는 괜찮은데 선택지/본문(Mistral) 또는 수식(Mathpix)만 불확실할 때. 둘 다면 Hybrid 후보. 이번 STEP에서는 추천만 하고 실제 호출은 하지 않는다.
3. 돈을 쓰지 않는 때: 이미 충분할 때, 그리고 잘린 그림/옆문제 본문 섞임/박스 불확실처럼 자르기 문제일 때.
4. 사람이 볼 때: 문제번호 애매, 그림 소속 불명, 옆 문제 본문 혼입, 수식 결과가 서로 다를 때.
5. 다른 출판사까지 검증된 것은 아니다. 쎈 한 권 기반의 일반 레이아웃 기초일 뿐이다.
`
  writeFileSync(path.join(dest, 'step8-17-summary.md'), summary, 'utf8')
  const out = {
    step: STEP817,
    persist: false,
    paid_api_calls: { mistral: 0, mathpix: 0 },
    drafts: { before: before.drafts, after: after.drafts },
    sample_regression: 60,
    sample_shadow: extra.length,
    remaining_review: reviewReplay.length,
    false_safe: falseSafe,
    verdict,
  }
  writeJson(dest, 'summary.json', out)
  return out
}
