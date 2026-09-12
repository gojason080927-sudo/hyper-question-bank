/**
 * STEP 8.31 runner — confidence gate on cached 8.28–8.30 artifacts.
 * Recover crops from a hash-checked original PDF + declared bbox only.
 * Default: cache-only, 0 paid OCR, 0 problem writes. --persist queues pipeline_items.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { parsePaidGate } from '../ocr/paidGate'
import { hasMistralCredentials } from '../ocr/mistralSecrets'
import { FROZEN_PIPELINE_COUNTS, QUESTION_BANK_REF, STUDENT_CARE_REF } from './batchPipeline825'
import { ITEM_RPC, RUN_RPC } from './pipelineJob826'
import { canonicalizeProblemNumber } from '../recognition/draftUpsert'
import { EXPECTED_GT_COUNT, GT_PATH, MANIFEST_PATH, STEP828_GT_SHA256, parseGtFile } from './structureFromCache828'
import {
  STEP828_ITEMS_PATH,
  STEP829_REVIEWS_PATH,
  parseManifestFile,
  type Step829ReviewInput,
} from './imageCompare830'
import type { Step828CachedItem } from './dualAiReview829'
import {
  ASSIGNED_BY,
  CROP_CACHE_DIR,
  STAGE,
  STEP830_COMPARES_PATH,
  STEP831,
  STEP831_DIR,
  STEP831_DOCUMENT,
  STEP831_DOCUMENT_TITLE,
  STEP831_PAGE_COUNT,
  STEP831_PAID_OCR_CAP,
  STEP831_PDF_SHA256,
  STORAGE_BUCKET,
  STORAGE_ORIGINAL,
  buildGateItem,
  denyPaidOcr831,
  emptyGateInventory,
  emptyRecoveredCrop,
  evaluateDryRun,
  findDuplicateCandidateIds,
  findOrphanItems,
  findWrongSourceItems,
  persistPlanSafe,
  progressFromItems,
  progressMatchesItems,
  projectStep831Targets,
  tallyGate,
  tallyVerdicts,
  type CachedOcrEvidence,
  type ExistingDraft,
  type GateItem,
  type RecoveredCrop,
} from './confidenceGate831'

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
  pipeline_run_id: string | null
  queued_review: number
}

export type Step831Summary = {
  step: '8.31'
  name: string
  status: 'CACHE_ONLY_GATED' | 'PERSISTED' | 'CACHE_ONLY_BLOCKED'
  target_ref: string
  student_care_accessed: boolean
  next_step_started: false
  textbook: { id: string; title: string }
  executed: boolean
  execution_count: 0 | 1
  production_problem_writes: number
  production_figure_writes: 0
  production_verified_writes: 0
  production_pipeline_writes: { runs: 0 | 1; items: number }
  production_draft_writes: number
  production_counts: ProductionCounts
  paid_api_calls: { mathpix: 0; mistral: 0; mistral_cached: number }
  paid_ocr_cap: { max_calls: 0; max_usd: 0 }
  mistral_credentials: 'PRESENT' | 'ABSENT'
  frozen: typeof FROZEN_PIPELINE_COUNTS
  original_pdf: ReturnType<typeof emptyGateInventory>['original_pdf']
  dry_run: ReturnType<typeof evaluateDryRun>
  items: GateItem[]
  progress: ReturnType<typeof progressFromItems>
  progress_matches_items: boolean
  tally: ReturnType<typeof tallyGate>
  persist_plan_ok: boolean
  persist_plan_reasons: string[]
  persist: PersistResult
  duplicates: number
  orphans: number
  wrong_source: number
  gt_mutated: boolean
  content_rewrites: 0
  targets: ReturnType<typeof projectStep831Targets>
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

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function countExact(
  admin: NonNullable<ReturnType<typeof adminClient>>,
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
      type_auto: await countExact(admin, 'problem_classification_meta', {
        classification_status: 'AUTO',
      }),
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

async function downloadOriginalPdf(root: string): Promise<{ path: string; sha256: string; bytes: number } | null> {
  const dest = path.join(root, '.ocr-temp/ssen-original.pdf')
  const tmp = '/tmp/hqb-ssen-ocr/original.pdf'
  const existing = existsSync(dest) ? dest : existsSync(tmp) ? tmp : null
  if (existing) {
    const hash = sha256File(existing)
    if (hash !== STEP831_PDF_SHA256) throw new Error('SSEN original PDF hash mismatch')
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
  if (hash !== STEP831_PDF_SHA256) throw new Error('downloaded PDF is not the frozen SSEN original')
  mkdirSync(path.dirname(dest), { recursive: true })
  mkdirSync('/tmp/hqb-ssen-ocr', { recursive: true })
  writeFileSync(dest, buf)
  writeFileSync(tmp, buf)
  return { path: dest, sha256: hash, bytes: buf.length }
}

function generateCrops(root: string, pdfPath: string): RecoveredCrop[] {
  const out = path.join(root, CROP_CACHE_DIR)
  const script = path.join(root, 'scripts/generate-step831-crops.py')
  execFileSync('python3', [script, '--pdf', pdfPath, '--out', out], { cwd: root, stdio: 'inherit' })
  return loadCachedCrops(root) ?? []
}

function loadCachedCrops(root: string): RecoveredCrop[] | null {
  const cropsDir = path.join(root, CROP_CACHE_DIR, 'crops')
  if (!existsSync(cropsDir)) return null
  const manifest = parseManifestFile(JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')))
  const hashPath = path.join(root, CROP_CACHE_DIR, 'crop-hashes.json')
  const hashFile = existsSync(hashPath)
    ? (JSON.parse(readFileSync(hashPath, 'utf8')) as {
        crops: Array<{ sample_id: string; bytes: number; sha256: string; width: number; height: number }>
      })
    : { crops: [] }
  const byId = new Map(hashFile.crops.map((row) => [row.sample_id, row]))
  const recovered = manifest.samples.map((sample) => {
    const rec = byId.get(sample.sample_id)
    const filePath = path.join(cropsDir, `${sample.sample_id}.png`)
    const present = existsSync(filePath)
    const sha = rec?.sha256 ?? (present ? sha256File(filePath) : null)
    const bytes = rec?.bytes ?? (present ? readFileSync(filePath).length : null)
    return {
      sample_id: sample.sample_id,
      present,
      path: present ? `${CROP_CACHE_DIR}/crops/${sample.sample_id}.png` : null,
      sha256: sha,
      bytes,
      width: rec?.width ?? null,
      height: rec?.height ?? null,
      frozen_sha256: sample.crop_sha256,
      frozen_bytes: sample.crop_bytes,
      matches_frozen: Boolean(sha && sha === sample.crop_sha256),
      source_kind: present ? ('recovered_from_original_bbox' as const) : null,
      substituted: false as const,
    }
  })
  if (recovered.some((row) => !row.present)) return null
  return recovered
}

function readOcrCache(root: string, sampleId: string): CachedOcrEvidence {
  const rawPath = path.join(root, CROP_CACHE_DIR, 'mistral', `${sampleId}.json`)
  if (!existsSync(rawPath)) {
    return { present: false, cached: false, provider: null, text: '', http: null }
  }
  const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as {
    pages?: Array<{ markdown?: string }>
    raw_text?: string
  }
  const text =
    typeof raw.raw_text === 'string' && raw.raw_text.trim()
      ? raw.raw_text
      : (raw.pages ?? []).map((page) => page.markdown ?? '').join('\n')
  return {
    present: text.trim().length > 0,
    cached: true,
    provider: 'mistral-ocr',
    text,
    http: 200,
  }
}

function publishReviewCrops(root: string) {
  const src = path.join(root, CROP_CACHE_DIR, 'crops')
  const dest = path.join(root, 'public/review-crops')
  if (!existsSync(src)) return
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (name.endsWith('.png')) copyFileSync(path.join(src, name), path.join(dest, name))
  }
}

async function lookupExistingDrafts(): Promise<Map<string, ExistingDraft>> {
  const found = new Map<string, ExistingDraft>()
  const admin = adminClient()
  if (!admin) return found
  const { data: pages, error: pageError } = await admin
    .from('source_pages')
    .select('id,page_number')
    .eq('source_document_id', STEP831_DOCUMENT)
    .in('page_number', [8, 12, 20, 36, 60, 96, 132, 156])
  if (pageError || !pages) return found
  const { data: sources, error: sourceError } = await admin
    .from('problem_sources')
    .select('problem_id, original_problem_number, source_page_id')
    .eq('source_document_id', STEP831_DOCUMENT)
    .in(
      'source_page_id',
      pages.map((row) => row.id),
    )
  if (sourceError || !sources) return found
  const { data: problems } = await admin
    .from('problems')
    .select('id, public_code, review_status, lifecycle_status, current_version_id')
    .in(
      'id',
      sources.map((row) => row.problem_id),
    )
  const pmap = new Map((problems ?? []).map((row) => [row.id, row]))
  for (const row of sources) {
    const page = pages.find((item) => item.id === row.source_page_id)?.page_number
    const canon = (row.original_problem_number ?? '').replace(/\s+/g, '').padStart(4, '0')
    const problem = pmap.get(row.problem_id)
    if (!page || !problem) continue
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

function inventoryCaches(root: string) {
  const inventory = emptyGateInventory()
  const itemsPath = path.join(root, STEP828_ITEMS_PATH)
  const reviewsPath = path.join(root, STEP829_REVIEWS_PATH)
  const comparesPath = path.join(root, STEP830_COMPARES_PATH)
  const gtPath = path.join(root, GT_PATH)
  const manifestPath = path.join(root, MANIFEST_PATH)
  let cached: Step828CachedItem[] = []
  let reviews: Step829ReviewInput[] = []
  let step830Pass = new Map<string, boolean>()
  let samples: ReturnType<typeof parseManifestFile>['samples'] = []
  if (existsSync(manifestPath)) {
    samples = parseManifestFile(JSON.parse(readFileSync(manifestPath, 'utf8'))).samples
    inventory.manifest_present = true
    inventory.manifest_count = samples.length
  }
  if (existsSync(itemsPath)) {
    const parsed = JSON.parse(readFileSync(itemsPath, 'utf8')) as { items?: Step828CachedItem[] }
    cached = parsed.items ?? []
    inventory.step828_items_present = true
    inventory.step828_count = cached.length
  }
  if (existsSync(reviewsPath)) {
    const parsed = JSON.parse(readFileSync(reviewsPath, 'utf8')) as { items?: Step829ReviewInput[] }
    reviews = parsed.items ?? []
    inventory.step829_reviews_present = true
    inventory.step829_count = reviews.length
  }
  if (existsSync(comparesPath)) {
    const parsed = JSON.parse(readFileSync(comparesPath, 'utf8')) as {
      items?: Array<{ candidate_id: string; image_compare_pass?: boolean }>
    }
    inventory.step830_compares_present = true
    inventory.step830_count = parsed.items?.length ?? 0
    for (const row of parsed.items ?? []) {
      step830Pass.set(row.candidate_id, row.image_compare_pass === true)
    }
  }
  let gtItems: ReturnType<typeof parseGtFile>['items'] = []
  if (existsSync(gtPath)) {
    const raw = readFileSync(gtPath)
    const gtFile = parseGtFile(JSON.parse(raw.toString('utf8')))
    gtItems = gtFile.items
    inventory.gt_present = true
    inventory.gt_count = gtFile.items.length
    inventory.gt_sha256 = createHash('sha256').update(raw).digest('hex')
    inventory.gt_sha256_after = inventory.gt_sha256
  }
  return { inventory, cached, reviews, gtItems, samples, step830Pass }
}

async function persistQueue(items: GateItem[]): Promise<PersistResult> {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anon = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !anon || !service) throw new Error('persist requires URL, anon, and service role')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `step831.gate.${Date.now()}@hyper.local`
  const password = `Gate-${Date.now()}aA1!`
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createdUser.error || !createdUser.data.user) throw new Error(createdUser.error?.message ?? 'create staff')
  await admin.from('user_profiles').upsert({
    user_id: createdUser.data.user.id,
    role: 'TEACHER',
    display_name: 'STEP 8.31 gate',
  })
  const staff = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await staff.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error(login.error.message)
  const run = await staff.rpc(RUN_RPC, {
    payload: {
      source_document_id: STEP831_DOCUMENT,
      actor: ASSIGNED_BY,
      assigned_by: ASSIGNED_BY,
    },
  })
  if (run.error) throw new Error(`pipeline run: ${run.error.message}`)
  const runId = (run.data as { run_id: string }).run_id
  const created: PersistCreated[] = []
  const recorded: PersistExisting[] = []
  const queued: string[] = []
  for (const row of items) {
    if (row.persist_action === 'CREATE_DRAFT') {
      throw new Error(`${row.candidate_id}: CREATE_DRAFT is not expected without §D AUTO_APPROVED`)
    }
    if (row.persist_action === 'RECORD_EXISTING' && row.existing) {
      if (row.existing.review_status === 'VERIFIED') {
        throw new Error(`${row.candidate_id} persist aborted: existing VERIFIED must not be rewritten`)
      }
      recorded.push({
        candidate_id: row.candidate_id,
        problem_id: row.existing.problem_id,
        version_id: row.existing.current_version_id,
        public_code: row.existing.public_code,
      })
    }
    if (row.status === 'HUMAN_REVIEW') queued.push(row.candidate_id)
    const problemId =
      recorded.find((item) => item.candidate_id === row.candidate_id)?.problem_id ?? row.existing?.problem_id ?? null
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
          crop_sha256: row.crop.sha256,
          persist_action: row.persist_action,
        },
      },
    })
    if (item.error) throw new Error(`pipeline item ${row.candidate_id}: ${item.error.message}`)
  }
  return {
    ran: true,
    created,
    existing: recorded,
    queued,
    pipeline_run_id: runId,
    queued_review: queued.length,
  }
}

export async function runStep831(root: string, argv: string[]): Promise<Step831Summary> {
  const gate = parsePaidGate(argv)
  if (argv.includes('--allow-paid-api') || gate.allowPaidApi) {
    throw new Error('STEP 8.31 forbids paid OCR')
  }
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) {
    throw new Error('paid OCR routing must stay false in STEP 8.31')
  }
  loadAnonKey()
  denyPaidOcr831()

  const persistRequested = argv.includes('--persist')
  const { inventory, cached, reviews, gtItems, samples, step830Pass } = inventoryCaches(root)
  const pdf = await downloadOriginalPdf(root)
  if (pdf) {
    inventory.original_pdf = {
      present: true,
      path: path.relative(root, pdf.path),
      sha256: pdf.sha256,
      hash_match: pdf.sha256 === STEP831_PDF_SHA256,
      is_second_book: false,
      substituted: false,
    }
  }

  let crops = loadCachedCrops(root)
  if ((!crops || crops.some((row) => !row.present)) && pdf && inventory.original_pdf.hash_match) {
    crops = generateCrops(root, pdf.path)
  }
  if (!crops) {
    crops = samples.map((sample) => emptyRecoveredCrop(sample))
  }
  inventory.recovered_crops = crops.filter((row) => row.present).length
  inventory.frozen_hash_matches = crops.filter((row) => row.matches_frozen).length

  const dryRun = evaluateDryRun({
    inventory,
    problemPersistRequested: persistRequested,
    paidApiRequested: false,
    mixedTextbook: inventory.original_pdf.is_second_book,
  })
  const executed = dryRun.pass
  const cachedBy = new Map(cached.map((row) => [row.candidate_id, row]))
  const reviewBy = new Map(reviews.map((row) => [row.candidate_id, row]))
  const sampleBy = new Map(samples.map((row) => [row.sample_id, row]))
  const cropBy = new Map(crops.map((row) => [row.sample_id, row]))
  const siblingsByPage = new Map<number, typeof samples>()
  for (const sample of samples) {
    const list = siblingsByPage.get(sample.page_number) ?? []
    list.push(sample)
    siblingsByPage.set(sample.page_number, list)
  }

  const existing =
    persistRequested || argv.includes('--probe-production') ? await lookupExistingDrafts() : new Map<string, ExistingDraft>()

  const items: GateItem[] = []
  const ocrBy = new Map<string, CachedOcrEvidence>()
  if (executed) {
    for (const gt of gtItems) {
      const cachedItem = cachedBy.get(gt.sample_id)
      const review = reviewBy.get(gt.sample_id)
      const sample = sampleBy.get(gt.sample_id)
      const crop = cropBy.get(gt.sample_id) ?? emptyRecoveredCrop({
        sample_id: gt.sample_id,
        crop_sha256: '',
        crop_bytes: 0,
      })
      if (!cachedItem || !review || !sample) throw new Error(`STEP 8.31 missing cache for ${gt.sample_id}`)
      const ocr = readOcrCache(root, gt.sample_id)
      ocrBy.set(gt.sample_id, ocr)
      const canon = canonicalizeProblemNumber(gt.problem_number)
      const key = canon ? `${gt.page_number}|${canon}` : ''
      const siblings = (siblingsByPage.get(sample.page_number) ?? [])
        .filter((other) => other.sample_id !== sample.sample_id)
        .map((other) => other.bbox)
      items.push(
        buildGateItem({
          gt,
          cached: cachedItem,
          review,
          sample,
          crop,
          ocr,
          existing: key ? existing.get(key) ?? null : null,
          siblingBboxes: siblings,
          step830ImageComparePass: step830Pass.get(gt.sample_id) === true,
        }),
      )
    }
  }

  const gtPath = path.join(root, GT_PATH)
  if (existsSync(gtPath)) {
    inventory.gt_sha256_after = sha256File(gtPath)
    inventory.mutated = inventory.gt_sha256_after !== inventory.gt_sha256
  }
  if (inventory.mutated) throw new Error('STEP 8.31 must not mutate ground-truth.json')

  const plan = persistPlanSafe(items)
  const tally = tallyGate(items)
  if (persistRequested && !plan.ok) throw new Error(`persist aborted: ${plan.reasons.join(',')}`)
  if (persistRequested && tally.create_draft > 0) {
    throw new Error(`persist aborted: CREATE_DRAFT ${tally.create_draft} without §D AUTO_APPROVED`)
  }
  if (persistRequested && tally.auto_approved > 0) {
    throw new Error('persist aborted: AUTO_APPROVED present without frozen image-compare pass')
  }

  publishReviewCrops(root)

  const before =
    argv.includes('--probe-production') || persistRequested
      ? await probeProductionCounts()
      : skippedCounts('cache-only_no_probe')
  const persist: PersistResult = persistRequested
    ? await persistQueue(items)
    : { ran: false, created: [], existing: [], queued: [], pipeline_run_id: null, queued_review: 0 }
  const after = persistRequested || argv.includes('--probe-production') ? await probeProductionCounts() : before

  const progress = progressFromItems(items)
  const targets = projectStep831Targets({
    dryRun,
    executed,
    originalPdfHashMatch: inventory.original_pdf.hash_match,
    recoveredCrops: inventory.recovered_crops,
    autoApproved: tally.auto_approved,
    createDraft: tally.create_draft,
  })
  const results = tallyVerdicts(targets)
  const duplicates = findDuplicateCandidateIds(items)
  const orphans = findOrphanItems(items, STEP831_DOCUMENT)
  const wrongSource = findWrongSourceItems(items)

  const summary: Step831Summary = {
    step: STEP831,
    name: 'Confidence gate + DRAFT persist + HUMAN_REVIEW queue',
    status: persist.ran ? 'PERSISTED' : executed ? 'CACHE_ONLY_GATED' : 'CACHE_ONLY_BLOCKED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP831_DOCUMENT, title: STEP831_DOCUMENT_TITLE },
    executed,
    execution_count: executed ? 1 : 0,
    production_problem_writes: persist.created.length,
    production_figure_writes: 0,
    production_verified_writes: 0,
    production_pipeline_writes: {
      runs: persist.ran ? 1 : 0,
      items: persist.ran ? items.length : 0,
    },
    production_draft_writes: persist.created.length,
    production_counts: persist.ran ? after : before,
    paid_api_calls: {
      mathpix: 0,
      mistral: 0,
      mistral_cached: items.filter((row) => row.ocr.cached).length,
    },
    paid_ocr_cap: { max_calls: STEP831_PAID_OCR_CAP.maxCalls, max_usd: STEP831_PAID_OCR_CAP.maxUsd },
    mistral_credentials: hasMistralCredentials() ? 'PRESENT' : 'ABSENT',
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: inventory.original_pdf,
    dry_run: dryRun,
    items,
    progress,
    progress_matches_items: progressMatchesItems(progress, items),
    tally,
    persist_plan_ok: plan.ok,
    persist_plan_reasons: plan.reasons,
    persist,
    duplicates: duplicates.length,
    orphans: orphans.length,
    wrong_source: wrongSource.length,
    gt_mutated: inventory.mutated,
    content_rewrites: 0,
    targets,
    results,
  }

  const dest = path.join(root, STEP831_DIR)
  mkdirSync(dest, { recursive: true })
  writeJson(dest, 'summary.json', {
    ...summary,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      status: row.status,
      reasons: row.reasons,
      page_number: row.page_number,
      problem_number: row.problem_number,
      canonical_number: row.canonical_number,
      persist_action: row.persist_action,
      compared: row.compared,
      image_compare_pass: row.image_compare_pass,
      step830_image_compare_pass: row.step830_image_compare_pass,
      section_d_all_met: row.section_d_all_met,
      dual_would_auto: row.dual_would_auto,
      crop_present: row.crop.present,
      crop_sha256: row.crop.sha256,
      crop_matches_frozen: row.crop.matches_frozen,
      crop_source_kind: row.crop.source_kind,
      ocr: row.ocr,
      checks: row.checks,
      existing: row.existing,
      has_figure: row.has_figure,
      has_table: row.has_table,
      bbox_valid: row.bbox_valid,
      declared_bbox_overlap: row.declared_bbox_overlap,
      content_fingerprint: row.content_fingerprint,
    })),
  })
  writeJson(dest, 'dry-run.json', dryRun)
  writeJson(dest, 'targets.json', { targets })
  writeJson(dest, 'inventory.json', inventory)
  writeJson(dest, 'crop-manifest.json', {
    pdf_sha256: inventory.original_pdf.sha256,
    recovered: crops,
    note: 'Recovered hashes are not written back to corpus-manifest.json',
  })
  const queue = {
    assigned_by: ASSIGNED_BY,
    items: items.map((row) => {
      const recorded = persist.existing.find((item) => item.candidate_id === row.candidate_id)
      const gt = gtItems.find((item) => item.sample_id === row.candidate_id)
      const ocr = ocrBy.get(row.candidate_id)
      const problemId = recorded?.problem_id ?? row.existing?.problem_id ?? null
      const versionId = recorded?.version_id ?? row.existing?.current_version_id ?? null
      return {
        candidate_id: row.candidate_id,
        status: row.status,
        reasons: row.reasons,
        page_number: row.page_number,
        problem_number: row.problem_number,
        canonical_number: row.canonical_number,
        problem_id: problemId,
        version_id: versionId,
        public_code: recorded?.public_code ?? row.existing?.public_code ?? null,
        persist_action: row.persist_action,
        checks: row.checks,
        crop_url: `/review-crops/${row.candidate_id}.png`,
        review_path: problemId ? `/questions/${problemId}/review` : null,
        has_figure: row.has_figure,
        has_table: row.has_table,
        choices: gt?.ground_truth_choices ?? [],
        math: gt?.ground_truth_math ?? [],
        stem_preview: (gt?.ground_truth_text ?? '').slice(0, 400),
        ocr_preview: (ocr?.text ?? '').slice(0, 400),
      }
    }),
  }
  writeJson(dest, 'review-queue.json', queue)
  mkdirSync(path.join(root, 'public'), { recursive: true })
  writeFileSync(path.join(root, 'public/review-queue.json'), JSON.stringify(queue, null, 2), 'utf8')
  writeJson(dest, 'production-before.json', before)
  writeJson(dest, 'production-after.json', after)
  writeJson(dest, 'production-readonly.json', persist.ran ? after : before)
  const persistResultPath = path.join(dest, 'persist-result.json')
  if (persist.ran) {
    writeJson(dest, 'persist-result.json', {
      ran: true,
      pipeline_run_id: persist.pipeline_run_id,
      queued_review: persist.queued_review,
      queued: persist.queued,
      created: persist.created,
      existing: persist.existing,
      production_before: before,
      production_after: after,
      production_problem_writes: persist.created.length,
      production_figure_writes: 0,
      production_verified_writes: 0,
      content_rewrites: 0,
      duplicates: duplicates.length,
      orphans: orphans.length,
    })
  } else if (!existsSync(persistResultPath)) {
    writeJson(dest, 'persist-result.json', {
      ran: false,
      created: [],
      existing: [],
      note: 'cache-only; persist-result is written only on --persist',
    })
  }
  writeJson(dest, 'gt-lock.json', {
    path: GT_PATH,
    sha256: inventory.gt_sha256,
    sha256_after: inventory.gt_sha256_after,
    expected_sha256: STEP828_GT_SHA256,
    count: inventory.gt_count,
    expected_count: EXPECTED_GT_COUNT,
    mutated: inventory.mutated,
  })
  writeFileSync(
    path.join(dest, 'step8-31-summary.md'),
    `# STEP 8.31 CONFIDENCE GATE + DRAFT PERSIST + HUMAN_REVIEW QUEUE

STEP 8.31 RESULT: ${summary.status}
NAME: ${summary.name}
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

textbook: ${STEP831_DOCUMENT_TITLE}
source_document_id: ${STEP831_DOCUMENT}
pages: ${STEP831_PAGE_COUNT}
assigned_by: ${ASSIGNED_BY}

executed: ${executed}
execution count: ${summary.execution_count}
dry-run pass: ${dryRun.pass}
dry-run blockers: ${dryRun.blockers.join(', ') || '(none)'}

crop recovered/missing: ${tally.crop_present}/${tally.crop_missing}
frozen STEP 7 hash match: ${tally.frozen_hash_match}
compared: ${tally.compared}
AUTO_APPROVED/HUMAN_REVIEW/BLOCKED: ${tally.auto_approved}/${tally.human_review}/${tally.blocked}
create_draft/record_existing/queue_only/skip_blocked/skip_identity: ${tally.create_draft}/${tally.record_existing}/${tally.queue_only}/${tally.skip_blocked}/${tally.skip_identity}
progress matches items: ${summary.progress_matches_items}
persist plan ok: ${plan.ok}
duplicates: ${summary.duplicates}
orphans: ${summary.orphans}
wrong source: ${summary.wrong_source}
gt mutated: ${inventory.mutated}
content rewrites: 0

Production problem writes: ${persist.created.length}
production figure writes: 0
production verified writes: 0
production pipeline writes: runs=${summary.production_pipeline_writes.runs} items=${summary.production_pipeline_writes.items}
queued HUMAN_REVIEW: ${persist.queued_review}
production drafts before/after: ${before.drafts}/${after.drafts}
production type AUTO: ${before.type_auto}/${after.type_auto}
production figures: ${before.figure_assets}/${before.figure_links} → ${after.figure_assets}/${after.figure_links}

PASS: ${results.PASS}
REVIEW: ${results.REVIEW}
BLOCKED: ${results.BLOCKED}

frozen drafts: ${FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts}
frozen type AUTO: ${FROZEN_PIPELINE_COUNTS.frozenTypeAuto}
implied remainder: ${FROZEN_PIPELINE_COUNTS.impliedNonTypeAuto}

paid OCR mathpix/mistral new: 0/0
mistral cached reads: ${summary.paid_api_calls.mistral_cached}
paid OCR cap: 0 / $0
mistral credentials: ${summary.mistral_credentials}

Do not implement STEP 8.32. Do not set VERIFIED. Do not call paid OCR.
Do not AUTO_APPROVE STEP 8.30 failures on confidence score alone.
`,
    'utf8',
  )
  return summary
}
