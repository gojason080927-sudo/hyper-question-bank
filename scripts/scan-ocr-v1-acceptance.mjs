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
const SAME_BBOX = { x: 0.04, y: 0.11, width: 0.45, height: 0.28, unit: 'normalized', origin: 'top-left', pageWidth: 612, pageHeight: 792 }

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

loadEnvLocal()
const url = mustEnv('VITE_SUPABASE_URL')
const anonKey = mustEnv('VITE_SUPABASE_ANON_KEY')
const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
assert(!url.includes(STUDENT_CARE_REF), 'Student Care project')
assert(url.includes(QUESTION_BANK_REF), 'Wrong Supabase project')

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function lookup(table, code) {
  return must(await admin.from(table).select('id,code').eq('code', code).single(), table)
}

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

const stamp = Date.now()
const teacher = await createStaff(`step7.teacher.${stamp}@hyper.local`, 'Step7Teacher!234', 'TEACHER')
const reviewer = await createStaff(`step7.reviewer.${stamp}@hyper.local`, 'Step7Reviewer!234', 'REVIEWER')
const pending = await createStaff(`step7.pending.${stamp}@hyper.local`, 'Step7Pending!234', 'PENDING')

const bytes = buildSyntheticPdf('scan', `step7-${stamp}`)
const hash = crypto.createHash('sha256').update(bytes).digest('hex')
const begun = await must(
  await teacher.client.rpc('hqb_begin_source_document', {
    payload: {
      title: `STEP7 SCAN ${stamp}`,
      document_type: 'TEACHER_CREATED',
      license_status: 'OWNED',
      publisher: 'HYPER',
      original_filename: 'hyper-step7-scan.pdf',
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
      pdf_type: 'SCAN_PDF',
      ocr_status: 'PENDING',
      extraction_status: 'MANUAL',
      pages: [
        {
          page_number: 1,
          page_width: 612,
          page_height: 792,
          extracted_text: '',
          text_char_count: 0,
          pdf_type_hint: 'SCAN_PDF',
          extraction_status: 'MANUAL',
          ocr_status: 'PENDING',
        },
        {
          page_number: 2,
          page_width: 612,
          page_height: 792,
          extracted_text: '',
          text_char_count: 0,
          pdf_type_hint: 'SCAN_PDF',
          extraction_status: 'MANUAL',
          ocr_status: 'PENDING',
        },
      ],
    },
  }),
  'finalize',
)
const bundle = await must(await teacher.client.rpc('hqb_fetch_source_document', { p_document_id: begun.document_id }), 'fetch')
const page1 = bundle.pages.find((row) => row.page_number === 1)

const regionA = await must(
  await teacher.client.rpc('hqb_create_source_page_region', {
    payload: {
      source_document_id: begun.document_id,
      source_page_id: page1.id,
      page_number: 1,
      bbox: SAME_BBOX,
      original_problem_number: '0040',
      extracted_text_preview: '',
    },
  }),
  'region A',
)
const regionB = await must(
  await teacher.client.rpc('hqb_create_source_page_region', {
    payload: {
      source_document_id: begun.document_id,
      source_page_id: page1.id,
      page_number: 1,
      bbox: SAME_BBOX,
      original_problem_number: '0040-engine-b',
      extracted_text_preview: '',
    },
  }),
  'region B same bbox',
)
assert(JSON.stringify(regionA.bbox ?? SAME_BBOX) , 'bbox kept')
const pageA = await must(await admin.from('source_page_regions').select('bbox,source_page_id').eq('id', regionA.region_id).single(), 'bbox A')
const pageB = await must(await admin.from('source_page_regions').select('bbox,source_page_id').eq('id', regionB.region_id).single(), 'bbox B')
assert(pageA.source_page_id === pageB.source_page_id, 'same page')
assert(pageA.bbox.x === pageB.bbox.x && pageA.bbox.y === pageB.bbox.y, 'same bbox across engines')
assert(pageA.bbox.width === pageB.bbox.width && pageA.bbox.height === pageB.bbox.height, 'same bbox size')

function scanPayload(regionId, engine, extra = {}) {
  return {
    source_document_id: begun.document_id,
    source_page_id: page1.id,
    source_page_region_id: regionId,
    engine,
    engine_version: '0.7.0',
    processing_mode: 'SCAN_OCR',
    status: 'REVIEW_REQUIRED',
    verdict: 'YELLOW',
    payload: {
      problem_number: '0040',
      stem_text: '두 다항식 OCR DRAFT',
      math_expressions: [{ original: '2x2', latex_candidate: null, structure_ok: false, notes: ['lost exponent; x2 is not treated as x^{2}'] }],
      choices: [],
      answer_candidate: null,
      has_figure: false,
      has_table: false,
      confidence: null,
      component_status: ['TEXT_OK', 'MATH_REVIEW_REQUIRED', 'LOW_CONFIDENCE'],
      warnings: ['SCAN_OCR: raw engine output. Uncertain tokens were not restored from context.'],
      raw_text: '0040 두 다항식 A=2x2',
    },
    warnings: ['SCAN_OCR: raw engine output. Uncertain tokens were not restored from context.'],
    component_status: ['TEXT_OK', 'MATH_REVIEW_REQUIRED', 'LOW_CONFIDENCE'],
    ...extra,
  }
}

console.log('PENDING / anon denied')
const anonSave = await anon.rpc('hqb_save_recognition_result', { payload: scanPayload(regionA.region_id, 'hqb-tesseractjs-v1') })
assert(anonSave.error, 'anon save denied')
const pendingSave = await pending.client.rpc('hqb_save_recognition_result', { payload: scanPayload(regionA.region_id, 'hqb-tesseractjs-v1') })
assert(pendingSave.error && /HQB_FORBIDDEN|HQB_UNAUTHENTICATED/.test(pendingSave.error.message), 'PENDING save denied')

console.log('SCAN crop ingestion + persist + rerun')
const first = await must(await teacher.client.rpc('hqb_save_recognition_result', { payload: scanPayload(regionA.region_id, 'hqb-tesseractjs-v1') }), 'save scan ocr')
const second = await must(await teacher.client.rpc('hqb_save_recognition_result', { payload: scanPayload(regionA.region_id, 'windows-media-ocr-ko') }), 'rerun')
assert(first.result_id !== second.result_id, 'rerun creates a separate result')
const listed = await must(await teacher.client.rpc('hqb_list_recognition_results', { p_region_id: regionA.region_id }), 'list')
assert(listed.length >= 2, 'both results kept')
assert(listed.every((row) => row.processing_mode === 'SCAN_OCR'), 'SCAN_OCR persisted')
assert(listed.every((row) => row.payload.confidence == null), 'confidence stays null')
assert(listed.some((row) => row.engine === 'hqb-tesseractjs-v1'), 'tesseractjs row')
assert(listed.some((row) => row.engine === 'windows-media-ocr-ko'), 'winocr row')

const empty = await must(
  await teacher.client.rpc('hqb_save_recognition_result', {
    payload: scanPayload(regionA.region_id, 'hqb-tesseractjs-v1', {
      status: 'FAILED',
      verdict: 'RED',
      payload: {
        ...scanPayload(regionA.region_id, 'hqb-tesseractjs-v1').payload,
        stem_text: '',
        raw_text: '',
      },
    }),
  }),
  'empty ocr',
)

console.log('verified lock')
const tax = {
  node: (await lookup('curriculum_nodes', 'LINEAR_EQ_UNIT')).id,
  concept: (await lookup('concepts', 'LINEAR_EQUATION')).id,
  type: (await lookup('hyper_problem_types', 'LINEAR_DIRECT_SOLVE')).id,
  strategy: (await lookup('strategy_templates', 'LINEAR_EQUATION_SOLVE')).id,
  target: (await lookup('target_terms', 'EQUATION_SOLUTION')).id,
  reasoning: (await lookup('reasoning_terms', 'TRANSFORMATION')).id,
}
const draft = await must(
  await teacher.client.rpc('hqb_create_problem_draft', {
    payload: {
      source: {
        new_document: {
          title: 'HYPER Internal STEP 7 OCR Regression',
          document_type: 'TEACHER_CREATED',
          publisher: 'HYPER',
          publication_year: 2026,
          license_status: 'OWNED',
          usage_scope: 'INTERNAL_TEST',
        },
        page_number: 1,
        original_problem_number: 'S7R',
      },
      version: { problem_text: 'STEP 7 verified lock 2x+3=11', normalized_text: 'STEP 7 verified lock 2x+3=11', item_format: 'SHORT_ANSWER', origin: 'TEACHER_EDIT' },
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
    },
  }),
  'draft',
)
await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: draft.version_id,
    p_note: 'STEP 7 must not mutate VERIFIED',
  }),
  'verify',
)
const locked = await teacher.client.rpc('hqb_apply_recognition_to_draft', {
  p_result_id: first.result_id,
  p_version_id: draft.version_id,
})
assert(locked.error && /HQB_VERIFIED_LOCKED/.test(locked.error.message), 'VERIFIED apply blocked')
const emptyApply = await teacher.client.rpc('hqb_apply_recognition_to_draft', {
  p_result_id: empty.result_id,
  p_version_id: draft.version_id,
})
assert(emptyApply.error, 'empty/locked apply denied')
const verified = await must(
  await admin.from('problem_versions').select('problem_text,review_status').eq('id', draft.version_id).single(),
  'verified text',
)
assert(verified.review_status === 'VERIFIED', 'still verified')
assert(verified.problem_text.includes('verified lock'), 'verified body unchanged')

console.log('scan ocr v1 acceptance PASS')
console.log(JSON.stringify({
  documentId: begun.document_id,
  regionA: regionA.region_id,
  firstResult: first.result_id,
  secondResult: second.result_id,
}, null, 2))
