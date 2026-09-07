import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'

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
  const data = await must(await admin.from(table).select('id,code').eq('code', code).single(), table)
  return data
}

async function createStaff(email, password, role) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (created.error) throw new Error(`createUser ${email}: ${created.error.message}`)
  const id = created.data.user.id
  await must(await admin.from('user_profiles').upsert({ user_id: id, role, display_name: email }), `role ${email}`)
  const loginClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const session = await loginClient.auth.signInWithPassword({ email, password })
  if (session.error || !session.data.session) throw new Error(`login ${email}: ${session.error?.message ?? 'no session'}`)
  return { id, accessToken: session.data.session.access_token, client: loginClient }
}

function draftPayload(tax, overrides = {}) {
  return {
    source: {
      new_document: {
        title: 'HYPER Internal STEP 4 Fixtures',
        document_type: 'TEACHER_CREATED',
        publisher: 'HYPER',
        publication_year: 2026,
        license_status: 'OWNED',
        usage_scope: 'INTERNAL_TEST',
      },
      page_number: 1,
      original_problem_number: 'D',
    },
    version: {
      instruction: 'x의 값을 구하여라.',
      problem_text: '2(x - 3) + 5 = 11\nx의 값을 구하여라.',
      normalized_text: '2(x-3)+5=11',
      item_format: 'SHORT_ANSWER',
      origin: 'TEACHER_EDIT',
    },
    expressions: [
      {
        expression_role: 'TARGET',
        original_expression: '2(x - 3) + 5 = 11',
        latex_expression: '2(x-3)+5=11',
        normalized_expression: '2(x-3)+5=11',
        structure_skeleton: 'a(x-b)+c=d',
        sort_order: 1,
      },
    ],
    answer: { answer_type: 'NUMBER', answer_text: '6', normalized_answer: '6', numeric_value: 6 },
    explanation: { explanation_type: 'TEACHER', content: '2x - 6 + 5 = 11, 2x = 12, x = 6' },
    curriculum_node_ids: [tax.node],
    concepts: [{ concept_id: tax.concept, is_primary: true, weight: 1, application_role: 'SOLVE_WITH' }],
    type_ids: [tax.type],
    strategy_ids: [tax.strategy],
    target_ids: [tax.target],
    reasoning_ids: [tax.reasoning],
    difficulty: {
      concept_difficulty: 1,
      calculation_complexity: 2,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    },
    ...overrides,
  }
}

const stamp = Date.now()
const teacher = await createStaff(`step4-teacher-${stamp}@hqb.test`, `Tchr-${stamp}aA1!`, 'TEACHER')
const reviewer = await createStaff(`step4-admin-${stamp}@hqb.test`, `Adm-${stamp}aA1!`, 'ADMIN')

const tax = {
  node: (await lookup('curriculum_nodes', 'LINEAR_EQ_UNIT')).id,
  concept: (await lookup('concepts', 'LINEAR_EQUATION')).id,
  type: (await lookup('hyper_problem_types', 'LINEAR_DIRECT_SOLVE')).id,
  strategy: (await lookup('strategy_templates', 'LINEAR_EQUATION_SOLVE')).id,
  target: (await lookup('target_terms', 'EQUATION_SOLUTION')).id,
  reasoning: (await lookup('reasoning_terms', 'TRANSFORMATION')).id,
}

const created = await must(
  await teacher.client.rpc('hqb_create_problem_draft', { payload: draftPayload(tax) }),
  'create D',
)
assert(created.public_code, 'missing public_code')
console.log(`PASS  create-draft ${created.public_code}`)

const teacherVerify = await teacher.client.rpc('hqb_verify_problem_version', {
  p_version_id: created.version_id,
  p_note: 'should fail',
})
assert(teacherVerify.error, 'teacher must not verify')
console.log('PASS  teacher-verify-denied')

const boot = await teacher.client.rpc('hqb_bootstrap_admin')
assert(boot.error, 'authenticated bootstrap must fail')
const anonBoot = await anon.rpc('hqb_bootstrap_admin')
assert(anonBoot.error, 'anon bootstrap must fail')
console.log('PASS  bootstrap-admin-denied')

const verified = await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: created.version_id,
    p_note: 'STEP 4 Test D',
  }),
  'admin verify D',
)
assert(verified.review_status === 'VERIFIED', 'verify did not stick')
console.log('PASS  admin-verify')

const before = await must(
  await admin.from('problems').select('current_version_id,review_status').eq('id', created.problem_id).single(),
  'current before clone',
)
const cloned = await must(
  await teacher.client.rpc('hqb_clone_problem_version', {
    p_problem_id: created.problem_id,
    p_change_reason: 'wording',
    p_content_overrides: {
      instruction: 'x의 값을 구하세요.',
      problem_text: '2(x - 3) + 5 = 11\nx의 값을 구하세요.',
    },
  }),
  'clone D',
)
const afterClone = await must(
  await admin.from('problems').select('current_version_id,review_status').eq('id', created.problem_id).single(),
  'current after clone',
)
assert(afterClone.current_version_id === before.current_version_id, 'current moved too early')
assert(afterClone.review_status === 'VERIFIED', 'verified current lost')
const clonedConcepts = await must(
  await admin.from('problem_concepts').select('id').eq('problem_version_id', cloned.version_id),
  'cloned concepts',
)
const clonedAnswers = await must(
  await admin.from('problem_answers').select('id').eq('problem_version_id', cloned.version_id),
  'cloned answers',
)
const clonedDiff = await must(
  await admin
    .from('problem_difficulty')
    .select('difficulty_source')
    .eq('problem_version_id', cloned.version_id),
  'cloned difficulty',
)
assert(clonedConcepts.length >= 1, 'classification not cloned')
assert(clonedAnswers.length >= 1, 'answer not cloned')
assert(clonedDiff.every((row) => row.difficulty_source === 'HUMAN'), 'MODEL/CALIBRATED should not clone')

const currentBundle = await must(
  await reviewer.client.rpc('hqb_fetch_problem_bundle', { p_public_code: created.public_code }),
  'current bundle after clone',
)
assert(
  String(currentBundle.current_version?.problem_text ?? '').includes('구하여라'),
  'current bundle must still show v1 wording',
)
const v2Bundle = await must(
  await reviewer.client.rpc('hqb_fetch_problem_version_bundle', {
    p_problem_id: created.problem_id,
    p_version_id: cloned.version_id,
  }),
  'exact v2 bundle',
)
assert(v2Bundle.version?.id === cloned.version_id, 'bundle followed current instead of requested version')
assert(String(v2Bundle.version?.problem_text ?? '').includes('구하세요'), 'v2 wording missing')
assert(!String(v2Bundle.version?.problem_text ?? '').includes('구하여라'), 'v2 bundle leaked v1 wording')
assert((v2Bundle.concepts ?? []).length >= 1, 'v2 classification missing')
assert((v2Bundle.answers ?? []).length >= 1, 'v2 answer missing')
assert(
  (v2Bundle.difficulty ?? []).some((row) => row.difficulty_source === 'HUMAN'),
  'v2 HUMAN difficulty missing',
)
assert(v2Bundle.problem?.current_version_id === created.version_id, 'current pointer moved in v2 bundle')
const mismatch = await reviewer.client.rpc('hqb_fetch_problem_version_bundle', {
  p_problem_id: created.problem_id,
  p_version_id: '00000000-0000-0000-0000-000000000000',
})
assert(mismatch.error, 'mismatched version must fail')
console.log('PASS  exact-version-bundle-v2')

const oldStill = await must(
  await admin.from('problem_versions').select('id').eq('id', created.version_id).single(),
  'old version',
)
assert(oldStill.id === created.version_id, 'old version missing')
console.log('PASS  clone-keeps-current')

const v2Verified = await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: cloned.version_id,
    p_note: 'new wording verified',
  }),
  'verify clone',
)
const afterVerify = await must(
  await admin.from('problems').select('current_version_id').eq('id', created.problem_id).single(),
  'current after v2 verify',
)
assert(afterVerify.current_version_id === cloned.version_id, 'current did not switch')
assert(v2Verified.review_status === 'VERIFIED', 'v2 not verified')
console.log('PASS  current-switches-after-verify')

const rollback = await teacher.client.rpc('hqb_create_problem_draft', {
  payload: draftPayload(tax, {
    difficulty: {
      concept_difficulty: 0,
      calculation_complexity: 1,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    },
  }),
})
assert(rollback.error, 'invalid difficulty should roll back')
const orphan = await must(
  await admin.from('problem_versions').select('id').eq('problem_text', 'ROLLBACK_SHOULD_NOT_EXIST'),
  'orphan check',
)
assert(orphan.length === 0, 'unexpected orphan')
console.log('PASS  rollback-invalid-difficulty')

const anonCreate = await anon.rpc('hqb_create_problem_draft', { payload: draftPayload(tax) })
assert(anonCreate.error, 'anon create should fail')
const anonVerify = await anon.rpc('hqb_verify_problem_version', {
  p_version_id: created.version_id,
  p_note: 'nope',
})
assert(anonVerify.error, 'anon verify should fail')
console.log('PASS  anon-rpc-denied')

const direct = await teacher.client
  .from('problems')
  .update({ review_status: 'VERIFIED' })
  .eq('id', created.problem_id)
  .select()
assert(direct.error || !direct.data?.length, 'direct table update should be denied')
console.log('PASS  direct-table-write-denied')

const audits = await must(
  await admin.from('audit_events').select('action').eq('entity_id', created.problem_id),
  'audit',
)
assert(
  ['CREATE_PROBLEM', 'CREATE_VERSION', 'VERIFY_VERSION'].every((action) =>
    audits.some((row) => row.action === action),
  ),
  'missing audit actions',
)
console.log('PASS  audit')

const a = await must(await admin.from('problems').select('public_code').eq('public_code', 'HQB-000001').single(), 'A still there')
assert(a.public_code === 'HQB-000001', 'STEP 3 problem A missing')
console.log('PASS  step3-data-preserved')

console.log(`\nWorkflow v1 tests passed. Test D = ${created.public_code}`)
