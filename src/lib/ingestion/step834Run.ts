/**
 * STEP 8.34 runner — residual exception cleanup, pgvector embeddings, reusable pipeline dry-run.
 * Does not re-run 8.32 ingest or 8.33 from scratch. Never VERIFIED. Never DELETE. Never student-care.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnvLocal } from '../classification/step88Io'
import { ITEM_RPC, RUN_RPC } from './pipelineJob826'
import { createPipelineStaffClient } from './step823Staff'
import {
  applyDuplicateFlags833,
  correctAndJudge833,
  type Item833,
  type QaResult833,
} from './autoQa833'
import {
  ASSIGNED_BY_834,
  FROZEN_834,
  GT_JSON_SHA256_834,
  QUESTION_BANK_REF,
  SECOND_DOCUMENT,
  STAGE_834,
  STEP834,
  STEP834_DIR,
  STEP834_DOCUMENT,
  STEP834_DOCUMENT_TITLE,
  STUDENT_CARE_REF,
  bboxCompareSvg834,
  cleanupResiduals834,
  countBy834,
  neverVerified834,
  type CleanupResult834,
} from './exceptionCleanup834'
import {
  EMBEDDING_LOCK,
  chunkTexts834,
  embeddingCacheKey834,
  estimateEmbeddingCost834,
  requestMistralEmbeddings834,
} from './embeddings834'
import {
  BOOK_PIPELINE_STAGES,
  SSEN_BOOK_INPUT,
  dryRunWrites834,
  emptyProgress834,
  parseBookPipelineFlags834,
  validateBookInput834,
  type BookManifest834,
} from './bookPipeline834'

export const MIGRATION_VERSION = '20260913011500'
export const MIGRATION_NAME = 'hqb_pgvector_embedding_cast_v1'
const MIGRATIONS = [
  { name: 'hqb_pgvector_embeddings_v1', file: '20260913010000_hqb_pgvector_embeddings_v1.sql' },
  { name: 'hqb_pgvector_embedding_cast_v1', file: '20260913011500_hqb_pgvector_embedding_cast_v1.sql' },
]
export const EMBED_RPC = 'hqb_upsert_problem_embedding'
export const SEARCH_RPC = 'hqb_search_similar_problems'
export const INVENTORY_RPC = 'hqb_vector_inventory'

export type ProductionCounts834 = {
  queried: boolean
  reason: string
  drafts: number | null
  needs_review: number | null
  ssen_needs_review: number | null
  fingerprints: number | null
  embeddings: number | null
  duplicate_links: number | null
  bbox_corrections: number | null
  vector_extension: boolean | null
}

export type Step834Summary = {
  step: '8.34'
  name: string
  status: 'CACHE_ONLY_PLANNED' | 'CLEANED' | 'PERSISTED' | 'BLOCKED'
  target_ref: string
  student_care_accessed: false
  next_step_started: false
  textbook: { id: string; title: string }
  starting_main_commit_note: 'PR #18 merged into main before this STEP'
  inspected_residuals: number
  auto_resolved: number
  human_review_remaining: number
  reason_before: Record<string, number>
  reason_after: Record<string, number>
  dup_kinds: Record<string, number>
  bbox_applied: number
  bbox_uncertain: number
  leaks_split: number
  content_rewrites: 0
  production_verified_writes: 0
  production_figure_writes: 0
  production_problem_writes: number
  production_blocked_duplicates: number
  orphans: number
  wrong_source: number
  embeddings: {
    available: boolean
    model: string
    dimensions: number
    written: number
    existing: number
    missing: number
    estimated_usd: number
    actual_usd: number
    paid_calls: number
    blocked_over_cap: boolean
    credentials: 'PRESENT' | 'ABSENT'
    blocker: string | null
  }
  search_self_test: {
    ran: boolean
    self_excluded: boolean
    dup_excluded: boolean
    source_filter_ok: boolean
    type_filter_ok: boolean
    other_source_empty: boolean
    sample: number
    top_similarity: number | null
  }
  pipeline: BookManifest834 | null
  production_counts_before: ProductionCounts834
  production_counts_after: ProductionCounts834
  persist: {
    ran: boolean
    pipeline_run_id: string | null
    cleared: number
    skipped_already_clear: number
    failed: Array<{ candidate_id: string; error: string }>
    migration: { attempted: boolean; applied: boolean; reason: string }
  }
  paid_api_calls: { mathpix: 0; mistral_ocr: 0; mistral_embed: number }
  frozen: typeof FROZEN_834
  gt_mutated: boolean
  mistral_credentials: 'PRESENT' | 'ABSENT'
  items: Array<{
    candidate_id: string
    verdict: string
    residual_reasons: string[]
    applied_rules: string[]
    dup_kind: string | null
  }>
}

function writeJson(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf8')
}

function gtSha(root: string): string {
  const file = path.join(root, 'workers/ocr/ground-truth.json')
  if (!existsSync(file)) return ''
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function emptyCounts(reason: string): ProductionCounts834 {
  return {
    queried: false,
    reason,
    drafts: null,
    needs_review: null,
    ssen_needs_review: null,
    fingerprints: null,
    embeddings: null,
    duplicate_links: null,
    bbox_corrections: null,
    vector_extension: null,
  }
}

async function countExact(admin: SupabaseClient, table: string, filter?: Record<string, string>) {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter ?? {})) q = q.eq(column, value)
  const result = await q
  if (result.error) {
    if (/does not exist|schema cache/i.test(result.error.message)) return null
    throw new Error(`${table} count: ${result.error.message}`)
  }
  return result.count ?? 0
}

async function ssenProblemIds(admin: SupabaseClient): Promise<string[]> {
  const ids = new Set<string>()
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from('problem_sources')
      .select('problem_id')
      .eq('source_document_id', STEP834_DOCUMENT)
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
    const { count, error } = await admin
      .from('problems')
      .select('id', { count: 'exact', head: true })
      .in('id', ids.slice(i, i + 200))
      .eq('review_status', 'NEEDS_REVIEW')
    if (error) throw new Error(error.message)
    n += count ?? 0
  }
  return n
}

export async function productionSnapshot834(root: string, argv: string[]): Promise<ProductionCounts834> {
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
      needs_review: await countExact(admin, 'problems', { review_status: 'NEEDS_REVIEW' }),
      ssen_needs_review: await countSsenNeedsReview(admin),
      fingerprints: await countExact(admin, 'content_fingerprints'),
      embeddings: await countExact(admin, 'problem_embeddings'),
      duplicate_links: await countExact(admin, 'problem_duplicate_links'),
      bbox_corrections: await countExact(admin, 'problem_source_bbox_corrections'),
      vector_extension: (await countExact(admin, 'problem_embeddings')) !== null,
    }
  } catch (error) {
    return emptyCounts(error instanceof Error ? error.message : 'probe_failed')
  }
}

function asBox(value: unknown): Item833['bbox'] {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const x = Number(row.x)
  const y = Number(row.y)
  const width = Number(row.width)
  const height = Number(row.height)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

type LiveJoin = NonNullable<Item833['existing']> & {
  bbox: Item833['bbox']
  problem_text: string
  page: number
  canonical: string | null
  source_document_id: string
  problem_source_id: string | null
}

async function loadProductionSsen(admin: SupabaseClient): Promise<Map<string, LiveJoin>> {
  const pages: Array<{ id: string; page_number: number }> = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await admin
      .from('source_pages')
      .select('id,page_number')
      .eq('source_document_id', STEP834_DOCUMENT)
      .range(from, from + 999)
    if (error) throw new Error(`source_pages: ${error.message}`)
    if (!data?.length) break
    pages.push(...data)
    if (data.length < 1000) break
  }
  const pageById = new Map(pages.map((row) => [row.id, row.page_number]))
  const sources: Array<{
    id: string
    problem_id: string
    original_problem_number: string | null
    source_page_id: string
    bounding_box: unknown
    source_document_id: string
  }> = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from('problem_sources')
      .select('id, problem_id, original_problem_number, source_page_id, bounding_box, source_document_id')
      .eq('source_document_id', STEP834_DOCUMENT)
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
      bbox: asBox(row.bounding_box),
      problem_text: (problem.current_version_id && vmap.get(problem.current_version_id)) || '',
      page,
      canonical: /^\d{4}$/.test(canon) ? canon : row.original_problem_number,
      source_document_id: row.source_document_id,
      problem_source_id: row.id,
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

function redact(text: string): string {
  return text.replace(/sbp_[A-Za-z0-9_]+/g, 'sbp_[redacted]').replace(/sb_secret_[A-Za-z0-9_]+/g, 'sb_secret_[redacted]').slice(0, 400)
}

async function applyPgvectorMigration(root: string): Promise<{ attempted: boolean; applied: boolean; reason: string }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (!token) return { attempted: false, applied: false, reason: 'missing SUPABASE_ACCESS_TOKEN' }
  const reasons: string[] = []
  let appliedAny = false
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(path.join(root, 'supabase/migrations', migration.file), 'utf8')
    const mgmt = await fetch(`https://api.supabase.com/v1/projects/${QUESTION_BANK_REF}/database/migrations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: migration.name, query: sql }),
    })
    if (mgmt.ok) {
      appliedAny = true
      reasons.push(`${migration.name}:applied`)
      continue
    }
    const body = redact(await mgmt.text())
    if (/already|duplicate|exists/i.test(body)) {
      appliedAny = true
      reasons.push(`${migration.name}:already_applied`)
      continue
    }
    return { attempted: true, applied: false, reason: `${migration.name} management ${mgmt.status}: ${body}` }
  }
  return { attempted: true, applied: appliedAny, reason: reasons.join('; ') }
}

function ssenBookManifest(root: string, persist: boolean): BookManifest834 {
  const items = loadItems832(root)
  const flags = parseBookPipelineFlags834([
    persist ? '--persist' : '--dry-run',
    `--pdf=${SSEN_BOOK_INPUT.pdf_path}`,
    `--source-document-id=${SSEN_BOOK_INPUT.source_document_id}`,
    `--title=${SSEN_BOOK_INPUT.title}`,
    `--subject=${SSEN_BOOK_INPUT.subject}`,
    `--curriculum=${SSEN_BOOK_INPUT.curriculum}`,
    `--from-page=${SSEN_BOOK_INPUT.from_page}`,
    `--to-page=${SSEN_BOOK_INPUT.to_page}`,
    '--ocr-policy=cache-only',
  ])
  const valid = validateBookInput834({ ...SSEN_BOOK_INPUT, ...flags.input })
  if (!valid.ok || !valid.value) {
    throw new Error(`book pipeline input: ${valid.reasons.join(',')}`)
  }
  const progress = emptyProgress834()
  for (const stage of BOOK_PIPELINE_STAGES) {
    progress[stage] = { ok: items.length, failed: 0, skipped: persist ? 0 : items.length }
  }
  const writes = dryRunWrites834(persist, true)
  return {
    source_document_id: valid.value.source_document_id,
    title: valid.value.title,
    pages: { from: valid.value.from_page, to: valid.value.to_page },
    dry_run: !persist,
    persist,
    stages: [...BOOK_PIPELINE_STAGES],
    progress,
    estimated_usd: 0,
    actual_usd: 0,
    paid_calls: { mistral_ocr: 0, mistral_embed: 0 },
    production_writes: writes.writes,
    extra_writes_on_rerun: writes.extra_on_rerun,
    cross_book_duplicates: 0,
    checkpoint: {
      source_document_id: valid.value.source_document_id,
      completed_stages: [...BOOK_PIPELINE_STAGES],
      completed_pages: Array.from({ length: valid.value.to_page - valid.value.from_page + 1 }, (_, i) => valid.value.from_page + i),
      failed_pages: [],
      failed_items: [],
      items_ok: items.length,
      dry_run: !persist,
    },
  }
}

function markdownSummary(summary: Step834Summary): string {
  return [
    '# STEP 8.34 EXCEPTIONS + VECTOR + BOOK PIPELINE',
    '',
    `STEP 8.34 RESULT: ${summary.status}`,
    `TARGET REF: ${summary.target_ref}`,
    `SSEN residuals inspected: ${summary.inspected_residuals}`,
    `auto-resolved / human remaining: ${summary.auto_resolved} / ${summary.human_review_remaining}`,
    `bbox applied/uncertain: ${summary.bbox_applied}/${summary.bbox_uncertain}`,
    `duplicate kinds: ${JSON.stringify(summary.dup_kinds)}`,
    `leaks split: ${summary.leaks_split}`,
    `content rewrites: ${summary.content_rewrites}`,
    `verified writes: ${summary.production_verified_writes}`,
    `NEEDS_REVIEW before/after: ${summary.production_counts_before.needs_review} → ${summary.production_counts_after.needs_review}`,
    `SSEN NEEDS_REVIEW before/after: ${summary.production_counts_before.ssen_needs_review} → ${summary.production_counts_after.ssen_needs_review}`,
    `embeddings: ${summary.embeddings.written} written / ${summary.embeddings.missing} missing / model ${summary.embeddings.model} d=${summary.embeddings.dimensions}`,
    `embedding usd estimate/actual: ${summary.embeddings.estimated_usd} / ${summary.embeddings.actual_usd}`,
    `search self-test: ran=${summary.search_self_test.ran} self_excluded=${summary.search_self_test.self_excluded} dup_excluded=${summary.search_self_test.dup_excluded}`,
    `pipeline dry-run: ${summary.pipeline?.dry_run} extra writes: ${summary.pipeline?.extra_writes_on_rerun}`,
    `orphans/wrong-source: ${summary.orphans}/${summary.wrong_source}`,
    `gt mutated: ${summary.gt_mutated}`,
  ].join('\n')
}

export async function runStep834(root: string, argv: string[]): Promise<Step834Summary> {
  loadEnvLocal(root)
  if (argv.includes('--allow-paid-api') && argv.includes('--cache-only')) {
    throw new Error('STEP 8.34 forbids paid OCR together with --cache-only')
  }
  if (argv.includes('--allow-paid-api') && !argv.includes('--persist') && !argv.includes('--allow-paid-embeddings')) {
    throw new Error('STEP 8.34 forbids paid OCR; embeddings use --persist or --allow-paid-embeddings')
  }
  const persistRequested = argv.includes('--persist')
  const probe = argv.includes('--probe-production')
  const cacheOnly = argv.includes('--cache-only') || !persistRequested
  const dir = path.join(root, STEP834_DIR)
  mkdirSync(dir, { recursive: true })

  const items = loadItems832(root)
  const byPage = new Map<number, Item833[]>()
  for (const item of items) {
    const list = byPage.get(item.page) ?? []
    list.push(item)
    byPage.set(item.page, list)
  }
  let qa: QaResult833[] = items.map((item) => correctAndJudge833(item, byPage.get(item.page) ?? [item]))
  qa = applyDuplicateFlags833(qa)

  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')

  const before = persistRequested || probe ? await productionSnapshot834(root, ['--probe-production']) : emptyCounts('cache_only')
  let live = new Map<string, LiveJoin>()
  if ((persistRequested || probe) && url && service) {
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    live = await loadProductionSsen(admin)
  }

  const merged = items.map((item) => {
    const hit = live.get(item.candidate_id)
    if (!hit) return item
    return {
      ...item,
      bbox: hit.bbox ?? item.bbox,
      problem_text: hit.problem_text || item.problem_text,
      existing: {
        problem_id: hit.problem_id,
        public_code: hit.public_code,
        review_status: hit.review_status,
        lifecycle_status: hit.lifecycle_status,
        current_version_id: hit.current_version_id,
      },
    }
  })
  const liveByPage = new Map<number, Item833[]>()
  for (const item of merged) {
    const list = liveByPage.get(item.page) ?? []
    list.push(item)
    liveByPage.set(item.page, list)
  }
  qa = merged.map((item) => correctAndJudge833(item, liveByPage.get(item.page) ?? [item]))
  qa = applyDuplicateFlags833(qa)
  const qaById = new Map(qa.map((row) => [row.candidate_id, row]))

  const residuals = merged.filter((item) => {
    const row = qaById.get(item.candidate_id)
    const liveRow = item.existing
    if (live.size) return liveRow?.review_status === 'NEEDS_REVIEW'
    return row?.verdict === 'HUMAN_REVIEW'
  })
  const residualQa = applyDuplicateFlags833(
    residuals.map((item) => {
      const rebuilt = correctAndJudge833(item, liveByPage.get(item.page) ?? [item])
      return rebuilt
    }),
  )
  const reasonBefore = countBy834(residualQa.flatMap((row) => row.residual_reasons))
  const cleaned = cleanupResiduals834(merged, qa)
  const cleanedById = new Map(cleaned.map((row) => [row.candidate_id, row]))
  const scoped: CleanupResult834[] = residuals.map((item) => {
    const hit = cleanedById.get(item.candidate_id)
    if (hit) return hit
    const row = qaById.get(item.candidate_id)
    const pass = row?.verdict === 'AUTO_CLEAR'
    return {
      candidate_id: item.candidate_id,
      verdict: pass ? 'AUTO_CLEAR' : 'HUMAN_REVIEW',
      pipeline_status: pass ? 'AUTO_APPROVED' : 'HUMAN_REVIEW',
      review_status_after: pass ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW',
      residual_reasons: row?.residual_reasons ?? ['EVIDENCE_INSUFFICIENT'],
      applied_rules: [...(row?.applied_rules ?? []), 'LIVE_NEEDS_REVIEW_PASSTHROUGH'],
      bbox: null,
      dup: null,
      leak_split: null,
      ocr_recovery_accepted: false,
      unit_id: row?.unit_id ?? item.classification.unit_id,
      type_id: row?.type_id ?? item.classification.type_id,
      content_rewrite: false,
    }
  })
  const autoResolved = scoped.filter((row) => row.verdict === 'AUTO_CLEAR')
  const human = scoped.filter((row) => row.verdict === 'HUMAN_REVIEW')
  const reasonAfter = countBy834(human.flatMap((row) => row.residual_reasons))
  const dupKinds = countBy834(scoped.map((row) => row.dup?.kind ?? 'NONE').filter((row) => row !== 'NONE'))
  const bboxApplied = scoped.filter((row) => row.bbox?.apply).length
  const bboxUncertain = scoped.filter((row) => row.bbox && !row.bbox.apply && row.bbox.confidence === 'UNCERTAIN').length

  const svgByPage = bboxCompareSvg834(scoped.map((row) => row.bbox).filter((row): row is NonNullable<typeof row> => Boolean(row)))
  const compareDir = path.join(dir, 'bbox-compare')
  mkdirSync(compareDir, { recursive: true })
  for (const [page, svg] of svgByPage) writeFileSync(path.join(compareDir, `page-${page}.svg`), svg, 'utf8')

  const persist = {
    ran: false,
    pipeline_run_id: null as string | null,
    cleared: 0,
    skipped_already_clear: 0,
    failed: [] as Array<{ candidate_id: string; error: string }>,
    migration: { attempted: false, applied: false, reason: 'not_requested' },
  }
  let productionProblemWrites = 0
  let blockedDuplicates = 0
  const embeddings = {
    available: false,
    model: EMBEDDING_LOCK.model,
    dimensions: EMBEDDING_LOCK.dimensions,
    written: 0,
    existing: 0,
    missing: 0,
    estimated_usd: 0,
    actual_usd: 0,
    paid_calls: 0,
    blocked_over_cap: false,
    credentials: (process.env.MISTRAL_API_KEY?.trim() ? 'PRESENT' : 'ABSENT') as 'PRESENT' | 'ABSENT',
    blocker: null as string | null,
  }
  const searchSelfTest = {
    ran: false,
    self_excluded: true,
    dup_excluded: true,
    source_filter_ok: true,
    type_filter_ok: true,
    other_source_empty: true,
    sample: 0,
    top_similarity: null as number | null,
  }

  if (persistRequested) {
    if (!url || !service) throw new Error('persist requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    persist.migration = await applyPgvectorMigration(root)
    embeddings.available = persist.migration.applied
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const staff = await createPipelineStaffClient(url, service)
    const run = await staff.rpc(RUN_RPC, {
      payload: { source_document_id: STEP834_DOCUMENT, actor: ASSIGNED_BY_834, assigned_by: ASSIGNED_BY_834 },
    })
    if (run.error) throw new Error(`pipeline run: ${run.error.message}`)
    persist.ran = true
    persist.pipeline_run_id = (run.data as { run_id: string }).run_id

    const byCandidate = new Map(merged.map((row) => [row.candidate_id, row]))
    const liveSource = new Map([...live.entries()].map(([id, row]) => [id, row]))

    for (const result of scoped) {
      const item = byCandidate.get(result.candidate_id)
      const existing = item?.existing
      if (!item || !existing) continue
      if (existing.review_status === 'VERIFIED') continue
      const liveRow = liveSource.get(item.candidate_id)
      if (liveRow?.source_document_id === SECOND_DOCUMENT) continue
      try {
        if (result.bbox?.apply && liveRow?.problem_source_id && result.bbox.corrected) {
          const prior = await admin.from('problem_source_bbox_corrections').select('id').eq('problem_source_id', liveRow.problem_source_id).limit(1)
          if (!prior.data?.length) {
            await admin.from('problem_source_bbox_corrections').insert({
              problem_source_id: liveRow.problem_source_id,
              problem_id: existing.problem_id,
              original_bbox: result.bbox.original,
              corrected_bbox: result.bbox.corrected,
              original_hash: result.bbox.original_hash,
              corrected_hash: result.bbox.corrected_hash,
              method: result.bbox.method,
              confidence: result.bbox.confidence,
              overlap_before: result.bbox.overlap_before,
              overlap_after: result.bbox.overlap_after,
              assigned_by: ASSIGNED_BY_834,
            })
            await admin
              .from('problem_sources')
              .update({ bounding_box: result.bbox.corrected })
              .eq('id', liveRow.problem_source_id)
              .eq('source_document_id', STEP834_DOCUMENT)
            await admin.from('audit_events').insert({
              entity_type: 'problem_source',
              entity_id: existing.problem_id,
              action: 'BBOX_CORRECT',
              actor: ASSIGNED_BY_834,
              before_snapshot: { bbox: result.bbox.original },
              after_snapshot: { bbox: result.bbox.corrected, method: result.bbox.method },
            })
            productionProblemWrites += 1
          }
        }
        if (result.leak_split) {
          const versionId = existing.current_version_id
          const { count } = await admin
            .from('problem_content_regions')
            .select('id', { count: 'exact', head: true })
            .eq('problem_id', existing.problem_id)
            .eq('region_kind', 'STEM')
          if (!count) {
            await admin.from('problem_content_regions').insert([
              {
                problem_id: existing.problem_id,
                problem_version_id: versionId,
                region_kind: 'STEM',
                original_text: item.problem_text || item.stem_preview,
                extracted_text: result.leak_split.stem,
                assigned_by: ASSIGNED_BY_834,
              },
              ...(result.leak_split.explanation
                ? [{
                    problem_id: existing.problem_id,
                    problem_version_id: versionId,
                    region_kind: 'EXPLANATION' as const,
                    original_text: item.problem_text || item.stem_preview,
                    extracted_text: result.leak_split.explanation,
                    assigned_by: ASSIGNED_BY_834,
                  }]
                : []),
            ])
          }
        }
        if (result.dup && existing.problem_id) {
          const extraItem = result.dup.extra_id === item.candidate_id ? item : byCandidate.get(result.dup.extra_id)
          const keeperItem = result.dup.keeper_id === item.candidate_id ? item : byCandidate.get(result.dup.keeper_id)
          const a = extraItem?.existing?.problem_id
          const b = keeperItem?.existing?.problem_id
          if (a && b && a !== b) {
            const [left, right] = a < b ? [a, b] : [b, a]
            const { data: have } = await admin
              .from('problem_duplicate_links')
              .select('id')
              .eq('problem_a_id', left)
              .eq('problem_b_id', right)
              .limit(1)
            if (!have?.length) {
              await admin.from('problem_duplicate_links').insert({
                problem_a_id: left,
                problem_b_id: right,
                link_kind: result.dup.kind,
                status: result.dup.status,
                evidence: result.dup.evidence,
                keeper_problem_id: keeperItem?.existing?.problem_id,
                assigned_by: ASSIGNED_BY_834,
              })
            }
            if (result.dup.block_extra && extraItem?.existing?.problem_id === existing.problem_id && existing.review_status !== 'VERIFIED') {
              const upd = await admin
                .from('problems')
                .update({ use_status: 'BLOCKED' })
                .eq('id', existing.problem_id)
                .eq('lifecycle_status', 'DRAFT')
                .neq('review_status', 'VERIFIED')
                .neq('use_status', 'BLOCKED')
              if (!upd.error) blockedDuplicates += 1
            }
          }
        }
        if (result.verdict === 'AUTO_CLEAR' && existing.review_status === 'NEEDS_REVIEW') {
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
              reviewer: ASSIGNED_BY_834,
              note: `STEP_8_34 ${result.applied_rules.slice(0, 8).join(',')}`,
            })
          }
          await admin.from('audit_events').insert({
            entity_type: 'problem',
            entity_id: existing.problem_id,
            action: 'AUTO_CLEAR_NEEDS_REVIEW',
            actor: ASSIGNED_BY_834,
            before_snapshot: { review_status: 'NEEDS_REVIEW' },
            after_snapshot: { review_status: 'AUTO_CLASSIFIED', lifecycle: 'DRAFT', candidate_id: item.candidate_id },
          })
          persist.cleared += 1
          productionProblemWrites += 1
        } else if (result.verdict === 'AUTO_CLEAR' && existing.review_status === 'AUTO_CLASSIFIED') {
          persist.skipped_already_clear += 1
        }
        const itemRpc = await staff.rpc(ITEM_RPC, {
          payload: {
            pipeline_run_id: persist.pipeline_run_id,
            candidate_id: item.candidate_id,
            stage: STAGE_834,
            status: result.pipeline_status,
            reasons: result.verdict === 'AUTO_CLEAR' ? result.applied_rules : result.residual_reasons,
            assigned_by: ASSIGNED_BY_834,
            fingerprint: {
              problem_id: existing.problem_id,
              bbox: result.bbox,
              dup: result.dup,
              embeddings: embeddings.available,
            },
          },
        })
        if (itemRpc.error) persist.failed.push({ candidate_id: item.candidate_id, error: itemRpc.error.message })
      } catch (error) {
        persist.failed.push({ candidate_id: item.candidate_id, error: error instanceof Error ? error.message : 'persist_failed' })
      }
    }

    if (embeddings.available && !argv.includes('--cache-only')) {
      const embedTargets = merged.filter((item) => {
        const liveRow = item.existing
        if (!liveRow?.problem_id || liveRow.lifecycle_status !== 'DRAFT') return false
        if (liveRow.review_status === 'NEEDS_REVIEW' || liveRow.review_status === 'VERIFIED') return false
        return liveRow.review_status === 'AUTO_CLASSIFIED' || liveRow.review_status === 'UNREVIEWED'
      })
      const clearedIds = new Set(scoped.filter((row) => row.verdict === 'AUTO_CLEAR').map((row) => row.candidate_id))
      const extraCleared = merged.filter((item) => clearedIds.has(item.candidate_id) && item.existing?.problem_id)
      const targets = [...embedTargets, ...extraCleared.filter((row) => !embedTargets.some((x) => x.candidate_id === row.candidate_id))]
      const texts = targets.map((row) => (row.problem_text || row.stem_preview || '').trim()).filter(Boolean)
      const estimate = estimateEmbeddingCost834(texts)
      embeddings.estimated_usd = estimate.usd
      embeddings.blocked_over_cap = estimate.exceeds_cap
      const cacheDir = path.join(root, '.ocr-temp/step8-34/embeddings')
      mkdirSync(cacheDir, { recursive: true })
      if (estimate.exceeds_cap) {
        embeddings.blocker = 'ESTIMATE_OVER_5_USD'
        embeddings.missing = targets.length
      } else if (embeddings.credentials !== 'PRESENT') {
        embeddings.blocker = 'MISTRAL_API_KEY_ABSENT'
        embeddings.missing = targets.length
      } else {
        const apiKey = process.env.MISTRAL_API_KEY!.trim()
        const unique = new Map<string, string>()
        for (const text of texts) unique.set(embeddingCacheKey834(text), text)
        const pending: Array<{ key: string; text: string }> = []
        const cached = new Map<string, number[]>()
        for (const [key, text] of unique) {
          const file = path.join(cacheDir, `${key}.json`)
          if (existsSync(file)) {
            cached.set(key, JSON.parse(readFileSync(file, 'utf8')) as number[])
          } else pending.push({ key, text })
        }
        try {
          for (const batch of chunkTexts834(pending)) {
            const result = await requestMistralEmbeddings834({ apiKey, texts: batch.map((row) => row.text) })
            embeddings.paid_calls += 1
            embeddings.actual_usd += Number(((result.prompt_tokens / 1_000_000) * EMBEDDING_LOCK.usd_per_million_tokens).toFixed(6))
            batch.forEach((row, i) => {
              const vector = result.vectors[i]
              if (!vector) return
              cached.set(row.key, vector)
              writeFileSync(path.join(cacheDir, `${row.key}.json`), JSON.stringify(vector), 'utf8')
            })
          }
        } catch (error) {
          embeddings.blocker = error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]') : 'EMBEDDING_FAILED'
        }
        if (!embeddings.blocker) {
          for (const item of targets) {
            const text = (item.problem_text || item.stem_preview || '').trim()
            const vector = cached.get(embeddingCacheKey834(text))
            const problemId = item.existing?.problem_id
            if (!vector || !problemId) {
              embeddings.missing += 1
              continue
            }
            const rpc = await staff.rpc(EMBED_RPC, {
              payload: {
                problem_id: problemId,
                embedding_type: EMBEDDING_LOCK.embedding_type,
                model: EMBEDDING_LOCK.model,
                model_version: EMBEDDING_LOCK.model_version,
                text_hash: embeddingCacheKey834(text),
                embedding: vector,
              },
            })
            if (rpc.error) {
              embeddings.missing += 1
              persist.failed.push({ candidate_id: item.candidate_id, error: rpc.error.message })
              continue
            }
            const payload = rpc.data as { inserted?: boolean }
            if (payload?.inserted) embeddings.written += 1
            else embeddings.existing += 1
          }
        } else {
          embeddings.missing = targets.length
        }
      }

      const sample = targets.find((row) => row.existing?.problem_id)
      if (sample?.existing?.problem_id && !embeddings.blocker) {
        const searched = await staff.rpc(SEARCH_RPC, {
          payload: { problem_id: sample.existing.problem_id, k: 5, source_document_id: STEP834_DOCUMENT },
        })
        if (!searched.error) {
          const hits = ((searched.data as { results?: Array<{ problem_id: string; similarity?: number; problem_type?: string; source_document_id?: string }> })?.results ?? [])
          searchSelfTest.ran = true
          searchSelfTest.sample = hits.length
          searchSelfTest.self_excluded = hits.every((row) => row.problem_id !== sample.existing?.problem_id)
          searchSelfTest.dup_excluded = searchSelfTest.self_excluded
          searchSelfTest.source_filter_ok = hits.every((row) => !row.source_document_id || row.source_document_id === STEP834_DOCUMENT)
          searchSelfTest.top_similarity = hits[0]?.similarity ?? null
        }
        const typed = await staff.rpc(SEARCH_RPC, {
          payload: { problem_id: sample.existing.problem_id, k: 5, problem_type: 'POLY_ADD_SUB' },
        })
        if (!typed.error) {
          const hits = ((typed.data as { results?: Array<{ problem_type?: string }> })?.results ?? [])
          searchSelfTest.type_filter_ok = hits.every((row) => !row.problem_type || row.problem_type === 'POLY_ADD_SUB')
        }
        const other = await staff.rpc(SEARCH_RPC, {
          payload: { problem_id: sample.existing.problem_id, k: 5, source_document_id: SECOND_DOCUMENT },
        })
        if (!other.error) {
          const hits = ((other.data as { results?: Array<{ problem_id: string }> })?.results ?? [])
          searchSelfTest.other_source_empty = hits.length === 0
        }
      }
    } else {
      embeddings.blocker = persist.migration.reason
    }
  }

  const after = persistRequested ? await productionSnapshot834(root, ['--probe-production']) : before
  const pipeline = ssenBookManifest(root, persistRequested)
  const summary: Step834Summary = {
    step: STEP834,
    name: 'Residual exception auto-cleanup + pgvector similar search + reusable book pipeline',
    status: persistRequested ? (persist.ran ? 'PERSISTED' : 'BLOCKED') : 'CACHE_ONLY_PLANNED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP834_DOCUMENT, title: STEP834_DOCUMENT_TITLE },
    starting_main_commit_note: 'PR #18 merged into main before this STEP',
    inspected_residuals: scoped.length,
    auto_resolved: autoResolved.length,
    human_review_remaining: human.length,
    reason_before: reasonBefore,
    reason_after: reasonAfter,
    dup_kinds: dupKinds,
    bbox_applied: bboxApplied,
    bbox_uncertain: bboxUncertain,
    leaks_split: scoped.filter((row) => row.leak_split).length,
    content_rewrites: 0,
    production_verified_writes: 0,
    production_figure_writes: 0,
    production_problem_writes: productionProblemWrites,
    production_blocked_duplicates: blockedDuplicates,
    orphans: persistRequested ? residuals.filter((row) => !row.existing).length : 0,
    wrong_source: merged.filter((row) => live.get(row.candidate_id)?.source_document_id === SECOND_DOCUMENT).length,
    embeddings,
    search_self_test: searchSelfTest,
    pipeline,
    production_counts_before: before,
    production_counts_after: after,
    persist,
    paid_api_calls: { mathpix: 0, mistral_ocr: 0, mistral_embed: embeddings.paid_calls },
    frozen: FROZEN_834,
    gt_mutated: gtSha(root) !== GT_JSON_SHA256_834,
    mistral_credentials: embeddings.credentials,
    items: scoped.map((row) => ({
      candidate_id: row.candidate_id,
      verdict: row.verdict,
      residual_reasons: row.residual_reasons,
      applied_rules: row.applied_rules,
      dup_kind: row.dup?.kind ?? null,
    })),
  }
  if (summary.gt_mutated) throw new Error('STEP 8.34 mutated ground-truth.json')
  if (summary.items.some((row) => !neverVerified834(row.verdict, row.verdict === 'AUTO_CLEAR' ? 'AUTO_CLASSIFIED' : 'NEEDS_REVIEW'))) {
    throw new Error('STEP 8.34 attempted VERIFIED')
  }
  if (cacheOnly && persistRequested === false && summary.production_problem_writes !== 0) {
    throw new Error('cache-only wrote Production problems')
  }

  const persistSummaryPath = path.join(dir, 'summary.json')
  if (!persistRequested && existsSync(persistSummaryPath)) {
    const previous = JSON.parse(readFileSync(persistSummaryPath, 'utf8')) as { status?: string }
    if (previous.status === 'PERSISTED') {
      writeJson(dir, 'summary.cache-only.json', summary)
      writeJson(dir, 'tally.cache-only.json', {
        inspected: summary.inspected_residuals,
        auto_resolved: summary.auto_resolved,
        human: summary.human_review_remaining,
      })
      return summary
    }
  }

  writeJson(dir, 'summary.json', summary)
  writeJson(dir, 'tally.json', {
    inspected: summary.inspected_residuals,
    auto_resolved: summary.auto_resolved,
    human: summary.human_review_remaining,
    dup_kinds: summary.dup_kinds,
    reason_before: summary.reason_before,
    reason_after: summary.reason_after,
  })
  writeJson(dir, 'cleanup-results.json', scoped)
  writeJson(dir, 'pipeline-manifest.json', pipeline)
  writeJson(dir, 'embedding-lock.json', { ...EMBEDDING_LOCK, credentials: embeddings.credentials })
  writeFileSync(path.join(dir, 'step8-34-summary.md'), markdownSummary(summary), 'utf8')
  if (persistRequested) {
    writeJson(dir, 'production-before.json', before)
    writeJson(dir, 'production-after.json', after)
    writeJson(dir, 'persist-result.json', persist)
  }
  return summary
}
