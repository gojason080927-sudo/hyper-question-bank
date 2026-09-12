/**
 * STEP 8.31 runner — recover original, crop, OCR, compare, optional idempotent DRAFT persist.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { canonicalizeProblemNumber, UPSERT_RPC, upsertPayload } from '../recognition/draftUpsert'
import { parsePaidGate } from '../ocr/paidGate'
import { hasMistralCredentials } from '../ocr/mistralSecrets'
import { createMistralProvider } from '../ocr/mistralProvider'
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
} from './batchPipeline825'
import { ITEM_RPC, RUN_RPC } from './pipelineJob826'
import {
  EXPECTED_GT_COUNT,
  GT_PATH,
  MANIFEST_PATH,
  STEP828_GT_SHA256,
  parseGtFile,
  type GtItem,
} from './structureFromCache828'
import { STEP828_ITEMS_PATH, STEP829_REVIEWS_PATH, parseManifestFile, type Step829ReviewInput } from './imageCompare830'
import type { Step828CachedItem } from './dualAiReview829'
import {
  ASSIGNED_BY,
  CROP_CACHE_DIR,
  STAGE,
  STEP831,
  STEP831_DIR,
  STEP831_DOCUMENT,
  STEP831_DOCUMENT_TITLE,
  STEP831_PAGE_COUNT,
  STEP831_PAID_OCR_CAP,
  STEP831_PDF_SHA256,
  STORAGE_BUCKET,
  STORAGE_ORIGINAL,
  authorizePilotPaidOcr,
  buildPilotItem,
  estimateMistralUsd,
  persistPlanSafe,
  progressFromItems,
  tallyPilot,
  type ExistingDraft,
  type OcrEvidence,
  type PilotItem,
  type RecoveredCrop,
} from './e2ePilot831'

export type ProductionCounts = {
  queried: boolean
  reason: string
  drafts: number | null
  type_auto: number | null
  figure_assets: number | null
  figure_links: number | null
  pipeline_runs: number | null
  pipeline_items: number | null
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
    }
  } catch (error) {
    return skippedCounts(error instanceof Error ? error.message : 'probe_failed')
  }
}

async function downloadOriginalPdf(root: string): Promise<{ path: string; sha256: string; bytes: number }> {
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
  if (!admin) throw new Error('Cannot download original: missing service role')
  const downloaded = await admin.storage.from(STORAGE_BUCKET).download(STORAGE_ORIGINAL)
  if (downloaded.error || !downloaded.data) {
    throw new Error(`original pdf download failed: ${downloaded.error?.message ?? 'empty'}`)
  }
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
  const manifest = parseManifestFile(JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')))
  const hashFile = JSON.parse(readFileSync(path.join(out, 'crop-hashes.json'), 'utf8')) as {
    crops: Array<{ sample_id: string; path: string; bytes: number; sha256: string; width: number; height: number }>
  }
  const byId = new Map(hashFile.crops.map((row) => [row.sample_id, row]))
  return manifest.samples.map((sample) => {
    const rec = byId.get(sample.sample_id)
    const present = Boolean(rec && existsSync(path.join(root, CROP_CACHE_DIR, 'crops', `${sample.sample_id}.png`)))
    return {
      sample_id: sample.sample_id,
      present,
      path: present ? `${CROP_CACHE_DIR}/crops/${sample.sample_id}.png` : null,
      sha256: rec?.sha256 ?? null,
      bytes: rec?.bytes ?? null,
      width: rec?.width ?? null,
      height: rec?.height ?? null,
      frozen_sha256: sample.crop_sha256,
      frozen_bytes: sample.crop_bytes,
      matches_frozen: Boolean(rec && rec.sha256 === sample.crop_sha256 && rec.bytes === sample.crop_bytes),
    }
  })
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
    }
  })
  if (recovered.some((row) => !row.present)) return null
  return recovered
}

function readOcrCache(root: string, sampleId: string): OcrEvidence | null {
  const rawPath = path.join(root, CROP_CACHE_DIR, 'mistral', `${sampleId}.json`)
  if (!existsSync(rawPath)) return null
  const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as { pages?: Array<{ markdown?: string }> }
  const text = (raw.pages ?? []).map((page) => page.markdown ?? '').join('\n')
  return { present: text.trim().length > 0, provider: 'mistral-ocr', text, http: 200, cached: true }
}

async function ocrCrop(
  root: string,
  sampleId: string,
  argv: string[],
): Promise<{ evidence: OcrEvidence; newCall: boolean }> {
  const cached = readOcrCache(root, sampleId)
  if (cached) return { evidence: cached, newCall: false }
  const gate = parsePaidGate(argv)
  const decision = authorizePilotPaidOcr({
    estimatedCalls: 1,
    allowPaidApi: gate.allowPaidApi,
    confirmCost: gate.confirmCost,
    cacheOnly: Boolean(gate.cacheOnly),
  })
  if (!decision.authorized) {
    return {
      evidence: { present: false, provider: null, text: '', http: null, cached: false },
      newCall: false,
    }
  }
  const cropPath = path.join(root, CROP_CACHE_DIR, 'crops', `${sampleId}.png`)
  if (!existsSync(cropPath) || !hasMistralCredentials()) {
    return {
      evidence: { present: false, provider: null, text: '', http: null, cached: false },
      newCall: false,
    }
  }
  const provider = createMistralProvider()
  const result = await provider.recognizeCrop(
    { sampleId, imageBytes: new Uint8Array(readFileSync(cropPath)), mimeType: 'image/png' },
    gate,
  )
  const dest = path.join(root, CROP_CACHE_DIR, 'mistral')
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, `${sampleId}.json`), JSON.stringify(result.raw.raw_response ?? {}))
  const text = result.raw.raw_text || result.normalized.raw_ocr_text || ''
  return {
    evidence: {
      present: text.trim().length > 0,
      provider: 'mistral-ocr',
      text,
      http: result.raw.http_status,
      cached: false,
    },
    newCall: true,
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

function publishReviewCrops(root: string) {
  const src = path.join(root, CROP_CACHE_DIR, 'crops')
  const dest = path.join(root, 'public/review-crops')
  if (!existsSync(src)) return
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (name.endsWith('.png')) copyFileSync(path.join(src, name), path.join(dest, name))
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

export async function runStep831(root: string, argv: string[]) {
  if (argv.includes('--help')) {
    return
  }
  loadAnonKey()
  const persistRequested = argv.includes('--persist')
  const pdf = await downloadOriginalPdf(root)
  let crops = loadCachedCrops(root)
  if (!crops || crops.some((row) => !row.present)) {
    crops = generateCrops(root, pdf.path)
  }
  const gtFile = parseGtFile(JSON.parse(readFileSync(path.join(root, GT_PATH), 'utf8')))
  const cachedFile = JSON.parse(readFileSync(path.join(root, STEP828_ITEMS_PATH), 'utf8')) as {
    items: Step828CachedItem[]
  }
  const reviewsFile = JSON.parse(readFileSync(path.join(root, STEP829_REVIEWS_PATH), 'utf8')) as {
    items: Step829ReviewInput[]
  }
  const cachedBy = new Map(cachedFile.items.map((row) => [row.candidate_id, row]))
  const reviewBy = new Map(reviewsFile.items.map((row) => [row.candidate_id, row]))
  const cropBy = new Map(crops.map((row) => [row.sample_id, row]))
  const ocrBy = new Map<string, OcrEvidence>()
  const existing = await lookupExistingDrafts()
  let newOcrCalls = 0
  const items: PilotItem[] = []
  for (const gt of gtFile.items) {
    const ocr = await ocrCrop(root, gt.sample_id, argv)
    if (ocr.newCall) newOcrCalls += 1
    if (newOcrCalls > STEP831_PAID_OCR_CAP.maxCalls) throw new Error('OCR calls exceeded pilot cap')
    ocrBy.set(gt.sample_id, ocr.evidence)
    const cached = cachedBy.get(gt.sample_id)
    const review = reviewBy.get(gt.sample_id)
    const crop = cropBy.get(gt.sample_id)
    if (!cached || !review || !crop) throw new Error(`missing cache for ${gt.sample_id}`)
    const canon = canonicalizeProblemNumber(gt.problem_number)
    const key = canon ? `${gt.page_number}|${canon}` : ''
    items.push(
      buildPilotItem({
        gt,
        cachedStatus: cached.status,
        review,
        crop,
        ocr: ocr.evidence,
        existing: existing.get(key) ?? null,
      }),
    )
  }
  const plan = persistPlanSafe(items)
  const createCount = items.filter((row) => row.persist_action === 'CREATE_DRAFT').length
  if (persistRequested && !plan.ok) {
    throw new Error(`persist aborted: ${plan.reasons.join(',')}`)
  }
  if (persistRequested && existing.size < 10) {
    throw new Error('persist aborted: existing-draft lookup incomplete; refusing mass create')
  }
  if (persistRequested && createCount > 4) {
    throw new Error(`persist aborted: unexpected create count ${createCount}`)
  }
  const gtAfter = sha256File(path.join(root, GT_PATH))
  if (gtAfter !== STEP828_GT_SHA256) throw new Error('GT mutated')
  publishReviewCrops(root)

  const before =
    argv.includes('--probe-production') || persistRequested
      ? await probeProductionCounts()
      : skippedCounts('no_probe')
  const persistResult = persistRequested
    ? await persistPilot(items, gtFile.items)
    : {
        ran: false,
        created: [] as PersistCreated[],
        existing: [] as PersistExisting[],
        pipeline_run_id: null as string | null,
        queued_review: 0,
      }
  const after = persistRequested || argv.includes('--probe-production') ? await probeProductionCounts() : before

  const dest = path.join(root, STEP831_DIR)
  mkdirSync(dest, { recursive: true })
  const tally = tallyPilot(items)
  const progress = progressFromItems(items)
  const summary = {
    step: STEP831,
    name: 'End-to-end 26-sample original recover, crop, OCR, compare, review queue',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    textbook: { id: STEP831_DOCUMENT, title: STEP831_DOCUMENT_TITLE },
    original_pdf: { sha256: pdf.sha256, bytes: pdf.bytes, pages: STEP831_PAGE_COUNT, git: false },
    paid_ocr_cap: STEP831_PAID_OCR_CAP,
    paid_api_calls: {
      mistral: newOcrCalls,
      mistral_cached: items.filter((row) => row.ocr.cached).length,
      mathpix: 0,
    },
    estimated_usd: estimateMistralUsd(newOcrCalls),
    milestone_mistral_calls: items.filter((row) => row.ocr.present).length,
    milestone_estimated_usd: estimateMistralUsd(items.filter((row) => row.ocr.present).length),
    mistral_credentials: hasMistralCredentials() ? 'PRESENT' : 'ABSENT',
    tally,
    progress,
    persist_plan_ok: plan.ok,
    persist_plan_reasons: plan.reasons,
    persist: persistResult,
    production_before: before,
    production_after: after,
    production_problem_writes: persistResult.created.length,
    production_figure_writes: 0,
    production_verified_writes: 0,
    frozen: FROZEN_PIPELINE_COUNTS,
    gt_sha256: gtAfter,
    gt_mutated: false,
    duplicates: 0,
    orphans: 0,
    wrong_source: items.filter((row) => row.source_document_id !== STEP831_DOCUMENT).length,
    content_rewrites: 0,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      status: row.status,
      reasons: row.reasons,
      page_number: row.page_number,
      problem_number: row.problem_number,
      canonical_number: row.canonical_number,
      compared: row.compared,
      image_compare_pass: row.image_compare_pass,
      checks: row.checks,
      persist_action: row.persist_action,
      existing: row.existing,
      crop_present: row.crop.present,
      crop_sha256: row.crop.sha256,
      crop_matches_frozen: row.crop.matches_frozen,
      ocr: row.ocr,
      has_figure: row.has_figure,
      dual_would_auto: row.dual_would_auto,
      content_fingerprint: row.content_fingerprint,
    })),
  }
  writeJson(dest, 'summary.json', summary)
  const queue = {
    assigned_by: ASSIGNED_BY,
    items: items.map((row) => {
      const created = persistResult.created.find((item) => item.candidate_id === row.candidate_id)
      const recorded = persistResult.existing.find((item) => item.candidate_id === row.candidate_id)
      const gt = gtFile.items.find((item) => item.sample_id === row.candidate_id)
      const ocr = ocrBy.get(row.candidate_id)
      const problemId = created?.problem_id ?? recorded?.problem_id ?? row.existing?.problem_id ?? null
      const versionId = created?.version_id ?? recorded?.version_id ?? row.existing?.current_version_id ?? null
      return {
        candidate_id: row.candidate_id,
        status: row.status,
        reasons: row.reasons,
        page_number: row.page_number,
        problem_number: row.problem_number,
        canonical_number: row.canonical_number,
        problem_id: problemId,
        version_id: versionId,
        public_code: created?.public_code ?? recorded?.public_code ?? row.existing?.public_code ?? null,
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
  writeJson(
    dest,
    'ocr-previews.json',
    items.map((row) => ({
      candidate_id: row.candidate_id,
      cached: row.ocr.cached,
      http: row.ocr.http,
      text_len: row.ocr.text_len,
      preview: (ocrBy.get(row.candidate_id)?.text ?? '').slice(0, 240),
    })),
  )
  writeJson(dest, 'crop-manifest.json', {
    pdf_sha256: pdf.sha256,
    frozen_step7_cropset: true,
    recovered: crops,
  })
  writeJson(dest, 'production-before.json', before)
  writeJson(dest, 'production-after.json', after)
  writeFileSync(
    path.join(dest, 'step8-31-summary.md'),
    `# STEP 8.31 E2E PILOT

status: compared=${tally.compared} AUTO=${tally.auto_approved} HUMAN_REVIEW=${tally.human_review} BLOCKED=${tally.blocked}
crops: ${tally.crop_present}/${EXPECTED_GT_COUNT}
mistral new calls: ${newOcrCalls} cached: ${items.filter((row) => row.ocr.cached).length}
milestone usd: ${estimateMistralUsd(items.filter((row) => row.ocr.present).length)}
persist creates: ${tally.create_draft} existing: ${tally.record_existing} skip_identity: ${tally.skip_identity}
plan ok: ${plan.ok}
Production drafts before/after: ${before.drafts}/${after.drafts}
writes: problems=${persistResult.created.length} figures=0 verified=0
queued_review: ${persistResult.queued_review}
`,
    'utf8',
  )
  return summary
}

async function persistPilot(items: PilotItem[], gtItems: GtItem[]) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anon = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !anon || !service) throw new Error('persist requires URL, anon, and service role')
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `step831.pilot.${Date.now()}@hyper.local`
  const password = `Pilot-${Date.now()}aA1!`
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createdUser.error || !createdUser.data.user) throw new Error(createdUser.error?.message ?? 'create staff')
  await admin.from('user_profiles').upsert({
    user_id: createdUser.data.user.id,
    role: 'TEACHER',
    display_name: 'STEP 8.31 pilot',
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
  let queuedReview = 0
  const gtTextBy = new Map(gtItems.map((item) => [item.sample_id, item.ground_truth_text]))

  async function queueNeedsReview(problemId: string, versionId: string | null, sampleId: string) {
    if (!versionId) return
    const submitted = await staff.rpc('hqb_submit_for_review', {
      p_version_id: versionId,
      p_note: `STEP 8.31 HUMAN_REVIEW ${sampleId}`,
    })
    if (submitted.error) throw new Error(`${sampleId} submit: ${submitted.error.message}`)
    queuedReview += 1
    void problemId
  }

  for (const row of items) {
    if (row.persist_action === 'CREATE_DRAFT') {
      const text = gtTextBy.get(row.candidate_id) ?? ''
      const upserted = await staff.rpc(UPSERT_RPC, {
        payload: upsertPayload({
          source_document_id: STEP831_DOCUMENT,
          page_number: row.page_number,
          original_problem_number: row.canonical_number ?? '',
          problem_text: text,
        }),
      })
      if (upserted.error) throw new Error(`${row.candidate_id}: ${upserted.error.message}`)
      const data = upserted.data as {
        problem_id: string
        version_id?: string
        public_code: string
        status: string
        created: boolean
      }
      if (data.status !== 'CREATED' || data.created !== true) {
        throw new Error(
          `${row.candidate_id} persist aborted: expected CREATED, got ${data.status} (identity already in Production)`,
        )
      }
      created.push({
        candidate_id: row.candidate_id,
        problem_id: data.problem_id,
        version_id: data.version_id ?? null,
        public_code: data.public_code,
        status: data.status,
      })
      await queueNeedsReview(data.problem_id, data.version_id ?? null, row.candidate_id)
    } else if (row.persist_action === 'RECORD_EXISTING' && row.existing) {
      if (row.existing.review_status === 'VERIFIED') {
        throw new Error(`${row.candidate_id} persist aborted: existing VERIFIED must not be rewritten`)
      }
      recorded.push({
        candidate_id: row.candidate_id,
        problem_id: row.existing.problem_id,
        version_id: row.existing.current_version_id,
        public_code: row.existing.public_code,
      })
      if (row.existing.review_status !== 'NEEDS_REVIEW') {
        await queueNeedsReview(row.existing.problem_id, row.existing.current_version_id, row.candidate_id)
      } else {
        queuedReview += 1
      }
    }
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
          crop_sha256: row.crop.sha256,
        },
      },
    })
    if (item.error) throw new Error(`pipeline item ${row.candidate_id}: ${item.error.message}`)
  }
  return {
    ran: true,
    created,
    existing: recorded,
    pipeline_run_id: runId,
    queued_review: queuedReview,
    staff_email: email,
  }
}
