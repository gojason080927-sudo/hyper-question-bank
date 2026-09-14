/**
 * SSEN full classification CLI. Default dry-run. --apply writes AUTO type/unit only.
 * Never DELETE. Never VERIFIED. Never student-care. Never 8.32–8.40 persist replay.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { bboxTop, SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { QUESTION_BANK_REF, STUDENT_CARE_REF, SSEN_LISTED_FROZEN } from './ssenFullQa839'
import { CLASSIFICATION_RPC, CURRICULUM_RPC } from '../taxonomy/classificationPersistence'
import { profileById } from '../taxonomy/typeProfiles'
import {
  CLASSIFY_ASSIGNED_BY,
  classificationPayloadFromDecision,
  planSsenClassify,
  type SsenClassifyItem,
  type SsenHeadingHit,
  type SsenTypeNode,
} from '../taxonomy/ssenFullClassify'

const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const persist = process.argv.includes('--persist') || process.argv.includes('--apply')
const OUT_DIR = 'ocr-tests/taxonomy/ssen-classify'

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

export async function runSsenClassify(root = process.cwd()) {
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
    const { data, error } = await admin.from('source_pages').select('id,page_number,extracted_text').in('id', pageIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    pages.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const pageMap = Object.fromEntries(pages.map((row) => [String(row.id), row]))
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
      existing_type_code: null,
    }
  })

  const nodes = await paged(admin, 'source_outline_nodes', 'id,code,title_original,node_level,parent_id,source_document_id', (q) =>
    q.eq('source_document_id', SSEN_SOURCE_DOCUMENT_ID),
  )
  const sections = nodes.filter((row) => row.node_level === 'SECTION')
  const sectionCode = Object.fromEntries(sections.map((row) => [String(row.id), String(row.code ?? '')]))
  const types: SsenTypeNode[] = nodes
    .filter((row) => row.node_level === 'TYPE_SEGMENT')
    .map((row) => ({
      id: String(row.id),
      code: String(row.code ?? '').padStart(2, '0'),
      title: String(row.title_original ?? ''),
      sectionCode: sectionCode[String(row.parent_id ?? '')] ?? '',
    }))
    .filter((row) => row.sectionCode)

  const pageOcrByPage = new Map<number, string>()
  for (const page of pages) {
    const n = Number(page.page_number)
    const text = String(page.extracted_text ?? '')
    if (n && text.length > (pageOcrByPage.get(n) ?? '').length) pageOcrByPage.set(n, text)
  }
  const headings = loadHeadings(root)

  const listed = items.filter((row) => row.display_state === 'LISTED')
  if (listed.length !== SSEN_LISTED_FROZEN) throw new Error(`listed ${listed.length} != ${SSEN_LISTED_FROZEN}`)
  const planned = planSsenClassify(items, types, pageOcrByPage, headings)
  const outDir = path.join(root, OUT_DIR)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })
  const dry = {
    status: persist ? 'DRY_RUN_BEFORE_PERSIST' : 'DRY_RUN',
    source_id: SSEN_SOURCE_DOCUMENT_ID,
    headings: headings.length,
    summary: planned.summary,
    human_reasons: tally(planned.decisions.filter((row) => row.verdict === 'HUMAN').flatMap((row) => row.reasons)),
    needs_review: planned.decisions.filter((row) => items.find((item) => item.problem_id === row.problem_id)?.review_status === 'NEEDS_REVIEW'),
  }
  writeFileSync(path.join(outDir, 'dry-run.json'), JSON.stringify({ ...dry, decisions: planned.decisions }, null, 2), 'utf8')
  writeDashboard(root, planned.summary, { live_needs_review: listed.filter((row) => row.review_status === 'NEEDS_REVIEW').length, persisted: false })
  console.log(JSON.stringify({ phase: persist ? 'dry-run-before-persist' : 'dry-run', headings: headings.length, summary: planned.summary, human_reasons: dry.human_reasons }, null, 2))
  if (!persist) return dry

  const staff = await staffClient(url, service)
  const ensured = await staff.rpc(CURRICULUM_RPC)
  if (ensured.error) throw new Error(`curriculum: ${ensured.error.message}`)

  const auto = planned.decisions.filter((row) => row.verdict === 'AUTO')
  const persistRows: Array<Record<string, unknown>> = []
  let stopped: string | null = null
  for (const decision of auto) {
    if (stopped) {
      persistRows.push({ problem_id: decision.problem_id, skipped: true, reason: `atomic stop: ${stopped}` })
      continue
    }
    const item = items.find((row) => row.problem_id === decision.problem_id)
    const profile = decision.type_id ? profileById(decision.type_id) : undefined
    if (!item?.current_version_id || !profile) {
      persistRows.push({ problem_id: decision.problem_id, skipped: true, reason: 'missing_profile_or_version' })
      continue
    }
    const rpc = await staff.rpc(CLASSIFICATION_RPC, {
      payload: classificationPayloadFromDecision(decision, item.current_version_id, profile),
    })
    if (rpc.error) {
      stopped = rpc.error.message
      persistRows.push({ problem_id: decision.problem_id, error: rpc.error.message })
      continue
    }
    if (decision.outline_type_node_id) {
      await staff.rpc('hqb_assign_problem_outline', {
        payload: {
          problem_id: decision.problem_id,
          outline_node_id: decision.outline_type_node_id,
          is_primary: false,
          assigned_by: CLASSIFY_ASSIGNED_BY,
          confidence: 0.9,
        },
      })
    }
    persistRows.push({ problem_id: decision.problem_id, error: null, result: rpc.data ?? null })
  }

  let cleared = 0
  if (!stopped) {
    for (const decision of planned.decisions.filter((row) => row.clear_needs_review)) {
      const item = items.find((row) => row.problem_id === decision.problem_id)
      if (!item?.current_version_id) continue
      const ver = await admin
        .from('problem_versions')
        .update({ review_status: 'AUTO_CLASSIFIED' })
        .eq('id', item.current_version_id)
        .eq('problem_id', item.problem_id)
      if (ver.error) throw new Error(ver.error.message)
      const prob = await admin
        .from('problems')
        .update({ review_status: 'AUTO_CLASSIFIED' })
        .eq('id', item.problem_id)
        .neq('review_status', 'VERIFIED')
      if (prob.error) throw new Error(prob.error.message)
      cleared += 1
    }
    await staff.rpc('hqb_sync_source_pipeline_status', {
      p_document_id: SSEN_SOURCE_DOCUMENT_ID,
      payload: { ocr_status: 'SUCCEEDED', extraction_status: 'MANUAL' },
    })
  }

  const afterNeeds: Array<{ id: string; review_status: string }> = []
  const listedIds = listed.map((row) => row.problem_id)
  for (let i = 0; i < listedIds.length; i += 80) {
    const { data, error } = await admin.from('problems').select('id,review_status').in('id', listedIds.slice(i, i + 80))
    if (error) throw new Error(error.message)
    afterNeeds.push(...((data ?? []) as Array<{ id: string; review_status: string }>))
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
      atomic_stop: stopped,
      cleared_needs_review: cleared,
    },
    live_needs_review_after: liveNeeds,
  }
  writeFileSync(path.join(outDir, 'persist-result.json'), JSON.stringify({ ...outcome, rows: persistRows }, null, 2), 'utf8')
  writeDashboard(root, planned.summary, { live_needs_review: liveNeeds, persisted: true, persist: outcome.persist })
  console.log(`SSEN CLASSIFY PERSIST written=${outcome.persist.written} cleared=${cleared} stop=${stopped ?? 'none'} needs=${liveNeeds}`)
  if (stopped) throw new Error(stopped)
  return outcome
}

function loadHeadings(root: string): SsenHeadingHit[] {
  const file = path.join(root, OUT_DIR, 'page-headings.json')
  if (!existsSync(file)) return []
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { hits?: SsenHeadingHit[] }
  return Array.isArray(raw.hits) ? raw.hits : []
}

function tally(keys: string[]): Record<string, number> {
  const bag: Record<string, number> = {}
  for (const key of keys) bag[key] = (bag[key] ?? 0) + 1
  return bag
}

function writeDashboard(root: string, summary: Record<string, number>, extras: Record<string, unknown>) {
  const payload = {
    source_id: SSEN_SOURCE_DOCUMENT_ID,
    title: '쎈수학 공통수학1',
    inspected_at: new Date().toISOString(),
    assigned_by: CLASSIFY_ASSIGNED_BY,
    listed: SSEN_LISTED_FROZEN,
    auto: summary.auto,
    human: summary.human,
    type_mapped: summary.type_mapped,
    banner:
      summary.human === 0
        ? `전체 분류 완료 · 유형 AUTO ${summary.auto}/${SSEN_LISTED_FROZEN}`
        : `유형 AUTO ${summary.auto}/${SSEN_LISTED_FROZEN} · 잔여 ${summary.human}`,
    ...extras,
  }
  writeFileSync(path.join(root, 'public/ssen-classify-status.json'), JSON.stringify(payload, null, 2), 'utf8')
}

const isMain = process.argv[1]?.includes('ssenFullClassifyCli')
if (isMain) {
  await runSsenClassify(process.cwd())
}
