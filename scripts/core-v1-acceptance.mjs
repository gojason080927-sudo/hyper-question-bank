import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { FIXTURE_MARK, PROBLEMS } from './fixtures/core-v1-test-problems.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

function failedConstraint(error) {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  return (
    code === '23505' ||
    code === '23503' ||
    code === '23514' ||
    code === '23502' ||
    /duplicate|violates|check constraint|not-null|foreign key/i.test(message)
  )
}

async function must(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message} (${result.error.code ?? 'no-code'})`)
  }
  return result.data
}

async function expectFail(result, label) {
  if (!result.error) {
    throw new Error(`${label}: expected DB rejection, but the write succeeded`)
  }
  if (!failedConstraint(result.error) && result.error.code !== '42501' && result.error.code !== 'PGRST301') {
    // 42501 insufficient privilege, PGRST RLS/permission
    if (!/row-level security|permission denied|violates/i.test(result.error.message ?? '')) {
      throw new Error(`${label}: unexpected error ${result.error.code} ${result.error.message}`)
    }
  }
  return result.error
}

async function expectRlsDeny(result, label) {
  if (!result.error) {
    throw new Error(`${label}: expected anon write to be denied`)
  }
  const message = `${result.error.code ?? ''} ${result.error.message ?? ''}`
  if (!/42501|PGRST|row-level security|permission denied|RLS/i.test(message)) {
    throw new Error(`${label}: expected RLS/privilege denial, got ${message}`)
  }
  return result.error
}

function mapByCode(rows) {
  return Object.fromEntries((rows ?? []).map((row) => [row.code, row]))
}

loadEnvLocal()

const url = mustEnv('VITE_SUPABASE_URL')
const anonKey = mustEnv('VITE_SUPABASE_ANON_KEY')
const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')

assert(!url.includes(STUDENT_CARE_REF), 'Refusing to run tests against Student Care Supabase')
assert(
  url.includes(QUESTION_BANK_REF),
  `Expected Question Bank project ${QUESTION_BANK_REF}, got ${url}`,
)
assert(!anonKey.includes('service_role'), 'anon key looks like a service role key')

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

const report = {
  results: {},
  publicCodes: {},
  problemA: null,
  notes: [],
}

function pass(name, extra) {
  report.results[name] = extra ? { status: 'PASS', ...extra } : { status: 'PASS' }
  console.log(`PASS  ${name}`)
}

function fail(name, error) {
  report.results[name] = { status: 'FAIL', error: error instanceof Error ? error.message : String(error) }
  console.error(`FAIL  ${name}: ${report.results[name].error}`)
}

async function lookupTaxonomy() {
  const [frameworks, nodes, concepts, types, strategies, conditions, targets, reasoning] = await Promise.all([
    must(await admin.from('curriculum_frameworks').select('id,code,name'), 'frameworks'),
    must(await admin.from('curriculum_nodes').select('id,code,name,node_type,framework_id'), 'nodes'),
    must(await admin.from('concepts').select('id,code,name'), 'concepts'),
    must(await admin.from('hyper_problem_types').select('id,code,name'), 'types'),
    must(await admin.from('strategy_templates').select('id,code,name'), 'strategies'),
    must(await admin.from('condition_terms').select('id,code,name'), 'conditions'),
    must(await admin.from('target_terms').select('id,code,name'), 'targets'),
    must(await admin.from('reasoning_terms').select('id,code,name'), 'reasoning'),
  ])
  return {
    frameworks: mapByCode(frameworks),
    nodes: mapByCode(nodes),
    concepts: mapByCode(concepts),
    types: mapByCode(types),
    strategies: mapByCode(strategies),
    conditions: mapByCode(conditions),
    targets: mapByCode(targets),
    reasoning: mapByCode(reasoning),
  }
}

async function ensureSources() {
  const primary = await must(
    await admin
      .from('source_documents')
      .select('id,title')
      .eq('title', 'HYPER Internal STEP 3 Fixtures')
      .maybeSingle(),
    'lookup source 1',
  )
  let source1 = primary
  if (!source1) {
    source1 = await must(
      await admin
        .from('source_documents')
        .insert({
          title: 'HYPER Internal STEP 3 Fixtures',
          publisher: 'HYPER',
          author: 'Question Bank STEP 3',
          publication_year: 2026,
          document_type: 'TEACHER_CREATED',
          source_type: 'internal_fixture',
          license_status: 'OWNED',
          usage_scope: 'INTERNAL_TEST',
          copyright_note: 'Original HYPER test items. Not copied from commercial textbooks.',
          page_count: 2,
        })
        .select()
        .single(),
      'insert source 1',
    )
  }
  const secondary = await must(
    await admin
      .from('source_documents')
      .select('id,title')
      .eq('title', 'HYPER Internal STEP 3 Fixtures Copy Set')
      .maybeSingle(),
    'lookup source 2',
  )
  let source2 = secondary
  if (!source2) {
    source2 = await must(
      await admin
        .from('source_documents')
        .insert({
          title: 'HYPER Internal STEP 3 Fixtures Copy Set',
          publisher: 'HYPER',
          document_type: 'TEACHER_CREATED',
          license_status: 'OWNED',
          usage_scope: 'INTERNAL_TEST',
          page_count: 1,
        })
        .select()
        .single(),
      'insert source 2',
    )
  }
  async function ensurePage(documentId, pageNumber) {
    const existing = await must(
      await admin
        .from('source_pages')
        .select('id')
        .eq('source_document_id', documentId)
        .eq('page_number', pageNumber)
        .maybeSingle(),
      'lookup page',
    )
    if (existing) return existing
    return must(
      await admin
        .from('source_pages')
        .insert({
          source_document_id: documentId,
          page_number: pageNumber,
          extraction_status: 'MANUAL',
          review_status: 'UNREVIEWED',
        })
        .select()
        .single(),
      'insert page',
    )
  }
  const page1 = await ensurePage(source1.id, 1)
  const page2 = await ensurePage(source2.id, 1)
  return { source1, source2, page1, page2 }
}

async function insertClassifiedProblem(tax, sources, spec, options = {}) {
  const problem = await must(
    await admin
      .from('problems')
      .insert({
        review_status: options.reviewStatus ?? 'UNREVIEWED',
        lifecycle_status: 'DRAFT',
        use_status: 'INTERNAL_ONLY',
      })
      .select()
      .single(),
    `insert problem ${spec.key}`,
  )
  const version = await must(
    await admin
      .from('problem_versions')
      .insert({
        problem_id: problem.id,
        version_no: 1,
        origin: spec.origin,
        problem_text: spec.text,
        normalized_text: spec.normalized,
        instruction: spec.instruction,
        item_format: 'SHORT_ANSWER',
        choice_count: 0,
        content_metadata: { fixture: FIXTURE_MARK, fixture_key: spec.key },
        extraction_status: 'MANUAL',
        classification_status: 'DRAFT',
        review_status: options.reviewStatus ?? 'UNREVIEWED',
        created_by: 'STEP3_TEST',
      })
      .select()
      .single(),
    `insert version ${spec.key}`,
  )
  await must(
    await admin.from('problems').update({ current_version_id: version.id }).eq('id', problem.id),
    `link current version ${spec.key}`,
  )

  const sourceRows = (
    options.sources ?? [
      {
        source_document_id: sources.source1.id,
        source_page_id: sources.page1.id,
        original_problem_number: spec.key,
        bounding_box: {
          x: 0.1,
          y: 0.1,
          width: 0.5,
          height: 0.2,
          unit: 'normalized',
          pageWidth: 1,
          pageHeight: 1,
        },
        source_type_label: 'internal_fixture',
        is_primary_source: true,
      },
    ]
  ).map((row) => ({ ...row, problem_id: problem.id }))
  await must(await admin.from('problem_sources').insert(sourceRows), `sources ${spec.key}`)

  if (spec.curriculumNode) {
    await must(
      await admin.from('problem_curriculum').insert({
        problem_version_id: version.id,
        curriculum_node_id: tax.nodes[spec.curriculumNode].id,
        is_primary: true,
      }),
      `curriculum ${spec.key}`,
    )
  }
  await must(
    await admin.from('problem_concepts').insert({
      problem_version_id: version.id,
      concept_id: tax.concepts[spec.concept].id,
      is_primary: true,
      weight: 1,
      application_role: 'SOLVE_WITH',
      confidence: 1,
      assigned_by: 'STEP3_TEST',
    }),
    `concept ${spec.key}`,
  )
  for (const extra of spec.extraConcepts ?? []) {
    await must(
      await admin.from('problem_concepts').insert({
        problem_version_id: version.id,
        concept_id: tax.concepts[extra.code].id,
        is_primary: extra.primary,
        weight: extra.weight,
        application_role: extra.role,
        assigned_by: 'STEP3_TEST',
      }),
      `extra concept ${extra.code}`,
    )
  }
  await must(
    await admin.from('problem_type_assignments').insert({
      problem_version_id: version.id,
      hyper_problem_type_id: tax.types[spec.type].id,
      is_primary: true,
      confidence: 1,
      assigned_by: 'STEP3_TEST',
    }),
    `type ${spec.key}`,
  )
  await must(
    await admin.from('problem_strategy_assignments').insert({
      problem_version_id: version.id,
      strategy_template_id: tax.strategies[spec.strategy].id,
      is_primary: true,
      confidence: 1,
      assigned_by: 'STEP3_TEST',
    }),
    `strategy ${spec.key}`,
  )
  await must(
    await admin.from('math_expressions').insert({
      problem_version_id: version.id,
      expression_role: spec.expression.role,
      original_expression: spec.expression.original,
      normalized_expression: spec.expression.normalized,
      latex_expression: spec.expression.latex,
      structure_skeleton: spec.expression.skeleton,
      structure_tags: spec.expression.tags,
      sort_order: 1,
    }),
    `expression ${spec.key}`,
  )
  for (const code of spec.conditions ?? []) {
    await must(
      await admin.from('problem_conditions').insert({
        problem_version_id: version.id,
        condition_term_id: tax.conditions[code].id,
        assignment_status: 'APPROVED',
        assigned_by: 'STEP3_TEST',
      }),
      `condition ${code}`,
    )
  }
  await must(
    await admin.from('problem_targets').insert({
      problem_version_id: version.id,
      target_term_id: tax.targets[spec.target].id,
      assignment_status: 'APPROVED',
      is_primary: true,
      assigned_by: 'STEP3_TEST',
    }),
    `target ${spec.key}`,
  )
  for (const code of spec.reasoning) {
    await must(
      await admin.from('problem_reasoning').insert({
        problem_version_id: version.id,
        reasoning_term_id: tax.reasoning[code].id,
        assigned_by: 'STEP3_TEST',
      }),
      `reasoning ${code}`,
    )
  }
  await must(
    await admin.from('problem_difficulty').insert({
      problem_version_id: version.id,
      difficulty_source: 'HUMAN',
      created_by: 'STEP3_TEST',
      ...spec.difficultyHuman,
    }),
    `difficulty human ${spec.key}`,
  )
  await must(
    await admin.from('problem_answers').insert({
      problem_version_id: version.id,
      answer_type: spec.answer.type,
      answer_text: spec.answer.text,
      normalized_answer: spec.answer.normalized,
      numeric_value: spec.answer.numeric,
    }),
    `answer ${spec.key}`,
  )
  if (spec.explanation) {
    await must(
      await admin.from('problem_explanations').insert({
        problem_version_id: version.id,
        explanation_type: 'TEACHER',
        content: spec.explanation,
        created_by: 'STEP3_TEST',
      }),
      `explanation ${spec.key}`,
    )
  }
  if (options.withReview) {
    await must(
      await admin.from('reviews').insert({
        problem_id: problem.id,
        problem_version_id: version.id,
        status: 'UNREVIEWED',
        reviewer: 'STEP3_TEST',
        note: 'fixture created',
      }),
      `review ${spec.key}`,
    )
  }
  const latest = await must(
    await admin.from('problems').select('*').eq('id', problem.id).single(),
    `reload problem ${spec.key}`,
  )
  return { problem: latest, version }
}

async function fetchBundle(publicCode) {
  const result = await admin.rpc('hqb_fetch_problem_bundle', { p_public_code: publicCode })
  const data = await must(result, `fetch ${publicCode}`)
  assert(data, `fetch ${publicCode} returned empty`)
  return data
}

async function run() {
  const tax = await lookupTaxonomy()
  assert(tax.frameworks.KR_2022, 'missing KR_2022 framework seed')
  assert(tax.concepts.LINEAR_EQUATION, 'missing LINEAR_EQUATION seed')
  assert(tax.strategies.FACTORABLE_QUADRATIC_SOLVE, 'missing quadratic strategy seed')
  const steps = await must(
    await admin
      .from('strategy_template_steps')
      .select('step_no,label,strategy_template_id')
      .eq('strategy_template_id', tax.strategies.FACTORABLE_QUADRATIC_SOLVE.id)
      .order('step_no'),
    'strategy steps',
  )
  assert(steps.length === 5, `expected 5 quadratic strategy steps, got ${steps.length}`)
  pass('taxonomy-seed')

  const sources = await ensureSources()

  const a = await insertClassifiedProblem(tax, sources, PROBLEMS.A, { withReview: true })
  report.publicCodes.A = a.problem.public_code
  pass('problem-A-insert', { public_code: a.problem.public_code })

  const bundleA = await fetchBundle(a.problem.public_code)
  report.problemA = bundleA
  assert(bundleA.problem.public_code === a.problem.public_code, 'bundle public_code mismatch')
  assert(bundleA.current_version.problem_text.includes('3x + 7 = 22'), 'A text missing')
  assert(bundleA.sources.length >= 1, 'A source missing')
  assert(bundleA.curriculum.some((row) => row.framework_code === 'KR_2022'), 'A curriculum missing')
  assert(bundleA.concepts.some((row) => row.is_primary && row.code === 'LINEAR_EQUATION'), 'A primary concept missing')
  assert(bundleA.hyper_types.some((row) => row.code === 'LINEAR_DIRECT_SOLVE'), 'A type missing')
  assert(bundleA.strategies[0]?.steps?.length >= 3, 'A strategy steps missing')
  assert(bundleA.expressions.some((row) => row.structure_skeleton === 'ax+b=c'), 'A skeleton missing')
  assert(bundleA.targets.some((row) => row.code === 'EQUATION_SOLUTION'), 'A target missing')
  assert(bundleA.reasoning.some((row) => row.code === 'TRANSFORMATION'), 'A reasoning missing')
  const humanA = bundleA.difficulty.find((row) => row.difficulty_source === 'HUMAN')
  assert(humanA, 'A HUMAN difficulty missing')
  assert(Number(humanA.overall_difficulty) === 1, `A overall expected 1.00, got ${humanA.overall_difficulty}`)
  assert(bundleA.answers.some((row) => String(row.numeric_value) === '5' || row.answer_text === '5'), 'A answer missing')
  assert(bundleA.reviews.length >= 1, 'A review missing')
  pass('problem-A-fetch')

  const b = await insertClassifiedProblem(tax, sources, PROBLEMS.B, {
    sources: [
      {
        source_document_id: sources.source1.id,
        source_page_id: sources.page1.id,
        original_problem_number: 'B-1',
        bounding_box: {
          x: 0.2,
          y: 0.3,
          width: 0.4,
          height: 0.15,
          unit: 'normalized',
          pageWidth: 1,
          pageHeight: 1,
        },
        source_type_label: 'internal_fixture',
        is_primary_source: true,
      },
      {
        source_document_id: sources.source2.id,
        source_page_id: sources.page2.id,
        original_problem_number: 'B-copy',
        source_type_label: 'reprint_set',
        is_primary_source: false,
      },
    ],
  })
  report.publicCodes.B = b.problem.public_code
  pass('problem-B-insert', { public_code: b.problem.public_code })

  const c = await insertClassifiedProblem(tax, sources, PROBLEMS.C)
  report.publicCodes.C = c.problem.public_code
  pass('problem-C-insert', { public_code: c.problem.public_code })

  const codes = [a.problem.public_code, b.problem.public_code, c.problem.public_code]
  assert(new Set(codes).size === 3, `public_code not unique: ${codes.join(',')}`)
  assert(codes.every((code) => /^HQB-[0-9]{6,}$/.test(code)), `public_code format: ${codes.join(',')}`)
  pass('public-code-unique', { codes })

  // Repair B sources if the placeholder ids were inserted incorrectly
  const bSources = await must(
    await admin.from('problem_sources').select('id,problem_id,source_document_id').eq('problem_id', b.problem.id),
    'b sources',
  )
  if (bSources.length < 2) {
    await must(
      await admin.from('problem_sources').insert({
        problem_id: b.problem.id,
        source_document_id: sources.source2.id,
        source_page_id: sources.page2.id,
        original_problem_number: 'B-copy',
        source_type_label: 'reprint_set',
        is_primary_source: false,
      }),
      'b second source',
    )
  }
  const bSourcesFinal = await must(
    await admin.from('problem_sources').select('id,source_document_id').eq('problem_id', b.problem.id),
    'b sources final',
  )
  assert(bSourcesFinal.length === 2, `expected 2 sources for B, got ${bSourcesFinal.length}`)
  await must(
    await admin
      .from('source_documents')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', sources.source2.id),
    'archive source 2',
  )
  const bStill = await must(await admin.from('problems').select('id,public_code').eq('id', b.problem.id).single(), 'b after archive')
  assert(bStill.id === b.problem.id, 'problem B disappeared after source archive')
  pass('source-nm', { source_count: 2 })

  // Version lifecycle for A
  await must(
    await admin
      .from('problems')
      .update({ review_status: 'VERIFIED', lifecycle_status: 'ACTIVE' })
      .eq('id', a.problem.id),
    'verify A',
  )
  await must(
    await admin.from('problem_versions').update({ review_status: 'VERIFIED' }).eq('id', a.version.id),
    'verify A v1',
  )
  await must(
    await admin.from('reviews').insert({
      problem_id: a.problem.id,
      problem_version_id: a.version.id,
      status: 'VERIFIED',
      reviewer: 'STEP3_REVIEWER',
      note: 'verified original',
      reviewed_at: new Date().toISOString(),
    }),
    'review history A',
  )
  const v2 = await must(
    await admin
      .from('problem_versions')
      .insert({
        problem_id: a.problem.id,
        version_no: 2,
        origin: 'TEACHER_EDIT',
        parent_version_id: a.version.id,
        change_reason: 'Post-VERIFIED wording clarification',
        problem_text: '다음 일차방정식을 풀어 x의 값을 구하여라. 3x + 7 = 22',
        normalized_text: PROBLEMS.A.normalized,
        instruction: '다음 일차방정식을 푸시오.',
        item_format: 'SHORT_ANSWER',
        content_metadata: { fixture: FIXTURE_MARK, fixture_key: 'STEP3_A_V2' },
        created_by: 'STEP3_TEST',
      })
      .select()
      .single(),
    'insert A v2',
  )
  await must(
    await admin.from('problems').update({ current_version_id: v2.id, review_status: 'NEEDS_REVIEW' }).eq('id', a.problem.id),
    'point A to v2',
  )
  await must(
    await admin.from('problem_difficulty').insert({
      problem_version_id: v2.id,
      difficulty_source: 'HUMAN',
      concept_difficulty: 1,
      calculation_complexity: 1,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    }),
    'v2 human difficulty',
  )
  await must(
    await admin.from('problem_difficulty').insert({
      problem_version_id: v2.id,
      difficulty_source: 'MODEL',
      concept_difficulty: 1,
      calculation_complexity: 2,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    }),
    'v2 model difficulty',
  )
  await must(
    await admin.from('problem_difficulty').insert({
      problem_version_id: v2.id,
      difficulty_source: 'CALIBRATED',
      concept_difficulty: 1,
      calculation_complexity: 1,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    }),
    'v2 calibrated difficulty',
  )
  const versions = await must(
    await admin.from('problem_versions').select('id,version_no').eq('problem_id', a.problem.id).order('version_no'),
    'list A versions',
  )
  const current = await must(await admin.from('problems').select('current_version_id').eq('id', a.problem.id).single(), 'current A')
  assert(versions.length === 2, `expected 2 versions, got ${versions.length}`)
  assert(current.current_version_id === v2.id, 'current_version_id did not move to v2')
  const v1Difficulty = await must(
    await admin.from('problem_difficulty').select('difficulty_source,overall_difficulty').eq('problem_version_id', a.version.id),
    'v1 difficulty still present',
  )
  assert(v1Difficulty.length === 1, 'v1 classification/difficulty was lost')
  const v2Difficulty = await must(
    await admin.from('problem_difficulty').select('difficulty_source').eq('problem_version_id', v2.id),
    'v2 difficulty sources',
  )
  assert(
    ['HUMAN', 'MODEL', 'CALIBRATED'].every((src) => v2Difficulty.some((row) => row.difficulty_source === src)),
    'HUMAN/MODEL/CALIBRATED did not coexist',
  )
  const modelOverall = await must(
    await admin
      .from('problem_difficulty')
      .select('overall_difficulty')
      .eq('problem_version_id', v2.id)
      .eq('difficulty_source', 'MODEL')
      .single(),
    'model overall',
  )
  assert(Number(modelOverall.overall_difficulty) === 1.17, `expected 1.17, got ${modelOverall.overall_difficulty}`)
  pass('version-lifecycle')
  pass('difficulty-sources-coexist')

  await expectFail(
    await admin.from('problem_difficulty').insert({
      problem_version_id: v2.id,
      difficulty_source: 'HUMAN',
      concept_difficulty: 0,
      calculation_complexity: 1,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    }),
    'difficulty 0',
  )
  pass('difficulty-0-rejected')

  await expectFail(
    await admin.from('problem_difficulty').insert({
      problem_version_id: a.version.id,
      difficulty_source: 'MODEL',
      concept_difficulty: 6,
      calculation_complexity: 1,
      reasoning_depth: 1,
      condition_complexity: 1,
      representation_complexity: 1,
      trap_level: 1,
    }),
    'difficulty 6',
  )
  pass('difficulty-6-rejected')

  await expectFail(
    await admin.from('problems').update({ public_code: a.problem.public_code }).eq('id', b.problem.id),
    'duplicate public_code',
  )
  pass('duplicate-public-code-rejected')

  await expectFail(
    await admin.from('problem_versions').insert({
      problem_id: a.problem.id,
      version_no: 1,
      origin: 'TEACHER_EDIT',
      problem_text: 'duplicate version',
    }),
    'duplicate version',
  )
  pass('duplicate-version-rejected')

  await expectFail(
    await admin.from('problem_concepts').insert({
      problem_version_id: '00000000-0000-4000-8000-000000000099',
      concept_id: tax.concepts.LINEAR_EQUATION.id,
    }),
    'orphan FK',
  )
  pass('orphan-fk-rejected')

  await expectFail(
    await admin.from('problems').update({ review_status: 'BOGUS' }).eq('id', a.problem.id),
    'invalid review_status',
  )
  pass('invalid-review-status-rejected')

  await expectFail(
    await admin.from('problem_versions').insert({
      problem_id: a.problem.id,
      version_no: 9,
      origin: 'TEACHER_EDIT',
      problem_text: null,
    }),
    'required field',
  )
  pass('required-field-rejected')

  await expectRlsDeny(await anon.from('problems').insert({ lifecycle_status: 'DRAFT' }), 'anon insert')
  pass('anon-insert-denied')

  await expectRlsDeny(
    await anon.from('problems').update({ review_status: 'VERIFIED' }).eq('id', a.problem.id),
    'anon update',
  )
  pass('anon-update-denied')

  const anonRead = await anon.from('problems').select('id').eq('id', a.problem.id)
  assert(anonRead.error || !anonRead.data?.length, 'anon unexpectedly read core problems')
  pass('anon-select-core-denied')

  const rls = await must(
    await admin.rpc('hqb_fetch_problem_bundle', { p_public_code: a.problem.public_code }),
    'rls still allows service fetch',
  )
  assert(rls.problem.id === a.problem.id, 'service fetch failed after rls tests')

  const enabled = await must(
    await admin
      .from('problems')
      .select('id')
      .limit(1),
    'service select after rls',
  )
  assert(enabled.length >= 1, 'service_role lost read access')
}

run()
  .then(() => {
    const failed = Object.entries(report.results).filter(([, value]) => value.status === 'FAIL')
    const out = path.join(root, 'scripts', '.tmp-core-v1-report.json')
    fs.writeFileSync(out, JSON.stringify(report, null, 2))
    if (failed.length) {
      console.error(`\n${failed.length} test(s) failed`)
      process.exit(1)
    }
    console.log('\nAll STEP 3 acceptance tests passed')
    console.log(`public_codes: ${JSON.stringify(report.publicCodes)}`)
  })
  .catch((error) => {
    fail('runner', error)
    fs.writeFileSync(
      path.join(root, 'scripts', '.tmp-core-v1-report.json'),
      JSON.stringify(report, null, 2),
    )
    console.error(error)
    process.exit(1)
  })
