/**
 * STEP 8.38 CLI — DRY RUN by default. `--persist` applies AUTO_SAFE only.
 * Never DELETE. Never paid OCR. Never student-care.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import {
  ASSIGNED_BY_838,
  buildRangeRestorePlan,
  CHANGE_REASON_838,
  dryRunSafety838,
  formatAuditMarkdown,
  QUESTION_BANK_REF,
  SSEN_LISTED_FROZEN,
  STEP838_DIR,
  STUDENT_CARE_REF,
  TEST_WORKSHEET_IDS_838,
  withAppliedStems,
  type CatalogProblem838,
  type RangePlan838,
} from './rangeStemRestore838'

const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const persist = process.argv.includes('--persist')

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
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

function loadStep832Previews(root: string): { byId: Map<string, string>; byKey: Map<string, string> } {
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

async function loadCatalog(admin: SupabaseClient, root: string): Promise<CatalogProblem838[]> {
  const previews = loadStep832Previews(root)
  const links = await paged(admin, 'problem_sources', 'problem_id,original_problem_number,source_page_id', (q) =>
    q.eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID).eq('is_primary_source', true),
  )
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
    const { data, error } = await admin
      .from('problem_versions')
      .select('id,problem_text,origin,parent_version_id,version_no,instruction')
      .in('id', versionIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    versions.push(...((data ?? []) as Array<Record<string, unknown>>))
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
  const nmap = Object.fromEntries(nodes.map((row) => [String(row.id), row]))
  const omap = Object.fromEntries(outlines.map((row) => [String(row.problem_id), nmap[String(row.outline_node_id)]]))

  return links.map((link) => {
    const problem = pmap[String(link.problem_id)]
    if (!problem) return null
    const version = problem.current_version_id ? vmap[String(problem.current_version_id)] : null
    const page = link.source_page_id ? pageMap[String(link.source_page_id)] : null
    const nRaw = String(link.original_problem_number ?? '')
    const n = Number(nRaw)
    const pageNumber = typeof page?.page_number === 'number' ? page.page_number : null
    const key = pageNumber != null ? `${pageNumber}|${nRaw.padStart(4, '0')}` : ''
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
      section_code: omap[String(problem.id)]?.code ? String(omap[String(problem.id)].code) : null,
      stem: String(version?.problem_text ?? ''),
      instruction: version?.instruction ? String(version.instruction) : null,
      source_document_id: SSEN_SOURCE_DOCUMENT_ID,
      has_page_image: Boolean(page?.page_image_path),
      page_ocr_chars: typeof page?.text_char_count === 'number' ? page.text_char_count : 0,
      step832_preview: previews.byId.get(String(problem.id)) ?? previews.byKey.get(key) ?? null,
      crop_present: Boolean(previews.byId.get(String(problem.id)) || previews.byKey.get(key)),
    } satisfies CatalogProblem838
  }).filter((row): row is CatalogProblem838 => Boolean(row))
}

async function majorListed(admin: SupabaseClient) {
  const assignments = await paged(admin, 'problem_outline_assignments', 'problem_id,outline_node_id,is_primary', (q) => q.eq('is_primary', true))
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
      if (row.review_status === 'NEEDS_REVIEW') needs += 1
    }
  }
  const dup = codes.length - new Set(codes).size
  return {
    drafts: (await countEq(admin, 'problems', { lifecycle_status: 'DRAFT' })).count,
    listed,
    ssen_linked: ssenIds.length,
    ssen_needs_review: needs,
    public_code_dups: dup,
    embeddings: (await countEq(admin, 'problem_embeddings')).count,
    fingerprints: (await countEq(admin, 'content_fingerprints')).count,
    majors: await majorListed(admin),
  }
}

function examples(plan: RangePlan838, n = 10) {
  return plan.applies.slice(0, n).map((row) => ({
    problem_id: row.problem_id,
    public_code: row.public_code,
    number: row.current_number,
    page: row.source_page,
    role: row.role,
    range: row.range,
    from: row.from_stem,
    to: row.to_stem,
    from_sha256: sha256(row.from_stem),
    to_sha256: sha256(row.to_stem),
  }))
}

export async function runStep838(root = process.cwd()) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !service) throw new Error('missing supabase env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('refused student-care')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('wrong supabase project')

  const outDir = path.join(root, STEP838_DIR)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const before = await snapshot(admin)
  const catalog = await loadCatalog(admin, root)
  const plan = buildRangeRestorePlan(catalog)
  const safety = dryRunSafety838(plan, before.listed ?? 0)
  const worksheets = []
  {
    const { data } = await admin
      .from('worksheets')
      .select('id,title,created_at,archived_at,layout')
      .in('id', [...TEST_WORKSHEET_IDS_838])
    for (const row of data ?? []) {
      const { count } = await admin.from('worksheet_items').select('id', { count: 'exact', head: true }).eq('worksheet_id', row.id)
      worksheets.push({ ...row, item_count: count ?? 0, looks_like_test: /TEST|HYPER 문제지/i.test(row.title ?? '') })
    }
  }

  const dry = {
    step: '8.38',
    status: persist ? 'PERSIST_REQUESTED' : 'DRY_RUN',
    student_care_accessed: false,
    paid_ocr_calls: 0,
    paid_ocr_usd: 0,
    before,
    gap_vs_63: {
      step836_merged_flagged: 63,
      all_current_stems_with_range: plan.summary.candidates,
      listed: plan.summary.listed_range_hits,
      hidden: plan.summary.hidden_range_hits,
      later_leaks: plan.summary.later_leaks,
      reason:
        '8.36 counted every SSEN-linked current stem with [n~m], including 5 HIDDEN_DUPLICATE rows. Listed-only is 58. Do not pad to 63.',
    },
    summary: plan.summary,
    safety,
    examples: examples(plan),
    worksheets,
  }

  writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify(dry, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ step: '8.38', ...plan }, null, 2), 'utf8')
  writeFileSync(path.join(outDir, 'audit.md'), formatAuditMarkdown(plan), 'utf8')
  writeFileSync(
    path.join(root, 'public/step8-38-range-audit.json'),
    JSON.stringify(
      {
        step: '8.38',
        summary: plan.summary,
        candidates: plan.candidates,
      },
      null,
      2,
    ),
    'utf8',
  )

  if (!persist) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ ...dry, status: 'DRY_RUN' }, null, 2), 'utf8')
    console.log(
      `STEP 8.38 DRY RUN candidates=${plan.summary.candidates} auto=${plan.summary.auto_safe} review=${plan.summary.review_required} blocked=${plan.summary.blocked} applies=${plan.applies.length} listed=${before.listed} safety=${safety.ok}`,
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
    const res = await staff.rpc('hqb_apply_auto_clean_text', {
      p_problem_id: apply.problem_id,
      p_cleaned_text: apply.to_stem,
      p_change_reason: `${CHANGE_REASON_838} ${apply.role} ${apply.range} ${ASSIGNED_BY_838}`,
    })
    persistRows.push({
      problem_id: apply.problem_id,
      role: apply.role,
      error: res.error?.message ?? null,
      result: res.data ?? null,
    })
  }

  const afterCatalog = await loadCatalog(admin, root)
  const rerun = buildRangeRestorePlan(afterCatalog)
  const after = await snapshot(admin)
  const appliedLocal = withAppliedStems(catalog, plan.applies)
  const localRerun = buildRangeRestorePlan(appliedLocal)

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
    integrity: {
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
  writeFileSync(
    path.join(root, 'public/step8-38-range-audit.json'),
    JSON.stringify({ step: '8.38', summary: rerun.summary, candidates: rerun.candidates, persisted: true }, null, 2),
    'utf8',
  )
  console.log(
    `STEP 8.38 PERSIST written=${outcome.persist.written} skipped=${outcome.persist.skipped} rerun=${rerun.applies.length} listed=${after.listed}`,
  )
  return outcome
}

await runStep838(process.cwd())
