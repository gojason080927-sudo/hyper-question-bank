/**
 * STEP 8.39 CLI — full free QA. Default DRY RUN. `--persist` applies AUTO_SAFE only.
 * Never DELETE. Never paid OCR. Never student-care. Never 8.32–8.38 persist replay.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { STEP832_PDF_SHA256, STORAGE_BUCKET, STORAGE_ORIGINAL } from './fullBookIngest832'
import {
  ASSIGNED_BY_839,
  CHANGE_REASON_839,
  dryRunSafety839,
  formatQaMarkdown,
  inspectCatalog,
  overlapIds,
  paidOcrPlan839,
  QUESTION_BANK_REF,
  SSEN_LISTED_FROZEN,
  STEP839_DIR,
  STUDENT_CARE_REF,
  TEST_WORKSHEET_IDS_839,
  withAppliedStems839,
  type CatalogProblem839,
  type InspectCache839,
  type QaPlan839,
} from './ssenFullQa839'

const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const persist = process.argv.includes('--persist')

function sha256Bytes(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
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

function loadStep832Previews(root: string) {
  const byId = new Map<string, string>()
  const byKey = new Map<string, string>()
  const file = path.join(root, 'ocr-tests/taxonomy/step8-32/items.json')
  if (!existsSync(file)) return { byId, byKey }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    items?: Array<{
      page?: number
      canonical?: string
      problem_number?: string
      stem_preview?: string
      existing?: { problem_id?: string }
    }>
  }
  for (const item of parsed.items ?? []) {
    const preview = item.stem_preview ?? ''
    if (item.existing?.problem_id) byId.set(item.existing.problem_id, preview)
    const n = item.canonical || item.problem_number
    if (item.page && n) byKey.set(`${item.page}|${String(n).padStart(4, '0')}`, preview)
  }
  return { byId, byKey }
}

function loadRange838Leftovers(root: string): { review: string[]; blocked: string[]; auto: string[] } {
  const file = path.join(root, 'public/step8-38-range-audit.json')
  const empty = { review: [] as string[], blocked: [] as string[], auto: [] as string[] }
  if (!existsSync(file)) return empty
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    candidates?: Array<{ problem_id: string; verdict: string }>
  }
  for (const row of parsed.candidates ?? []) {
    if (row.verdict === 'REVIEW_REQUIRED') empty.review.push(row.problem_id)
    else if (row.verdict === 'BLOCKED') empty.blocked.push(row.problem_id)
    else if (row.verdict === 'AUTO_SAFE') empty.auto.push(row.problem_id)
  }
  return empty
}

function countProviderCache(root: string, name: string): number {
  const dir = path.join(root, 'ocr-tests', name)
  if (!existsSync(dir)) return 0
  return readdirSync(dir, { recursive: true }).filter((file) => String(file).endsWith('.json')).length
}

async function loadCatalog(admin: SupabaseClient, root: string): Promise<CatalogProblem839[]> {
  const previews = loadStep832Previews(root)
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
  const choices: Array<Record<string, unknown>> = []
  for (let i = 0; i < versionIds.length; i += 80) {
    const { data } = await admin
      .from('problem_choices')
      .select('problem_version_id,choice_order,label,choice_text')
      .in('problem_version_id', versionIds.slice(i, i + 80))
    choices.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const choiceMap = new Map<string, Array<{ label: string; order: number; text: string }>>()
  for (const row of choices) {
    const key = String(row.problem_version_id)
    const bag = choiceMap.get(key) ?? []
    bag.push({
      label: String(row.label ?? ''),
      order: Number(row.choice_order ?? 0),
      text: String(row.choice_text ?? ''),
    })
    choiceMap.set(key, bag)
  }
  let figureLinks: Array<Record<string, unknown>> = []
  let figureAssets: Array<Record<string, unknown>> = []
  try {
    figureLinks = await paged(admin, 'problem_figure_links', 'problem_id,figure_id')
    figureAssets = await paged(admin, 'problem_figure_assets', 'figure_id,page_number,crop_path,source_document_id')
  } catch {
    figureLinks = []
    figureAssets = []
  }
  const assetMap = Object.fromEntries(figureAssets.map((row) => [String(row.figure_id), row]))
  const figuresByProblem = new Map<string, { ids: string[]; pages: number[]; paths: string[] }>()
  for (const link of figureLinks) {
    const pid = String(link.problem_id)
    const asset = assetMap[String(link.figure_id)]
    const bag = figuresByProblem.get(pid) ?? { ids: [], pages: [], paths: [] }
    bag.ids.push(String(link.figure_id))
    if (typeof asset?.page_number === 'number') bag.pages.push(asset.page_number)
    if (asset?.crop_path) bag.paths.push(String(asset.crop_path))
    figuresByProblem.set(pid, bag)
  }
  let fps: Array<Record<string, unknown>> = []
  try {
    fps = await paged(admin, 'content_fingerprints', 'problem_id,fingerprint_value')
  } catch {
    fps = []
  }
  const fpMap = new Map<string, string[]>()
  for (const row of fps) {
    const pid = String(row.problem_id)
    const bag = fpMap.get(pid) ?? []
    bag.push(String(row.fingerprint_value ?? ''))
    fpMap.set(pid, bag)
  }
  const vmap = Object.fromEntries(versions.map((row) => [String(row.id), row]))
  const pmap = Object.fromEntries(problems.map((row) => [String(row.id), row]))
  const pageIds = [...new Set(links.map((row) => row.source_page_id).filter(Boolean).map(String))]
  const pages: Array<Record<string, unknown>> = []
  for (let i = 0; i < pageIds.length; i += 80) {
    const { data } = await admin
      .from('source_pages')
      .select('id,page_number,extracted_text,page_image_path,text_char_count')
      .in('id', pageIds.slice(i, i + 80))
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
      const key = pageNumber != null ? `${pageNumber}|${nRaw.padStart(4, '0')}` : ''
      const node = omap[String(problem.id)]
      const parent = node?.parent_id ? parentMap[String(node.parent_id)] : null
      const major = String((node?.node_level === 'MAJOR_UNIT' ? node.code : parent?.code) ?? '')
      const vid = version?.id ? String(version.id) : ''
      const figs = figuresByProblem.get(String(problem.id)) ?? { ids: [], pages: [], paths: [] }
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
        has_page_image: Boolean(page?.page_image_path),
        page_ocr_chars: typeof page?.text_char_count === 'number' ? page.text_char_count : 0,
        step832_preview: previews.byId.get(String(problem.id)) ?? previews.byKey.get(key) ?? null,
        crop_present: Boolean(previews.byId.get(String(problem.id)) || previews.byKey.get(key) || figs.paths.length),
        item_format: version?.item_format ? String(version.item_format) : null,
        choice_count: typeof version?.choice_count === 'number' ? version.choice_count : null,
        choices: choiceMap.get(vid) ?? [],
        figure_ids: figs.ids,
        figure_pages: figs.pages,
        figure_paths: figs.paths,
        fingerprint_values: fpMap.get(String(problem.id)) ?? [],
        lifecycle_status: problem.lifecycle_status ? String(problem.lifecycle_status) : null,
        major_code: major || null,
      } satisfies CatalogProblem839
    })
    .filter((row): row is CatalogProblem839 => Boolean(row))
}

async function majorListed(admin: SupabaseClient) {
  const assignments = await paged(admin, 'problem_outline_assignments', 'problem_id,outline_node_id,is_primary', (q) =>
    q.eq('is_primary', true),
  )
  const problemIds = [...new Set(assignments.map((row) => String(row.problem_id)))]
  const listed = new Set<string>()
  for (let i = 0; i < problemIds.length; i += 80) {
    const { data } = await admin
      .from('problems')
      .select('id,display_state')
      .in('id', problemIds.slice(i, i + 80))
      .eq('display_state', 'LISTED')
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
  const needIds: string[] = []
  const codes: string[] = []
  for (let i = 0; i < ssenIds.length; i += 80) {
    const { data } = await admin
      .from('problems')
      .select('id,display_state,review_status,public_code')
      .in('id', ssenIds.slice(i, i + 80))
    for (const row of data ?? []) {
      if (row.display_state === 'LISTED') {
        listed += 1
        codes.push(row.public_code)
      }
      if (row.review_status === 'NEEDS_REVIEW') {
        needs += 1
        needIds.push(row.id)
      }
    }
  }
  return {
    drafts: (await countEq(admin, 'problems', { lifecycle_status: 'DRAFT' })).count,
    listed,
    ssen_linked: ssenIds.length,
    ssen_needs_review: needs,
    needs_review_ids: needIds,
    public_code_dups: codes.length - new Set(codes).size,
    embeddings: (await countEq(admin, 'problem_embeddings')).count,
    fingerprints: (await countEq(admin, 'content_fingerprints')).count,
    majors: await majorListed(admin),
  }
}

async function ensurePdfPages(root: string, admin: SupabaseClient): Promise<{
  pdfSha: string | null
  pageHashes: Map<number, string>
  rendered: number
  reused: number
}> {
  const pageHashes = new Map<number, string>()
  const dest = path.join(root, '.ocr-temp/ssen-original.pdf')
  const tmp = '/tmp/hqb-ssen-ocr/original.pdf'
  let pdfPath = existsSync(dest) ? dest : existsSync(tmp) ? tmp : null
  if (!pdfPath) {
    const downloaded = await admin.storage.from(STORAGE_BUCKET).download(STORAGE_ORIGINAL)
    if (!downloaded.error && downloaded.data) {
      const buf = Buffer.from(await downloaded.data.arrayBuffer())
      mkdirSync(path.dirname(dest), { recursive: true })
      mkdirSync('/tmp/hqb-ssen-ocr', { recursive: true })
      writeFileSync(dest, buf)
      writeFileSync(tmp, buf)
      pdfPath = dest
    }
  }
  if (!pdfPath) return { pdfSha: null, pageHashes, rendered: 0, reused: 0 }
  const pdfSha = sha256Bytes(readFileSync(pdfPath))
  if (pdfSha !== STEP832_PDF_SHA256) throw new Error(`SSEN original PDF hash mismatch: ${pdfSha}`)
  const out = path.join(root, '.ocr-temp/step8-39')
  const inventoryFile = path.join(out, 'page-inventory.json')
  if (existsSync(inventoryFile)) {
    const parsed = JSON.parse(readFileSync(inventoryFile, 'utf8')) as {
      pdf_sha256?: string
      pages?: Array<{ page: number; sha256: string; path: string }>
    }
    if (parsed.pdf_sha256 === pdfSha && (parsed.pages?.length ?? 0) === 192) {
      let reused = 0
      for (const row of parsed.pages ?? []) {
        if (existsSync(row.path)) {
          pageHashes.set(row.page, row.sha256)
          reused += 1
        }
      }
      if (reused === 192) return { pdfSha, pageHashes, rendered: 0, reused }
    }
  }
  const script = path.join(root, 'scripts/render-step832-pages.py')
  execFileSync('python3', [script, '--pdf', pdfPath, '--out', out, '--scale', '1.5', '--from-page', '1', '--to-page', '192'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (existsSync(inventoryFile)) {
    const parsed = JSON.parse(readFileSync(inventoryFile, 'utf8')) as {
      pages?: Array<{ page: number; sha256: string }>
    }
    for (const row of parsed.pages ?? []) pageHashes.set(row.page, row.sha256)
    const stamped = JSON.parse(readFileSync(inventoryFile, 'utf8')) as Record<string, unknown>
    stamped.pdf_sha256 = pdfSha
    writeFileSync(inventoryFile, JSON.stringify(stamped, null, 2), 'utf8')
  }
  return { pdfSha, pageHashes, rendered: pageHashes.size, reused: 0 }
}

function publicPayload(plan: QaPlan839, extras: Record<string, unknown>) {
  const listed = plan.records.filter((row) => row.display_state === 'LISTED')
  return {
    step: '8.39',
    inspector_version: plan.inspector_version,
    rules_version: plan.rules_version,
    inspected_at: new Date().toISOString(),
    summary: plan.summary,
    integrity: plan.integrity,
    pages: plan.pages.map((row) => ({
      page: row.page,
      listed_count: row.listed_count,
      suspect: row.suspect,
      page_sha256: row.page_sha256,
    })),
    records: listed.map((row) => ({
      problem_id: row.problem_id,
      public_code: row.public_code,
      current_number: row.current_number,
      source_page: row.source_page,
      section_code: row.section_code,
      major_code: row.major_code,
      verdict: row.verdict,
      priority: row.priority,
      root_cause: row.root_cause,
      verdict_reason: row.verdict_reason,
      signals: row.signals.map((signal) => signal.code),
      stem: row.stem,
      proposed_stem: row.proposed_stem,
      katex: {
        render_fail: row.katex.render_fail,
        max_width_px: row.katex.max_width_px,
        overflow_360: row.katex.overflow_360,
        overflow_a4_2col: row.katex.overflow_a4_2col,
      },
      has_figure: row.has_figure,
      figure_needed: row.figure_needed,
      evidence: row.evidence,
      teacher_edit: row.teacher_edit,
      verified: row.verified,
    })),
    applies: plan.applies,
    ...extras,
  }
}

export async function runStep839(root = process.cwd()) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !service) throw new Error('missing supabase env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('refused student-care')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('wrong supabase project')

  const outDir = path.join(root, STEP839_DIR)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const before = await snapshot(admin)
  const leftovers = loadRange838Leftovers(root)
  const overlap = overlapIds(leftovers.review, before.needs_review_ids)
  const catalog = await loadCatalog(admin, root)
  const pages = await ensurePdfPages(root, admin)
  const cacheFile = path.join(outDir, 'inspect-cache.json')
  const cache: InspectCache839 = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as InspectCache839) : {}
  const plan = inspectCatalog(catalog, { cache, pageHashes: pages.pageHashes, pdfSha: pages.pdfSha })
  const nextCache: InspectCache839 = { ...cache }
  for (const record of plan.records) {
    nextCache[record.cache_key] = { record, inspector: plan.inspector_version, rules: plan.rules_version }
  }
  writeFileSync(cacheFile, JSON.stringify(nextCache), 'utf8')

  const safety = dryRunSafety839(plan, before.listed ?? 0)
  const paid = paidOcrPlan839(plan)
  const worksheets = []
  {
    const { data } = await admin.from('worksheets').select('id,title,created_at,archived_at,layout').in('id', [...TEST_WORKSHEET_IDS_839])
    for (const row of data ?? []) {
      const { count } = await admin.from('worksheet_items').select('id', { count: 'exact', head: true }).eq('worksheet_id', row.id)
      worksheets.push({ ...row, item_count: count ?? 0, looks_like_test: /TEST|HYPER 문제지/i.test(row.title ?? '') })
    }
  }

  const extras = {
    student_care_accessed: false,
    paid_ocr_calls: 0,
    paid_ocr_usd: 0,
    pdf_sha256: pages.pdfSha,
    pages_rendered: pages.rendered,
    pages_reused: pages.reused,
    overlap_838_review_vs_live_needs: overlap,
    leftover_838: { review: leftovers.review.length, blocked: leftovers.blocked.length, auto_safe: leftovers.auto.length },
    paid_ocr_plan: paid,
    mathpix_cache_files: countProviderCache(root, 'mathpix'),
    mistral_cache_files: countProviderCache(root, 'mistral'),
    worksheets,
    before,
  }

  const dry = {
    step: '8.39',
    status: persist ? 'PERSIST_REQUESTED' : 'DRY_RUN',
    ...extras,
    summary: plan.summary,
    integrity: plan.integrity,
    safety,
    examples: plan.applies.slice(0, 12).map((row) => ({
      problem_id: row.problem_id,
      public_code: row.public_code,
      number: row.current_number,
      page: row.source_page,
      from: row.from_stem.slice(0, 240),
      to: row.to_stem.slice(0, 240),
      from_sha256: sha256Bytes(row.from_stem),
      to_sha256: sha256Bytes(row.to_stem),
    })),
  }

  writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify(dry, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ step: '8.39', ...plan, applies: plan.applies }, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.md'), formatQaMarkdown(plan), 'utf8')
  writeFileSync(path.join(root, 'public/step8-39-full-qa.json'), JSON.stringify(publicPayload(plan, extras), null, 2), 'utf8')

  if (!persist) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ ...dry, status: 'DRY_RUN' }, null, 2), 'utf8')
    console.log(
      `STEP 8.39 DRY RUN pages=${plan.summary.pages_inspected} listed=${plan.summary.listed_inspected} pass=${plan.summary.pass} auto=${plan.summary.auto_safe} review=${plan.summary.review_required} paid=${plan.summary.paid_ocr_candidate} blocked=${plan.summary.blocked} applies=${plan.applies.length} safety=${safety.ok}`,
    )
    if (!safety.ok) console.error('safety violations', safety.violations)
    return dry
  }

  if (!safety.ok) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ ...dry, status: 'ABORT_UNSAFE' }, null, 2), 'utf8')
    throw new Error(`DRY RUN safety failed: ${safety.violations.join('; ')}`)
  }

  const staff = await staffClient(url, service)
  const persistRows = []
  for (const apply of plan.applies) {
    const live = catalog.find((row) => row.id === apply.problem_id)
    if (!live || live.current_version_id !== apply.parent_version_id || live.stem !== apply.from_stem) {
      persistRows.push({ problem_id: apply.problem_id, skipped: true, reason: 'current version changed', result: { skipped: true } })
      continue
    }
    const res = await staff.rpc('hqb_apply_auto_clean_text', {
      p_problem_id: apply.problem_id,
      p_cleaned_text: apply.to_stem,
      p_change_reason: `${CHANGE_REASON_839} ${apply.rules.join(',')} ${ASSIGNED_BY_839}`,
    })
    persistRows.push({ problem_id: apply.problem_id, error: res.error?.message ?? null, result: res.data ?? null })
  }

  const afterCatalog = await loadCatalog(admin, root)
  const rerun = inspectCatalog(afterCatalog, { pageHashes: pages.pageHashes, pdfSha: pages.pdfSha })
  const after = await snapshot(admin)
  const localRerun = inspectCatalog(withAppliedStems839(catalog, plan.applies), { pageHashes: pages.pageHashes, pdfSha: pages.pdfSha })
  const outcome = {
    ...dry,
    status: 'PERSISTED',
    persist: {
      attempted: persistRows.length,
      written: persistRows.filter((row) => row.result && (row.result as { skipped?: boolean }).skipped === false).length,
      skipped: persistRows.filter((row) => row.result && (row.result as { skipped?: boolean }).skipped === true).length,
      errors: persistRows.filter((row) => row.error).length,
      rows: persistRows,
    },
    after,
    rerun_applies: rerun.applies.length,
    local_rerun_applies: localRerun.applies.length,
    integrity_after: {
      listed_unchanged: after.listed === before.listed && after.listed === SSEN_LISTED_FROZEN,
      public_code_dups: after.public_code_dups,
      embeddings_unchanged: after.embeddings === before.embeddings,
      fingerprints_unchanged: after.fingerprints === before.fingerprints,
      majors: after.majors,
      needs_review: after.ssen_needs_review,
    },
  }
  writeFileSync(path.join(outDir, 'persist-result.json'), JSON.stringify(outcome, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(outcome, null, 2), 'utf8')
  writeFileSync(path.join(root, 'public/step8-39-full-qa.json'), JSON.stringify(publicPayload(plan, { ...extras, persisted: true, persist: outcome.persist }), null, 2), 'utf8')
  console.log(
    `STEP 8.39 PERSIST written=${outcome.persist.written} skipped=${outcome.persist.skipped} rerun=${rerun.applies.length} listed=${after.listed}`,
  )
  return outcome
}

await runStep839(process.cwd())
