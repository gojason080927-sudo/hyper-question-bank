/**
 * SSEN closeout CLI — leftover 56, paid OCR cap $1, persist AUTO_SAFE / VERIFIED_BY_SOURCE.
 * Default dry-run. Never DELETE. Never raw OCR write. Never TEACHER_EDIT/VERIFIED overwrite.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { STEP832_PDF_SHA256, STORAGE_BUCKET, STORAGE_ORIGINAL } from './fullBookIngest832'
import { type CatalogProblem839, QUESTION_BANK_REF, STUDENT_CARE_REF } from './ssenFullQa839'
import {
  ASSIGNED_BY_CLOSE,
  bookStatusFromPlan,
  CHANGE_REASON_CLOSE,
  CLOSEOUT_DIR,
  COST_CAP_USD,
  dryRunSafetyClose,
  INSPECTOR_VERSION_CLOSE,
  leftoverFrom840Payload,
  LOCK_MAIN_COMMIT_CLOSE,
  MATHPIX_PAGE_USD,
  ocrCacheKey,
  pagesNeedingPaidOcr,
  paidBudgetAllows,
  planCloseout,
  REVIEW_START_CLOSE,
  SSEN_LISTED_FROZEN,
  type ApplyClose,
  type CatalogRowClose,
} from './ssenBookCloseout'
import { catalogFromLive839, skipIfCurrentChanged840, type Input839Record } from './ssenReviewMinimize840'
import { parsePaidGate } from '../ocr/paidGate'
import { createMistralProvider } from '../ocr/mistralProvider'
import { extractMistralMarkdown, type MistralOcrLike } from '../ocr/normalizeMistral'
import { hasMathpixCredentials } from '../ocr/mathpixSecrets'

const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const persist = process.argv.includes('--persist') || process.argv.includes('--apply')
const wantOcr = process.argv.includes('--ocr')
const makeWorksheet = process.argv.includes('--worksheet')

function sha256Bytes(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

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
) {
  const rows: Array<Record<string, unknown>> = []
  for (let from = 0; from < 50000; from += 1000) {
    let q = admin.from(table).select(columns).range(from, from + 999)
    q = apply ? apply(q) : q
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as Array<Record<string, unknown>>))
    if (data.length < 1000) break
  }
  return rows
}

async function countEq(admin: SupabaseClient, table: string, filter: Record<string, string> = {}) {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter)) q = q.eq(column, value)
  const result = await q
  if (result.error) return { count: null as number | null, error: result.error.message }
  return { count: result.count ?? 0, error: null as string | null }
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

async function loadCatalog(admin: SupabaseClient, root: string): Promise<CatalogProblem839[]> {
  const links = await paged(admin, 'problem_sources', 'problem_id,original_problem_number,source_page_id', (q) =>
    q.eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID).eq('is_primary_source', true),
  )
  const problemIds = [...new Set(links.map((row) => String(row.problem_id)))]
  const problems: Array<Record<string, unknown>> = []
  for (let i = 0; i < problemIds.length; i += 80) {
    const { data, error } = await admin
      .from('problems')
      .select('id,public_code,current_version_id,review_status,display_state,lifecycle_status')
      .in('id', problemIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    problems.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const versionIds = problems.map((row) => row.current_version_id).filter(Boolean).map(String)
  const versions: Array<Record<string, unknown>> = []
  for (let i = 0; i < versionIds.length; i += 80) {
    const { data, error } = await admin
      .from('problem_versions')
      .select('id,problem_text,origin,parent_version_id,version_no,instruction,item_format,choice_count')
      .in('id', versionIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    versions.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const vmap = Object.fromEntries(versions.map((row) => [String(row.id), row]))
  const pmap = Object.fromEntries(problems.map((row) => [String(row.id), row]))
  const pageIds = [...new Set(links.map((row) => row.source_page_id).filter(Boolean).map(String))]
  const pages: Array<Record<string, unknown>> = []
  for (let i = 0; i < pageIds.length; i += 80) {
    const { data } = await admin.from('source_pages').select('id,page_number,extracted_text,page_image_path,text_char_count').in('id', pageIds.slice(i, i + 80))
    pages.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const pageMap = Object.fromEntries(pages.map((row) => [String(row.id), row]))
  const outlines: Array<Record<string, unknown>> = []
  for (let i = 0; i < problemIds.length; i += 80) {
    const { data } = await admin
      .from('problem_outline_assignments')
      .select('problem_id,outline_node_id,is_primary')
      .in('problem_id', problemIds.slice(i, i + 80))
      .eq('is_primary', true)
    outlines.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const nodeIds = [...new Set(outlines.map((row) => String(row.outline_node_id)))]
  const nodes: Array<Record<string, unknown>> = []
  for (let i = 0; i < nodeIds.length; i += 80) {
    const { data } = await admin.from('source_outline_nodes').select('id,code,parent_id,node_level').in('id', nodeIds.slice(i, i + 80))
    nodes.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const parentIds = [...new Set(nodes.map((row) => row.parent_id).filter(Boolean).map(String))]
  const parents: Array<Record<string, unknown>> = []
  for (let i = 0; i < parentIds.length; i += 80) {
    const { data } = await admin.from('source_outline_nodes').select('id,code,node_level').in('id', parentIds.slice(i, i + 80))
    parents.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const nmap = Object.fromEntries(nodes.map((row) => [String(row.id), row]))
  const parentMap = Object.fromEntries(parents.map((row) => [String(row.id), row]))
  const omap = Object.fromEntries(outlines.map((row) => [String(row.problem_id), nmap[String(row.outline_node_id)]]))

  return links
    .map((link) => {
      const problem = pmap[String(link.problem_id)]
      if (!problem) return null
      const version = problem.current_version_id ? vmap[String(problem.current_version_id)] : null
      const page = link.source_page_id ? pageMap[String(link.source_page_id)] : null
      const nRaw = String(link.original_problem_number ?? '')
      const n = Number(nRaw)
      const pageNumber = typeof page?.page_number === 'number' ? page.page_number : null
      const node = omap[String(problem.id)]
      const parent = node?.parent_id ? parentMap[String(node.parent_id)] : null
      const major = String((node?.node_level === 'MAJOR_UNIT' ? node.code : parent?.code) ?? '')
      return {
        id: String(problem.id),
        public_code: String(problem.public_code),
        display_state: String(problem.display_state),
        review_status: String(problem.review_status),
        current_version_id: problem.current_version_id ? String(problem.current_version_id) : null,
        origin: version?.origin ? String(version.origin) : null,
        version_no: typeof version?.version_no === 'number' ? version.version_no : null,
        parent_version_id: version?.parent_version_id ? String(version.parent_version_id) : null,
        original_problem_number: nRaw.padStart(4, '0'),
        problem_number: n,
        source_page: pageNumber,
        section_code: node?.code ? String(node.code) : null,
        stem: String(version?.problem_text ?? ''),
        instruction: version?.instruction ? String(version.instruction) : null,
        source_document_id: SSEN_SOURCE_DOCUMENT_ID,
        has_page_image: Boolean(page?.page_image_path) || existsSync(path.join(root, `.ocr-temp/step8-39/pages/p${String(pageNumber ?? 0).padStart(3, '0')}.png`)),
        page_ocr_chars: typeof page?.text_char_count === 'number' ? page.text_char_count : String(page?.extracted_text ?? '').length,
        step832_preview: null,
        crop_present: false,
        item_format: version?.item_format ? String(version.item_format) : null,
        choice_count: typeof version?.choice_count === 'number' ? version.choice_count : null,
        choices: [],
        figure_ids: [],
        figure_pages: [],
        figure_paths: [],
        fingerprint_values: [],
        lifecycle_status: problem.lifecycle_status ? String(problem.lifecycle_status) : null,
        major_code: major || null,
        page_ocr_text: page?.extracted_text ? String(page.extracted_text) : '',
      } as CatalogProblem839 & { page_ocr_text?: string }
    })
    .filter((row): row is CatalogProblem839 & { page_ocr_text?: string } => Boolean(row))
}

async function majorListed(admin: SupabaseClient) {
  const assignments = await paged(admin, 'problem_outline_assignments', 'problem_id,outline_node_id,is_primary', (q) => q.eq('is_primary', true))
  const problemIds = [...new Set(assignments.map((row) => String(row.problem_id)))]
  const listed = new Set<string>()
  for (let i = 0; i < problemIds.length; i += 80) {
    const { data } = await admin.from('problems').select('id,display_state').in('id', problemIds.slice(i, i + 80)).eq('display_state', 'LISTED')
    for (const row of data ?? []) listed.add(row.id)
  }
  const sources = await paged(admin, 'problem_sources', 'problem_id', (q) => q.eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID))
  const ssen = new Set(sources.map((row) => String(row.problem_id)))
  const nodeIds = [...new Set(assignments.map((row) => String(row.outline_node_id)))]
  const nodes: Array<Record<string, unknown>> = []
  for (let i = 0; i < nodeIds.length; i += 80) {
    const { data } = await admin.from('source_outline_nodes').select('id,code,parent_id,node_level').in('id', nodeIds.slice(i, i + 80))
    nodes.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const parentIds = [...new Set(nodes.map((row) => row.parent_id).filter(Boolean).map(String))]
  const parents: Array<Record<string, unknown>> = []
  for (let i = 0; i < parentIds.length; i += 80) {
    const { data } = await admin.from('source_outline_nodes').select('id,code,node_level').in('id', parentIds.slice(i, i + 80))
    parents.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const nmap = Object.fromEntries(nodes.map((row) => [String(row.id), row]))
  const pmap = Object.fromEntries(parents.map((row) => [String(row.id), row]))
  const bag: Record<string, number> = { I: 0, II: 0, III: 0, IV: 0, V: 0 }
  for (const row of assignments) {
    const pid = String(row.problem_id)
    if (!listed.has(pid) || !ssen.has(pid)) continue
    const node = nmap[String(row.outline_node_id)]
    const parent = node?.parent_id ? pmap[String(node.parent_id)] : null
    const code = String((node?.node_level === 'MAJOR_UNIT' ? node.code : parent?.code) ?? '')
    if (code in bag) bag[code] += 1
  }
  return bag
}

async function snapshot(admin: SupabaseClient) {
  const sources = await paged(admin, 'problem_sources', 'problem_id', (q) => q.eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID))
  const ssenIds = [...new Set(sources.map((row) => String(row.problem_id)))]
  let listed = 0
  let needs = 0
  let autoClean839 = 0
  let autoClean840 = 0
  const codes: string[] = []
  for (let i = 0; i < ssenIds.length; i += 80) {
    const { data } = await admin.from('problems').select('id,display_state,review_status,public_code,current_version_id').in('id', ssenIds.slice(i, i + 80))
    const vids = (data ?? []).map((row) => row.current_version_id).filter(Boolean)
    if (vids.length) {
      const versions = await admin.from('problem_versions').select('id,origin,change_reason').in('id', vids as string[])
      for (const row of versions.data ?? []) {
        const reason = String(row.change_reason ?? '')
        if (row.origin === 'AUTO_CLEAN' && reason.includes('STEP 8.39')) autoClean839 += 1
        if (row.origin === 'AUTO_CLEAN' && reason.includes('STEP 8.40')) autoClean840 += 1
      }
    }
    for (const row of data ?? []) {
      if (row.display_state === 'LISTED') {
        listed += 1
        codes.push(row.public_code)
      }
      if (row.review_status === 'NEEDS_REVIEW') needs += 1
    }
  }
  return {
    listed,
    ssen_linked: ssenIds.length,
    ssen_needs_review: needs,
    public_code_dups: codes.length - new Set(codes).size,
    embeddings: (await countEq(admin, 'problem_embeddings')).count,
    fingerprints: (await countEq(admin, 'content_fingerprints')).count,
    majors: await majorListed(admin),
    auto_clean_839: autoClean839,
    auto_clean_840: autoClean840,
  }
}

function loadCachedOcr(root: string): Map<number, string> {
  const dir = path.join(root, CLOSEOUT_DIR, 'ocr')
  const map = new Map<number, string>()
  if (!existsSync(dir)) return map
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const parsed = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { page?: number; markdown?: string; cached?: boolean }
    if (parsed.page != null && parsed.markdown) map.set(parsed.page, parsed.markdown)
  }
  return map
}

async function runPaidOcr(
  root: string,
  pages: number[],
  cached: Map<number, string>,
): Promise<{ ocr: Map<number, string>; mathpix: number; mistral: number; cacheHits: number; cost: number; aborted?: string }> {
  const ocrDir = path.join(root, CLOSEOUT_DIR, 'ocr')
  mkdirSync(ocrDir, { recursive: true })
  const out = new Map(cached)
  let mathpix = 0
  let mistral = 0
  let cacheHits = 0
  let cost = 0
  const gate = parsePaidGate(process.argv)
  const need = pages.filter((page) => !(out.get(page) ?? '').trim())
  if (need.length === 0) return { ocr: out, mathpix: 0, mistral: 0, cacheHits: pages.length, cost: 0 }

  if (hasMathpixCredentials()) {
    console.warn('[closeout] Mathpix credentials present ($0.002/image, dense $0.005/page). This run uses Mistral only when Mathpix is not called.')
  } else {
    console.warn('[closeout] Mathpix credentials absent — Mistral OCR-latest. Conservative dense-page rate $0.005.')
  }

  const provider = createMistralProvider()
  for (const page of need) {
    if (!paidBudgetAllows(cost, MATHPIX_PAGE_USD, COST_CAP_USD)) {
      return { ocr: out, mathpix, mistral, cacheHits, cost, aborted: `cost cap $${COST_CAP_USD}` }
    }
    const pngPath = path.join(root, `.ocr-temp/step8-39/pages/p${String(page).padStart(3, '0')}.png`)
    if (!existsSync(pngPath)) throw new Error(`missing page png ${pngPath}`)
    const buf = readFileSync(pngPath)
    const imageSha = sha256Bytes(buf)
    const cacheName = `${ocrCacheKey(page, imageSha).slice(0, 21)}.json`
    const cacheFile = path.join(ocrDir, cacheName)
    const existing = readdirSync(ocrDir).find((name) => name.startsWith(`p${String(page).padStart(3, '0')}-`) && name.endsWith('.json'))
    if (existing) {
      const hit = JSON.parse(readFileSync(path.join(ocrDir, existing), 'utf8')) as { markdown?: string; image_sha256?: string }
      if (hit.markdown && (hit.image_sha256 === imageSha || existing.startsWith(ocrCacheKey(page, imageSha).slice(0, 21)))) {
        out.set(page, hit.markdown)
        cacheHits += 1
        continue
      }
    }
    let markdown = ''
    const redact = (raw: unknown) => {
      const copy = JSON.parse(JSON.stringify(raw ?? {})) as { raw_response?: { pages?: Array<{ images?: Array<{ image_base64?: string }> }> } }
      for (const pageRow of copy.raw_response?.pages ?? []) {
        for (const image of pageRow.images ?? []) delete image.image_base64
      }
      return copy
    }
    try {
      const result = await provider.recognizeCrop(
        { sampleId: `ssen-closeout-p${page}`, imageBytes: new Uint8Array(buf), mimeType: 'image/png' },
        gate,
      )
      markdown = result.raw.raw_text || extractMistralMarkdown(result.raw.raw_response as MistralOcrLike)
      writeFileSync(
        cacheFile,
        JSON.stringify(
          {
            page,
            provider: 'mistral',
            markdown,
            image_sha256: imageSha,
            cost_usd: MATHPIX_PAGE_USD,
            cached: false,
            raw: redact(result.raw),
            recorded_at: new Date().toISOString(),
            unit_price: { mathpix_image: 0.002, mathpix_page_or_dense: 0.005, mistral_conservative_dense: 0.005 },
          },
          null,
          2,
        ),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/429|quota|billing|unauthorized|invalid.?key|NOT_CONFIGURED|PAID_CALL_DENIED/i.test(msg)) {
        return { ocr: out, mathpix, mistral, cacheHits, cost, aborted: msg }
      }
      console.warn(`[closeout] page ${page} first attempt failed: ${msg} — retry once`)
      try {
        const result = await provider.recognizeCrop(
          { sampleId: `ssen-closeout-p${page}-retry`, imageBytes: new Uint8Array(buf), mimeType: 'image/png' },
          gate,
        )
        markdown = result.raw.raw_text || extractMistralMarkdown(result.raw.raw_response as MistralOcrLike)
        writeFileSync(
          cacheFile,
          JSON.stringify({ page, provider: 'mistral', markdown, image_sha256: imageSha, cost_usd: MATHPIX_PAGE_USD, cached: false, retry: true, raw: redact(result.raw), recorded_at: new Date().toISOString() }, null, 2),
        )
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        return { ocr: out, mathpix, mistral, cacheHits, cost, aborted: retryMsg }
      }
    }
    out.set(page, markdown)
    mistral += 1
    cost += MATHPIX_PAGE_USD
    console.log(`[closeout] OCR page ${page} $${MATHPIX_PAGE_USD} sha=${imageSha.slice(0, 12)}`)
  }
  void mathpix
  return { ocr: out, mathpix, mistral, cacheHits, cost }
}

function publicPayload(
  plan: ReturnType<typeof planCloseout>,
  extras: Record<string, unknown>,
  book: Record<string, unknown>,
) {
  return {
    step: 'ssen-closeout',
    inspector_version: plan.inspector_version,
    rules_version: plan.rules_version,
    inspected_at: new Date().toISOString(),
    lock_main_commit: LOCK_MAIN_COMMIT_CLOSE,
    book,
    summary: plan.summary,
    p1: plan.p1.map((row) => ({
      problem_id: row.problem_id,
      current_number: row.current_number,
      source_page: row.source_page,
      verdict: row.verdict,
      verdict_reason: row.verdict_reason,
      rules: row.rules,
      stem: row.stem,
      proposed_stem: row.proposed_stem,
    })),
    records: plan.decisions.map((row) => ({
      problem_id: row.problem_id,
      public_code: row.public_code,
      current_number: row.current_number,
      source_page: row.source_page,
      verdict: row.verdict,
      root_cause: row.bucket,
      verdict_reason: row.verdict_reason,
      signals: row.rules,
      rules: row.rules,
      evidence: row.evidence,
      stem: row.stem,
      proposed_stem: row.proposed_stem,
      teacher_edit: row.teacher_edit,
      verified: row.verified,
      create_draft_numbers: row.create_draft_numbers,
    })),
    applies: plan.applies,
    ...extras,
  }
}

export async function runCloseout(root = process.cwd()) {
  loadEnvLocal(root)
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !service) throw new Error('missing supabase env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('refused student-care')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('wrong supabase project')

  const qa840Path = path.join(root, 'public/step8-40-review-minimize.json')
  if (!existsSync(qa840Path)) throw new Error('missing public/step8-40-review-minimize.json')
  const leftovers = leftoverFrom840Payload(JSON.parse(readFileSync(qa840Path, 'utf8')) as { records?: Input839Record[] })
  if (leftovers.length !== REVIEW_START_CLOSE) throw new Error(`expected ${REVIEW_START_CLOSE} leftovers, got ${leftovers.length}`)

  const outDir = path.join(root, CLOSEOUT_DIR)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(path.join(outDir, 'ocr'), { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })
  mkdirSync(path.join(root, 'public/book-status'), { recursive: true })

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const before = await snapshot(admin)
  if (before.listed !== SSEN_LISTED_FROZEN) throw new Error(`listed ${before.listed} != ${SSEN_LISTED_FROZEN}`)

  const catalog839 = await loadCatalog(admin, root)
  const live = catalogFromLive839(catalog839) as CatalogRowClose[]
  const pageOcrByPage = new Map<number, string>()
  for (const row of catalog839 as Array<CatalogProblem839 & { page_ocr_text?: string }>) {
    if (row.source_page != null && row.page_ocr_text) {
      const prev = pageOcrByPage.get(row.source_page) ?? ''
      if (row.page_ocr_text.length > prev.length) pageOcrByPage.set(row.source_page, row.page_ocr_text)
    }
  }
  for (const [page, text] of loadCachedOcr(root)) {
    if (text.length > (pageOcrByPage.get(page) ?? '').length) pageOcrByPage.set(page, text)
  }

  let pdfPath = existsSync(path.join(root, '.ocr-temp/ssen-original.pdf'))
    ? path.join(root, '.ocr-temp/ssen-original.pdf')
    : existsSync('/tmp/hqb-ssen-ocr/original.pdf')
      ? '/tmp/hqb-ssen-ocr/original.pdf'
      : null
  if (!pdfPath) {
    const downloaded = await admin.storage.from(STORAGE_BUCKET).download(STORAGE_ORIGINAL)
    if (!downloaded.error && downloaded.data) {
      const dest = path.join(root, '.ocr-temp/ssen-original.pdf')
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.from(await downloaded.data.arrayBuffer()))
      pdfPath = dest
    }
  }
  const pdfSha = pdfPath ? sha256Bytes(readFileSync(pdfPath)) : null
  if (pdfSha && pdfSha !== STEP832_PDF_SHA256) throw new Error(`SSEN original PDF hash mismatch: ${pdfSha}`)

  const freePlan = planCloseout(leftovers, live, { ocrByPage: pageOcrByPage })
  const needPages = pagesNeedingPaidOcr(freePlan.decisions, pageOcrByPage)
  let mathpix = 0
  let mistral = 0
  let cacheHits = 0
  let cost = 0
  let aborted: string | undefined
  if (wantOcr && needPages.length) {
    const paid = await runPaidOcr(root, needPages, pageOcrByPage)
    mathpix = paid.mathpix
    mistral = paid.mistral
    cacheHits = paid.cacheHits
    cost = paid.cost
    aborted = paid.aborted
    for (const [page, text] of paid.ocr) pageOcrByPage.set(page, text)
  } else {
    cacheHits = [...pageOcrByPage.keys()].filter((page) => needPages.includes(page)).length
  }

  const plan = planCloseout(leftovers, live, {
    ocrByPage: pageOcrByPage,
    paidUsd: cost,
    mathpix,
    mistral,
    cacheHits,
  })
  const safety = dryRunSafetyClose(plan, before.listed ?? 0)
  const book = bookStatusFromPlan(plan, { pdf_hash: pdfSha ?? STEP832_PDF_SHA256, paid_usd: cost, listed: before.listed ?? 0 })
  const uniquePages = [...new Set(leftovers.map((row) => row.source_page).filter((page): page is number => page != null))]

  const dry = {
    step: 'ssen-closeout',
    status: persist ? 'PERSIST_REQUESTED' : 'DRY_RUN',
    lock_main_commit: LOCK_MAIN_COMMIT_CLOSE,
    inspector_version: INSPECTOR_VERSION_CLOSE,
    pdf_sha256: pdfSha,
    unique_pages: uniquePages,
    need_ocr_pages: needPages,
    ocr: { mathpix, mistral, cacheHits, cost, aborted: aborted ?? null, mathpix_configured: hasMathpixCredentials() },
    before,
    summary: plan.summary,
    safety,
    book,
    p1: plan.p1.map((row) => ({ number: row.current_number, page: row.source_page, verdict: row.verdict, reason: row.verdict_reason })),
    create_draft_candidates: plan.decisions.flatMap((row) => row.create_draft_numbers.map((n) => ({ parent: row.current_number, number: n }))),
    applies: plan.applies.map((row) => ({ number: row.current_number, page: row.source_page, display_state: row.display_state, rules: row.rules, from: row.from_stem.slice(0, 200), to: row.to_stem.slice(0, 200) })),
    student_care_accessed: false,
    create_draft_persist: false,
  }

  writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify(dry, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ ...plan, applies: plan.applies }, null, 2), 'utf8')
  writeFileSync(
    path.join(outDir, 'REPORT.md'),
    [
      '# 쎈수학 공통수학1 최종 마감',
      '',
      `- inspector ${INSPECTOR_VERSION_CLOSE}`,
      `- lock ${LOCK_MAIN_COMMIT_CLOSE}`,
      `- ${String(book.banner)}`,
      `- listed ${before.listed} embeddings ${before.embeddings} fingerprints ${before.fingerprints}`,
      `- OCR $${cost.toFixed(4)} Mathpix ${mathpix} Mistral ${mistral} cache ${cacheHits}`,
      `- VERIFIED_BY_SOURCE ${plan.summary.verified_by_source} AUTO_SAFE ${plan.summary.auto_safe} PASS_FP ${plan.summary.pass_false_positive} HUMAN ${plan.summary.human_final_check}`,
      `- versions ${plan.summary.new_versions} create-draft candidates ${plan.summary.create_draft_candidates} (INSERT never in this run)`,
      '',
      '## Safety',
      '',
      `- ${safety.ok ? 'OK' : 'FAIL'} ${safety.violations.join(', ') || 'no violations'}`,
      '',
      '## Rows',
      '',
      ...plan.decisions.map((row) => `- ${row.current_number} p.${row.source_page} ${row.bucket} → ${row.verdict} | ${row.verdict_reason}`),
    ].join('\n'),
    'utf8',
  )
  writeFileSync(path.join(root, 'public/ssen-book-closeout.json'), JSON.stringify(publicPayload(plan, { before, ocr: dry.ocr, safety }, book), null, 2), 'utf8')
  writeFileSync(path.join(root, 'public/ssen-book-status.json'), JSON.stringify({ ...book, freeze: before, counts: plan.summary }, null, 2), 'utf8')
  writeFileSync(path.join(root, 'public/book-status', `${SSEN_SOURCE_DOCUMENT_ID}.json`), JSON.stringify({ ...book, freeze: before, counts: plan.summary }, null, 2), 'utf8')

  console.log(
    JSON.stringify(
      {
        phase: persist ? 'dry-run-before-persist' : 'dry-run',
        start: leftovers.length,
        unique_pages: uniquePages.length,
        summary: plan.summary,
        safety,
        book: { banner: book.banner, ready_for_use: book.ready_for_use, human_exceptions: book.human_exceptions },
        ocr: dry.ocr,
      },
      null,
      2,
    ),
  )

  if (!persist) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ ...dry, status: 'DRY_RUN' }, null, 2), 'utf8')
    return dry
  }
  if (!safety.ok) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ ...dry, status: 'ABORT_UNSAFE' }, null, 2), 'utf8')
    throw new Error(`DRY RUN safety failed: ${safety.violations.join('; ')}`)
  }

  const staff = await staffClient(url, service)
  const persistRows: Array<Record<string, unknown>> = []
  const preflight = plan.applies.map((apply) => ({ apply, skip: skipIfCurrentChanged840(apply, live.find((row) => row.id === apply.problem_id)) }))
  if (preflight.some((row) => row.skip.skip)) {
    for (const row of preflight.filter((item) => item.skip.skip)) {
      persistRows.push({ problem_id: row.apply.problem_id, skipped: true, reason: row.skip.reason, result: { skipped: true } })
    }
  }
  const ready = preflight.filter((row) => !row.skip.skip).map((row) => row.apply)
  let stopped: string | null = null
  for (const apply of ready) {
    if (stopped) {
      persistRows.push({ problem_id: apply.problem_id, skipped: true, reason: `atomic stop: ${stopped}`, result: { skipped: true } })
      continue
    }
    const res = await staff.rpc('hqb_apply_auto_clean_text', {
      p_problem_id: apply.problem_id,
      p_cleaned_text: apply.to_stem,
      p_change_reason: `${CHANGE_REASON_CLOSE} ${apply.rules.join(',')} ${ASSIGNED_BY_CLOSE}`,
    })
    if (res.error) {
      stopped = res.error.message
      persistRows.push({ problem_id: apply.problem_id, error: res.error.message, result: null })
      continue
    }
    persistRows.push({ problem_id: apply.problem_id, error: null, result: res.data ?? null })
  }

  let worksheetId: string | null = null
  if (makeWorksheet) {
    const picks = [
      plan.p1.find((row) => row.verdict === 'VERIFIED_BY_SOURCE'),
      plan.decisions.find((row) => row.rules.includes('trim_later_range')),
      plan.decisions.find((row) => row.rules.some((rule) => rule.startsWith('drop_homed'))),
      plan.decisions.find((row) => row.verdict === 'AUTO_SAFE'),
      plan.decisions.find((row) => row.verdict === 'HUMAN_FINAL_CHECK'),
    ].filter(Boolean)
    const created = await staff.rpc('hqb_create_worksheet', {
      payload: { title: 'TEST SSEN CLOSEOUT', exam_kind: 'EXAM', layout: { columns: 2 } },
    })
    worksheetId = (created.data as { worksheet_id?: string } | null)?.worksheet_id ?? null
    if (worksheetId) {
      await staff.rpc('hqb_replace_worksheet_items', {
        p_worksheet_id: worksheetId,
        payload: {
          items: picks.map((row, index) => ({
            problem_id: row!.problem_id,
            problem_version_id: live.find((item) => item.id === row!.problem_id)?.current_version_id,
            order_no: index + 1,
          })),
        },
      })
    }
  }

  const afterCatalog = await loadCatalog(admin, root)
  const afterLive = catalogFromLive839(afterCatalog) as CatalogRowClose[]
  const rerun = planCloseout(leftovers, afterLive, { ocrByPage: pageOcrByPage, paidUsd: 0, mathpix: 0, mistral: 0, cacheHits: pageOcrByPage.size })
  const after = await snapshot(admin)
  const outcome = {
    ...dry,
    status: 'PERSISTED',
    persist: {
      attempted: persistRows.length,
      written: persistRows.filter((row) => row.result && (row.result as { skipped?: boolean }).skipped === false).length,
      skipped: persistRows.filter((row) => row.skipped || (row.result as { skipped?: boolean } | null)?.skipped === true).length,
      errors: persistRows.filter((row) => row.error).length,
      atomic_stop: stopped,
      rows: persistRows,
    },
    worksheet_id: worksheetId,
    after,
    rerun_applies: rerun.applies.length,
    rerun_ocr_calls: 0,
    integrity_after: {
      listed_unchanged: after.listed === before.listed && after.listed === SSEN_LISTED_FROZEN,
      public_code_dups: after.public_code_dups,
      embeddings_unchanged: after.embeddings === before.embeddings,
      fingerprints_unchanged: after.fingerprints === before.fingerprints,
      majors: after.majors,
      auto_clean_839: after.auto_clean_839,
      auto_clean_840: after.auto_clean_840,
      needs_review: after.ssen_needs_review,
    },
  }
  writeFileSync(path.join(outDir, 'persist-result.json'), JSON.stringify(outcome, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(outcome, null, 2), 'utf8')
  writeFileSync(path.join(root, 'public/ssen-book-closeout.json'), JSON.stringify(publicPayload(plan, { ...dry.ocr, persisted: true, persist: outcome.persist, worksheet_id: worksheetId, rerun_applies: rerun.applies.length, after }, book), null, 2), 'utf8')
  console.log(
    `SSEN CLOSEOUT PERSIST written=${outcome.persist.written} skipped=${outcome.persist.skipped} rerun=${rerun.applies.length} listed=${after.listed} worksheet=${worksheetId ?? 'none'}`,
  )
  return outcome
}

const isMain = process.argv[1]?.includes('ssenBookCloseoutCli')
if (isMain) {
  await runCloseout(process.cwd())
}
