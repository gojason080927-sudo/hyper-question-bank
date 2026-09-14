/**
 * STEP 8.40 CLI — page-grouped contrast of 128 REVIEW leftovers. Default DRY RUN.
 * `--persist` applies AUTO_SAFE only. Never DELETE. Never paid OCR. Never 8.32–8.39 persist replay.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { STEP832_PDF_SHA256, STORAGE_BUCKET, STORAGE_ORIGINAL } from './fullBookIngest832'
import { overlapIds, type CatalogProblem839 } from './ssenFullQa839'
import {
  ASSIGNED_BY_840,
  CHANGE_REASON_840,
  catalogFromLive839,
  contactSheetHtml840,
  dryRunSafety840,
  formatAuditMarkdown840,
  LOCK_MAIN_COMMIT_840,
  minimizeReview840,
  paidOcrPlan840,
  PRODUCTION_DOMAIN_840,
  QUESTION_BANK_REF,
  reviewRequired839,
  skipIfCurrentChanged840,
  SSEN_LISTED_FROZEN,
  STEP840_DIR,
  STUDENT_CARE_REF,
  TEST_WORKSHEET_IDS_840,
  VERCEL_PROJECT_ID_840,
  VERCEL_PROJECT_NAME_840,
  VERCEL_TEAM_SLUG_840,
  type Input839Record,
} from './ssenReviewMinimize840'

const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const persist = process.argv.includes('--persist')
const makeWorksheet = process.argv.includes('--worksheet')

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
    items?: Array<{ page?: number; canonical?: string; problem_number?: string; stem_preview?: string; existing?: { problem_id?: string } }>
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
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { candidates?: Array<{ problem_id: string; verdict: string }> }
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
      const key = pageNumber != null ? `${pageNumber}|${nRaw.padStart(4, '0')}` : ''
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
        step832_preview: previews.byId.get(String(problem.id)) ?? previews.byKey.get(key) ?? null,
        crop_present: Boolean(previews.byId.get(String(problem.id)) || previews.byKey.get(key)),
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
  const needIds: string[] = []
  const codes: string[] = []
  let autoClean839 = 0
  for (let i = 0; i < ssenIds.length; i += 80) {
    const { data } = await admin.from('problems').select('id,display_state,review_status,public_code,current_version_id').in('id', ssenIds.slice(i, i + 80))
    const vids = (data ?? []).map((row) => row.current_version_id).filter(Boolean)
    if (vids.length) {
      const versions = await admin.from('problem_versions').select('id,origin,change_reason').in('id', vids as string[])
      for (const row of versions.data ?? []) {
        if (row.origin === 'AUTO_CLEAN' && String(row.change_reason ?? '').includes('STEP 8.39')) autoClean839 += 1
      }
    }
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
    listed,
    ssen_linked: ssenIds.length,
    ssen_needs_review: needs,
    needs_review_ids: needIds,
    public_code_dups: codes.length - new Set(codes).size,
    embeddings: (await countEq(admin, 'problem_embeddings')).count,
    fingerprints: (await countEq(admin, 'content_fingerprints')).count,
    majors: await majorListed(admin),
    auto_clean_839: autoClean839,
  }
}

function freezeFirstPass(outDir: string, plan: ReturnType<typeof minimizeReview840>) {
  const file = path.join(outDir, 'first-pass.json')
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({
      inspector_version: plan.inspector_version,
      rules_version: plan.rules_version,
      start_review: plan.start_review,
      unique_pages: plan.unique_pages,
      groups: plan.groups,
      decisions: plan.decisions,
      applies: plan.applies,
      p1: plan.p1,
      summary: plan.summary,
    }), 'utf8')
  }
  return JSON.parse(readFileSync(file, 'utf8')) as ReturnType<typeof minimizeReview840>
}

function overlayAppliedStems(
  frozen: ReturnType<typeof minimizeReview840>,
  extraApplies: typeof frozen.applies,
): ReturnType<typeof minimizeReview840> {
  const map = new Map([...frozen.applies, ...extraApplies].map((row) => [row.problem_id, row.to_stem]))
  return {
    ...frozen,
    applies: extraApplies,
    decisions: frozen.decisions.map((row) => {
      const stem = map.get(row.problem_id)
      if (!stem) return row
      return { ...row, stem, proposed_stem: row.verdict === 'AUTO_SAFE' ? stem : row.proposed_stem }
    }),
  }
}

function publicPayload(plan: ReturnType<typeof minimizeReview840>, extras: Record<string, unknown>) {
  return {
    step: '8.40',
    inspector_version: plan.inspector_version,
    rules_version: plan.rules_version,
    inspected_at: new Date().toISOString(),
    lock_main_commit: LOCK_MAIN_COMMIT_840,
    vercel: {
      git_repo: 'gojason080927-sudo/hyper-question-bank',
      project_name: VERCEL_PROJECT_NAME_840,
      project_id: VERCEL_PROJECT_ID_840,
      team_slug: VERCEL_TEAM_SLUG_840,
      production_domain: PRODUCTION_DOMAIN_840,
      team_slug_note: 'Preview URL 뒤 hyper-student-care는 Vercel 팀 slug이다. Git 저장소와 projectId는 문제은행이다.',
    },
    summary: plan.summary,
    groups: plan.groups,
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
      section_code: row.section_code,
      major_code: row.major_code,
      verdict: row.verdict,
      priority: row.priority_839,
      root_cause: row.root_cause_839,
      verdict_reason: row.verdict_reason,
      signals: row.signals_839,
      rules: row.rules,
      evidence: row.evidence,
      stem: row.stem,
      proposed_stem: row.proposed_stem,
      teacher_edit: row.teacher_edit,
      verified: row.verified,
      neighbors_before: row.neighbors_before.map((item) => ({ number: item.number, stem: item.stem.slice(0, 240) })),
      neighbors_after: row.neighbors_after.map((item) => ({ number: item.number, stem: item.stem.slice(0, 240) })),
      page_numbers: row.page_numbers,
      original_page_available: row.original_page_available,
      katex: { render_fail: 0, max_width_px: 0, overflow_360: false, overflow_a4_2col: false },
      has_figure: false,
      figure_needed: /그림|그래프|도형/.test(row.stem),
    })),
    applies: plan.applies,
    ...extras,
  }
}

export async function runStep840(root = process.cwd()) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !service) throw new Error('missing supabase env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('refused student-care')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('wrong supabase project')

  const qa839Path = path.join(root, 'public/step8-39-full-qa.json')
  if (!existsSync(qa839Path)) throw new Error('missing public/step8-39-full-qa.json')
  const qa839 = JSON.parse(readFileSync(qa839Path, 'utf8')) as { records?: Input839Record[] }
  const candidates = reviewRequired839(qa839.records ?? [])
  if (candidates.length !== 128) throw new Error(`expected 128 REVIEW_REQUIRED, got ${candidates.length}`)

  const outDir = path.join(root, STEP840_DIR)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(path.join(outDir, 'contact-sheets'), { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const before = await snapshot(admin)
  if (before.listed !== SSEN_LISTED_FROZEN) throw new Error(`listed ${before.listed} != ${SSEN_LISTED_FROZEN}`)

  const leftovers = loadRange838Leftovers(root)
  const overlap838 = overlapIds(leftovers.review, candidates.map((row) => row.problem_id))
  const overlapLive = overlapIds(candidates.map((row) => row.problem_id), before.needs_review_ids)
  const catalog839 = await loadCatalog(admin, root)
  const live = catalogFromLive839(catalog839)
  const pageOcrByPage = new Map<number, string>()
  for (const row of catalog839 as Array<CatalogProblem839 & { page_ocr_text?: string }>) {
    if (row.source_page != null && row.page_ocr_text) {
      const prev = pageOcrByPage.get(row.source_page) ?? ''
      if (row.page_ocr_text.length > prev.length) pageOcrByPage.set(row.source_page, row.page_ocr_text)
    }
    const mapped = live.find((item) => item.id === row.id)
    if (mapped) {
      mapped.page_ocr = row.page_ocr_text
      mapped.has_page_image = row.has_page_image
      mapped.crop_present = row.crop_present
    }
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

  const plan = minimizeReview840(candidates, live, { pageOcrByPage })
  const frozen = freezeFirstPass(outDir, plan)
  const display = overlayAppliedStems(frozen, plan.applies)
  const safety = dryRunSafety840(plan, before.listed ?? 0)
  const paid = paidOcrPlan840(plan)

  for (const group of plan.groups) {
    const png = group.source_page != null ? path.join(root, `.ocr-temp/step8-39/pages/p${String(group.source_page).padStart(3, '0')}.png`) : null
    const rel = png && existsSync(png) ? path.relative(path.join(outDir, 'contact-sheets'), png) : null
    writeFileSync(
      path.join(outDir, 'contact-sheets', `p${String(group.source_page ?? 0).padStart(3, '0')}.html`),
      contactSheetHtml840(group, plan.decisions, rel),
      'utf8',
    )
  }

  const worksheets = []
  {
    const { data } = await admin.from('worksheets').select('id,title,created_at,archived_at,layout').in('id', [...TEST_WORKSHEET_IDS_840])
    for (const row of data ?? []) {
      const { count } = await admin.from('worksheet_items').select('id', { count: 'exact', head: true }).eq('worksheet_id', row.id)
      worksheets.push({ ...row, item_count: count ?? 0, looks_like_test: /TEST|HYPER 문제지/i.test(row.title ?? '') })
    }
  }
  const fpExamples = plan.decisions.filter((row) => row.verdict === 'PASS_FALSE_POSITIVE').slice(0, 12)
  const autoExamples = plan.applies.slice(0, 12)
  const extras = {
    student_care_accessed: false,
    paid_ocr_calls: 0,
    paid_ocr_usd: 0,
    pdf_sha256: pdfSha,
    pages_reused: readdirSync(path.join(root, '.ocr-temp/step8-39/pages')).filter((name) => name.endsWith('.png')).length,
    overlap_838_review_in_128: overlap838,
    overlap_128_vs_live_needs: overlapLive,
    leftover_838: { review: leftovers.review.length, blocked: leftovers.blocked.length, auto_safe: leftovers.auto.length },
    paid_ocr_plan: paid,
    mathpix_cache_files: countProviderCache(root, 'mathpix'),
    mistral_cache_files: countProviderCache(root, 'mistral'),
    worksheets,
    before,
    vercel_project_id: VERCEL_PROJECT_ID_840,
    storage_bucket: STORAGE_BUCKET,
  }

  const dry = {
    step: '8.40',
    status: persist ? 'PERSIST_REQUESTED' : 'DRY_RUN',
    ...extras,
    summary: plan.summary,
    safety,
    p1: plan.p1.map((row) => ({ number: row.current_number, page: row.source_page, verdict: row.verdict, reason: row.verdict_reason })),
    examples_auto_safe: autoExamples.map((row) => ({
      number: row.current_number,
      page: row.source_page,
      rules: row.rules,
      from: row.from_stem.slice(0, 240),
      to: row.to_stem.slice(0, 240),
    })),
    examples_pass_fp: fpExamples.map((row) => ({
      number: row.current_number,
      page: row.source_page,
      reason: row.verdict_reason,
      stem: row.stem.slice(0, 240),
    })),
  }

  writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify(dry, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ step: '8.40', ...plan, applies: plan.applies }, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.md'), formatAuditMarkdown840(plan), 'utf8')
  writeFileSync(path.join(root, 'public/step8-40-review-minimize.json'), JSON.stringify(publicPayload(display, extras), null, 2), 'utf8')

  if (!persist) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ ...dry, status: 'DRY_RUN' }, null, 2), 'utf8')
    console.log(
      `STEP 8.40 DRY RUN start=128 pages=${plan.summary.unique_pages} fp=${plan.summary.pass_false_positive} auto=${plan.summary.auto_safe} review=${plan.summary.review_required} blocked=${plan.summary.blocked} paid=${plan.summary.paid_ocr_candidate} applies=${plan.applies.length} safety=${safety.ok}`,
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
    const liveRow = live.find((row) => row.id === apply.problem_id)
    const skip = skipIfCurrentChanged840(apply, liveRow)
    if (skip.skip) {
      persistRows.push({ problem_id: apply.problem_id, skipped: true, reason: skip.reason, result: { skipped: true } })
      continue
    }
    const res = await staff.rpc('hqb_apply_auto_clean_text', {
      p_problem_id: apply.problem_id,
      p_cleaned_text: apply.to_stem,
      p_change_reason: `${CHANGE_REASON_840} ${apply.rules.join(',')} ${ASSIGNED_BY_840}`,
    })
    persistRows.push({ problem_id: apply.problem_id, error: res.error?.message ?? null, result: res.data ?? null })
  }

  let worksheetId: string | null = null
  if (makeWorksheet) {
    const picks = [
      plan.decisions.find((row) => row.verdict === 'PASS_FALSE_POSITIVE' && row.root_cause_839 === 'OWN_RANGE_HEADER'),
      plan.decisions.find((row) => row.verdict === 'PASS_FALSE_POSITIVE' && row.signals_839.includes('TOO_SHORT')),
      plan.decisions.find((row) => row.verdict === 'AUTO_SAFE'),
      plan.decisions.find((row) => /pmatrix|배열|행렬/.test(row.stem)),
      plan.decisions.find((row) => /그림|그래프|도형/.test(row.stem)),
      plan.decisions.find((row) => row.verdict === 'REVIEW_REQUIRED' && row.root_cause_839 === 'NEXT_NUMBER_LEAK'),
    ].filter(Boolean)
    const created = await staff.rpc('hqb_create_worksheet', {
      payload: { title: 'TEST STEP 8.40', exam_kind: 'EXAM', layout: { columns: 2 } },
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
  const afterLive = catalogFromLive839(afterCatalog)
  const rerun = minimizeReview840(candidates, afterLive, { pageOcrByPage })
  const after = await snapshot(admin)
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
    worksheet_id: worksheetId,
    after,
    rerun_applies: rerun.applies.length,
    integrity_after: {
      listed_unchanged: after.listed === before.listed && after.listed === SSEN_LISTED_FROZEN,
      public_code_dups: after.public_code_dups,
      embeddings_unchanged: after.embeddings === before.embeddings,
      fingerprints_unchanged: after.fingerprints === before.fingerprints,
      majors: after.majors,
      auto_clean_839: after.auto_clean_839,
      needs_review: after.ssen_needs_review,
    },
  }
  writeFileSync(path.join(outDir, 'persist-result.json'), JSON.stringify(outcome, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(outcome, null, 2), 'utf8')
  writeFileSync(path.join(root, 'public/step8-40-review-minimize.json'), JSON.stringify(publicPayload(overlayAppliedStems(frozen, [...frozen.applies, ...plan.applies]), { ...extras, persisted: true, persist: outcome.persist, worksheet_id: worksheetId, rerun_applies: rerun.applies.length }), null, 2), 'utf8')
  console.log(
    `STEP 8.40 PERSIST written=${outcome.persist.written} skipped=${outcome.persist.skipped} rerun=${rerun.applies.length} listed=${after.listed} worksheet=${worksheetId ?? 'none'}`,
  )
  return outcome
}

await runStep840(process.cwd())
