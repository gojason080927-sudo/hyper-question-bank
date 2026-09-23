/**
 * Classify already-persisted 공통수학2 drafts via existing HYPER RPC.
 * Skips 쎈1 and any version that already has classification meta.
 * Never writes REVIEW. Never touches problem_text / identity.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { CLASSIFICATION_RPC, TYPE_DICTIONARY_RPC } from '../taxonomy/classificationPersistence'
import { CM2_CURRICULUM_SEED, CM2_TYPE_PROFILES, cm2DictionaryPayload } from '../taxonomy/cm2Catalog'
import { classifyCm2Problem, cm2ClassificationPayload, structureFromPageTexts, type Cm2Decision } from '../taxonomy/cm2Classify'
import { GANYEOM2_SPEC, GOJAENG2_SPEC, ILDEUNG2_SPEC, RPM2_SPEC } from './bookIngestSpec'
import { MATH2_DOCUMENT_ID, MATH2_TITLE } from './math2Ocr'
import { QUESTION_BANK_REF, STUDENT_CARE_REF } from './math2Persist'

export const CLASSIFY_TARGETS = [
  { slug: 'math2', sourceId: MATH2_DOCUMENT_ID, title: MATH2_TITLE },
  { slug: GANYEOM2_SPEC.slug, sourceId: GANYEOM2_SPEC.sourceId, title: GANYEOM2_SPEC.title },
  { slug: RPM2_SPEC.slug, sourceId: RPM2_SPEC.sourceId, title: RPM2_SPEC.title },
  { slug: GOJAENG2_SPEC.slug, sourceId: GOJAENG2_SPEC.sourceId, title: GOJAENG2_SPEC.title },
  { slug: ILDEUNG2_SPEC.slug, sourceId: ILDEUNG2_SPEC.sourceId, title: ILDEUNG2_SPEC.title },
] as const

const REPORT_DIR = 'ocr-tests/taxonomy/book-classify'

async function paged<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  apply?: (q: ReturnType<SupabaseClient['from']>) => ReturnType<SupabaseClient['from']>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  const size = 1000
  while (true) {
    let q = admin.from(table).select(columns).range(from, from + size - 1) as ReturnType<SupabaseClient['from']>
    if (apply) q = apply(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if ((data ?? []).length < size) break
    from += size
  }
  return rows
}

function adminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) throw new Error('BOOK_CLASSIFY_SUPABASE: missing env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('BOOK_CLASSIFY_FORBIDDEN: hyper-student-care refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('BOOK_CLASSIFY_WRONG_PROJECT')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function staffClient(admin: SupabaseClient) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  const email = 'hqb.pipeline.bookclassify@hyper.local'
  const password = 'BookClassify-46a3aA1!'
  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const found = existing.data?.users.find((user) => user.email === email)
  if (!found) {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? 'create staff')
    await admin.from('user_profiles').upsert({
      user_id: created.data.user.id,
      role: 'TEACHER',
      display_name: 'book classify cm2',
    })
  } else {
    await admin.from('user_profiles').upsert({
      user_id: found.id,
      role: 'TEACHER',
      display_name: 'book classify cm2',
    })
  }
  const staff = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await staff.auth.signInWithPassword({ email, password })
  if (login.error) {
    await admin.auth.admin.updateUserById(found?.id ?? '', { password })
    const retry = await staff.auth.signInWithPassword({ email, password })
    if (retry.error) throw new Error(retry.error.message)
    return staff
  }
  return staff
}

async function ensureCm2Curriculum(admin: SupabaseClient) {
  const { data: fw, error: fwError } = await admin.from('curriculum_frameworks').select('id').eq('code', 'KR_2022').maybeSingle()
  if (fwError || !fw?.id) throw new Error(fwError?.message ?? 'KR_2022 missing')
  const frameworkId = fw.id
  const { data: high } = await admin.from('curriculum_nodes').select('id').eq('code', 'HIGH').eq('node_type', 'SCHOOL_LEVEL').maybeSingle()
  if (!high) throw new Error('HIGH node missing')

  async function ensure(parentId: string, code: string, name: string, nodeType: string, sort: number): Promise<string> {
    const { data: hit } = await admin.from('curriculum_nodes').select('id').eq('framework_id', frameworkId).eq('code', code).maybeSingle()
    if (hit?.id) return hit.id
    const inserted = await admin
      .from('curriculum_nodes')
      .insert({ framework_id: frameworkId, parent_id: parentId, node_type: nodeType, code, name, sort_order: sort, active: true })
      .select('id')
      .single()
    if (inserted.error || !inserted.data) throw new Error(`curriculum ${code}: ${inserted.error?.message ?? 'insert failed'}`)
    return inserted.data.id
  }

  const gradeId = await ensure(high.id, CM2_CURRICULUM_SEED.grade.code, CM2_CURRICULUM_SEED.grade.name, 'GRADE', 2)
  const subjectId = await ensure(gradeId, CM2_CURRICULUM_SEED.subject.code, CM2_CURRICULUM_SEED.subject.name, 'SUBJECT', 1)
  const unitIds: Record<string, string> = {}
  for (const unit of CM2_CURRICULUM_SEED.units) {
    unitIds[unit.code] = await ensure(subjectId, unit.code, unit.name, 'UNIT', unit.sort)
  }
  for (const sub of CM2_CURRICULUM_SEED.subunits) {
    await ensure(unitIds[sub.unit]!, sub.code, sub.name, 'SUBUNIT', sub.sort)
  }
}

async function ensureCm2Types(staff: SupabaseClient) {
  for (const type of CM2_TYPE_PROFILES) {
    const rpc = await staff.rpc(TYPE_DICTIONARY_RPC, { payload: cm2DictionaryPayload(type) })
    if (rpc.error) throw new Error(`type ${type.type_id}: ${rpc.error.message}`)
  }
}

type SourceRow = {
  problem_id: string
  original_problem_number: string
  source_page_id: string
  source_document_id: string
}

export async function runBookClassifyCli(root = process.cwd(), argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply') || argv.includes('--persist')
  const only = argv.find((arg) => arg.startsWith('--book='))?.slice('--book='.length)
  const targets = CLASSIFY_TARGETS.filter((row) => !only || row.slug === only)
  if (!targets.length) throw new Error(`BOOK_CLASSIFY_UNKNOWN: ${only}`)
  for (const target of targets) {
    if (target.sourceId === SSEN_SOURCE_DOCUMENT_ID) throw new Error('BOOK_CLASSIFY_FORBIDDEN: 쎈1 is skipped')
  }

  const admin = adminClient()
  const staff = apply ? await staffClient(admin) : null
  if (apply) {
    await ensureCm2Curriculum(admin)
    await ensureCm2Types(staff!)
  }

  const books: Array<Record<string, unknown>> = []
  const samples: Array<Record<string, unknown>> = []
  let written = 0
  let review = 0
  let skippedExisting = 0
  let failed = 0

  for (const target of targets) {
    const sources = await paged<SourceRow>(admin, 'problem_sources', 'problem_id,original_problem_number,source_page_id,source_document_id', (q) =>
      q.eq('source_document_id', target.sourceId),
    )
    const pageIds = [...new Set(sources.map((row) => row.source_page_id))]
    const pages: Array<{ id: string; page_number: number; extracted_text: string | null }> = []
    for (let i = 0; i < pageIds.length; i += 200) {
      const { data, error } = await admin
        .from('source_pages')
        .select('id, page_number, extracted_text')
        .in('id', pageIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      pages.push(...((data ?? []) as typeof pages))
    }
    const pageById = new Map(pages.map((row) => [row.id, row]))
    const allPages = await paged<{ page_number: number; extracted_text: string | null }>(
      admin,
      'source_pages',
      'page_number, extracted_text',
      (q) => q.eq('source_document_id', target.sourceId),
    )
    const structure = structureFromPageTexts(allPages.map((row) => ({ page: row.page_number, text: row.extracted_text ?? '' })))

    const problemIds = [...new Set(sources.map((row) => row.problem_id))]
    const problems: Array<{ id: string; current_version_id: string | null; review_status: string }> = []
    for (let i = 0; i < problemIds.length; i += 200) {
      const { data, error } = await admin.from('problems').select('id, current_version_id, review_status').in('id', problemIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      problems.push(...((data ?? []) as typeof problems))
    }
    const problemById = new Map(problems.map((row) => [row.id, row]))
    const versionIds = problems.map((row) => row.current_version_id).filter((id): id is string => Boolean(id))
    const versions: Array<{ id: string; problem_text: string; item_format: string; classification_status: string }> = []
    for (let i = 0; i < versionIds.length; i += 200) {
      const { data, error } = await admin
        .from('problem_versions')
        .select('id, problem_text, item_format, classification_status')
        .in('id', versionIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      versions.push(...((data ?? []) as typeof versions))
    }
    const versionById = new Map(versions.map((row) => [row.id, row]))
    const existing = new Set<string>()
    for (let i = 0; i < versionIds.length; i += 200) {
      const { data, error } = await admin
        .from('problem_classification_meta')
        .select('problem_version_id')
        .in('problem_version_id', versionIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      for (const row of data ?? []) existing.add(row.problem_version_id as string)
    }

    let bookAuto = 0
    let bookReview = 0
    let bookSkip = 0
    let bookWrite = 0
    let bookFail = 0
    const bookSamples: Cm2Decision[] = []

    for (const source of sources) {
      const problem = problemById.get(source.problem_id)
      const versionId = problem?.current_version_id
      if (!problem || !versionId) continue
      if (problem.review_status === 'VERIFIED') {
        bookSkip += 1
        continue
      }
      if (existing.has(versionId)) {
        bookSkip += 1
        skippedExisting += 1
        continue
      }
      const version = versionById.get(versionId)
      const page = pageById.get(source.source_page_id)?.page_number
      if (!version || !page) continue
      const decision = classifyCm2Problem({
        problem_id: source.problem_id,
        page,
        problem_number: String(source.original_problem_number ?? '').padStart(4, '0'),
        stem: version.problem_text ?? '',
        section: structure.get(page),
        choice_count: version.item_format === 'MULTIPLE_CHOICE' ? 5 : 0,
      })
      if (decision.overall !== 'AUTO') {
        bookReview += 1
        review += 1
        continue
      }
      bookAuto += 1
      if (bookSamples.length < 3) bookSamples.push(decision)
      if (!apply || !staff) continue
      const rpc = await staff.rpc(CLASSIFICATION_RPC, {
        payload: cm2ClassificationPayload({ decision, versionId, sourceDocumentId: target.sourceId }),
      })
      if (rpc.error) {
        bookFail += 1
        failed += 1
        continue
      }
      bookWrite += 1
      written += 1
    }

    books.push({
      slug: target.slug,
      sourceId: target.sourceId,
      sources: sources.length,
      auto: bookAuto,
      review: bookReview,
      skipped_existing: bookSkip,
      written: apply ? bookWrite : 0,
      failed: bookFail,
    })
    for (const row of bookSamples) {
      samples.push({
        book: target.slug,
        page: row.page,
        number: row.problem_number,
        unit: row.unit_id,
        subunit: row.subunit_id,
        type: row.type_id,
        difficulty: row.difficulty_level,
        key_test_points: row.key_test_points,
      })
    }
  }

  const summary = {
    phase: apply ? 'classify-apply' : 'classify-dry-run',
    persist: apply,
    student_care_accessed: false,
    problem_text_mutated: false,
    ssen_skipped: true,
    written,
    review,
    skipped_existing: skippedExisting,
    failed,
    books,
    samples,
  }
  const dest = path.join(root, REPORT_DIR)
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, apply ? 'apply-result.json' : 'dry-run.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  return summary
}

const isMain = process.argv[1]?.includes('bookClassifyCli')
if (isMain) {
  runBookClassifyCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
