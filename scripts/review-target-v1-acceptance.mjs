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
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw new Error(`createUser ${email}: ${created.error.message}`)
  const id = created.data.user.id
  await must(await admin.from('user_profiles').upsert({ user_id: id, role, display_name: email }), `role ${email}`)
  const loginClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const session = await loginClient.auth.signInWithPassword({ email, password })
  if (session.error || !session.data.session) throw new Error(`login ${email}: ${session.error?.message ?? 'no session'}`)
  return { id, client: loginClient }
}

function draftPayload(tax, text) {
  return {
    source: {
      new_document: {
        title: 'HYPER Internal STEP 4.5 Review Target',
        document_type: 'TEACHER_CREATED',
        publisher: 'HYPER',
        publication_year: 2026,
        license_status: 'OWNED',
        usage_scope: 'INTERNAL_TEST',
      },
      page_number: 1,
      original_problem_number: 'R45',
    },
    version: {
      instruction: text,
      problem_text: `5x - 4 = 21\n${text}`,
      normalized_text: '5x-4=21',
      item_format: 'SHORT_ANSWER',
      origin: 'TEACHER_EDIT',
    },
    expressions: [
      {
        expression_role: 'TARGET',
        original_expression: '5x - 4 = 21',
        latex_expression: '5x-4=21',
        sort_order: 1,
      },
    ],
    answer: { answer_type: 'NUMBER', answer_text: '5', numeric_value: 5 },
    curriculum_node_ids: [tax.node],
    concepts: [{ concept_id: tax.concept, is_primary: true, weight: 1, application_role: 'SOLVE_WITH' }],
    type_ids: [tax.type],
    strategy_ids: [tax.strategy],
    target_ids: [tax.target],
    reasoning_ids: [tax.reasoning],
    difficulty: {
      concept_difficulty: 1,
      calculation_complexity: 1,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    },
  }
}

const stamp = Date.now()
const teacher = await createStaff(`step45-teacher-${stamp}@hqb.test`, `Tchr-${stamp}aA1!`, 'TEACHER')
const reviewer = await createStaff(`step45-admin-${stamp}@hqb.test`, `Adm-${stamp}aA1!`, 'ADMIN')

const boot = await teacher.client.rpc('hqb_bootstrap_admin')
assert(boot.error, 'authenticated bootstrap must fail')
const anonBoot = await anon.rpc('hqb_bootstrap_admin')
assert(anonBoot.error, 'anon bootstrap must fail')
console.log('PASS  bootstrap-closed')

const pendingUser = await admin.auth.admin.createUser({
  email: `step45-pending-${stamp}@hqb.test`,
  password: `Pend-${stamp}aA1!`,
  email_confirm: true,
})
if (pendingUser.error) throw new Error(pendingUser.error.message)
const pendingClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const pendingLogin = await pendingClient.auth.signInWithPassword({
  email: `step45-pending-${stamp}@hqb.test`,
  password: `Pend-${stamp}aA1!`,
})
if (pendingLogin.error) throw new Error(pendingLogin.error.message)
const pendingProfile = await must(await pendingClient.rpc('hqb_my_profile'), 'pending profile')
assert(pendingProfile.role === 'PENDING', `expected PENDING, got ${pendingProfile.role}`)
console.log('PASS  new-user-pending')

const tax = {
  node: (await lookup('curriculum_nodes', 'LINEAR_EQ_UNIT')).id,
  concept: (await lookup('concepts', 'LINEAR_EQUATION')).id,
  type: (await lookup('hyper_problem_types', 'LINEAR_DIRECT_SOLVE')).id,
  strategy: (await lookup('strategy_templates', 'LINEAR_EQUATION_SOLVE')).id,
  target: (await lookup('target_terms', 'EQUATION_SOLUTION')).id,
  reasoning: (await lookup('reasoning_terms', 'TRANSFORMATION')).id,
}

const created = await must(
  await teacher.client.rpc('hqb_create_problem_draft', {
    payload: draftPayload(tax, 'x의 값을 구하여라.'),
  }),
  'create review-target draft',
)
await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: created.version_id,
    p_note: 'STEP 4.5 v1',
  }),
  'verify v1',
)
const cloned = await must(
  await teacher.client.rpc('hqb_clone_problem_version', {
    p_problem_id: created.problem_id,
    p_change_reason: 'wording',
    p_content_overrides: {
      instruction: 'x의 값을 구하세요.',
      problem_text: '5x - 4 = 21\nx의 값을 구하세요.',
    },
  }),
  'clone v2',
)

const currentAfterClone = await must(
  await admin.from('problems').select('current_version_id').eq('id', created.problem_id).single(),
  'current after clone',
)
assert(currentAfterClone.current_version_id === created.version_id, 'current moved to draft')

const currentBundle = await must(
  await reviewer.client.rpc('hqb_fetch_problem_bundle', { p_public_code: created.public_code }),
  'current bundle',
)
assert(String(currentBundle.current_version?.problem_text ?? '').includes('구하여라'), 'current bundle is not v1')

const v2Bundle = await must(
  await reviewer.client.rpc('hqb_fetch_problem_version_bundle', {
    p_problem_id: created.problem_id,
    p_version_id: cloned.version_id,
  }),
  'v2 bundle',
)
assert(v2Bundle.version?.id === cloned.version_id, 'preview version != requested version')
assert(String(v2Bundle.version?.problem_text ?? '').includes('구하세요.'), 'v2 text missing')
assert(!String(v2Bundle.version?.problem_text ?? '').includes('구하여라'), 'v2 preview leaked v1')
assert((v2Bundle.concepts ?? []).length >= 1, 'v2 classification missing')
assert(String(v2Bundle.answers?.[0]?.answer_text ?? v2Bundle.answers?.[0]?.numeric_value) === '5', 'v2 answer missing')
assert((v2Bundle.difficulty ?? []).some((row) => row.difficulty_source === 'HUMAN'), 'v2 HUMAN difficulty missing')
assert(v2Bundle.problem.current_version_id === created.version_id, 'bundle mutated current')
console.log('PASS  review-preview-is-v2')

const pendingFetch = await pendingClient.rpc('hqb_fetch_problem_version_bundle', {
  p_problem_id: created.problem_id,
  p_version_id: cloned.version_id,
})
assert(pendingFetch.error, 'PENDING must not read core bundle')
const anonFetch = await anon.rpc('hqb_fetch_problem_version_bundle', {
  p_problem_id: created.problem_id,
  p_version_id: cloned.version_id,
})
assert(anonFetch.error, 'anon must not fetch version bundle')
console.log('PASS  pending-and-anon-denied')

const v2Verified = await must(
  await reviewer.client.rpc('hqb_verify_problem_version', {
    p_version_id: cloned.version_id,
    p_note: 'STEP 4.5 v2',
  }),
  'verify v2',
)
const after = await must(
  await admin.from('problems').select('current_version_id').eq('id', created.problem_id).single(),
  'current after v2 verify',
)
assert(after.current_version_id === cloned.version_id, 'current did not switch to v2')
assert(v2Verified.review_status === 'VERIFIED', 'v2 not verified')
const oldV1 = await must(
  await admin.from('problem_versions').select('id,review_status').eq('id', created.version_id).single(),
  'old v1',
)
assert(oldV1.id === created.version_id, 'v1 missing')
const v1Reviews = await must(
  await admin.from('reviews').select('status').eq('problem_version_id', created.version_id),
  'v1 reviews',
)
assert(v1Reviews.some((row) => row.status === 'VERIFIED'), 'v1 verified history lost')
console.log('PASS  current-switches-only-after-v2-verify')

const teacherVerify = await teacher.client.rpc('hqb_verify_problem_version', {
  p_version_id: cloned.version_id,
  p_note: 'nope',
})
assert(teacherVerify.error, 'teacher must not verify')
console.log('PASS  teacher-verify-denied')

console.log(`\nSTEP 4.5 review-target tests passed. public_code=${created.public_code}`)
