/**
 * Persist 쎈2 AUTO_SAFE drafts. Default dry-run.
 * --persist-auto-safe writes via hqb_upsert_problem_draft_from_identity.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { UPSERT_RPC } from '../recognition/draftUpsert'
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import {
  FORBIDDEN_SOURCE_IDS,
  MATH2_CACHE_DIR,
  MATH2_DOCUMENT_ID,
  MATH2_PAGE_COUNT,
  MATH2_PDF_SHA256,
  MATH2_REPORT_DIR,
  cacheFileName,
} from './math2Ocr'
import {
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
  assertMath2PersistTarget,
  autoSafePersistItems,
  math2UpsertPayload,
  type Math2PersistItem,
} from './math2Persist'
import { refusePersist, runMath2Segment, type Math2PageInput } from './math2Segment'

type CachedPage = { page: number; markdown: string; raw?: MistralOcrLike }

function loadPages(root: string): Math2PageInput[] {
  const pages: Math2PageInput[] = []
  for (let page = 1; page <= MATH2_PAGE_COUNT; page += 1) {
    const file = path.join(root, MATH2_CACHE_DIR, cacheFileName(MATH2_PDF_SHA256, page))
    if (!existsSync(file)) throw new Error(`MATH2_PERSIST_CACHE_MISS: ${file}`)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CachedPage
    pages.push({ page, markdown: raw.markdown ?? '', raw: raw.raw ?? null })
  }
  return pages
}

function adminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) throw new Error('MATH2_PERSIST_SUPABASE: missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  assertMath2PersistTarget(MATH2_DOCUMENT_ID, url)
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function countMath2Sources(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('problem_sources')
    .select('id', { count: 'exact', head: true })
    .eq('source_document_id', MATH2_DOCUMENT_ID)
  if (error) throw new Error(`problem_sources count: ${error.message}`)
  return count ?? 0
}

async function existingIdentities(admin: SupabaseClient): Promise<Set<string>> {
  const found = new Set<string>()
  const { data, error } = await admin
    .from('problem_sources')
    .select('original_problem_number, source_page_id')
    .eq('source_document_id', MATH2_DOCUMENT_ID)
  if (error) throw new Error(`problem_sources list: ${error.message}`)
  const pageIds = [...new Set((data ?? []).map((row) => row.source_page_id).filter(Boolean))] as string[]
  const pages = new Map<string, number>()
  for (let i = 0; i < pageIds.length; i += 80) {
    const { data: pageRows, error: pageError } = await admin
      .from('source_pages')
      .select('id, page_number')
      .in('id', pageIds.slice(i, i + 80))
    if (pageError) throw new Error(`source_pages: ${pageError.message}`)
    for (const page of pageRows ?? []) pages.set(page.id, page.page_number)
  }
  for (const row of data ?? []) {
    const page = pages.get(row.source_page_id as string)
    const number = String(row.original_problem_number ?? '').padStart(4, '0')
    if (page && number) found.add(`${page}|${number}`)
  }
  return found
}

async function ensureMath2Pages(admin: SupabaseClient): Promise<void> {
  const { data, error } = await admin.from('source_pages').select('page_number').eq('source_document_id', MATH2_DOCUMENT_ID).limit(300)
  if (error) throw new Error(`ensure source_pages: ${error.message}`)
  const have = new Set((data ?? []).map((row) => row.page_number))
  const missing = []
  for (let page = 1; page <= MATH2_PAGE_COUNT; page += 1) {
    if (!have.has(page)) {
      missing.push({
        source_document_id: MATH2_DOCUMENT_ID,
        page_number: page,
        extraction_status: 'EXTRACTED',
        review_status: 'UNREVIEWED',
      })
    }
  }
  for (let i = 0; i < missing.length; i += 50) {
    const inserted = await admin.from('source_pages').insert(missing.slice(i, i + 50))
    if (inserted.error) throw new Error(`insert source_pages: ${inserted.error.message}`)
  }
}

async function staffClient(admin: SupabaseClient) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  const email = `math2.persist.${Date.now()}@hyper.local`
  const password = `Math2-${Date.now()}aA1!`
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createdUser.error || !createdUser.data.user) throw new Error(createdUser.error?.message ?? 'create staff')
  await admin.from('user_profiles').upsert({
    user_id: createdUser.data.user.id,
    role: 'TEACHER',
    display_name: 'math2 AUTO_SAFE persist',
  })
  const staff = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await staff.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error(login.error.message)
  return staff
}

export async function runMath2PersistCli(root = process.cwd(), argv = process.argv.slice(2)) {
  const persist = argv.includes('--persist-auto-safe')
  if (!persist) refusePersist(argv)
  for (const forbidden of FORBIDDEN_SOURCE_IDS) {
    if (forbidden === MATH2_DOCUMENT_ID) throw new Error('MATH2_PERSIST_FORBIDDEN: source lock collapsed')
  }
  const pages = loadPages(root)
  const report = runMath2Segment(pages)
  const items = autoSafePersistItems(report.rows)
  const reviewHeld = report.rows.filter((row) => row.verdict !== 'AUTO_SAFE').length
  const dest = path.join(root, MATH2_REPORT_DIR)
  mkdirSync(dest, { recursive: true })

  if (!persist) {
    const summary = {
      phase: 'persist-dry-run',
      persist_problems: false,
      auto_safe: items.length,
      review_held: reviewHeld,
      engine: 'hqb_upsert_problem_draft_from_identity',
      sourceId: MATH2_DOCUMENT_ID,
    }
    writeFileSync(path.join(dest, 'persist-dry-run.json'), JSON.stringify(summary, null, 2), 'utf8')
    console.log(JSON.stringify(summary, null, 2))
    return summary
  }

  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  assertMath2PersistTarget(MATH2_DOCUMENT_ID, url)
  if (url.includes(STUDENT_CARE_REF) || !url.includes(QUESTION_BANK_REF)) {
    throw new Error('MATH2_PERSIST_WRONG_PROJECT')
  }
  const admin = adminClient()
  const before = await countMath2Sources(admin)
  await ensureMath2Pages(admin)
  const already = await existingIdentities(admin)
  const staff = await staffClient(admin)
  let created = 0
  let existing = 0
  const failed: Array<{ page: number; problem_number: string; error: string }> = []
  const createdSamples: Math2PersistItem[] = []

  for (const item of items) {
    const key = `${item.page}|${item.problem_number}`
    if (already.has(key)) {
      existing += 1
      continue
    }
    const rpc = await staff.rpc(UPSERT_RPC, { payload: math2UpsertPayload(item) })
    if (rpc.error) {
      failed.push({ page: item.page, problem_number: item.problem_number, error: rpc.error.message })
      continue
    }
    const body = rpc.data as { created?: boolean; status?: string; problem_id?: string }
    if (body.created === true) {
      created += 1
      already.add(key)
      if (createdSamples.length < 4) createdSamples.push(item)
    } else if (body.problem_id) {
      existing += 1
      already.add(key)
    } else {
      failed.push({ page: item.page, problem_number: item.problem_number, error: JSON.stringify(body) })
    }
  }

  const after = await countMath2Sources(admin)
  const outcome = {
    phase: 'persist-auto-safe',
    persist_problems: true,
    sourceId: MATH2_DOCUMENT_ID,
    engine: UPSERT_RPC,
    before,
    after,
    auto_safe: items.length,
    created,
    existing,
    failed: failed.length,
    review_held: reviewHeld,
    failed_rows: failed.slice(0, 20),
    samples: createdSamples.map((row) => ({ page: row.page, problem_number: row.problem_number })),
  }
  writeFileSync(path.join(dest, 'persist-result.json'), JSON.stringify(outcome, null, 2), 'utf8')
  console.log(JSON.stringify(outcome, null, 2))
  return outcome
}

const isMain = process.argv[1]?.includes('math2PersistCli')
if (isMain) {
  runMath2PersistCli(process.cwd(), process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
