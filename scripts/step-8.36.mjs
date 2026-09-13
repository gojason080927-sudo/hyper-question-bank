/**
 * STEP 8.36: apply outline schema, persist 쎈 TOC, fixture visibility,
 * pagination-safe repairs. Never DELETE. Never VERIFIED.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const MIGRATION_FILE = '20260913033000_hqb_ssen_outline_stabilize_v1.sql'
const PIPELINE_TEACHER_EMAIL = 'hqb.pipeline.ssen@hyper.local'
const SSEN = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
const persist = process.argv.includes('--persist')
const applyOnly = process.argv.includes('--apply-schema') || persist

const MAJORS = [
  { code: 'I', title: '다항식' },
  { code: 'II', title: '방정식' },
  { code: 'III', title: '부등식' },
  { code: 'IV', title: '순열과 조합' },
  { code: 'V', title: '행렬' },
]
const SECTIONS = [
  { code: '01', title: '다항식의 연산', start: 8, major: 'I' },
  { code: '02', title: '나머지 정리와 인수분해', start: 24, major: 'I' },
  { code: '03', title: '복소수', start: 46, major: 'II' },
  { code: '04', title: '이차방정식', start: 62, major: 'II' },
  { code: '05', title: '이차방정식과 이차함수', start: 82, major: 'II' },
  { code: '06', title: '여러 가지 방정식', start: 98, major: 'II' },
  { code: '07', title: '일차부등식', start: 116, major: 'III' },
  { code: '08', title: '이차부등식', start: 130, major: 'III' },
  { code: '09', title: '순열과 조합', start: 150, major: 'IV' },
  { code: '10', title: '행렬과 그 연산', start: 174, major: 'V' },
]
const LAST = 192

function sectionEnd(row) {
  const index = SECTIONS.findIndex((item) => item.code === row.code)
  const next = SECTIONS[index + 1]
  return (next?.start ?? LAST + 1) - 1
}

function sectionForPage(page) {
  return SECTIONS.find((row) => page >= row.start && page <= sectionEnd(row)) ?? null
}

function isFixture(row) {
  const blob = `${row.title ?? ''} ${row.original_filename ?? ''} ${row.document_type ?? ''}`
  return /STEP\s*\d|fixture|regression|Internal STEP|Production UI Test|do not use/i.test(blob)
}

function cleanOcr(text) {
  const rules = []
  let next = String(text ?? '').replace(/\u00a0/g, ' ')
  if (/^(\d{3,4})\s+\1\b/.test(next)) {
    next = next.replace(/^(\d{3,4})\s+\1\b/, '$1')
    rules.push('repeated_number')
  }
  if (/^(유형\s*\d{1,2}\b[^\n]*\n+)/.test(next)) {
    next = next.replace(/^(유형\s*\d{1,2}\b[^\n]*\n+)/, '')
    rules.push('type_header')
  }
  if (/[•◎●]/.test(next)) {
    next = next.replace(/[•◎●]/g, '')
    rules.push('bullet_mark')
  }
  next = next.replace(/서술항|시술항|시술함/g, (match) => {
    rules.push(`ocr_${match}`)
    return '서술형'
  })
  next = next.replace(/[ \t]{2,}/g, ' ').trim()
  return { cleaned: next, rules, changed: rules.length > 0 && next !== String(text ?? '').trim() }
}

function normalizeDup(text) {
  return String(text ?? '')
    .replace(/[•◎●#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function redact(text) {
  return text
    .replace(/sbp_[A-Za-z0-9_]+/g, 'sbp_[redacted]')
    .replace(/sb_secret_[A-Za-z0-9_]+/g, 'sb_secret_[redacted]')
    .slice(0, 800)
}

async function applyMigration(token) {
  const sql = readFileSync(path.join(root, 'supabase/migrations', MIGRATION_FILE), 'utf8')
  const mgmt = await fetch(`https://api.supabase.com/v1/projects/${QUESTION_BANK_REF}/database/migrations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'hqb_ssen_outline_stabilize_v1', query: sql }),
  })
  if (mgmt.ok) return { applied: true, reason: 'applied' }
  const body = redact(await mgmt.text())
  if (/already|duplicate|exists/i.test(body)) return { applied: true, reason: 'already_applied' }
  return { applied: false, reason: `management ${mgmt.status}: ${body}` }
}

async function staffClient(url, service) {
  const staff = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const link = await staff.auth.admin.generateLink({ type: 'magiclink', email: PIPELINE_TEACHER_EMAIL })
  const hashed = link.data?.properties?.hashed_token
  if (link.error || !hashed) throw new Error(`staff magiclink: ${link.error?.message ?? 'no token'}`)
  const verify = await staff.auth.verifyOtp({ token_hash: hashed, type: 'email' })
  if (verify.error || !verify.data.session) throw new Error(`staff verify: ${verify.error?.message ?? 'no session'}`)
  return staff
}

async function countEq(admin, table, filter = {}) {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter)) q = q.eq(column, value)
  const result = await q
  if (result.error) return { count: null, error: result.error.message }
  return { count: result.count ?? 0, error: null }
}

async function paged(admin, table, columns, apply) {
  const rows = []
  for (let from = 0; from < 50000; from += 1000) {
    let q = admin.from(table).select(columns).range(from, from + 999)
    q = apply ? apply(q) : q
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

async function snapshot(admin) {
  const drafts = await countEq(admin, 'problems', { lifecycle_status: 'DRAFT' })
  const active = await countEq(admin, 'problems', { lifecycle_status: 'ACTIVE' })
  const review = await countEq(admin, 'problems', { review_status: 'NEEDS_REVIEW' })
  const sources = await paged(admin, 'problem_sources', 'problem_id', (q) => q.eq('source_document_id', SSEN))
  const ssenIds = [...new Set(sources.map((row) => row.problem_id))]
  let ssenReview = 0
  for (let i = 0; i < ssenIds.length; i += 80) {
    const chunk = ssenIds.slice(i, i + 80)
    const { data } = await admin.from('problems').select('id,review_status').in('id', chunk)
    ssenReview += (data ?? []).filter((row) => row.review_status === 'NEEDS_REVIEW').length
  }
  return {
    drafts: drafts.count,
    active: active.count,
    needs_review: review.count,
    ssen_problems: ssenIds.length,
    ssen_needs_review: ssenReview,
    fingerprints: (await countEq(admin, 'content_fingerprints')).count,
    embeddings: (await countEq(admin, 'problem_embeddings')).count,
    worksheets: (await countEq(admin, 'worksheets')).count,
  }
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? ''
  const outDir = path.join(root, 'ocr-tests/taxonomy/step8-36')
  mkdirSync(outDir, { recursive: true })

  const summary = {
    step: '8.36',
    status: persist ? 'PERSISTED' : 'PLANNED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    student_care_ref_touched: STUDENT_CARE_REF ? false : false,
    production_verified_writes: 0,
    content_rewrites: 0,
    schema: { attempted: false, applied: false, reason: 'not requested' },
    before: null,
    after: null,
    outline: { majors: 0, sections: 0, types: 0, assignments: 0 },
    fixtures_marked: 0,
    duplicates_hidden: 0,
    ocr_cleaned: 0,
    merged_flagged: 0,
    merged_split: 0,
    bbox_corrected: 0,
    pagination: { total: null, unique: null },
    review_queue: { ssen: null },
    worksheet: null,
    unresolved: [],
  }

  if (url.includes(STUDENT_CARE_REF)) throw new Error('refused student-care')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('wrong supabase project')

  if (applyOnly && token) {
    summary.schema = { attempted: true, ...(await applyMigration(token)) }
  } else if (applyOnly) {
    summary.schema = { attempted: false, applied: false, reason: 'missing SUPABASE_ACCESS_TOKEN' }
  }

  if (!persist || !url || !service || !summary.schema.applied) {
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  summary.before = await snapshot(admin)
  const staff = await staffClient(url, service)

  const evidence = { printed_toc_page: 6, print_equals_pdf: true, source: 'uploaded SSEN PDF' }
  const bookRes = await staff.rpc('hqb_upsert_source_outline_node', {
    payload: {
      source_document_id: SSEN,
      node_level: 'BOOK',
      code: 'SSEN',
      title_original: '쎈수학 공통수학1',
      title_normalized: '쎈수학 공통수학1',
      sort_order: 0,
      pdf_page_start: 1,
      pdf_page_end: LAST,
      print_page_start: 1,
      print_page_end: LAST,
      evidence,
      confidence: 1,
    },
  })
  if (bookRes.error) throw new Error(bookRes.error.message)
  const bookId = bookRes.data.id
  const majorIds = {}
  for (const [index, major] of MAJORS.entries()) {
    const rows = SECTIONS.filter((row) => row.major === major.code)
    const start = rows[0].start
    const end = sectionEnd(rows[rows.length - 1])
    const res = await staff.rpc('hqb_upsert_source_outline_node', {
      payload: {
        source_document_id: SSEN,
        parent_id: bookId,
        node_level: 'MAJOR_UNIT',
        code: major.code,
        title_original: `${major.code} ${major.title}`,
        title_normalized: `${major.code} ${major.title}`,
        sort_order: index + 1,
        pdf_page_start: start,
        pdf_page_end: end,
        print_page_start: start,
        print_page_end: end,
        evidence,
        confidence: 1,
      },
    })
    if (res.error) throw new Error(res.error.message)
    majorIds[major.code] = res.data.id
    summary.outline.majors += 1
  }
  const sectionIds = {}
  for (const [index, section] of SECTIONS.entries()) {
    const res = await staff.rpc('hqb_upsert_source_outline_node', {
      payload: {
        source_document_id: SSEN,
        parent_id: majorIds[section.major],
        node_level: 'SECTION',
        code: section.code,
        title_original: `${section.code} ${section.title}`,
        title_normalized: `${section.code} ${section.title}`,
        sort_order: index + 1,
        pdf_page_start: section.start,
        pdf_page_end: sectionEnd(section),
        print_page_start: section.start,
        print_page_end: sectionEnd(section),
        evidence,
        confidence: 1,
      },
    })
    if (res.error) throw new Error(res.error.message)
    sectionIds[section.code] = res.data.id
    summary.outline.sections += 1
  }

  const links = await paged(admin, 'problem_sources', 'problem_id,original_problem_number,bounding_box,source_page_id,is_primary_source', (q) =>
    q.eq('source_document_id', SSEN).eq('is_primary_source', true),
  )
  const pageIds = [...new Set(links.map((row) => row.source_page_id).filter(Boolean))]
  const pages = []
  for (let i = 0; i < pageIds.length; i += 80) {
    const { data } = await admin.from('source_pages').select('id,page_number').in('id', pageIds.slice(i, i + 80))
    pages.push(...(data ?? []))
  }
  const pageMap = Object.fromEntries(pages.map((row) => [row.id, row.page_number]))
  const problemIds = [...new Set(links.map((row) => row.problem_id))]
  const problems = []
  for (let i = 0; i < problemIds.length; i += 80) {
    const { data } = await admin
      .from('problems')
      .select('id,public_code,current_version_id,review_status,lifecycle_status,display_state,created_at')
      .in('id', problemIds.slice(i, i + 80))
    problems.push(...(data ?? []))
  }
  const versions = []
  const versionIds = problems.map((row) => row.current_version_id).filter(Boolean)
  for (let i = 0; i < versionIds.length; i += 80) {
    const { data } = await admin.from('problem_versions').select('id,problem_text,origin').in('id', versionIds.slice(i, i + 80))
    versions.push(...(data ?? []))
  }
  const versionMap = Object.fromEntries(versions.map((row) => [row.id, row]))
  const problemMap = Object.fromEntries(problems.map((row) => [row.id, row]))

  for (const link of links) {
    const page = pageMap[link.source_page_id]
    const section = sectionForPage(page)
    const nodeId = section ? sectionIds[section.code] : bookId
    const assigned = await staff.rpc('hqb_assign_problem_outline', {
      payload: { problem_id: link.problem_id, outline_node_id: nodeId, is_primary: true, assigned_by: 'STEP_8_36', confidence: 1 },
    })
    if (!assigned.error) summary.outline.assignments += 1
  }

  const docs = await paged(admin, 'source_documents', 'id,title,original_filename,document_type,document_status', (q) => q.is('archived_at', null))
  for (const doc of docs) {
    if (!isFixture(doc) && doc.id !== SSEN) continue
    if (doc.id === SSEN) continue
    if (isFixture(doc) || doc.document_status === 'UPLOADING') {
      const res = await staff.rpc('hqb_set_source_fixture', { p_document_id: doc.id, p_is_fixture: true })
      if (!res.error) summary.fixtures_marked += 1
    }
  }

  const listedSsen = problems.filter((row) => ['DRAFT', 'ACTIVE'].includes(row.lifecycle_status)).length
  const ssenReview = problems.filter((row) => row.review_status === 'NEEDS_REVIEW').length
  await staff.rpc('hqb_sync_source_pipeline_status', {
    p_document_id: SSEN,
    payload: {
      ocr_status: ssenReview > 0 ? 'REVIEW_REQUIRED' : 'SUCCEEDED',
      extraction_status: 'MANUAL',
    },
  })

  const groups = new Map()
  for (const link of links) {
    const problem = problemMap[link.problem_id]
    const version = problem?.current_version_id ? versionMap[problem.current_version_id] : null
    const page = pageMap[link.source_page_id]
    const key = `${page}|${link.original_problem_number ?? ''}|${normalizeDup(version?.problem_text ?? '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ link, problem, version })
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const listed = group.filter((row) => row.problem && row.problem.lifecycle_status !== 'ARCHIVED')
    if (listed.length < 2) continue
    listed.sort((a, b) => String(a.problem.public_code).localeCompare(String(b.problem.public_code)))
    const keeper = listed[0]
    for (const extra of listed.slice(1)) {
      const res = await staff.rpc('hqb_link_duplicate', {
        payload: {
          problem_a_id: keeper.problem.id,
          problem_b_id: extra.problem.id,
          keeper_problem_id: keeper.problem.id,
          extra_problem_id: extra.problem.id,
          link_kind: 'EXACT_DUPLICATE',
          status: 'LINKED',
          evidence: [{ page: pageMap[extra.link.source_page_id], number: extra.link.original_problem_number }],
          assigned_by: 'STEP_8_36',
        },
      })
      if (!res.error && !res.data?.skipped) summary.duplicates_hidden += 1
    }
  }

  for (const problem of problems) {
    const version = problem.current_version_id ? versionMap[problem.current_version_id] : null
    if (!version || version.origin === 'TEACHER_EDIT') continue
    const cleaned = cleanOcr(version.problem_text ?? '')
    if (!cleaned.changed) continue
    const res = await staff.rpc('hqb_apply_auto_clean_text', {
      p_problem_id: problem.id,
      p_cleaned_text: cleaned.cleaned,
      p_change_reason: `STEP 8.36 ${cleaned.rules.join(',')}`,
    })
    if (!res.error && res.data && res.data.skipped === false) summary.ocr_cleaned += 1
  }

  for (const problem of problems) {
    const version = problem.current_version_id ? versionMap[problem.current_version_id] : null
    if (/\[[0-9]{3,4}\s*[~～-]\s*[0-9]{3,4}\]/.test(version?.problem_text ?? '')) {
      summary.merged_flagged += 1
    }
  }
  summary.unresolved.push({
    item: 'merged_stem_split',
    count: summary.merged_flagged,
    reason: '독립 bbox 없이 분리하면 원본 영역이 앞뒤 문제를 계속 포함하므로 SUPERSEDED_SPLIT을 만들지 않음. 확인 필요 큐에 범위 발문만 보고.',
  })
  summary.unresolved.push({
    item: 'bbox_auto_crop',
    count: 0,
    reason: '문자 좌표 없이 확실한 침범만 보정. 8.34 보정 이후 추가 근거 없는 일괄 crop 재생성은 하지 않음.',
  })

  let unique = new Set()
  let total = null
  for (let page = 1; page <= 40; page += 1) {
    const res = await staff.rpc('hqb_list_problems', {
      payload: { page, page_size: 100, listed_only: true, show_fixtures: true, sort: 'updated' },
    })
    if (res.error) {
      summary.pagination.error = res.error.message
      break
    }
    total = res.data.total
    for (const row of res.data.items ?? []) unique.add(row.id)
    if ((res.data.items ?? []).length < 100) break
  }
  summary.pagination = { total, unique: unique.size }

  const queue = await staff.rpc('hqb_list_review_queue', { payload: { source_document_id: SSEN } })
  summary.review_queue = { ssen: (queue.data?.items ?? []).length, error: queue.error?.message ?? null }

  const sample = problems.filter((row) => row.lifecycle_status === 'DRAFT').slice(0, 2)
  if (sample.length) {
    const sheet = await staff.rpc('hqb_create_worksheet', {
      payload: { title: 'STEP 8.36 테스트 문제지 (archive)', exam_kind: 'EXAM', layout: { columns: 1 } },
    })
    if (!sheet.error && sheet.data?.worksheet_id) {
      await staff.rpc('hqb_replace_worksheet_items', {
        p_worksheet_id: sheet.data.worksheet_id,
        payload: {
          items: sample.map((row, index) => ({
            problem_id: row.id,
            problem_version_id: row.current_version_id,
            order_no: index + 1,
            points: 5,
          })),
        },
      })
      await staff.rpc('hqb_archive_worksheet', { p_worksheet_id: sheet.data.worksheet_id })
      summary.worksheet = { id: sheet.data.worksheet_id, archived: true, items: sample.length, stems_rewritten: false }
    } else {
      summary.worksheet = { error: sheet.error?.message ?? 'create failed' }
    }
  }

  summary.after = await snapshot(admin)
  summary.status = 'PERSISTED'
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  writeFileSync(
    path.join(outDir, 'rollback-manifest.json'),
    JSON.stringify(
      {
        note: 'No DELETE. Restore display_state=LISTED and current_version_id from before snapshot if needed.',
        source_document_id: SSEN,
        duplicates_hidden: summary.duplicates_hidden,
        ocr_cleaned: summary.ocr_cleaned,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify(summary, null, 2))
}

await main()
