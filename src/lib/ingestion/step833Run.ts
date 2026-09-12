/**
 * STEP 8.33 runner — auto QA, common-error correction, NEEDS_REVIEW clear, fingerprints.
 * Never re-runs STEP 8.32 ingest. Never VERIFIED. Never student-care. Never DELETE.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnvLocal } from '../classification/step88Io'
import { CLASSIFICATION_RPC, UNIT_CODE, classificationPayload, preflightAuto } from '../taxonomy/classificationPersistence'
import { classifyDraftV1, DEFAULT_V1_THRESHOLDS } from '../taxonomy/taxonomyClassifier'
import { estimateRubricDifficulty } from '../taxonomy/difficultyRubric'
import { profileById } from '../taxonomy/typeProfiles'
import { ITEM_RPC, RUN_RPC } from './pipelineJob826'
import { createPipelineStaffClient } from './step823Staff'
import { buildBookStructure } from '../classification/bookStructure'
import {
  ASSIGNED_BY_833,
  FROZEN_833,
  GT_JSON_SHA256_833,
  QUESTION_BANK_REF,
  SECOND_DOCUMENT,
  STAGE_833,
  STEP833,
  STEP833_DIR,
  STEP833_DOCUMENT,
  STEP833_DOCUMENT_TITLE,
  STEP833_PAGE_COUNT,
  STUDENT_CARE_REF,
  applyDuplicateFlags833,
  correctAndJudge833,
  countReasons833,
  embeddingsAvailable833,
  neverVerified833,
  stratifiedSample833,
  type Item833,
  type QaResult833,
} from './autoQa833'

export type ProductionCounts833 = {
  queried: boolean
  reason: string
  drafts: number | null
  type_auto: number | null
  figure_assets: number | null
  figure_links: number | null
  pipeline_runs: number | null
  pipeline_items: number | null
  needs_review: number | null
  fingerprints: number | null
  ssen_needs_review: number | null
}

export type Step833Summary = {
  step: '8.33'
  name: string
  status: 'CACHE_ONLY_PLANNED' | 'QA_COMPLETED' | 'PERSISTED' | 'BLOCKED'
  target_ref: string
  student_care_accessed: false
  next_step_started: false
  textbook: { id: string; title: string }
  executed: boolean
  inspected: number
  scoped_needs_review: number
  auto_cleared: number
  human_review_remaining: number
  fingerprints_written: number
  fingerprints_existing: number
  embeddings_written: number
  embeddings_available: false
  classification_written: number
  duplicates: number
  orphans: number
  wrong_source: number
  content_rewrites: number
  production_problem_writes: number
  production_figure_writes: 0
  production_verified_writes: 0
  production_draft_writes: 0
  production_counts_before: ProductionCounts833
  production_counts_after: ProductionCounts833
  paid_api_calls: { mathpix: 0; mistral: 0 }
  estimated_usd: 0
  mistral_credentials: 'PRESENT' | 'ABSENT'
  frozen: typeof FROZEN_833
  reason_census_before: ReturnType<typeof countReasons833>
  reason_census_after: Record<string, number>
  residual_census: Record<string, number>
  sample_ids: string[]
  sample_findings: Array<{ candidate_id: string; verdict: string; residuals: string[] }>
  persist: {
    ran: boolean
    pipeline_run_id: string | null
    cleared: number
    skipped_already_clear: number
    failed: Array<{ candidate_id: string; error: string }>
  }
  gt_mutated: boolean
  items: Array<{
    candidate_id: string
    verdict: string
    pipeline_status: string
    residual_reasons: string[]
    type_id: string
    unit_id: string
  }>
}

function writeJson(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf8')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function gtSha(root: string): string {
  const file = path.join(root, 'workers/ocr/ground-truth.json')
  if (!existsSync(file)) return ''
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function emptyCounts(reason: string): ProductionCounts833 {
  return {
    queried: false,
    reason,
    drafts: null,
    type_auto: null,
    figure_assets: null,
    figure_links: null,
    pipeline_runs: null,
    pipeline_items: null,
    needs_review: null,
    fingerprints: null,
    ssen_needs_review: null,
  }
}

async function countExact(admin: SupabaseClient, table: string, filter?: Record<string, string>) {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter ?? {})) q = q.eq(column, value)
  const result = await q
  if (result.error) throw new Error(`${table} count: ${result.error.message}`)
  return result.count ?? 0
}

async function ssenProblemIds(admin: SupabaseClient): Promise<string[]> {
  const ids = new Set<string>()
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from('problem_sources')
      .select('problem_id')
      .eq('source_document_id', STEP833_DOCUMENT)
      .range(from, from + 999)
    if (error) throw new Error(`problem_sources: ${error.message}`)
    if (!data?.length) break
    for (const row of data) ids.add(row.problem_id)
    if (data.length < 1000) break
  }
  return [...ids]
}

async function countSsenNeedsReview(admin: SupabaseClient): Promise<number> {
  const ids = await ssenProblemIds(admin)
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { count, error } = await admin
      .from('problems')
      .select('id', { count: 'exact', head: true })
      .in('id', chunk)
      .eq('review_status', 'NEEDS_REVIEW')
    if (error) throw new Error(error.message)
    n += count ?? 0
  }
  return n
}

async function productionSnapshot(root: string, argv: string[]): Promise<ProductionCounts833> {
  loadEnvLocal(root)
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) return emptyCounts('SUPABASE_SERVICE_ROLE_KEY_MISSING')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  if (!argv.includes('--persist') && !argv.includes('--probe-production')) return emptyCounts('not_requested')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    return {
      queried: true,
      reason: 'read_only',
      drafts: await countExact(admin, 'problems', { lifecycle_status: 'DRAFT' }),
      type_auto: await countExact(admin, 'problem_classification_meta', { classification_status: 'AUTO' }),
      figure_assets: await countExact(admin, 'problem_figure_assets'),
      figure_links: await countExact(admin, 'problem_figure_links'),
      pipeline_runs: await countExact(admin, 'pipeline_runs'),
      pipeline_items: await countExact(admin, 'pipeline_items'),
      needs_review: await countExact(admin, 'problems', { review_status: 'NEEDS_REVIEW' }),
      fingerprints: await countExact(admin, 'content_fingerprints'),
      ssen_needs_review: await countSsenNeedsReview(admin),
    }
  } catch (error) {
    return emptyCounts(error instanceof Error ? error.message : 'probe_failed')
  }
}

type LiveJoin = NonNullable<Item833['existing']> & {
  bbox: Item833['bbox']
  problem_text: string
  page: number
  canonical: string | null
  source_document_id: string
}

async function loadProductionSsen(admin: SupabaseClient): Promise<Map<string, LiveJoin>> {
  const pages: Array<{ id: string; page_number: number }> = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await admin
      .from('source_pages')
      .select('id,page_number')
      .eq('source_document_id', STEP833_DOCUMENT)
      .range(from, from + 999)
    if (error) throw new Error(`source_pages: ${error.message}`)
    if (!data?.length) break
    pages.push(...data)
    if (data.length < 1000) break
  }
  const pageById = new Map(pages.map((row) => [row.id, row.page_number]))
  const sources: Array<{
    problem_id: string
    original_problem_number: string | null
    source_page_id: string
    bounding_box: Item833['bbox']
    source_document_id: string
  }> = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from('problem_sources')
      .select('problem_id, original_problem_number, source_page_id, bounding_box, source_document_id')
      .eq('source_document_id', STEP833_DOCUMENT)
      .range(from, from + 999)
    if (error) throw new Error(`problem_sources: ${error.message}`)
    if (!data?.length) break
    sources.push(...(data as typeof sources))
    if (data.length < 1000) break
  }
  const problemIds = [...new Set(sources.map((row) => row.problem_id))]
  const problems: Array<{
    id: string
    public_code: string
    review_status: string
    lifecycle_status: string
    current_version_id: string | null
  }> = []
  for (let i = 0; i < problemIds.length; i += 200) {
    const { data, error } = await admin
      .from('problems')
      .select('id, public_code, review_status, lifecycle_status, current_version_id')
      .in('id', problemIds.slice(i, i + 200))
    if (error) throw new Error(`problems: ${error.message}`)
    problems.push(...(data ?? []))
  }
  const versions: Array<{ id: string; problem_text: string }> = []
  const versionIds = problems.map((row) => row.current_version_id).filter((id): id is string => Boolean(id))
  for (let i = 0; i < versionIds.length; i += 200) {
    const { data, error } = await admin.from('problem_versions').select('id, problem_text').in('id', versionIds.slice(i, i + 200))
    if (error) throw new Error(`problem_versions: ${error.message}`)
    versions.push(...(data ?? []))
  }
  const pmap = new Map(problems.map((row) => [row.id, row]))
  const vmap = new Map(versions.map((row) => [row.id, row.problem_text]))
  const found = new Map<string, LiveJoin>()
  for (const row of sources) {
    const page = pageById.get(row.source_page_id)
    const problem = pmap.get(row.problem_id)
    if (!page || !problem) continue
    const canon = (row.original_problem_number ?? '').padStart(4, '0')
    found.set(`${page}|${canon}`, {
      problem_id: problem.id,
      public_code: problem.public_code,
      review_status: problem.review_status,
      lifecycle_status: problem.lifecycle_status,
      current_version_id: problem.current_version_id,
      bbox: row.bounding_box ?? null,
      problem_text: (problem.current_version_id && vmap.get(problem.current_version_id)) || '',
      page,
      canonical: /^\d{4}$/.test(canon) ? canon : row.original_problem_number,
      source_document_id: row.source_document_id,
    })
  }
  return found
}

function loadItems832(root: string): Item833[] {
  const file = path.join(root, 'ocr-tests/taxonomy/step8-32/items.json')
  if (!existsSync(file)) return []
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items?: Item833[] }
  return parsed.items ?? []
}

function inspectSample(items: Item833[], qa: QaResult833[], ids: string[]) {
  const byId = new Map(items.map((row) => [row.candidate_id, row]))
  const byQa = new Map(qa.map((row) => [row.candidate_id, row]))
  return ids.map((id) => {
    const item = byId.get(id)
    const row = byQa.get(id)
    const findings: string[] = []
    if (item && !item.crop_present) findings.push('SAMPLE_CROP_MISSING')
    if (row?.residual_reasons.length) findings.push(...row.residual_reasons)
    if (row?.verdict === 'AUTO_CLEAR' && !row.stem_readable) findings.push('SAMPLE_FALSE_CLEAR')
    return { candidate_id: id, verdict: row?.verdict ?? 'MISSING', residuals: findings }
  })
}

async function existingFingerprints(admin: SupabaseClient, problemIds: string[]): Promise<Set<string>> {
  const have = new Set<string>()
  for (let i = 0; i < problemIds.length; i += 200) {
    const { data, error } = await admin
      .from('content_fingerprints')
      .select('problem_id, fingerprint_type, fingerprint_value')
      .in('problem_id', problemIds.slice(i, i + 200))
    if (error) throw new Error(`fingerprints: ${error.message}`)
    for (const row of data ?? []) have.add(`${row.problem_id}|${row.fingerprint_type}|${row.fingerprint_value}`)
  }
  return have
}

async function existingClassificationVersions(admin: SupabaseClient, versionIds: string[]): Promise<Set<string>> {
  const have = new Set<string>()
  for (let i = 0; i < versionIds.length; i += 200) {
    const { data, error } = await admin
      .from('problem_classification_meta')
      .select('problem_version_id')
      .in('problem_version_id', versionIds.slice(i, i + 200))
    if (error) throw new Error(`classification_meta: ${error.message}`)
    for (const row of data ?? []) have.add(row.problem_version_id)
  }
  return have
}

function markdownSummary(summary: Step833Summary): string {
  return [
    '# STEP 8.33 AUTO QA + SEARCH PREP',
    '',
    `STEP 8.33 RESULT: ${summary.status}`,
    `NAME: ${summary.name}`,
    `TARGET REF: ${summary.target_ref} (hyper-student-care NOT accessed)`,
    '',
    `textbook: ${summary.textbook.title}`,
    `source_document_id: ${summary.textbook.id}`,
    `inspected: ${summary.inspected}`,
    `scoped NEEDS_REVIEW: ${summary.scoped_needs_review}`,
    `auto-cleared: ${summary.auto_cleared}`,
    `HUMAN_REVIEW remaining: ${summary.human_review_remaining}`,
    `fingerprints written/existing: ${summary.fingerprints_written}/${summary.fingerprints_existing}`,
    `embeddings written: ${summary.embeddings_written} (pgvector unavailable)`,
    `classification AUTO writes: ${summary.classification_written}`,
    `duplicates held: ${summary.duplicates}`,
    `orphans: ${summary.orphans}`,
    `wrong source: ${summary.wrong_source}`,
    `content rewrites: ${summary.content_rewrites}`,
    `verified writes: ${summary.production_verified_writes}`,
    `figure writes: ${summary.production_figure_writes}`,
    `NEEDS_REVIEW before/after: ${summary.production_counts_before.needs_review} → ${summary.production_counts_after.needs_review}`,
    `SSEN NEEDS_REVIEW before/after: ${summary.production_counts_before.ssen_needs_review} → ${summary.production_counts_after.ssen_needs_review}`,
    `drafts before/after: ${summary.production_counts_before.drafts} → ${summary.production_counts_after.drafts}`,
    `type AUTO live before/after: ${summary.production_counts_before.type_auto} → ${summary.production_counts_after.type_auto}`,
    `figures: ${summary.production_counts_after.figure_assets}/${summary.production_counts_after.figure_links}`,
    `gt mutated: ${summary.gt_mutated}`,
    `paid USD: ${summary.estimated_usd}`,
    '',
    'Do not auto-merge. Do not set VERIFIED.',
    '',
  ].join('\n')
}

export async function runStep833(root: string, argv: string[]): Promise<Step833Summary> {
  loadEnvLocal(root)
  if (argv.includes('--allow-paid-api') || argv.includes('--i-understand-this-costs-money')) {
    throw new Error('STEP 8.33 forbids paid OCR')
  }
  const persistRequested = argv.includes('--persist')
  const probe = persistRequested || argv.includes('--probe-production')
  const dest = path.join(root, STEP833_DIR)
  mkdirSync(dest, { recursive: true })

  const items = loadItems832(root)
  const before = probe || persistRequested ? await productionSnapshot(root, ['--probe-production']) : emptyCounts('cache_only')
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')

  let production = new Map<string, LiveJoin>()
  if ((persistRequested || probe) && url && service) {
    if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
    production = await loadProductionSsen(createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }))
  } else if (persistRequested) {
    throw new Error('persist requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  const merged: Item833[] = items.map((row) => {
    const live = production.get(row.candidate_id)
    return {
      ...row,
      bbox: live?.bbox ?? row.bbox ?? null,
      problem_text: live?.problem_text || row.problem_text || row.stem_preview,
      existing: live
        ? {
            problem_id: live.problem_id,
            public_code: live.public_code,
            review_status: live.review_status,
            lifecycle_status: live.lifecycle_status,
            current_version_id: live.current_version_id,
          }
        : row.existing,
    }
  })

  const byPage = new Map<number, Item833[]>()
  for (const row of merged) {
    const list = byPage.get(row.page) ?? []
    list.push(row)
    byPage.set(row.page, list)
  }

  let qa = merged.map((row) => correctAndJudge833(row, byPage.get(row.page) ?? []))
  qa = applyDuplicateFlags833(qa)
  const qaById = new Map(qa.map((row) => [row.candidate_id, row]))

  const scoped = merged.filter((row) => {
    const live = row.existing
    if (!live) return false
    if (live.lifecycle_status !== 'DRAFT') return false
    if (live.review_status === 'VERIFIED') return false
    if (persistRequested || probe) return live.review_status === 'NEEDS_REVIEW'
    return true
  })

  const scopedQa = scoped.map((row) => qaById.get(row.candidate_id)).filter((row): row is QaResult833 => Boolean(row))
  const autoCleared = scopedQa.filter((row) => row.verdict === 'AUTO_CLEAR')
  const human = scopedQa.filter((row) => row.verdict === 'HUMAN_REVIEW')
  const residualCensus: Record<string, number> = {}
  for (const row of human) {
    for (const reason of row.residual_reasons) residualCensus[reason] = (residualCensus[reason] ?? 0) + 1
    if (!row.residual_reasons.length) residualCensus.UNSPECIFIED = (residualCensus.UNSPECIFIED ?? 0) + 1
  }

  const sampleIds = stratifiedSample833(scoped.length ? scoped : merged, scopedQa.length ? scopedQa : qa)
  const sampleFindings = inspectSample(merged, qa, sampleIds)

  const fingerprintTargets = merged.filter((row) => {
    const live = row.existing
    const rowQa = qaById.get(row.candidate_id)
    return Boolean(live?.problem_id && live.lifecycle_status === 'DRAFT' && live.review_status !== 'VERIFIED' && rowQa?.verdict === 'AUTO_CLEAR')
  })

  const persist = {
    ran: false,
    pipeline_run_id: null as string | null,
    cleared: 0,
    skipped_already_clear: 0,
    failed: [] as Array<{ candidate_id: string; error: string }>,
  }
  let fingerprintsWritten = 0
  let fingerprintsExisting = 0
  let classificationWritten = 0
  let productionProblemWrites = 0

  if (persistRequested) {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const staff = await createPipelineStaffClient(url, service)
    const run = await staff.rpc(RUN_RPC, {
      payload: { source_document_id: STEP833_DOCUMENT, actor: ASSIGNED_BY_833, assigned_by: ASSIGNED_BY_833 },
    })
    if (run.error) throw new Error(`pipeline run: ${run.error.message}`)
    persist.ran = true
    persist.pipeline_run_id = (run.data as { run_id: string }).run_id

    const fpIds = fingerprintTargets.map((row) => row.existing?.problem_id).filter((id): id is string => Boolean(id))
    const haveFp = await existingFingerprints(admin, fpIds)
    const versionIds = fingerprintTargets.map((row) => row.existing?.current_version_id).filter((id): id is string => Boolean(id))
    const haveClass = await existingClassificationVersions(admin, versionIds)
    const book = buildBookStructure({
      pageTexts: merged.map((row) => ({ page: row.page, text: row.stem_preview })),
      lastPage: STEP833_PAGE_COUNT,
    })

    const persistOne = async (item: Item833, allowClear: boolean) => {
      const row = qaById.get(item.candidate_id)
      const existing = item.existing
      if (!row || !existing) return
      if (existing.review_status === 'VERIFIED') return
      if (allowClear && row.verdict === 'AUTO_CLEAR' && existing.review_status === 'NEEDS_REVIEW') {
        const versionId = existing.current_version_id
        if (versionId) {
          const ver = await admin
            .from('problem_versions')
            .update({ review_status: 'AUTO_CLASSIFIED' })
            .eq('id', versionId)
            .eq('problem_id', existing.problem_id)
          if (ver.error) throw new Error(ver.error.message)
        }
        const prob = await admin
          .from('problems')
          .update({ review_status: 'AUTO_CLASSIFIED' })
          .eq('id', existing.problem_id)
          .eq('lifecycle_status', 'DRAFT')
          .neq('review_status', 'VERIFIED')
        if (prob.error) throw new Error(prob.error.message)
        if (versionId) {
          await admin.from('reviews').insert({
            problem_id: existing.problem_id,
            problem_version_id: versionId,
            status: 'AUTO_CLASSIFIED',
            reviewer: ASSIGNED_BY_833,
            note: `STEP_8_33 ${row.applied_rules.slice(0, 8).join(',')}`,
          })
        }
        await admin.from('audit_events').insert({
          entity_type: 'problem',
          entity_id: existing.problem_id,
          action: 'AUTO_CLEAR_NEEDS_REVIEW',
          actor: ASSIGNED_BY_833,
          after_snapshot: { review_status: 'AUTO_CLASSIFIED', lifecycle: 'DRAFT', candidate_id: item.candidate_id },
          before_snapshot: { review_status: 'NEEDS_REVIEW' },
        })
        persist.cleared += 1
        productionProblemWrites += 1
      } else if (allowClear && row.verdict === 'AUTO_CLEAR' && existing.review_status === 'AUTO_CLASSIFIED') {
        persist.skipped_already_clear += 1
      }

      if (row.verdict === 'AUTO_CLEAR') {
        const fps = [
          { type: 'NORMALIZED_TEXT', value: sha256Text(row.normalized_text) },
          { type: 'STRUCTURE', value: sha256Text(row.structure_key) },
          ...(item.crop_sha256 ? [{ type: 'FILE_HASH', value: item.crop_sha256 }] : []),
        ]
        for (const fp of fps) {
          const key = `${existing.problem_id}|${fp.type}|${fp.value}`
          if (haveFp.has(key)) {
            fingerprintsExisting += 1
            continue
          }
          const inserted = await admin.from('content_fingerprints').insert({
            problem_id: existing.problem_id,
            problem_version_id: existing.current_version_id,
            fingerprint_type: fp.type,
            fingerprint_value: fp.value,
          })
          if (inserted.error) throw new Error(inserted.error.message)
          haveFp.add(key)
          fingerprintsWritten += 1
        }

        const versionId = existing.current_version_id
        if (versionId && !haveClass.has(versionId) && UNIT_CODE[row.unit_id] && profileById(row.type_id)) {
          const classified = classifyDraftV1({
            problem_id: existing.problem_id,
            page: item.page,
            problem_number: item.canonical ?? item.problem_number,
            stem: item.problem_text || item.stem_preview,
            structure: book,
            difficulty: estimateRubricDifficulty({
              stem: item.stem_preview,
              choice_count: item.choice_count,
              math_count: row.math_readable ? 2 : 0,
              figure_hint: item.has_figure,
              graph_hint: /그래프/.test(item.stem_preview),
              table_hint: item.has_table,
            }),
            thresholds: { ...DEFAULT_V1_THRESHOLDS, unit: 0.8, type: 0.7 },
          })
          const persistable = {
            ...classified,
            unit_id: row.unit_id,
            type_id: row.type_id,
            classification_status: 'AUTO' as const,
            decisions: { ...classified.decisions, unit: 'AUTO' as const, type: 'AUTO' as const, overall: 'AUTO' as const },
            review_reasons: [] as string[],
          }
          const preflight = preflightAuto({
            row: persistable,
            problem: existing,
            source: {
              source_document_id: STEP833_DOCUMENT,
              page: item.page,
              problem_number: item.canonical ?? item.problem_number,
            },
            profile: profileById(row.type_id),
            expectedDocument: STEP833_DOCUMENT,
          })
          if (preflight.pass) {
            const rpc = await staff.rpc(CLASSIFICATION_RPC, {
              payload: classificationPayload({ row: persistable, versionId, preflight, assignedBy: ASSIGNED_BY_833 }),
            })
            if (!rpc.error) {
              classificationWritten += 1
              haveClass.add(versionId)
            }
          }
        }
      }
    }

    for (const item of fingerprintTargets) {
      try {
        await persistOne(item, false)
      } catch (error) {
        persist.failed.push({ candidate_id: item.candidate_id, error: error instanceof Error ? error.message : 'fingerprint_failed' })
      }
    }

    for (const item of scoped) {
      const row = qaById.get(item.candidate_id)
      const existing = item.existing
      if (!row || !existing) continue
      try {
        await persistOne(item, true)
        const itemRpc = await staff.rpc(ITEM_RPC, {
          payload: {
            pipeline_run_id: persist.pipeline_run_id,
            candidate_id: item.candidate_id,
            stage: STAGE_833,
            status: row.pipeline_status,
            reasons: row.verdict === 'AUTO_CLEAR' ? row.applied_rules : row.residual_reasons,
            assigned_by: ASSIGNED_BY_833,
            fingerprint: {
              problem_id: existing.problem_id,
              normalized_text: sha256Text(row.normalized_text),
              structure: row.structure_key,
              crop_sha256: item.crop_sha256,
              embeddings: false,
            },
          },
        })
        if (itemRpc.error) persist.failed.push({ candidate_id: item.candidate_id, error: itemRpc.error.message })
      } catch (error) {
        persist.failed.push({ candidate_id: item.candidate_id, error: error instanceof Error ? error.message : 'persist_failed' })
      }
    }
  }

  const after = persistRequested ? await productionSnapshot(root, ['--probe-production']) : before
  const reasonBefore = countReasons833(merged)
  const summary: Step833Summary = {
    step: STEP833,
    name: 'Auto QA + NEEDS_REVIEW minimization + fingerprint search prep',
    status: persistRequested ? (persist.ran ? 'PERSISTED' : 'BLOCKED') : 'CACHE_ONLY_PLANNED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP833_DOCUMENT, title: STEP833_DOCUMENT_TITLE },
    executed: persistRequested,
    inspected: merged.length,
    scoped_needs_review: scoped.length,
    auto_cleared: autoCleared.length,
    human_review_remaining: human.length,
    fingerprints_written: fingerprintsWritten,
    fingerprints_existing: fingerprintsExisting,
    embeddings_written: 0,
    embeddings_available: embeddingsAvailable833(),
    classification_written: classificationWritten,
    duplicates: qa.filter((row) => row.residual_reasons.includes('DUPLICATE_CANDIDATE')).length,
    orphans: merged.filter((row) => !row.existing && (persistRequested || probe)).length,
    wrong_source: merged.filter((row) => production.get(row.candidate_id)?.source_document_id === SECOND_DOCUMENT).length,
    content_rewrites: 0,
    production_problem_writes: productionProblemWrites,
    production_figure_writes: 0,
    production_verified_writes: 0,
    production_draft_writes: 0,
    production_counts_before: before,
    production_counts_after: after,
    paid_api_calls: { mathpix: 0, mistral: 0 },
    estimated_usd: 0,
    mistral_credentials: process.env.MISTRAL_API_KEY?.trim() ? 'PRESENT' : 'ABSENT',
    frozen: FROZEN_833,
    reason_census_before: reasonBefore,
    reason_census_after: residualCensus,
    residual_census: residualCensus,
    sample_ids: sampleIds,
    sample_findings: sampleFindings,
    persist,
    gt_mutated: gtSha(root) !== GT_JSON_SHA256_833,
    items: qa.map((row) => ({
      candidate_id: row.candidate_id,
      verdict: row.verdict,
      pipeline_status: row.pipeline_status,
      residual_reasons: row.residual_reasons,
      type_id: row.type_id,
      unit_id: row.unit_id,
    })),
  }
  if (summary.gt_mutated) throw new Error('STEP 8.33 mutated ground-truth.json')
  if (summary.items.some((row) => !neverVerified833(row.pipeline_status, row.verdict === 'AUTO_CLEAR' ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW'))) {
    throw new Error('STEP 8.33 attempted VERIFIED')
  }

  writeJson(dest, 'summary.json', summary)
  writeJson(dest, 'tally.json', {
    inspected: summary.inspected,
    scoped_needs_review: summary.scoped_needs_review,
    auto_cleared: summary.auto_cleared,
    human_review_remaining: summary.human_review_remaining,
    fingerprints_written: summary.fingerprints_written,
    embeddings_written: 0,
    duplicates: summary.duplicates,
  })
  writeJson(dest, 'reason-census-before.json', reasonBefore)
  writeJson(dest, 'residual-census.json', residualCensus)
  writeJson(dest, 'sample.json', { ids: sampleIds, findings: sampleFindings })
  writeJson(dest, 'production-before.json', before)
  writeJson(dest, 'production-after.json', after)
  writeJson(dest, 'persist-result.json', persist)
  writeJson(dest, 'items.json', { items: summary.items })
  writeJson(dest, 'qa-results.json', {
    results: qa.map((row) => ({
      candidate_id: row.candidate_id,
      verdict: row.verdict,
      applied_rules: row.applied_rules,
      residual_reasons: row.residual_reasons,
      type_id: row.type_id,
      unit_id: row.unit_id,
      unit_confidence: row.unit_confidence,
      type_confidence: row.type_confidence,
    })),
  })
  writeFileSync(path.join(dest, 'step8-33-summary.md'), markdownSummary(summary), 'utf8')
  return summary
}
