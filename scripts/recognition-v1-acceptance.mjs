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
  return must(await admin.from(table).select('id,code').eq('code', code).single(), table)
}

function draftPayload(tax, text) {
  return {
    source: {
      new_document: {
        title: 'HYPER Internal STEP 6 Workflow Regression',
        document_type: 'TEACHER_CREATED',
        publisher: 'HYPER',
        publication_year: 2026,
        license_status: 'OWNED',
        usage_scope: 'INTERNAL_TEST',
      },
      page_number: 1,
      original_problem_number: 'S6R',
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

const teacher = await createStaff(`step6.teacher.${stamp}@hyper.local`, 'Step6Teacher!234', 'TEACHER')
const reviewer = await createStaff(`step6.reviewer.${stamp}@hyper.local`, 'Step6Reviewer!234', 'REVIEWER')
const pending = await createStaff(`step6.pending.${stamp}@hyper.local`, 'Step6Pending!234', 'PENDING')

const bytes = buildSyntheticPdf('text', `step6-${stamp}`)
const hash = sha256(bytes)
const begun = await must(
  await teacher.client.rpc('hqb_begin_source_document', {
    payload: {
      title: `STEP6 TEXT ${stamp}`,
      document_type: 'TEACHER_CREATED',
      license_status: 'OWNED',
      publisher: 'HYPER',
      original_filename: 'hyper-step6-text.pdf',
      mime_type: 'application/pdf',
      file_size: bytes.length,
      sha256: hash,
    },
  }),
  'begin',
)
const uploaded = await teacher.client.storage.from(BUCKET).upload(begun.storage_path, bytes, {
  contentType: 'application/pdf',
  upsert: false,
})
if (uploaded.error) throw new Error(`upload: ${uploaded.error.message}`)
await must(
  await teacher.client.rpc('hqb_finalize_source_document', {
    p_document_id: begun.document_id,
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
  'finalize',
)
const bundle = await must(await teacher.client.rpc('hqb_fetch_source_document', { p_document_id: begun.document_id }), 'fetch')
const page1 = bundle.pages.find((row) => row.page_number === 1)
const region = await must(
  await teacher.client.rpc('hqb_create_source_page_region', {
    payload: {
      source_document_id: begun.document_id,
      source_page_id: page1.id,
      page_number: 1,
      bbox: bboxOk,
      original_problem_number: '1',
      extracted_text_preview: '2x + 3 = 11. Find x.',
    },
  }),
  'region',
)

function machinePayload(overrides = {}) {
  return {
    source_document_id: begun.document_id,
    source_page_id: page1.id,
    source_page_region_id: region.region_id,
    engine: 'hqb-embedded-text-v1',
    engine_version: '0.1.0',
    processing_mode: 'EMBEDDED_TEXT',
    status: 'REVIEW_REQUIRED',
    verdict: 'YELLOW',
    payload: {
      problem_number: '1',
      stem_text: 'MACHINE STEM 2x + 3 = 11 Find x.',
      math_expressions: [{ original: '2x+3=11', latex_candidate: null, structure_ok: false, notes: ['ASCII'] }],
      choices: [
        { order: 1, label: '①', text: '2' },
        { order: 2, label: '②', text: '4' },
        { order: 3, label: '③', text: '6' },
        { order: 4, label: '④', text: '8' },
        { order: 5, label: '⑤', text: '10' },
      ],
      answer_candidate: null,
      has_figure: false,
      has_table: false,
      confidence: null,
      component_status: ['TEXT_OK', 'CHOICES_OK', 'MATH_REVIEW_REQUIRED'],
      warnings: ['MATH_REVIEW_REQUIRED: formula structure is incomplete or ASCII-only'],
      raw_text: '1. MACHINE STEM 2x + 3 = 11 Find x.',
    },
    warnings: ['MATH_REVIEW_REQUIRED: formula structure is incomplete or ASCII-only'],
    component_status: ['TEXT_OK', 'CHOICES_OK', 'MATH_REVIEW_REQUIRED'],
    ...overrides,
  }
}

console.log('anon / PENDING denied')
const anonSave = await anon.rpc('hqb_save_recognition_result', { payload: machinePayload() })
assert(anonSave.error, 'anon save denied')
const pendingSave = await pending.client.rpc('hqb_save_recognition_result', { payload: machinePayload() })
assert(pendingSave.error && /HQB_FORBIDDEN|HQB_UNAUTHENTICATED/.test(pendingSave.error.message), 'PENDING save denied')
const pendingList = await pending.client.rpc('hqb_list_recognition_results', { p_region_id: region.region_id })
assert(pendingList.error, 'PENDING list denied')
const anonTable = await anon.from('recognition_results').select('id').limit(1)
assert(anonTable.error || !anonTable.data?.length, 'anon table denied')

console.log('schema / provenance / fake confidence / region mismatch')
const fake = await teacher.client.rpc('hqb_save_recognition_result', {
  payload: machinePayload({ payload: { ...machinePayload().payload, confidence: 97.3 } }),
})
assert(fake.error && /HQB_FAKE_CONFIDENCE/.test(fake.error.message), 'numeric confidence rejected')
const mismatch = await teacher.client.rpc('hqb_save_recognition_result', {
  payload: machinePayload({ source_document_id: crypto.randomUUID() }),
})
assert(mismatch.error && /HQB_REGION_MISMATCH/.test(mismatch.error.message), 'region relation enforced')

const saved = await must(await teacher.client.rpc('hqb_save_recognition_result', { payload: machinePayload() }), 'save recognition')
assert(saved.result_id, 'result id')
const listed = await must(await teacher.client.rpc('hqb_list_recognition_results', { p_region_id: region.region_id }), 'list')
assert(Array.isArray(listed) && listed.length >= 1, 'list returns rows')
const row = listed[0]
assert(row.source_document_id === begun.document_id, 'provenance document')
assert(row.source_page_id === page1.id, 'provenance page')
assert(row.source_page_region_id === region.region_id, 'provenance region')
assert(row.engine === 'hqb-embedded-text-v1', 'engine')
assert(row.engine_version === '0.1.0', 'engine version')
assert(row.processing_mode === 'EMBEDDED_TEXT', 'mode')
assert(row.created_at, 'created_at')
assert(row.payload.confidence == null, 'confidence stays null')
assert(row.warnings.length >= 1, 'warnings stored')

const teacherInsert = await teacher.client.from('recognition_results').insert({
  source_document_id: begun.document_id,
  source_page_id: page1.id,
  source_page_region_id: region.region_id,
  engine: 'hqb-embedded-text-v1',
  engine_version: '0.1.0',
  processing_mode: 'EMBEDDED_TEXT',
  status: 'SUCCEEDED',
  verdict: 'GREEN',
  payload: {},
})
assert(teacherInsert.error, 'direct insert blocked; RPC-only writes')

console.log('no auto overwrite + apply + choice order')
const created = await must(
  await teacher.client.rpc('hqb_create_problem_draft_from_region', {
    p_region_id: region.region_id,
    payload: draftPayload(tax, 'HUMAN DRAFT TEXT 2x+3=11'),
  }),
  'human draft',
)
const before = await must(
  await admin.from('problem_versions').select('problem_text,review_status').eq('id', created.version_id).single(),
  'before apply',
)
assert(before.problem_text === 'HUMAN DRAFT TEXT 2x+3=11', 'save did not overwrite draft')
assert(before.review_status !== 'VERIFIED', 'still draft')

const applied = await must(
  await teacher.client.rpc('hqb_apply_recognition_to_draft', {
    p_result_id: saved.result_id,
    p_version_id: created.version_id,
  }),
  'apply',
)
assert(applied.applied === true, 'applied flag')
const after = await must(
  await admin.from('problem_versions').select('problem_text,origin,item_format,choice_count').eq('id', created.version_id).single(),
  'after apply',
)
assert(after.problem_text.includes('MACHINE STEM'), 'explicit apply updated stem')
assert(after.origin === 'OCR', 'origin OCR')
assert(after.item_format === 'MULTIPLE_CHOICE', 'choices set format')
assert(after.choice_count === 5, 'five choices')
const choices = await must(
  await admin.from('problem_choices').select('choice_order,label,choice_text').eq('problem_version_id', created.version_id).order('choice_order'),
  'choices',
)
assert(choices.map((row) => row.label).join('') === '①②③④⑤', 'choice order preserved')
assert(choices.map((row) => row.choice_text).join(',') === '2,4,6,8,10', 'choice texts')
const answers = await must(
  await admin.from('problem_answers').select('answer_text').eq('problem_version_id', created.version_id),
  'answers',
)
assert(answers.length === 1 && answers[0].answer_text === '4', 'apply did not invent or wipe the existing answer')

console.log('missing choice + math review + OCR failure')
const missing = await must(
  await teacher.client.rpc('hqb_save_recognition_result', {
    payload: machinePayload({
      verdict: 'YELLOW',
      payload: {
        ...machinePayload().payload,
        choices: [
          { order: 1, label: '①', text: '2' },
          { order: 3, label: '③', text: '6' },
        ],
        component_status: ['CHOICES_REVIEW_REQUIRED', 'MATH_REVIEW_REQUIRED'],
        warnings: ['CHOICES_REVIEW_REQUIRED: a choice is missing or out of order'],
      },
      warnings: ['CHOICES_REVIEW_REQUIRED: a choice is missing or out of order'],
      component_status: ['CHOICES_REVIEW_REQUIRED', 'MATH_REVIEW_REQUIRED'],
    }),
  }),
  'missing choice result',
)
const missingRow = (await must(await teacher.client.rpc('hqb_list_recognition_results', { p_region_id: region.region_id }), 'list missing'))
  .find((row) => row.id === missing.result_id)
assert(missingRow.component_status.includes('CHOICES_REVIEW_REQUIRED'), 'missing choice warning stored')
assert(missingRow.component_status.includes('MATH_REVIEW_REQUIRED'), 'math review warning stored')

const scanFail = await must(
  await teacher.client.rpc('hqb_save_recognition_result', {
    payload: {
      source_document_id: begun.document_id,
      source_page_id: page1.id,
      source_page_region_id: region.region_id,
      engine: 'hqb-scan-unavailable-v1',
      engine_version: '0.1.0',
      processing_mode: 'SCAN_NO_ENGINE',
      status: 'FAILED',
      verdict: 'RED',
      payload: {
        problem_number: null,
        stem_text: '',
        math_expressions: [],
        choices: [],
        answer_candidate: null,
        has_figure: true,
        has_table: false,
        confidence: null,
        component_status: ['OCR_UNAVAILABLE', 'LOW_CONFIDENCE'],
        warnings: ['SCAN_NO_ENGINE: no free math OCR is installed in this environment'],
        raw_text: '',
      },
      warnings: ['SCAN_NO_ENGINE: no free math OCR is installed in this environment'],
      component_status: ['OCR_UNAVAILABLE', 'LOW_CONFIDENCE'],
    },
  }),
  'ocr failure saved',
)
const scanApply = await teacher.client.rpc('hqb_apply_recognition_to_draft', {
  p_result_id: scanFail.result_id,
  p_version_id: created.version_id,
})
assert(scanApply.error && /HQB_MISSING_TEXT/.test(scanApply.error.message), 'empty OCR result cannot become a draft body')

console.log('VERIFIED protection')
const verifiedDraft = await must(
  await teacher.client.rpc('hqb_create_problem_draft', { payload: draftPayload(tax, 'STEP 6 verified lock 2x+3=11') }),
  'verified draft',
)
await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: verifiedDraft.version_id,
    p_note: 'STEP 6 recognition must not mutate VERIFIED',
  }),
  'verify',
)
const locked = await teacher.client.rpc('hqb_apply_recognition_to_draft', {
  p_result_id: missing.result_id,
  p_version_id: verifiedDraft.version_id,
})
assert(locked.error && /HQB_VERIFIED_LOCKED/.test(locked.error.message), 'VERIFIED apply blocked')
const verifiedText = await must(
  await admin.from('problem_versions').select('problem_text,review_status').eq('id', verifiedDraft.version_id).single(),
  'verified text',
)
assert(verifiedText.review_status === 'VERIFIED', 'still verified')
assert(verifiedText.problem_text.includes('verified lock'), 'verified body unchanged')

console.log('recognition v1 acceptance PASS')
console.log(JSON.stringify({
  documentId: begun.document_id,
  regionId: region.region_id,
  resultId: saved.result_id,
  draftVersionId: created.version_id,
  publicCode: created.public_code,
}, null, 2))
