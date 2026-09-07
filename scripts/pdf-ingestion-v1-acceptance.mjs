import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { buildSyntheticPdf } from './generate-synthetic-pdfs.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const BUCKET = 'question-bank-sources'

function loadEnvLocal() {
  const file = path.join(root, '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function mustEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

loadEnvLocal()
const url = mustEnv('VITE_SUPABASE_URL')
const anonKey = mustEnv('VITE_SUPABASE_ANON_KEY')
const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
assert(!url.includes(STUDENT_CARE_REF), 'Student Care project')
assert(url.includes(QUESTION_BANK_REF), 'Wrong Supabase project')
assert(!anonKey.includes('service_role'), 'anon key looks like service_role')

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function createStaff(email, password, role) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw new Error(`createUser ${email}: ${created.error.message}`)
  const id = created.data.user.id
  await must(await admin.from('user_profiles').upsert({ user_id: id, role, display_name: email }), `role ${email}`)
  const loginClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const session = await loginClient.auth.signInWithPassword({ email, password })
  if (session.error || !session.data.session) throw new Error(`login ${email}: ${session.error?.message ?? 'no session'}`)
  return { id, client: loginClient }
}

async function lookup(table, code) {
  const data = await must(await admin.from(table).select('id,code').eq('code', code).single(), table)
  return data
}

function draftPayload(tax, text) {
  return {
    source: {
      new_document: {
        title: 'HYPER Internal STEP 5 Workflow Regression',
        document_type: 'TEACHER_CREATED',
        publisher: 'HYPER',
        publication_year: 2026,
        license_status: 'OWNED',
        usage_scope: 'INTERNAL_TEST',
      },
      page_number: 1,
      original_problem_number: 'S5R',
    },
    version: { problem_text: text, normalized_text: text, item_format: 'SHORT_ANSWER', origin: 'TEACHER_EDIT' },
    answer: { answer_type: 'NUMBER', answer_text: '4', numeric_value: 4 },
    expressions: [{ original_expression: '2x+3=11', latex_expression: '2x+3=11', sort_order: 1, expression_role: 'TARGET' }],
    curriculum_node_ids: [tax.node],
    concepts: [{ concept_id: tax.concept, is_primary: true }],
    type_ids: [tax.type],
    strategy_ids: [tax.strategy],
    target_ids: [tax.target],
    reasoning_ids: [tax.reasoning],
    difficulty: {
      concept_difficulty: 2,
      calculation_complexity: 2,
      reasoning_depth: 2,
      condition_complexity: 2,
      representation_complexity: 2,
      trap_level: 1,
    },
  }
}

async function uploadPdf(client, bytes, filename, title, extra = {}) {
  const hash = sha256(bytes)
  const begun = await must(
    await client.rpc('hqb_begin_source_document', {
      payload: {
        title,
        document_type: 'TEACHER_CREATED',
        license_status: 'OWNED',
        publisher: 'HYPER',
        original_filename: filename,
        mime_type: 'application/pdf',
        file_size: bytes.length,
        sha256: hash,
        ...extra,
      },
    }),
    'begin',
  )
  const uploaded = await client.storage.from(BUCKET).upload(begun.storage_path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (uploaded.error) throw new Error(`upload: ${uploaded.error.message}`)
  return { begun, hash }
}

const bboxOk = { x: 0.1, y: 0.22, width: 0.78, height: 0.16, unit: 'normalized', origin: 'top-left', pageWidth: 612, pageHeight: 792 }
const stamp = Date.now()

const tax = {
  node: (await lookup('curriculum_nodes', 'LINEAR_EQ_UNIT')).id,
  concept: (await lookup('concepts', 'LINEAR_EQUATION')).id,
  type: (await lookup('hyper_problem_types', 'LINEAR_DIRECT_SOLVE')).id,
  strategy: (await lookup('strategy_templates', 'LINEAR_EQUATION_SOLVE')).id,
  target: (await lookup('target_terms', 'EQUATION_SOLUTION')).id,
  reasoning: (await lookup('reasoning_terms', 'TRANSFORMATION')).id,
}

const teacher = await createStaff(`step5.teacher.${stamp}@hyper.local`, 'Step5Teacher!234', 'TEACHER')
const reviewer = await createStaff(`step5.reviewer.${stamp}@hyper.local`, 'Step5Reviewer!234', 'REVIEWER')
const pending = await createStaff(`step5.pending.${stamp}@hyper.local`, 'Step5Pending!234', 'PENDING')
const adminUser = await createStaff(`step5.admin.${stamp}@hyper.local`, 'Step5Admin!234', 'ADMIN')

console.log('A/B bbox validation')
const valid = await must(await teacher.client.rpc('hqb_validate_bbox', { p_bbox: bboxOk }), 'bbox ok')
assert(valid.x === 0.1 && valid.unit === 'normalized' && valid.origin === 'top-left', 'normalized bbox')
const bad = await teacher.client.rpc('hqb_validate_bbox', { p_bbox: { ...bboxOk, x: 0.5, width: 0.6 } })
assert(bad.error && /HQB_INVALID_BBOX/.test(bad.error.message), 'out of range bbox rejected')

console.log('C/D duplicate SHA-256 + non-PDF')
const textPdf = buildSyntheticPdf('text', String(stamp))
const scanPdf = buildSyntheticPdf('scan', String(stamp))
const mixedPdf = buildSyntheticPdf('mixed', String(stamp))
const textUpload = await uploadPdf(teacher.client, textPdf, 'hyper-step5-text.pdf', `STEP5 TEXT ${stamp}`)
const dup = await teacher.client.rpc('hqb_begin_source_document', {
  payload: {
    title: 'dup',
    document_type: 'TEACHER_CREATED',
    license_status: 'OWNED',
    original_filename: 'dup.pdf',
    mime_type: 'application/pdf',
    file_size: textPdf.length,
    sha256: textUpload.hash,
  },
})
assert(dup.error && /HQB_DUPLICATE_PDF/.test(dup.error.message), 'duplicate sha blocked')
const notPdf = await teacher.client.rpc('hqb_begin_source_document', {
  payload: {
    title: 'not pdf',
    document_type: 'TEACHER_CREATED',
    license_status: 'OWNED',
    original_filename: 'notes.png',
    mime_type: 'image/png',
    file_size: 12,
    sha256: sha256(Buffer.from('not-a-pdf')),
  },
})
assert(notPdf.error && /HQB_NOT_PDF/.test(notPdf.error.message), 'non-pdf rejected')

console.log('E/F/G role / PENDING / anon')
const anonList = await anon.from('source_documents').select('id').limit(1)
assert(anonList.error || !anonList.data?.length, 'anon cannot list sources')
const anonRpc = await anon.rpc('hqb_fetch_source_document', { p_document_id: textUpload.begun.document_id })
assert(anonRpc.error, 'anon fetch denied')
const pendingList = await pending.client.from('source_documents').select('id').limit(1)
assert(pendingList.error || !pendingList.data?.length, 'PENDING cannot list sources')
const pendingBegin = await pending.client.rpc('hqb_begin_source_document', {
  payload: {
    title: 'pending',
    document_type: 'TEACHER_CREATED',
    license_status: 'OWNED',
    original_filename: 'x.pdf',
    mime_type: 'application/pdf',
    file_size: 10,
    sha256: sha256(Buffer.from(`pending-${stamp}`)),
  },
})
assert(pendingBegin.error && /HQB_FORBIDDEN|HQB_UNAUTHENTICATED/.test(pendingBegin.error.message), 'PENDING upload denied')

console.log('finalize TEXT/SCAN/MIXED + page rule')
await must(
  await teacher.client.rpc('hqb_finalize_source_document', {
    p_document_id: textUpload.begun.document_id,
    payload: {
      page_count: 2,
      pdf_type: 'TEXT_PDF',
      ocr_status: 'NOT_NEEDED',
      extraction_status: 'EMBEDDED_TEXT',
      pages: [
        { page_number: 1, page_width: 612, page_height: 792, extracted_text: '1. 2x + 3 = 11. Find x.', text_char_count: 48, pdf_type_hint: 'TEXT_PDF', extraction_status: 'EXTRACTED', ocr_status: 'NOT_NEEDED' },
        { page_number: 2, page_width: 612, page_height: 792, extracted_text: '3. Solve x^2 - 5x + 6 = 0.', text_char_count: 46, pdf_type_hint: 'TEXT_PDF', extraction_status: 'EXTRACTED', ocr_status: 'NOT_NEEDED' },
      ],
    },
  }),
  'finalize text',
)
const badPage = await teacher.client.rpc('hqb_finalize_source_document', {
  p_document_id: textUpload.begun.document_id,
  payload: {
    page_count: 2,
    pdf_type: 'TEXT_PDF',
    pages: [{ page_number: 0, page_width: 612, page_height: 792, text_char_count: 1, pdf_type_hint: 'TEXT_PDF' }],
  },
})
assert(badPage.error && /HQB_INVALID_PAGE|HQB_PAGE_COUNT/.test(badPage.error.message), 'page_number 0 rejected')

const scanUpload = await uploadPdf(teacher.client, scanPdf, 'hyper-step5-scan.pdf', `STEP5 SCAN ${stamp}`)
await must(
  await teacher.client.rpc('hqb_finalize_source_document', {
    p_document_id: scanUpload.begun.document_id,
    payload: {
      page_count: 2,
      pdf_type: 'SCAN_PDF',
      ocr_status: 'PENDING',
      extraction_status: 'MANUAL',
      pages: [
        { page_number: 1, page_width: 612, page_height: 792, extracted_text: '', text_char_count: 0, pdf_type_hint: 'SCAN_PDF', extraction_status: 'MANUAL', ocr_status: 'PENDING' },
        { page_number: 2, page_width: 612, page_height: 792, extracted_text: '', text_char_count: 0, pdf_type_hint: 'SCAN_PDF', extraction_status: 'MANUAL', ocr_status: 'PENDING' },
      ],
    },
  }),
  'finalize scan',
)
const mixedUpload = await uploadPdf(reviewer.client, mixedPdf, 'hyper-step5-mixed.pdf', `STEP5 MIXED ${stamp}`)
await must(
  await reviewer.client.rpc('hqb_finalize_source_document', {
    p_document_id: mixedUpload.begun.document_id,
    payload: {
      page_count: 2,
      pdf_type: 'MIXED',
      ocr_status: 'PENDING',
      extraction_status: 'MANUAL',
      pages: [
        { page_number: 1, page_width: 612, page_height: 792, extracted_text: '1. 2x + 3 = 11. Find x. extra text layer here.', text_char_count: 52, pdf_type_hint: 'TEXT_PDF', extraction_status: 'EXTRACTED', ocr_status: 'NOT_NEEDED' },
        { page_number: 2, page_width: 612, page_height: 792, extracted_text: '', text_char_count: 0, pdf_type_hint: 'SCAN_PDF', extraction_status: 'MANUAL', ocr_status: 'PENDING' },
      ],
    },
  }),
  'finalize mixed',
)

const textBundle = await must(await teacher.client.rpc('hqb_fetch_source_document', { p_document_id: textUpload.begun.document_id }), 'fetch text')
assert(textBundle.document.pdf_type === 'TEXT_PDF', 'text type')
assert(textBundle.pages[0].page_number === 1, '1-based page')
assert(textBundle.document.ocr_status === 'NOT_NEEDED', 'no OCR on text pdf')

console.log('H/I/J/K lineage, mismatch, verified lock, reconstruction')
const page1 = textBundle.pages.find((row) => row.page_number === 1)
const region = await must(
  await teacher.client.rpc('hqb_create_source_page_region', {
    payload: {
      source_document_id: textUpload.begun.document_id,
      source_page_id: page1.id,
      page_number: 1,
      bbox: bboxOk,
      original_problem_number: '1',
      extracted_text_preview: '2x + 3 = 11. Find x.',
    },
  }),
  'create region',
)
const mismatch = await teacher.client.rpc('hqb_create_source_page_region', {
  payload: {
    source_document_id: scanUpload.begun.document_id,
    source_page_id: page1.id,
    bbox: bboxOk,
  },
})
assert(mismatch.error && /HQB_REGION_MISMATCH/.test(mismatch.error.message), 'wrong page/document rejected')

const created = await must(
  await teacher.client.rpc('hqb_create_problem_draft_from_region', {
    p_region_id: region.region_id,
    payload: draftPayload(tax, 'STEP 5 lineage: 2x + 3 = 11'),
  }),
  'draft from region',
)
assert(created.problem_id && created.public_code, 'draft created')
assert(created.source_page_region_id === region.region_id, 'region linked')

const sourceRow = await must(
  await admin
    .from('problem_sources')
    .select('source_document_id,source_page_id,source_page_region_id,bounding_box,is_primary_source')
    .eq('problem_id', created.problem_id)
    .single(),
  'problem_sources',
)
assert(sourceRow.source_document_id === textUpload.begun.document_id, 'document lineage')
assert(sourceRow.source_page_id === page1.id, 'page lineage')
assert(sourceRow.source_page_region_id === region.region_id, 'region lineage')
assert(sourceRow.bounding_box.x === 0.1 && sourceRow.bounding_box.unit === 'normalized', 'bbox copied')
assert(sourceRow.is_primary_source === true, 'primary source')

const secondDocLink = await must(
  await admin.from('problem_sources').insert({
    problem_id: created.problem_id,
    source_document_id: scanUpload.begun.document_id,
    is_primary_source: false,
    source_type_label: 'SECOND_BOOK',
  }).select('id').single(),
  'second source',
)
assert(secondDocLink.id, 'N:M source still allowed')

const verified = await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: created.version_id,
    p_note: 'STEP 5 acceptance VERIFY',
  }),
  'verify',
)
assert(verified.review_status === 'VERIFIED' && verified.version_id === created.version_id, 'verified')
const adminView = await must(
  await adminUser.client.rpc('hqb_fetch_source_document', { p_document_id: textUpload.begun.document_id }),
  'admin fetch',
)
assert(adminView.document.id === textUpload.begun.document_id, 'admin can read source')
const locked = await teacher.client.rpc('hqb_delete_source_page_region', { p_region_id: region.region_id })
assert(locked.error && /HQB_REGION_LOCKED/.test(locked.error.message), 'verified-linked delete blocked')

const bundle = await must(await teacher.client.rpc('hqb_fetch_problem_bundle', { p_public_code: created.public_code }), 'bundle')
assert(bundle.sources[0].source_document_id === textUpload.begun.document_id, 'bundle document')
assert(bundle.sources[0].page_number === 1, 'bundle page')
assert(bundle.sources[0].bounding_box.width === 0.78, 'bundle bbox')

console.log('L page numbering + M workflow regression')
const manual = await must(await teacher.client.rpc('hqb_create_problem_draft', { payload: draftPayload(tax, 'STEP 5 regression 2x+3=11') }), 'manual draft')
assert(manual.problem_id, 'manual workflow still works')

const storageAnon = await anon.storage.from(BUCKET).list(textUpload.begun.document_id)
assert(storageAnon.error || !storageAnon.data?.length, 'anon storage denied')

const bucket = await must(await admin.storage.getBucket(BUCKET), 'bucket')
assert(bucket.public === false, 'bucket is private')

console.log('PDF ingestion v1 acceptance PASS')
console.log(JSON.stringify({
  textDocumentId: textUpload.begun.document_id,
  scanDocumentId: scanUpload.begun.document_id,
  mixedDocumentId: mixedUpload.begun.document_id,
  publicCode: created.public_code,
  problemId: created.problem_id,
}, null, 2))
