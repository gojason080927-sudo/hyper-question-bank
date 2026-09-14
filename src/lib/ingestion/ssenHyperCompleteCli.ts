/**
 * SSEN HYPER complete CLI. Default dry-run. --apply writes type/enrichment.
 * Reuses heading AUTO cache. Never DELETE. Never VERIFIED overwrite. Never student-care.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { bboxH, bboxTop, bboxX, SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { QUESTION_BANK_REF, STUDENT_CARE_REF, SSEN_LISTED_FROZEN, EMBEDDINGS_FROZEN, FINGERPRINTS_FROZEN } from './ssenFullQa839'
import { CLASSIFICATION_RPC, CURRICULUM_RPC } from '../taxonomy/classificationPersistence'
import { profileById } from '../taxonomy/typeProfiles'
import { rankSimilar834 } from './embeddings834'
import {
  COST_CAP_USD,
  HYPER_ASSIGNED_BY,
  HYPER_COMPLETE_VERSION,
  allowedHyperTypesForSection,
  classificationPayloadFromHyperRow,
  mergeHeadingCache,
  neighborTypeMatch,
  planSsenHyperComplete,
  type CachedHeadingDecision,
  type HyperCompleteRow,
} from '../taxonomy/ssenHyperComplete'
import { sectionForPage } from '../outline/ssenToc'
import type { SsenClassifyItem, SsenHeadingHit } from '../taxonomy/ssenFullClassify'

const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const OUT_DIR = 'ocr-tests/taxonomy/ssen-classify'
const AI_MODEL = 'mistral-small-latest'
const AI_INPUT_USD = 0.1 / 1_000_000
const AI_OUTPUT_USD = 0.3 / 1_000_000

function loadEnvLocal(root: string): void {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

async function paged(
  admin: SupabaseClient,
  table: string,
  columns: string,
  apply?: (q: ReturnType<SupabaseClient['from']>) => ReturnType<SupabaseClient['from']>,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = []
  let from = 0
  const size = 1000
  while (true) {
    let q = admin.from(table).select(columns).range(from, from + size - 1)
    if (apply) q = apply(q) as typeof q
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as Array<Record<string, unknown>>))
    if ((data ?? []).length < size) break
    from += size
  }
  return rows
}

async function staffClient(url: string, service: string) {
  const staff = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const link = await staff.auth.admin.generateLink({ type: 'magiclink', email: PIPELINE_TEACHER_EMAIL })
  const hashed = link.data?.properties?.hashed_token
  if (link.error || !hashed) throw new Error(`staff magiclink: ${link.error?.message ?? 'no token'}`)
  const verify = await staff.auth.verifyOtp({ token_hash: hashed, type: 'email' })
  if (verify.error || !verify.data.session) throw new Error(`staff verify: ${verify.error?.message ?? 'no session'}`)
  return staff
}

function loadCachedDecisions(root: string): CachedHeadingDecision[] {
  const file = path.join(root, OUT_DIR, 'dry-run.json')
  if (!existsSync(file)) return []
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { decisions?: CachedHeadingDecision[] }
  return Array.isArray(raw.decisions) ? raw.decisions : []
}

function loadHeadings(root: string): SsenHeadingHit[] {
  const file = path.join(root, OUT_DIR, 'page-headings.json')
  if (!existsSync(file)) return []
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { hits?: SsenHeadingHit[] }
  return Array.isArray(raw.hits) ? raw.hits : []
}

function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((n) => Number.isFinite(n))
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => Number.isFinite(n))
  } catch {
    /* pgvector textual form */
  }
  const inner = value.replace(/^\[/, '').replace(/\]$/, '')
  if (!inner.trim()) return []
  return inner.split(',').map(Number).filter((n) => Number.isFinite(n))
}

function aiCachePath(root: string, hash: string) {
  return path.join(root, OUT_DIR, 'ai-cache', `${hash}.json`)
}

async function classifyWithMistral(input: {
  root: string
  batches: Array<{ problem_id: string; stem: string; allowed: string[]; subunit: string }>
}): Promise<{ types: Map<string, string>; calls: number; tokens_in: number; tokens_out: number; usd: number; skipped: string | null }> {
  const types = new Map<string, string>()
  const key = process.env.MISTRAL_API_KEY?.trim() ?? ''
  if (!key) return { types, calls: 0, tokens_in: 0, tokens_out: 0, usd: 0, skipped: 'MISTRAL_API_KEY_ABSENT' }
  mkdirSync(path.join(input.root, OUT_DIR, 'ai-cache'), { recursive: true })
  let calls = 0
  let tokensIn = 0
  let tokensOut = 0
  let usd = 0
  const chunks: typeof input.batches[] = []
  for (let i = 0; i < input.batches.length; i += 8) chunks.push(input.batches.slice(i, i + 8))
  for (const chunk of chunks) {
    const hash = createHash('sha256').update(HYPER_COMPLETE_VERSION + JSON.stringify(chunk.map((row) => row.problem_id + row.stem + row.allowed.join(',')))).digest('hex')
    const cacheFile = aiCachePath(input.root, hash)
    if (existsSync(cacheFile)) {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { types?: Record<string, string> }
      for (const [id, type] of Object.entries(cached.types ?? {})) types.set(id, type)
      continue
    }
    const estimate = 0.002 * chunk.length
    if (usd + estimate > COST_CAP_USD) return { types, calls, tokens_in: tokensIn, tokens_out: tokensOut, usd, skipped: 'COST_CAP' }
    const body = {
      model: AI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Pick one allowed HYPER type_id per problem. Return JSON {"classifications":[{"problem_id":"","type_id":""}]}. Use only allowed ids.',
        },
        {
          role: 'user',
          content: JSON.stringify(
            chunk.map((row) => ({
              problem_id: row.problem_id,
              subunit: row.subunit,
              allowed: row.allowed,
              stem: row.stem.slice(0, 800),
            })),
          ),
        },
      ],
    }
    const post = async () =>
      fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    let res = await post()
    if (!res.ok) res = await post()
    calls += 1
    if (!res.ok) continue
    const json = (await res.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      choices?: Array<{ message?: { content?: string } }>
    }
    tokensIn += json.usage?.prompt_tokens ?? 0
    tokensOut += json.usage?.completion_tokens ?? 0
    usd = Number((tokensIn * AI_INPUT_USD + tokensOut * AI_OUTPUT_USD).toFixed(6))
    const text = json.choices?.[0]?.message?.content ?? '{}'
    let parsed: { classifications?: Array<{ problem_id?: string; type_id?: string }> } = {}
    try {
      parsed = JSON.parse(text) as typeof parsed
    } catch {
      continue
    }
    const bag: Record<string, string> = {}
    for (const row of parsed.classifications ?? []) {
      const item = chunk.find((c) => c.problem_id === row.problem_id)
      if (!item || !row.type_id || !item.allowed.includes(row.type_id)) continue
      types.set(row.problem_id, row.type_id)
      bag[row.problem_id] = row.type_id
    }
    writeFileSync(cacheFile, JSON.stringify({ model: AI_MODEL, types: bag }, null, 2), 'utf8')
  }
  return { types, calls, tokens_in: tokensIn, tokens_out: tokensOut, usd, skipped: null }
}

export async function runSsenHyperComplete(root = process.cwd(), options?: { persist?: boolean }) {
  const persist = options?.persist ?? (process.argv.includes('--persist') || process.argv.includes('--apply'))
  loadEnvLocal(root)
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !service) throw new Error('missing supabase env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('refused student-care')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('wrong supabase project')

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const links = await paged(admin, 'problem_sources', 'problem_id,original_problem_number,source_page_id,bounding_box', (q) =>
    q.eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID).eq('is_primary_source', true),
  )
  const pageIds = [...new Set(links.map((row) => String(row.source_page_id ?? '')).filter(Boolean))]
  const pages: Array<Record<string, unknown>> = []
  for (let i = 0; i < pageIds.length; i += 80) {
    const { data, error } = await admin.from('source_pages').select('id,page_number').in('id', pageIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    pages.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const pageMap = Object.fromEntries(pages.map((row) => [String(row.id), row]))
  const problemIds = [...new Set(links.map((row) => String(row.problem_id)))]
  const problems: Array<Record<string, unknown>> = []
  for (let i = 0; i < problemIds.length; i += 80) {
    const { data, error } = await admin
      .from('problems')
      .select('id,public_code,current_version_id,review_status,display_state')
      .in('id', problemIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    problems.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const versionIds = problems.map((row) => row.current_version_id).filter(Boolean).map(String)
  const versions: Array<Record<string, unknown>> = []
  for (let i = 0; i < versionIds.length; i += 80) {
    const { data, error } = await admin.from('problem_versions').select('id,problem_text,origin').in('id', versionIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    versions.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const vmap = Object.fromEntries(versions.map((row) => [String(row.id), row]))
  const pmap = Object.fromEntries(problems.map((row) => [String(row.id), row]))
  const items: SsenClassifyItem[] = links.map((link) => {
    const problem = pmap[String(link.problem_id)]
    const version = problem?.current_version_id ? vmap[String(problem.current_version_id)] : undefined
    const page = pageMap[String(link.source_page_id ?? '')]
    return {
      problem_id: String(link.problem_id),
      public_code: String(problem?.public_code ?? ''),
      original_problem_number: String(link.original_problem_number ?? '').padStart(4, '0'),
      source_page: Number(page?.page_number ?? 0),
      stem: String(version?.problem_text ?? ''),
      review_status: String(problem?.review_status ?? ''),
      display_state: String(problem?.display_state ?? ''),
      current_version_id: problem?.current_version_id ? String(problem.current_version_id) : null,
      origin: version?.origin ? String(version.origin) : null,
      bbox_top: bboxTop(link.bounding_box),
      bbox_x: bboxX(link.bounding_box),
      bbox_h: bboxH(link.bounding_box),
      existing_type_code: null,
    }
  })
  const listed = items.filter((row) => row.display_state === 'LISTED')
  if (listed.length !== SSEN_LISTED_FROZEN) throw new Error(`listed ${listed.length} != ${SSEN_LISTED_FROZEN}`)

  const merged = mergeHeadingCache(listed, loadCachedDecisions(root))
  const headings = loadHeadings(root)
  const labeledIds = new Set(merged.filter((row) => row.cached_verdict === 'AUTO' && row.cached_type_id).map((row) => row.problem_id))
  const embeddingsCount = (await admin.from('problem_embeddings').select('id', { count: 'exact', head: true })).count ?? 0
  const fingerprintsCount = (await admin.from('content_fingerprints').select('id', { count: 'exact', head: true })).count ?? 0
  const embedById = new Map<string, number[]>()
  for (let i = 0; i < listed.length; i += 80) {
    const ids = listed.slice(i, i + 80).map((row) => row.problem_id)
    const { data, error } = await admin
      .from('problem_embeddings')
      .select('problem_id,embedding')
      .eq('embedding_type', 'NORMALIZED_TEXT')
      .in('problem_id', ids)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ problem_id: string; embedding: unknown }>) {
      const vector = parseEmbedding(row.embedding)
      if (vector.length) embedById.set(row.problem_id, vector)
    }
  }
  const fpById = new Map<string, string>()
  for (let i = 0; i < listed.length; i += 80) {
    const ids = listed.slice(i, i + 80).map((row) => row.problem_id)
    const { data, error } = await admin
      .from('content_fingerprints')
      .select('problem_id,fingerprint_value')
      .eq('fingerprint_type', 'NORMALIZED_TEXT')
      .in('problem_id', ids)
    if (error) break
    for (const row of (data ?? []) as Array<{ problem_id: string; fingerprint_value: string }>) {
      if (!fpById.has(row.problem_id)) fpById.set(row.problem_id, row.fingerprint_value)
    }
  }
  const typeByCached = Object.fromEntries(
    merged.filter((row) => row.cached_type_id).map((row) => [row.problem_id, row.cached_type_id as string]),
  )
  const clusterTypeByProblem = new Map<string, string>()
  for (const item of merged) {
    if (item.cached_verdict === 'AUTO' && item.cached_type_id) continue
    const vector = embedById.get(item.problem_id)
    if (!vector) continue
    const section = sectionForPage(item.source_page)
    const candidates = merged
      .filter((other) => other.problem_id !== item.problem_id && labeledIds.has(other.problem_id))
      .filter((other) => !section || sectionForPage(other.source_page)?.code === section.code)
      .map((other) => ({
        problem_id: other.problem_id,
        vector: embedById.get(other.problem_id) ?? [],
        fingerprint: fpById.get(other.problem_id) ?? null,
      }))
      .filter((other) => other.vector.length)
    const hits = rankSimilar834({
      query_id: item.problem_id,
      query_fingerprint: fpById.get(item.problem_id) ?? null,
      query_vector: vector,
      candidates,
      k: 3,
    }).filter((hit) => hit.similarity >= 0.82)
    const neighborType = hits.map((hit) => typeByCached[hit.problem_id]).find((id) => Boolean(id))
    if (neighborType) clusterTypeByProblem.set(item.problem_id, neighborType)
  }

  let planned = planSsenHyperComplete({ items: merged, headings, clusterTypeByProblem })
  const low = planned.rows.filter((row) => (row.confirmation === 'LOW_CONFIDENCE_REVIEW' || !row.type_id) && !row.cached)
  const reps = new Map<string, HyperCompleteRow>()
  for (const row of low) {
    const key = `${row.section_code}|${row.subunit_id}|${row.search.item_kind}|${row.condition_ids.join(',')}`
    if (!reps.has(key)) reps.set(key, row)
  }
  const ai = await classifyWithMistral({
    root,
    batches: [...reps.values()].map((row) => {
      const section = sectionForPage(row.source_page)
      return {
        problem_id: row.problem_id,
        stem: row.cleaned_stem,
        allowed: section ? allowedHyperTypesForSection(section) : [],
        subunit: row.subunit_id ?? '',
      }
    }),
  })
  if (ai.types.size) planned = planSsenHyperComplete({ items: merged, headings, aiTypes: ai.types, clusterTypeByProblem })

  const typeById = Object.fromEntries(planned.rows.map((row) => [row.problem_id, row.type_id]))
  const overallById = Object.fromEntries(planned.rows.map((row) => [row.problem_id, Number(row.hyper_overall ?? 0)]))
  const sample = planned.rows.filter((row) => row.type_id && embedById.has(row.problem_id)).slice(0, 30)
  const neighborCheck = neighborTypeMatch(
    sample.map((row) => {
      const vector = embedById.get(row.problem_id) ?? []
      const hits = rankSimilar834({
        query_id: row.problem_id,
        query_fingerprint: fpById.get(row.problem_id) ?? null,
        query_vector: vector,
        candidates: sample
          .filter((other) => other.problem_id !== row.problem_id)
          .filter((other) => Math.abs((overallById[other.problem_id] ?? 0) - (overallById[row.problem_id] ?? 0)) <= 1)
          .map((other) => ({
            problem_id: other.problem_id,
            vector: embedById.get(other.problem_id) ?? [],
            fingerprint: fpById.get(other.problem_id) ?? null,
          })),
        k: 5,
      })
      return { type_id: typeById[row.problem_id] ?? null, neighbor_types: hits.map((hit) => typeById[hit.problem_id] ?? '').filter(Boolean) }
    }),
  )

  const outDir = path.join(root, OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  const compactRows = planned.rows.map((row) => ({
    problem_id: row.problem_id,
    public_code: row.public_code,
    original_problem_number: row.original_problem_number,
    type_id: row.type_id,
    secondary_type_id: row.secondary_type_id,
    source_type: row.source_type,
    confirmation: row.confirmation,
    cached: row.cached,
    leak_stripped: row.leak_stripped,
    source_stage: row.source_stage,
    hyper_overall: row.hyper_overall,
    strategy_id: row.strategy_id,
    concept_ids: row.concept_ids,
    persist_type: row.persist_type,
  }))
  const dry = {
    status: persist ? 'DRY_RUN_BEFORE_PERSIST' : 'DRY_RUN',
    classifier_version: HYPER_COMPLETE_VERSION,
    listed: SSEN_LISTED_FROZEN,
    summary: planned.summary,
    confirmations: tally(planned.rows.map((row) => row.confirmation)),
    cached_auto: planned.summary.cached_auto,
    new_targets: planned.summary.new_targets,
    leak_stripped: planned.summary.leak_stripped,
    embedding_clusters: clusterTypeByProblem.size,
    ai: { model: AI_MODEL, calls: ai.calls, tokens_in: ai.tokens_in, tokens_out: ai.tokens_out, usd: ai.usd, skipped: ai.skipped, types: ai.types.size },
    neighbor_sample: neighborCheck,
    embeddings: embeddingsCount,
    fingerprints: fingerprintsCount,
    integrity: {
      listed: listed.length,
      embeddings_ok: embeddingsCount === EMBEDDINGS_FROZEN,
      fingerprints_ok: fingerprintsCount === FINGERPRINTS_FROZEN,
      delete: 0,
      raw_ocr_writes: 0,
    },
    specials: Object.fromEntries(
      planned.rows
        .filter((row) => ['0650', '0774', '0775', '1190', '1191', '0507', '0527', '0882', '1005', '1157'].includes(row.original_problem_number))
        .map((row) => [
          row.original_problem_number,
          {
            type_id: row.type_id,
            confirmation: row.confirmation,
            leak_stripped: row.leak_stripped,
            source_type: row.source_type,
            reasons: row.reasons,
          },
        ]),
    ),
  }
  writeFileSync(path.join(outDir, 'hyper-complete-dry-run.json'), JSON.stringify({ ...dry, rows: compactRows }, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'hyper-complete-summary.json'), JSON.stringify(dry, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'search-features.json'), JSON.stringify(planned.rows.map((row) => row.search), null, 2), 'utf8')
  writeDashboard(root, planned.rows, planned.summary, {
    live_needs_review: listed.filter((row) => row.review_status === 'NEEDS_REVIEW').length,
    persisted: false,
    ai: dry.ai,
  })
  console.log(JSON.stringify({ phase: persist ? 'dry-run-before-persist' : 'dry-run', ...dry }, null, 2))
  if (!persist) return dry

  const hashFile = path.join(outDir, 'hyper-complete-input-hash.json')
  const currentHash = createHash('sha256').update(planned.rows.map((row) => row.input_hash).join('')).digest('hex')
  const previousHash = existsSync(hashFile) ? (JSON.parse(readFileSync(hashFile, 'utf8')) as { hash?: string; rows?: Record<string, string> }) : { hash: '', rows: {} }
  if (previousHash.hash === currentHash) {
    console.log('SSEN HYPER COMPLETE rerun write=0 ai=0 (input hash unchanged)')
    return { ...dry, persist: { written: 0, skipped: planned.rows.length, rerun: true, leak_versions: 0 } }
  }
  const previousRows =
    previousHash.rows ??
    Object.fromEntries(planned.rows.filter((row) => !row.leak_stripped).map((row) => [row.problem_id, row.input_hash]))

  const staff = await staffClient(url, service)
  const ensured = await staff.rpc(CURRICULUM_RPC)
  if (ensured.error) throw new Error(`curriculum: ${ensured.error.message}`)
  await ensureDictionary(admin, planned.rows)

  const versionByProblem = new Map(listed.map((row) => [row.problem_id, row.current_version_id]))
  const leakWrites: Array<Record<string, unknown>> = []
  for (const row of planned.rows.filter((item) => item.leak_stripped)) {
    const rpc = await staff.rpc('hqb_apply_auto_clean_text', {
      p_problem_id: row.problem_id,
      p_cleaned_text: row.cleaned_stem,
      p_change_reason: 'SSEN hyper-complete answer-key leak strip',
    })
    if (rpc.error) throw new Error(rpc.error.message)
    const data = rpc.data as { version_id?: string; skipped?: boolean }
    if (data?.version_id) versionByProblem.set(row.problem_id, data.version_id)
    leakWrites.push({ problem_id: row.problem_id, result: rpc.data })
  }

  const persistRows: Array<Record<string, unknown>> = []
  let stopped: string | null = null
  const auto = planned.rows.filter((row) => row.persist_type && row.type_id)
  for (const row of auto) {
    if (stopped) {
      persistRows.push({ problem_id: row.problem_id, skipped: true, reason: `atomic stop: ${stopped}` })
      continue
    }
    const leakTouched = leakWrites.some((item) => item.problem_id === row.problem_id && (item.result as { skipped?: boolean } | undefined)?.skipped === false)
    if (!leakTouched && previousRows[row.problem_id] === row.input_hash) {
      persistRows.push({ problem_id: row.problem_id, skipped: true, reason: 'input_hash_unchanged' })
      continue
    }
    const versionId = versionByProblem.get(row.problem_id)
    if (!versionId) {
      persistRows.push({ problem_id: row.problem_id, skipped: true, reason: 'missing_version' })
      continue
    }
    const rpc = await staff.rpc(CLASSIFICATION_RPC, { payload: classificationPayloadFromHyperRow(row, versionId) })
    if (rpc.error) {
      stopped = rpc.error.message
      persistRows.push({ problem_id: row.problem_id, error: rpc.error.message })
      continue
    }
    await writeEnrichment(admin, row, versionId)
    persistRows.push({ problem_id: row.problem_id, error: null, result: rpc.data ?? null })
    if (persistRows.filter((item) => item.result).length % 50 === 0) {
      console.log(`SSEN HYPER COMPLETE persist ${persistRows.filter((item) => item.result).length}/${auto.length}`)
    }
  }

  let cleared = 0
  if (!stopped) {
    for (const row of planned.rows.filter((item) => item.clear_needs_review)) {
      const versionId = versionByProblem.get(row.problem_id)
      if (!versionId) continue
      const ver = await admin.from('problem_versions').update({ review_status: 'AUTO_CLASSIFIED' }).eq('id', versionId).eq('problem_id', row.problem_id)
      if (ver.error) throw new Error(ver.error.message)
      const prob = await admin.from('problems').update({ review_status: 'AUTO_CLASSIFIED' }).eq('id', row.problem_id).neq('review_status', 'VERIFIED')
      if (prob.error) throw new Error(prob.error.message)
      cleared += 1
    }
  }

  const afterNeeds: Array<{ review_status: string; original?: string }> = []
  for (let i = 0; i < listed.length; i += 80) {
    const ids = listed.slice(i, i + 80).map((row) => row.problem_id)
    const { data, error } = await admin.from('problems').select('id,review_status').in('id', ids)
    if (error) throw new Error(error.message)
    afterNeeds.push(...((data ?? []) as Array<{ review_status: string }>))
  }
  const liveNeeds = afterNeeds.filter((row) => row.review_status === 'NEEDS_REVIEW').length
  const outcome = {
    status: stopped ? 'ABORT' : 'PERSISTED',
    summary: planned.summary,
    persist: {
      attempted: persistRows.length,
      written: persistRows.filter((row) => row.result).length,
      skipped: persistRows.filter((row) => row.skipped).length,
      errors: persistRows.filter((row) => row.error).length,
      leak_versions: leakWrites.length,
      cleared_needs_review: cleared,
      atomic_stop: stopped,
      delete: 0,
    },
    live_needs_review_after: liveNeeds,
    ai: dry.ai,
    neighbor_sample: neighborCheck,
    embeddings: embeddingsCount,
    fingerprints: fingerprintsCount,
  }
  writeFileSync(path.join(outDir, 'hyper-complete-persist.json'), JSON.stringify({ ...outcome, rows: persistRows, leakWrites }, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'search-features.json'), JSON.stringify(planned.rows.map((row) => row.search), null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'hyper-complete-summary.json'), JSON.stringify({ ...outcome, specials: dry.specials }, null, 2), 'utf8')
  if (!stopped) {
    writeFileSync(
      hashFile,
      JSON.stringify(
        {
          hash: currentHash,
          version: HYPER_COMPLETE_VERSION,
          rows: Object.fromEntries(planned.rows.map((row) => [row.problem_id, row.input_hash])),
        },
        null,
        2,
      ),
      'utf8',
    )
  }
  writeDashboard(root, planned.rows, planned.summary, { live_needs_review: liveNeeds, persisted: !stopped, persist: outcome.persist, ai: dry.ai })
  console.log(`SSEN HYPER COMPLETE written=${outcome.persist.written} leak=${leakWrites.length} cleared=${cleared} stop=${stopped ?? 'none'} needs=${liveNeeds}`)
  if (stopped) throw new Error(stopped)
  return outcome
}

function tally(keys: string[]): Record<string, number> {
  const bag: Record<string, number> = {}
  for (const key of keys) bag[key] = (bag[key] ?? 0) + 1
  return bag
}

async function ensureDictionary(admin: SupabaseClient, rows: HyperCompleteRow[]) {
  const concepts = new Map<string, string>()
  const strategies = new Map<string, { name: string; steps: string[] }>()
  const conditions = new Set<string>()
  const targets = new Set<string>()
  const reasoning = new Set<string>()
  for (const row of rows) {
    const profile = row.type_id ? profileById(row.type_id) : undefined
    profile?.core_concepts.forEach((name, i) => concepts.set(`${row.type_id}:concept:${i}`, name))
    if (profile && row.strategy_id) strategies.set(row.strategy_id, { name: profile.canonical_name_ko, steps: profile.solution_strategies })
    row.condition_ids.forEach((id) => conditions.add(id))
    row.target_ids.forEach((id) => targets.add(id))
    row.reasoning_ids.forEach((id) => reasoning.add(id))
  }
  for (const [code, name] of concepts) {
    const { error } = await admin.from('concepts').upsert({ code, name, description: name, active: true }, { onConflict: 'code' })
    if (error) throw new Error(`concepts: ${error.message}`)
  }
  for (const [code, spec] of strategies) {
    const { error } = await admin.from('strategy_templates').upsert({ code, name: spec.name, description: spec.steps.join(' / '), active: true }, { onConflict: 'code' })
    if (error) throw new Error(`strategy: ${error.message}`)
    const found = await admin.from('strategy_templates').select('id').eq('code', code).maybeSingle()
    if (found.error) throw new Error(`strategy lookup: ${found.error.message}`)
    const templateId = (found.data as { id?: string } | null)?.id
    if (!templateId) continue
    for (const [index, label] of spec.steps.entries()) {
      const step = await admin.from('strategy_template_steps').upsert(
        { strategy_template_id: templateId, step_no: index + 1, label },
        { onConflict: 'strategy_template_id,step_no' },
      )
      if (step.error) throw new Error(`strategy step: ${step.error.message}`)
    }
  }
  for (const code of conditions) {
    const { error } = await admin.from('condition_terms').upsert({ code, name: code, approval_status: 'APPROVED', active: true }, { onConflict: 'code' })
    if (error) throw new Error(`condition: ${error.message}`)
  }
  for (const code of targets) {
    const { error } = await admin.from('target_terms').upsert({ code, name: code, approval_status: 'APPROVED', active: true }, { onConflict: 'code' })
    if (error) throw new Error(`target: ${error.message}`)
  }
  for (const code of reasoning) {
    const { error } = await admin.from('reasoning_terms').upsert({ code, name: code, active: true }, { onConflict: 'code' })
    if (error) throw new Error(`reasoning: ${error.message}`)
  }
}

async function writeEnrichment(admin: SupabaseClient, row: HyperCompleteRow, versionId: string) {
  if (row.hyper_dims && row.hyper_overall) {
    const { error } = await admin.from('problem_difficulty').upsert(
      {
        problem_version_id: versionId,
        difficulty_source: 'MODEL',
        ...row.hyper_dims,
        overall_difficulty: Number(row.hyper_overall),
        created_by: HYPER_ASSIGNED_BY,
      },
      { onConflict: 'problem_version_id,difficulty_source' },
    )
    if (error) throw new Error(`difficulty: ${error.message}`)
  }
  const conceptIds = await idsByCode(admin, 'concepts', row.concept_ids)
  for (const [i, id] of conceptIds.entries()) {
    const { error } = await admin.from('problem_concepts').upsert(
      { problem_version_id: versionId, concept_id: id, is_primary: i === 0, application_role: 'SOLVE_WITH', confidence: 0.9, assigned_by: HYPER_ASSIGNED_BY },
      { onConflict: 'problem_version_id,concept_id' },
    )
    if (error) throw new Error(`problem_concepts: ${error.message}`)
  }
  if (row.strategy_id) {
    const strategyIds = await idsByCode(admin, 'strategy_templates', [row.strategy_id])
    if (strategyIds[0]) {
      const { error } = await admin.from('problem_strategy_assignments').upsert(
        { problem_version_id: versionId, strategy_template_id: strategyIds[0], is_primary: true, confidence: 0.9, assigned_by: HYPER_ASSIGNED_BY },
        { onConflict: 'problem_version_id,strategy_template_id' },
      )
      if (error) throw new Error(`strategy_assign: ${error.message}`)
    }
  }
  await linkTerms(admin, 'problem_conditions', 'condition_term_id', 'condition_terms', versionId, row.condition_ids, {
    assignment_status: 'AUTO_DISCOVERED',
  })
  await linkTerms(admin, 'problem_targets', 'target_term_id', 'target_terms', versionId, row.target_ids, {
    assignment_status: 'AUTO_DISCOVERED',
    is_primary: true,
  })
  await linkTerms(admin, 'problem_reasoning', 'reasoning_term_id', 'reasoning_terms', versionId, row.reasoning_ids, {})
  if (row.source_type) {
    await admin
      .from('problem_sources')
      .update({ source_type_label: row.source_type })
      .eq('problem_id', row.problem_id)
      .eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID)
      .eq('is_primary_source', true)
      .is('source_type_label', null)
  }
  if (row.secondary_type_id) {
    const { data } = await admin.from('hyper_problem_types').select('id').eq('code', row.secondary_type_id).maybeSingle()
    if (data?.id) {
      await admin.from('problem_type_assignments').upsert(
        { problem_version_id: versionId, hyper_problem_type_id: data.id, is_primary: false, confidence: 0.7, assigned_by: HYPER_ASSIGNED_BY },
        { onConflict: 'problem_version_id,hyper_problem_type_id' },
      )
    }
  }
}

async function idsByCode(admin: SupabaseClient, table: string, codes: string[]): Promise<string[]> {
  if (!codes.length) return []
  const { data, error } = await admin.from(table).select('id,code').in('code', codes)
  if (error) throw new Error(`${table} lookup: ${error.message}`)
  const map = Object.fromEntries(((data ?? []) as Array<{ id: string; code: string }>).map((row) => [row.code, row.id]))
  return codes.map((code) => map[code]).filter(Boolean)
}

async function linkTerms(
  admin: SupabaseClient,
  linkTable: string,
  fk: string,
  termTable: string,
  versionId: string,
  codes: string[],
  extra: Record<string, unknown>,
) {
  const ids = await idsByCode(admin, termTable, codes)
  for (const id of ids) {
    const row: Record<string, unknown> = { problem_version_id: versionId, [fk]: id, assigned_by: HYPER_ASSIGNED_BY, ...extra }
    const { error } = await admin.from(linkTable).upsert(row, { onConflict: `problem_version_id,${fk}` })
    if (error) throw new Error(`${linkTable}: ${error.message}`)
  }
}

function writeDashboard(root: string, rows: HyperCompleteRow[], summary: Record<string, number>, extras: Record<string, unknown>) {
  const payload = {
    source_id: SSEN_SOURCE_DOCUMENT_ID,
    title: '쎈수학 공통수학1',
    inspected_at: new Date().toISOString(),
    assigned_by: HYPER_ASSIGNED_BY,
    classifier_version: HYPER_COMPLETE_VERSION,
    listed: SSEN_LISTED_FROZEN,
    auto: summary.hyper_type,
    human: SSEN_LISTED_FROZEN - summary.hyper_type,
    low_confidence: summary.low_confidence,
    banner: `HYPER 유형 ${summary.hyper_type}/${SSEN_LISTED_FROZEN} · 확인 필요 ${summary.low_confidence}`,
    hyper_type: summary.hyper_type,
    concept: summary.concept,
    difficulty: summary.difficulty,
    strategy: summary.strategy,
    key_points: summary.key_points,
    mistakes: summary.mistakes,
    search_features: summary.search_features,
    confirmations: tally(rows.map((row) => row.confirmation)),
    ...extras,
  }
  writeFileSync(path.join(root, 'public/ssen-classify-status.json'), JSON.stringify(payload, null, 2), 'utf8')
}

const isMain = process.argv[1]?.includes('ssenHyperCompleteCli')
if (isMain) {
  await runSsenHyperComplete(process.cwd())
}
