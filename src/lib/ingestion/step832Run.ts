/**
 * STEP 8.32 runner — full 192-page SSEN ingest.
 * Cache-first Mistral page OCR. DRAFT persist without AUTO_APPROVED.
 * Never VERIFIED. Never student-care. Never rewrite existing problem_text.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { parsePaidGate, assertPaidMistralAllowed } from '../ocr/paidGate'
import { hasMistralCredentials, readMistralCredentials } from '../ocr/mistralSecrets'
import { extractMistralMarkdown, mistralLayoutFromRaw, type MistralOcrLike } from '../ocr/normalizeMistral'
import { MISTRAL_ENDPOINT, MISTRAL_MODEL } from '../ocr/mathOcrTypes'
import { loadEnvLocal } from '../classification/step88Io'
import { buildBookStructure, type BookStructure } from '../classification/bookStructure'
import { classifyDraftV1, DEFAULT_V1_THRESHOLDS } from '../taxonomy/taxonomyClassifier'
import { estimateRubricDifficulty } from '../taxonomy/difficultyRubric'
import { ITEM_RPC, RUN_RPC } from './pipelineJob826'
import { UPSERT_RPC, canonicalizeProblemNumber, upsertPayload } from '../recognition/draftUpsert'
import { classifyBookPageV2, countAnchorsFromText, type BookPageKindV2 } from '../recognition/bookClassify'
import { layoutInputFromProviderLayout, segmentPageFromLayout } from '../recognition/layoutSegment'
import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import {
  ASSIGNED_BY,
  CACHE_DIR,
  DB_INSERT_BATCH,
  FROZEN_PIPELINE_COUNTS,
  GT_JSON_SHA256,
  GT_PATH,
  PAGE_OCR_BATCH,
  QUESTION_BANK_REF,
  STAGE,
  STEP832,
  STEP832_DIR,
  STEP832_DOCUMENT,
  STEP832_DOCUMENT_TITLE,
  STEP832_PAGE_COUNT,
  STEP832_PAID_OCR_CAP,
  STEP832_PDF_SHA256,
  STORAGE_BUCKET,
  STORAGE_ORIGINAL,
  STUDENT_CARE_REF,
  candidateIdFor,
  contentFingerprint,
  emptyTally832,
  estimateMistralUsd,
  extractOverlappingText,
  humanReadableContent,
  inBatchDuplicates,
  isExcludedPageKind,
  isFrontMatterPage,
  mapPersistWithExisting,
  paidCapAllows,
  persistEligible832,
  persistPlanSafe832,
  pipelineStatusFor,
  problemPageKind,
  projectStep832Targets,
  reviewReasonsFor,
  stitchCrossPageProblems,
  structureFromRegionText,
  syntheticLayoutFromMarkdown,
  type ExistingDraft832,
  type PersistAction832,
  type Tally832,
} from './fullBookIngest832'

export type ProductionCounts = {
  queried: boolean
  reason: string
  drafts: number | null
  type_auto: number | null
  figure_assets: number | null
  figure_links: number | null
  pipeline_runs: number | null
  pipeline_items: number | null
  needs_review: number | null
}

type PageRecord = {
  page: number
  kind: BookPageKindV2
  excluded: boolean
  ocr_cached: boolean
  ocr_called: boolean
  http: number | null
  text_length: number
  ink_ratio: number | null
  error: string | null
}

type BookItem = {
  candidate_id: string
  source_document_id: string
  page: number
  page_kind: BookPageKindV2
  problem_number: string
  canonical: string | null
  bbox: NormalizedBBox
  crop_present: boolean
  crop_sha256: string | null
  text: string
  stem: string
  choice_count: number
  math: string[]
  has_figure: boolean
  has_table: boolean
  status: 'HUMAN_REVIEW' | 'BLOCKED'
  persist_action: PersistAction832
  reasons: string[]
  existing: ExistingDraft832 | null
  stitched_from_page: number | null
  classification: {
    unit_id: string
    type_id: string
    difficulty_level: number | null
    overall: string
    review_reasons: string[]
  }
  content_fingerprint: string
}

type PersistCreated = {
  candidate_id: string
  problem_id: string
  version_id: string | null
  public_code: string
  status: string
}

type PersistExisting = {
  candidate_id: string
  problem_id: string
  version_id: string | null
  public_code: string
}

type PersistResult = {
  ran: boolean
  created: PersistCreated[]
  existing: PersistExisting[]
  queued: string[]
  failed: Array<{ candidate_id: string; error: string }>
  pipeline_run_id: string | null
  queued_review: number
  submitted_needs_review: number
}

export type Step832Summary = {
  step: '8.32'
  name: string
  status: 'CACHE_ONLY_PLANNED' | 'PROCESSED' | 'PERSISTED' | 'BLOCKED'
  target_ref: string
  student_care_accessed: boolean
  next_step_started: false
  textbook: { id: string; title: string }
  executed: boolean
  pages_processed: number
  pages_excluded: number
  problems_found: number
  production_problem_writes: number
  production_figure_writes: 0
  production_verified_writes: 0
  production_pipeline_writes: { runs: 0 | 1; items: number }
  production_draft_writes: number
  production_counts_before: ProductionCounts
  production_counts_after: ProductionCounts
  paid_api_calls: { mathpix: 0; mistral: number; mistral_cached: number }
  paid_ocr_cap: { max_calls: number; max_usd: number }
  estimated_usd: number
  mistral_credentials: 'PRESENT' | 'ABSENT'
  frozen: typeof FROZEN_PIPELINE_COUNTS
  original_pdf: {
    present: boolean
    path: string | null
    sha256: string | null
    hash_match: boolean
  }
  tally: Tally832
  persist_plan_ok: boolean
  persist_plan_reasons: string[]
  persist: PersistResult
  duplicates: number
  orphans: number
  wrong_source: number
  gt_mutated: boolean
  content_rewrites: 0
  items: Array<{
    candidate_id: string
    page: number
    persist_action: PersistAction832
    status: string
    reasons: string[]
    canonical: string | null
  }>
  results: { PASS: number; REVIEW: number; BLOCKED: number }
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function skippedCounts(reason: string): ProductionCounts {
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
  }
}

function adminClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function countExact(
  admin: SupabaseClient,
  table: string,
  filter?: Record<string, string>,
): Promise<number> {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter ?? {})) q = q.eq(column, value)
  const result = await q
  if (result.error) throw new Error(`${table} count: ${result.error.message}`)
  return result.count ?? 0
}

export async function probeProductionCounts(): Promise<ProductionCounts> {
  const admin = adminClient()
  if (!admin) return skippedCounts('SUPABASE_SERVICE_ROLE_KEY_MISSING')
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
    }
  } catch (error) {
    return skippedCounts(error instanceof Error ? error.message : 'probe_failed')
  }
}

function loadAnonKey() {
  if (process.env.VITE_SUPABASE_ANON_KEY?.trim()) return
  for (const candidate of ['/tmp/hqb-anon.env', path.join(process.cwd(), '.ocr-temp/anon.env')]) {
    if (!existsSync(candidate)) continue
    const text = readFileSync(candidate, 'utf8')
    const match = text.match(/^VITE_SUPABASE_ANON_KEY=(.*)$/m)
    if (match?.[1]?.trim()) {
      process.env.VITE_SUPABASE_ANON_KEY = match[1].trim()
      return
    }
  }
}

function mergePaidLedger(root: string, newCalls: number): { mistral: number; usd: number } {
  const file = path.join(root, CACHE_DIR, 'paid-ledger.json')
  let previous = 0
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { mistral?: number }
    previous = typeof parsed.mistral === 'number' ? parsed.mistral : 0
  }
  const mistral = previous + newCalls
  const usd = estimateMistralUsd(mistral)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ mistral, usd }, null, 2), 'utf8')
  return { mistral, usd }
}

async function downloadOriginalPdf(root: string): Promise<{ path: string; sha256: string; bytes: number } | null> {
  const dest = path.join(root, '.ocr-temp/ssen-original.pdf')
  const tmp = '/tmp/hqb-ssen-ocr/original.pdf'
  const existing = existsSync(dest) ? dest : existsSync(tmp) ? tmp : null
  if (existing) {
    const hash = sha256File(existing)
    if (hash !== STEP832_PDF_SHA256) throw new Error('SSEN original PDF hash mismatch')
    if (existing !== dest) {
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(existing, dest)
    }
    return { path: dest, sha256: hash, bytes: readFileSync(dest).length }
  }
  const admin = adminClient()
  if (!admin) return null
  const downloaded = await admin.storage.from(STORAGE_BUCKET).download(STORAGE_ORIGINAL)
  if (downloaded.error || !downloaded.data) return null
  const buf = Buffer.from(await downloaded.data.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex')
  if (hash !== STEP832_PDF_SHA256) throw new Error('downloaded PDF is not the frozen SSEN original')
  mkdirSync(path.dirname(dest), { recursive: true })
  mkdirSync('/tmp/hqb-ssen-ocr', { recursive: true })
  writeFileSync(dest, buf)
  writeFileSync(tmp, buf)
  return { path: dest, sha256: hash, bytes: buf.length }
}

function renderPages(root: string, pdfPath: string, fromPage: number, toPage: number) {
  const out = path.join(root, CACHE_DIR)
  const script = path.join(root, 'scripts/render-step832-pages.py')
  execFileSync('python3', [script, '--pdf', pdfPath, '--out', out, '--scale', '2.0', '--from-page', String(fromPage), '--to-page', String(toPage)], {
    cwd: root,
    stdio: 'inherit',
  })
}

function loadPageInventory(root: string): Map<number, { ink_ratio: number; width: number; height: number }> {
  const file = path.join(root, CACHE_DIR, 'page-inventory.json')
  const map = new Map<number, { ink_ratio: number; width: number; height: number }>()
  if (!existsSync(file)) return map
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    pages?: Array<{ page: number; ink_ratio: number; width: number; height: number }>
  }
  for (const row of parsed.pages ?? []) {
    map.set(row.page, { ink_ratio: row.ink_ratio, width: row.width, height: row.height })
  }
  return map
}

function pagePng(root: string, page: number): string {
  return path.join(root, CACHE_DIR, 'pages', `p${String(page).padStart(3, '0')}.png`)
}

function ocrCachePath(root: string, page: number): string {
  return path.join(root, CACHE_DIR, 'ocr', `p${String(page).padStart(3, '0')}.json`)
}

function readOcrCache(root: string, page: number): MistralOcrLike | null {
  const file = ocrCachePath(root, page)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as MistralOcrLike
}

function layoutForPage(
  raw: MistralOcrLike | null,
  markdown: string,
  fallback: { width: number; height: number },
) {
  if (raw) {
    const layout = mistralLayoutFromRaw(raw)
    const width = layout.dimensions?.width ?? fallback.width
    const height = layout.dimensions?.height ?? fallback.height
    if (layout.blocks.length > 0) {
      try {
        return layoutInputFromProviderLayout(
          {
            dimensions: { width, height },
            blocks: layout.blocks,
            images: raw.pages?.[0]?.images ?? [],
          },
          { width, height },
        )
      } catch {
        // markdown fallback
      }
    }
    const images = (raw.pages?.[0]?.images ?? []).flatMap((image, index) => {
      if (image.top_left_x == null || image.top_left_y == null || image.bottom_right_x == null || image.bottom_right_y == null) {
        return []
      }
      return [
        {
          id: image.id ?? `img-${index}`,
          bbox: {
            x: image.top_left_x / width,
            y: image.top_left_y / height,
            width: (image.bottom_right_x - image.top_left_x) / width,
            height: (image.bottom_right_y - image.top_left_y) / height,
            unit: 'normalized' as const,
            origin: 'top-left' as const,
          },
        },
      ]
    })
    return syntheticLayoutFromMarkdown(markdown, width, height, images)
  }
  return syntheticLayoutFromMarkdown(markdown, fallback.width, fallback.height)
}

function stripImageBase64(raw: MistralOcrLike): MistralOcrLike {
  return {
    ...raw,
    pages: (raw.pages ?? []).map((page) => ({
      ...page,
      images: (page.images ?? []).map((image) => ({
        id: image.id,
        top_left_x: image.top_left_x,
        top_left_y: image.top_left_y,
        bottom_right_x: image.bottom_right_x,
        bottom_right_y: image.bottom_right_y,
      })),
    })),
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

async function ocrPage(input: {
  root: string
  page: number
  gate: ReturnType<typeof parsePaidGate>
  calls: { mistral: number }
}): Promise<{ raw: MistralOcrLike | null; markdown: string; cached: boolean; called: boolean; http: number | null; error: string | null }> {
  const cached = readOcrCache(input.root, input.page)
  if (cached) {
    return {
      raw: cached,
      markdown: extractMistralMarkdown(cached),
      cached: true,
      called: false,
      http: 200,
      error: null,
    }
  }
  const png = pagePng(input.root, input.page)
  if (!existsSync(png)) {
    return { raw: null, markdown: '', cached: false, called: false, http: null, error: 'missing_page_png' }
  }
  if (input.gate.cacheOnly || !input.gate.allowPaidApi || !input.gate.confirmCost) {
    return { raw: null, markdown: '', cached: false, called: false, http: null, error: 'ocr_skipped_no_paid_gate' }
  }
  const cap = paidCapAllows(input.calls.mistral + 1, estimateMistralUsd(input.calls.mistral + 1))
  if (!cap.ok) {
    return { raw: null, markdown: '', cached: false, called: false, http: null, error: cap.reasons.join(',') }
  }
  assertPaidMistralAllowed(input.gate)
  const creds = readMistralCredentials()
  if (!creds) return { raw: null, markdown: '', cached: false, called: false, http: null, error: 'MISTRAL_ABSENT' }
  let lastError: string | null = null
  let lastHttp: number | null = null
  const imageB64 = bytesToBase64(new Uint8Array(readFileSync(png)))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const started = Date.now()
      const response = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          document: { type: 'image_url', image_url: `data:image/png;base64,${imageB64}` },
          include_image_base64: false,
        }),
      })
      lastHttp = response.status
      input.calls.mistral += 1
      const raw = stripImageBase64((await response.json()) as MistralOcrLike)
      mkdirSync(path.dirname(ocrCachePath(input.root, input.page)), { recursive: true })
      writeFileSync(ocrCachePath(input.root, input.page), JSON.stringify(raw), 'utf8')
      const markdown = extractMistralMarkdown(raw)
      const elapsed = Date.now() - started
      console.log(`STEP 8.32 OCR page ${input.page} http=${response.status} ms=${elapsed} cached=0`)
      if (response.status === 429 || response.status >= 500) {
        lastError = raw.error ?? raw.detail ?? raw.message ?? `HTTP ${response.status}`
        await sleep(1500 * 2 ** attempt)
        continue
      }
      if (!response.ok) {
        lastError = raw.error ?? raw.detail ?? raw.message ?? `HTTP ${response.status}`
        return { raw, markdown, cached: false, called: true, http: response.status, error: lastError }
      }
      await sleep(120)
      return { raw, markdown, cached: false, called: true, http: response.status, error: null }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'ocr_failed'
      await sleep(800 * (attempt + 1))
    }
  }
  return { raw: null, markdown: '', cached: false, called: true, http: lastHttp, error: lastError }
}

async function lookupExistingDrafts(): Promise<Map<string, ExistingDraft832>> {
  const found = new Map<string, ExistingDraft832>()
  const admin = adminClient()
  if (!admin) return found
  const pages: Array<{ id: string; page_number: number }> = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await admin
      .from('source_pages')
      .select('id,page_number')
      .eq('source_document_id', STEP832_DOCUMENT)
      .range(from, from + 999)
    if (error) throw new Error(`source_pages: ${error.message}`)
    if (!data?.length) break
    pages.push(...data)
    if (data.length < 1000) break
  }
  const pageById = new Map(pages.map((row) => [row.id, row.page_number]))
  const sources: Array<{ problem_id: string; original_problem_number: string | null; source_page_id: string }> = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from('problem_sources')
      .select('problem_id, original_problem_number, source_page_id')
      .eq('source_document_id', STEP832_DOCUMENT)
      .range(from, from + 999)
    if (error) throw new Error(`problem_sources: ${error.message}`)
    if (!data?.length) break
    sources.push(...data)
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
    const chunk = problemIds.slice(i, i + 200)
    const { data, error } = await admin
      .from('problems')
      .select('id, public_code, review_status, lifecycle_status, current_version_id')
      .in('id', chunk)
    if (error) throw new Error(`problems: ${error.message}`)
    problems.push(...(data ?? []))
  }
  const pmap = new Map(problems.map((row) => [row.id, row]))
  for (const row of sources) {
    const page = pageById.get(row.source_page_id)
    const canon = canonicalizeProblemNumber(row.original_problem_number)
    const problem = pmap.get(row.problem_id)
    if (!page || !canon || !problem) continue
    found.set(`${page}|${canon}`, {
      problem_id: problem.id,
      public_code: problem.public_code,
      review_status: problem.review_status,
      lifecycle_status: problem.lifecycle_status,
      current_version_id: problem.current_version_id ?? null,
    })
  }
  return found
}

async function ensureSourcePages(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('source_pages')
    .select('page_number')
    .eq('source_document_id', STEP832_DOCUMENT)
    .limit(1000)
  if (error) throw new Error(`ensure source_pages: ${error.message}`)
  const have = new Set((data ?? []).map((row) => row.page_number))
  const missing = []
  for (let page = 1; page <= STEP832_PAGE_COUNT; page += 1) {
    if (!have.has(page)) missing.push({ source_document_id: STEP832_DOCUMENT, page_number: page, extraction_status: 'EXTRACTED', review_status: 'UNREVIEWED' })
  }
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    const inserted = await admin.from('source_pages').insert(chunk)
    if (inserted.error) throw new Error(`insert source_pages: ${inserted.error.message}`)
  }
}

function cropRegions(root: string, items: BookItem[]) {
  const dest = path.join(root, CACHE_DIR)
  const regionsPath = path.join(dest, 'regions.json')
  writeJson(dest, 'regions.json', {
    regions: items.map((row) => ({ candidate_id: row.candidate_id.replace('|', '_'), page: row.page, bbox: row.bbox })),
  })
  const script = path.join(root, 'scripts/crop-step832-regions.py')
  try {
    execFileSync(
      'python3',
      [script, '--pages-dir', path.join(dest, 'pages'), '--regions', regionsPath, '--out', path.join(dest, 'crops')],
      { cwd: root, stdio: 'inherit' },
    )
  } catch (error) {
    console.error('crop script failed', error instanceof Error ? error.message : error)
  }
  const hashPath = path.join(dest, 'crop-hashes.json')
  const hashes = existsSync(hashPath)
    ? (JSON.parse(readFileSync(hashPath, 'utf8')) as { crops: Array<{ candidate_id: string; present: boolean; sha256?: string }> })
    : { crops: [] }
  const byId = new Map(hashes.crops.map((row) => [row.candidate_id, row]))
  for (const item of items) {
    const key = item.candidate_id.replace('|', '_')
    const rec = byId.get(key)
    const file = path.join(dest, 'crops', `${key}.png`)
    item.crop_present = Boolean(rec?.present || existsSync(file))
    item.crop_sha256 = rec?.sha256 ?? (existsSync(file) ? sha256File(file) : null)
  }
}

async function persistItems(items: BookItem[]): Promise<PersistResult> {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anon = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !anon || !service) throw new Error('persist requires URL, anon, and service role')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  await ensureSourcePages(admin)
  const email = `step832.ingest.${Date.now()}@hyper.local`
  const password = `Ingest-${Date.now()}aA1!`
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createdUser.error || !createdUser.data.user) throw new Error(createdUser.error?.message ?? 'create staff')
  await admin.from('user_profiles').upsert({
    user_id: createdUser.data.user.id,
    role: 'TEACHER',
    display_name: 'STEP 8.32 ingest',
  })
  const staff = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await staff.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error(login.error.message)
  const run = await staff.rpc(RUN_RPC, {
    payload: {
      source_document_id: STEP832_DOCUMENT,
      actor: ASSIGNED_BY,
      assigned_by: ASSIGNED_BY,
    },
  })
  if (run.error) throw new Error(`pipeline run: ${run.error.message}`)
  const runId = (run.data as { run_id: string }).run_id
  const created: PersistCreated[] = []
  const recorded: PersistExisting[] = []
  const queued: string[] = []
  const failed: Array<{ candidate_id: string; error: string }> = []
  let submitted = 0
  const batches: BookItem[][] = []
  for (let i = 0; i < items.length; i += DB_INSERT_BATCH) batches.push(items.slice(i, i + DB_INSERT_BATCH))
  for (const batch of batches) {
    for (const row of batch) {
      try {
        if (row.persist_action === 'CREATE_DRAFT') {
          const rpc = await staff.rpc(UPSERT_RPC, {
            payload: upsertPayload({
              source_document_id: STEP832_DOCUMENT,
              page_number: row.page,
              original_problem_number: row.canonical ?? row.problem_number,
              bbox: row.bbox,
              problem_text: row.text.slice(0, 8000),
            }),
          })
          if (rpc.error) {
            failed.push({ candidate_id: row.candidate_id, error: rpc.error.message })
          } else {
            const body = rpc.data as {
              created?: boolean
              status?: string
              problem_id?: string
              version_id?: string
              public_code?: string
            }
            if (body.created === true && body.status === 'CREATED' && body.problem_id) {
              created.push({
                candidate_id: row.candidate_id,
                problem_id: body.problem_id,
                version_id: body.version_id ?? null,
                public_code: body.public_code ?? '',
                status: body.status,
              })
              if (body.version_id) {
                const submit = await staff.rpc('hqb_submit_for_review', {
                  p_version_id: body.version_id,
                  p_note: row.reasons.slice(0, 12).join(','),
                })
                if (!submit.error) submitted += 1
              }
            } else if (body.problem_id) {
              recorded.push({
                candidate_id: row.candidate_id,
                problem_id: body.problem_id,
                version_id: body.version_id ?? null,
                public_code: body.public_code ?? '',
              })
            }
          }
        } else if (row.persist_action === 'RECORD_EXISTING' && row.existing) {
          if (row.existing.review_status === 'VERIFIED') {
            recorded.push({
              candidate_id: row.candidate_id,
              problem_id: row.existing.problem_id,
              version_id: row.existing.current_version_id,
              public_code: row.existing.public_code,
            })
          } else {
            recorded.push({
              candidate_id: row.candidate_id,
              problem_id: row.existing.problem_id,
              version_id: row.existing.current_version_id,
              public_code: row.existing.public_code,
            })
          }
        }
        if (row.status === 'HUMAN_REVIEW') queued.push(row.candidate_id)
        const problemId =
          created.find((item) => item.candidate_id === row.candidate_id)?.problem_id ??
          recorded.find((item) => item.candidate_id === row.candidate_id)?.problem_id ??
          row.existing?.problem_id ??
          null
        const item = await staff.rpc(ITEM_RPC, {
          payload: {
            pipeline_run_id: runId,
            candidate_id: row.candidate_id,
            stage: STAGE,
            status: row.status,
            reasons: row.reasons,
            assigned_by: ASSIGNED_BY,
            fingerprint: {
              problem_id: problemId,
              persist_action: row.persist_action,
              content_fingerprint: row.content_fingerprint,
            },
          },
        })
        if (item.error) failed.push({ candidate_id: row.candidate_id, error: `pipeline item: ${item.error.message}` })
      } catch (error) {
        failed.push({ candidate_id: row.candidate_id, error: error instanceof Error ? error.message : 'persist_failed' })
      }
    }
  }
  return {
    ran: true,
    created,
    existing: recorded,
    queued,
    failed,
    pipeline_run_id: runId,
    queued_review: queued.length,
    submitted_needs_review: submitted,
  }
}

function emptyStructure(): BookStructure {
  return {
    subject: '공통수학1',
    source: 'ssen-common-math1.pdf',
    major_units: [],
    sections: [],
    theory_headings: [],
    conflicts: [],
    uncertain: [],
  }
}

export async function runStep832(root: string, argv: string[]): Promise<Step832Summary> {
  loadEnvLocal(root)
  loadAnonKey()
  const gate = parsePaidGate(argv)
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) throw new Error('paid OCR routing must stay false in STEP 8.32')
  const persistRequested = argv.includes('--persist')
  const probe = argv.includes('--probe-production') || persistRequested
  const fromRaw = argv.find((row) => row.startsWith('--from-page='))?.slice('--from-page='.length)
  const toRaw = argv.find((row) => row.startsWith('--to-page='))?.slice('--to-page='.length)
  const fromPage = Math.max(1, Number(fromRaw ?? '1') || 1)
  const toPage = Math.min(STEP832_PAGE_COUNT, Number(toRaw ?? String(STEP832_PAGE_COUNT)) || STEP832_PAGE_COUNT)
  const dest = path.join(root, STEP832_DIR)
  mkdirSync(dest, { recursive: true })
  mkdirSync(path.join(root, CACHE_DIR), { recursive: true })

  const pdf = await downloadOriginalPdf(root)
  const original = {
    present: Boolean(pdf),
    path: pdf ? path.relative(root, pdf.path) : null,
    sha256: pdf?.sha256 ?? null,
    hash_match: pdf?.sha256 === STEP832_PDF_SHA256,
  }
  if (pdf && original.hash_match) {
    const dataPdf = path.join(root, 'workers/ocr/data/ssen-common-math1.pdf')
    mkdirSync(path.dirname(dataPdf), { recursive: true })
    if (!existsSync(dataPdf)) copyFileSync(pdf.path, dataPdf)
  }

  const gtPath = path.join(root, GT_PATH)
  const gtBefore = existsSync(gtPath) ? sha256File(gtPath) : null
  const gtMutated = gtBefore != null && gtBefore !== GT_JSON_SHA256 ? true : false
  if (gtMutated) throw new Error('STEP 8.32 must not mutate ground-truth.json')

  const shouldRender = Boolean(pdf && original.hash_match && (!gate.cacheOnly || argv.includes('--render')))
  let inventory = loadPageInventory(root)
  const needRender =
    shouldRender &&
    [...Array(toPage - fromPage + 1).keys()].some((i) => !existsSync(pagePng(root, fromPage + i)))
  if (needRender && pdf) {
    renderPages(root, pdf.path, fromPage, toPage)
    inventory = loadPageInventory(root)
  }

  const calls = { mistral: 0 }
  const pages: PageRecord[] = []
  const pageTexts: Array<{ page: number; text: string }> = []
  const rawCandidates: BookItem[] = []
  const blockedPages: BookItem[] = []

  const processBook =
    original.hash_match &&
    (!gate.cacheOnly || argv.includes('--full-cache') || persistRequested || argv.includes('--allow-paid-api'))

  if (processBook && original.hash_match) {
    for (let page = fromPage; page <= toPage; page += 1) {
      const ocr = await ocrPage({ root, page, gate, calls })
      const meta = inventory.get(page)
      const anchors = countAnchorsFromText(ocr.markdown)
      const classified = classifyBookPageV2({
        page_number: page,
        total_pages: STEP832_PAGE_COUNT,
        ink_ratio: meta?.ink_ratio ?? null,
        ocr_failed: Boolean(ocr.called && ocr.error && !ocr.markdown),
        has_ocr: ocr.markdown.trim().length > 0,
        cache_text: ocr.markdown,
        four_digit_count: anchors.four_digit,
        section_count: anchors.section,
        block_count: ocr.raw ? mistralLayoutFromRaw(ocr.raw).blocks.length : 0,
        image_count: ocr.raw ? (ocr.raw.pages?.[0]?.images ?? []).length : 0,
      })
      const excluded =
        isFrontMatterPage(page, ocr.markdown) ||
        (isExcludedPageKind(classified.page_kind) && classified.page_kind !== 'UNKNOWN' && classified.page_kind !== 'OCR_FAILED')
      pages.push({
        page,
        kind: classified.page_kind,
        excluded,
        ocr_cached: ocr.cached,
        ocr_called: ocr.called,
        http: ocr.http,
        text_length: ocr.markdown.length,
        ink_ratio: meta?.ink_ratio ?? null,
        error: ocr.error,
      })
      if (ocr.markdown) pageTexts.push({ page, text: ocr.markdown })
      if ((page - fromPage + 1) % PAGE_OCR_BATCH === 0) {
        writeJson(path.join(root, CACHE_DIR), 'checkpoint.json', {
          last_page: page,
          mistral_calls: calls.mistral,
          pages_done: pages.length,
        })
        console.log(`STEP 8.32 checkpoint page ${page}/${toPage} mistral=${calls.mistral}`)
      }
      if (excluded) continue
      if (classified.page_kind === 'OCR_FAILED' || (ocr.error && !ocr.markdown && problemPageKind(classified.page_kind))) {
        const dummy: NormalizedBBox = { x: 0.05, y: 0.05, width: 0.9, height: 0.9, unit: 'normalized', origin: 'top-left' }
        blockedPages.push({
          candidate_id: `${page}|OCR_FAILED`,
          source_document_id: STEP832_DOCUMENT,
          page,
          page_kind: classified.page_kind,
          problem_number: 'OCR_FAILED',
          canonical: null,
          bbox: dummy,
          crop_present: false,
          crop_sha256: null,
          text: '',
          stem: '',
          choice_count: 0,
          math: [],
          has_figure: false,
          has_table: false,
          status: 'BLOCKED',
          persist_action: 'SKIP_BLOCKED',
          reasons: ['NO_VERIFIED', 'OCR_FAILED', ocr.error ?? 'ocr_failed'],
          existing: null,
          stitched_from_page: null,
          classification: { unit_id: '미정', type_id: 'TYPE_UNCLEAR', difficulty_level: null, overall: 'REVIEW', review_reasons: ['OCR_FAILED'] },
          content_fingerprint: contentFingerprint(`${page}|OCR_FAILED`),
        })
        continue
      }
      if (!problemPageKind(classified.page_kind) && classified.page_kind !== 'OCR_FAILED') continue
      const layout = layoutForPage(ocr.raw, ocr.markdown, { width: meta?.width ?? 1000, height: meta?.height ?? 1400 })
      const segmented = segmentPageFromLayout(layout)
      const problemRegions = segmented.regions.filter((region) => region.kind === 'four_digit')
      if (problemRegions.length === 0 && (classified.page_kind === 'PROBLEM' || classified.page_kind === 'MIXED')) {
        const dummy: NormalizedBBox = { x: 0.05, y: 0.05, width: 0.9, height: 0.9, unit: 'normalized', origin: 'top-left' }
        blockedPages.push({
          candidate_id: `${page}|UNIDENTIFIED`,
          source_document_id: STEP832_DOCUMENT,
          page,
          page_kind: classified.page_kind,
          problem_number: 'UNIDENTIFIED',
          canonical: null,
          bbox: dummy,
          crop_present: false,
          crop_sha256: null,
          text: ocr.markdown.slice(0, 400),
          stem: '',
          choice_count: 0,
          math: [],
          has_figure: false,
          has_table: false,
          status: 'BLOCKED',
          persist_action: 'SKIP_BLOCKED',
          reasons: ['NO_VERIFIED', 'REGION_UNIDENTIFIED'],
          existing: null,
          stitched_from_page: null,
          classification: { unit_id: '미정', type_id: 'TYPE_UNCLEAR', difficulty_level: null, overall: 'REVIEW', review_reasons: ['REGION_UNIDENTIFIED'] },
          content_fingerprint: contentFingerprint(`${page}|UNIDENTIFIED`),
        })
        continue
      }
      for (const region of problemRegions) {
        let bbox: NormalizedBBox
        try {
          bbox = validateBBox(region.bbox)
        } catch {
          continue
        }
        const regionText = extractOverlappingText(layout.blocks, bbox) || region.preview || ''
        const structured = structureFromRegionText(regionText)
        const canonical = canonicalizeProblemNumber(region.detected_problem_number)
        const id = candidateIdFor(page, canonical, `${region.detected_problem_number || 'unk'}-${Math.round(bbox.y * 1000)}`)
        rawCandidates.push({
          candidate_id: id,
          source_document_id: STEP832_DOCUMENT,
          page,
          page_kind: classified.page_kind,
          problem_number: region.detected_problem_number,
          canonical,
          bbox,
          crop_present: false,
          crop_sha256: null,
          text: regionText || structured.stem,
          stem: structured.stem,
          choice_count: structured.choice_count,
          math: structured.math,
          has_figure: structured.has_figure || region.assigned_images.length > 0,
          has_table: structured.has_table,
          status: 'HUMAN_REVIEW',
          persist_action: 'SKIP_IDENTITY',
          reasons: [],
          existing: null,
          stitched_from_page: null,
          classification: { unit_id: '미정', type_id: 'TYPE_UNCLEAR', difficulty_level: null, overall: 'REVIEW', review_reasons: [] },
          content_fingerprint: contentFingerprint(regionText || structured.stem || id),
        })
      }
    }
  }

  const stitched = stitchCrossPageProblems(
    rawCandidates.map((row) => ({
      candidate_id: row.candidate_id,
      page: row.page,
      problem_number: row.problem_number,
      canonical: row.canonical,
      bbox: row.bbox,
      text: row.text,
      choice_count: row.choice_count,
      incomplete: row.choice_count < 2 && row.bbox.y + row.bbox.height >= 0.9,
    })),
  )
  const keep = new Map(stitched.map((row) => [row.candidate_id, row]))
  const dropped = new Set(rawCandidates.map((row) => row.candidate_id).filter((id) => !keep.has(id)))
  const merged = rawCandidates.filter((row) => !dropped.has(row.candidate_id)).map((row) => {
    const extra = keep.get(row.candidate_id)
    if (!extra) return row
    const structured = structureFromRegionText(extra.text)
    return {
      ...row,
      text: extra.text,
      stem: structured.stem || row.stem,
      choice_count: extra.choice_count,
      math: structured.math,
      has_figure: structured.has_figure || row.has_figure,
      has_table: structured.has_table || row.has_table,
      stitched_from_page: extra.stitched_from_page,
      content_fingerprint: contentFingerprint(extra.text),
    }
  })

  const bookStructure = pageTexts.length ? buildBookStructure({ pageTexts, lastPage: STEP832_PAGE_COUNT }) : emptyStructure()
  if (merged.length) cropRegions(root, merged)

  const existing =
    persistRequested || probe ? await lookupExistingDrafts() : new Map<string, ExistingDraft832>()
  const lookupComplete = persistRequested ? existing.size >= 10 : true
  const seen = new Set<string>()
  const items: BookItem[] = []
  for (const row of merged) {
    const key = row.canonical ? `${row.page}|${row.canonical}` : row.candidate_id
    const collision = Boolean(row.canonical && seen.has(key))
    if (row.canonical) seen.add(key)
    const found = row.canonical ? existing.get(`${row.page}|${row.canonical}`) ?? null : null
    const rubric = estimateRubricDifficulty({
      stem: row.stem,
      choice_count: row.choice_count,
      math_count: row.math.length,
      figure_hint: row.has_figure,
      graph_hint: /그래프/.test(row.text),
      table_hint: row.has_table,
    })
    const classified = classifyDraftV1({
      problem_id: found?.problem_id ?? row.candidate_id,
      page: row.page,
      problem_number: row.canonical ?? row.problem_number,
      stem: row.stem,
      structure: bookStructure,
      difficulty: rubric,
      thresholds: DEFAULT_V1_THRESHOLDS,
    })
    row.classification = {
      unit_id: classified.unit_id,
      type_id: classified.type_id,
      difficulty_level: classified.difficulty_level,
      overall: classified.classification_status,
      review_reasons: classified.review_reasons,
    }
    const eligibility = mapPersistWithExisting(
      persistEligible832({
        source_document_id: row.source_document_id,
        page: row.page,
        bbox: row.bbox,
        crop_present: row.crop_present,
        text: row.text,
        canonical: row.canonical,
        duplicate_check_ran: persistRequested || probe ? true : !persistRequested,
        identity_collision: collision,
        auto_approved: false,
      }),
      found,
    )
    row.existing = found
    row.persist_action = eligibility.action
    row.status = pipelineStatusFor(eligibility.action)
    row.reasons = [
      ...eligibility.reasons,
      ...reviewReasonsFor({
        choice_count: row.choice_count,
        math: row.math,
        has_figure: row.has_figure,
        classification_review: classified.classification_status !== 'AUTO',
        stitched: row.stitched_from_page != null,
        ocr_uncertain: !humanReadableContent(row.stem, 24),
        segmentation_status: 'REVIEW',
        anchor_kind: /^\d{4}$/.test(row.problem_number) ? 'four_digit' : null,
      }),
    ]
    items.push(row)
  }
  items.push(...blockedPages)

  const tally = emptyTally832()
  tally.pages_processed = pages.length || (original.hash_match && !gate.cacheOnly ? toPage - fromPage + 1 : pages.length)
  tally.pages_excluded = pages.filter((row) => row.excluded).length
  tally.problems_found = merged.length
  tally.create_draft = items.filter((row) => row.persist_action === 'CREATE_DRAFT').length
  tally.record_existing = items.filter((row) => row.persist_action === 'RECORD_EXISTING').length
  tally.needs_review = items.filter((row) => row.status === 'HUMAN_REVIEW').length
  tally.blocked = items.filter((row) => row.status === 'BLOCKED').length
  tally.skipped_duplicate = items.filter((row) => row.persist_action === 'SKIP_DUPLICATE' || row.persist_action === 'RECORD_EXISTING').length
  tally.skipped_identity = items.filter((row) => row.persist_action === 'SKIP_IDENTITY').length
  tally.auto_approved = 0

  const duplicateIds = inBatchDuplicates(items.filter((row) => row.canonical).map((row) => `${row.page}|${row.canonical}`))
  const wrongSource = items.filter((row) => row.source_document_id !== STEP832_DOCUMENT).length
  const orphans = items.filter((row) => row.persist_action === 'CREATE_DRAFT' && !row.canonical).length
  const plan = persistPlanSafe832({
    create_draft: tally.create_draft,
    auto_approved: 0,
    verified: 0,
    duplicate_ids: duplicateIds,
    wrong_source: wrongSource,
    lookup_complete: lookupComplete,
  })

  if (persistRequested && !original.hash_match) {
    throw new Error('persist aborted: original PDF missing or hash mismatch')
  }
  if (persistRequested && !plan.ok) throw new Error(`persist aborted: ${plan.reasons.join(',')}`)

  const before = probe ? await probeProductionCounts() : skippedCounts('no_probe')
  const persist: PersistResult =
    persistRequested && plan.ok
      ? await persistItems(items.filter((row) => row.persist_action === 'CREATE_DRAFT' || row.persist_action === 'RECORD_EXISTING' || row.status === 'HUMAN_REVIEW' || row.status === 'BLOCKED'))
      : { ran: false, created: [], existing: [], queued: [], failed: [], pipeline_run_id: null, queued_review: 0, submitted_needs_review: 0 }
  const after = persist.ran || probe ? await probeProductionCounts() : before

  const gtAfter = existsSync(gtPath) ? sha256File(gtPath) : null
  if (gtAfter && gtAfter !== GT_JSON_SHA256) throw new Error('STEP 8.32 mutated ground-truth.json')

  const targets = projectStep832Targets({
    originalPdfHashMatch: original.hash_match,
    pagesProcessed: pages.length,
    persisted: persist.ran,
    verifiedWrites: 0,
    autoApproved: 0,
  })
  const results = {
    PASS: targets.filter((row) => row.verdict === 'PASS').length,
    REVIEW: targets.filter((row) => row.verdict === 'REVIEW').length,
    BLOCKED: targets.filter((row) => row.verdict === 'BLOCKED').length,
  }
  const status: Step832Summary['status'] = !original.present
    ? 'BLOCKED'
    : persist.ran
      ? 'PERSISTED'
      : pages.length > 0
        ? 'PROCESSED'
        : 'CACHE_ONLY_PLANNED'

  const ledger = mergePaidLedger(root, calls.mistral)
  const summary: Step832Summary = {
    step: STEP832,
    name: 'Full 192-page SSEN ingest to Production DRAFT',
    status,
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP832_DOCUMENT, title: STEP832_DOCUMENT_TITLE },
    executed: pages.length > 0,
    pages_processed: pages.length,
    pages_excluded: tally.pages_excluded,
    problems_found: tally.problems_found,
    production_problem_writes: persist.created.length,
    production_figure_writes: 0,
    production_verified_writes: 0,
    production_pipeline_writes: { runs: persist.ran ? 1 : 0, items: persist.ran ? items.length : 0 },
    production_draft_writes: persist.created.length,
    production_counts_before: before,
    production_counts_after: after,
    paid_api_calls: {
      mathpix: 0,
      mistral: calls.mistral,
      mistral_cached: pages.filter((row) => row.ocr_cached).length,
    },
    paid_ocr_cap: { max_calls: STEP832_PAID_OCR_CAP.maxCalls, max_usd: STEP832_PAID_OCR_CAP.maxUsd },
    estimated_usd: ledger.usd,
    mistral_credentials: hasMistralCredentials() ? 'PRESENT' : 'ABSENT',
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: original,
    tally,
    persist_plan_ok: plan.ok,
    persist_plan_reasons: plan.reasons,
    persist,
    duplicates: duplicateIds.length,
    orphans,
    wrong_source: wrongSource,
    gt_mutated: false,
    content_rewrites: 0,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      page: row.page,
      persist_action: row.persist_action,
      status: row.status,
      reasons: row.reasons,
      canonical: row.canonical,
    })),
    results,
  }

  const skipCacheOnlyOverwrite =
    gate.cacheOnly &&
    !persistRequested &&
    existsSync(path.join(dest, 'persist-history.json'))
  if (skipCacheOnlyOverwrite) return summary

  writeJson(dest, 'summary.json', summary)
  writeJson(dest, 'pages.json', { pages })
  writeJson(dest, 'items.json', {
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      page: row.page,
      page_kind: row.page_kind,
      problem_number: row.problem_number,
      canonical: row.canonical,
      persist_action: row.persist_action,
      status: row.status,
      reasons: row.reasons,
      crop_present: row.crop_present,
      crop_sha256: row.crop_sha256,
      choice_count: row.choice_count,
      has_figure: row.has_figure,
      has_table: row.has_table,
      stitched_from_page: row.stitched_from_page,
      classification: row.classification,
      stem_preview: row.stem.slice(0, 240),
      existing: row.existing,
      content_fingerprint: row.content_fingerprint,
    })),
  })
  writeJson(dest, 'targets.json', { targets })
  writeJson(dest, 'tally.json', tally)
  writeJson(dest, 'ocr-cost.json', {
    mistral_calls: ledger.mistral,
    mistral_cached: pages.filter((row) => row.ocr_cached).length,
    mathpix_calls: 0,
    estimated_usd: ledger.usd,
    cap: STEP832_PAID_OCR_CAP,
    credentials: { mistral: hasMistralCredentials() ? 'PRESENT' : 'ABSENT', mathpix: 'ABSENT' },
  })
  if ((!existsSync(path.join(dest, 'production-before.json')) && (persist.ran || probe)) || argv.includes('--reset-production-snapshot')) {
    writeJson(dest, 'production-before.json', before)
  }
  if (persist.ran || probe || !existsSync(path.join(dest, 'production-after.json'))) {
    writeJson(dest, 'production-after.json', after)
  }
  if (persist.ran) {
    const historyPath = path.join(dest, 'persist-history.json')
    const previous = existsSync(historyPath)
      ? (JSON.parse(readFileSync(historyPath, 'utf8')) as { new_drafts?: number; runs?: unknown[] })
      : { new_drafts: 0, runs: [] }
    const history = {
      production_drafts_start: 761,
      new_drafts: (previous.new_drafts ?? 0) + persist.created.length,
      production_drafts_end: after.drafts,
      needs_review_end: after.needs_review,
      figure_assets: after.figure_assets,
      figure_links: after.figure_links,
      type_auto: after.type_auto,
      mistral_lifetime: ledger.mistral,
      estimated_usd: ledger.usd,
      last_created: persist.created.length,
      idempotent: persist.created.length === 0 && (previous.new_drafts ?? 0) > 0,
      runs: [
        ...((previous.runs as unknown[]) ?? []),
        {
          created: persist.created.length,
          existing: persist.existing.length,
          failed: persist.failed.length,
          drafts_before: before.drafts,
          drafts_after: after.drafts,
        },
      ],
    }
    writeJson(dest, 'persist-history.json', history)
    writeJson(dest, 'persist-result.json', {
      ran: true,
      pipeline_run_id: persist.pipeline_run_id,
      created: persist.created,
      existing: persist.existing,
      queued: persist.queued,
      failed: persist.failed,
      submitted_needs_review: persist.submitted_needs_review,
      production_before: before,
      production_after: after,
      cumulative_new_drafts: history.new_drafts,
    })
  } else if (!existsSync(path.join(dest, 'persist-result.json'))) {
    writeJson(dest, 'persist-result.json', { ran: false, created: [], note: 'persist-result is written only on --persist' })
  }
  const md = [
    '# STEP 8.32 FULL SSEN 192-PAGE INGEST',
    '',
    `STEP 8.32 RESULT: ${summary.status}`,
    `NAME: ${summary.name}`,
    `TARGET REF: ${summary.target_ref} (hyper-student-care NOT accessed)`,
    '',
    `textbook: ${STEP832_DOCUMENT_TITLE}`,
    `source_document_id: ${STEP832_DOCUMENT}`,
    `pages processed: ${summary.pages_processed}`,
    `pages excluded: ${summary.pages_excluded}`,
    `problems found: ${summary.problems_found}`,
    `create_draft: ${tally.create_draft}`,
    `record_existing / skipped duplicate: ${tally.record_existing} / ${tally.skipped_duplicate}`,
    `NEEDS_REVIEW / HUMAN_REVIEW: ${tally.needs_review}`,
    `BLOCKED: ${tally.blocked}`,
    `skipped identity: ${tally.skipped_identity}`,
    `AUTO_APPROVED: 0`,
    `mistral new/cached/lifetime: ${summary.paid_api_calls.mistral}/${summary.paid_api_calls.mistral_cached}/${ledger.mistral}`,
    `estimated USD: ${summary.estimated_usd}`,
    `Production drafts before/after: ${before.drafts}/${after.drafts}`,
    `new DRAFT writes: ${summary.production_draft_writes}`,
    `verified writes: 0`,
    `figure writes: 0`,
    `gt mutated: false`,
    `duplicates: ${summary.duplicates}`,
    `orphans: ${summary.orphans}`,
    `wrong source: ${summary.wrong_source}`,
    '',
    'Do not auto-merge. Do not set VERIFIED.',
  ].join('\n')
  writeFileSync(path.join(dest, 'step8-32-summary.md'), md, 'utf8')
  return summary
}
