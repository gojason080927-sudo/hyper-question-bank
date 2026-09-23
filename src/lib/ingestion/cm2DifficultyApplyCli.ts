/**
 * Dry-run / apply CM2 absolute difficulty only.
 * Never mutates problem_text, types, curriculum, or key points.
 * Default is dry-run. --apply writes dims via hqb_upsert_problem_difficulty_dims.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { DIFFICULTY_DIMS_RPC } from '../taxonomy/classificationPersistence'
import { CM2_ASSIGNED_BY } from '../taxonomy/cm2Catalog'
import { cm2DifficultyRpcPayload, type Cm2Decision } from '../taxonomy/cm2Classify'
import {
  addLevel,
  CM2_DIFFICULTY_ARTIFACT,
  distributionLooksSane,
  emptyLevelHist,
  scoreStoredCm2Difficulty,
  typeForDifficulty,
} from '../taxonomy/cm2DifficultyApply'
import { CLASSIFY_TARGETS } from './bookClassifyCli'
import { QUESTION_BANK_REF, STUDENT_CARE_REF } from './math2Persist'

const REPORT_DIR = 'ocr-tests/taxonomy/cm2-difficulty-apply'

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
  if (!url || !key) throw new Error('CM2_DIFF_SUPABASE: missing env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('CM2_DIFF_FORBIDDEN: hyper-student-care refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('CM2_DIFF_WRONG_PROJECT')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function staffClient(admin: SupabaseClient) {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  const email = 'hqb.pipeline.bookclassify@hyper.local'
  const password = 'BookClassify-46a3aA1!'
  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const found = existing.data?.users.find((user) => user.email === email)
  if (!found) throw new Error('CM2_DIFF_STAFF_MISSING')
  const staff = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await staff.auth.signInWithPassword({ email, password })
  if (login.error) throw new Error(login.error.message)
  return staff
}

export async function runCm2DifficultyApplyCli(root = process.cwd(), argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply') || argv.includes('--persist')
  const only = argv.find((arg) => arg.startsWith('--book='))?.slice('--book='.length)
  const targets = CLASSIFY_TARGETS.filter((row) => !only || row.slug === only)
  if (!targets.length) throw new Error(`CM2_DIFF_UNKNOWN_BOOK: ${only}`)
  for (const target of targets) {
    if (target.sourceId === SSEN_SOURCE_DOCUMENT_ID) throw new Error('CM2_DIFF_FORBIDDEN: 쎈1 is skipped')
  }

  const admin = adminClient()
  const staff = apply ? await staffClient(admin) : null

  const types = await paged<{ id: string; code: string }>(admin, 'hyper_problem_types', 'id, code', (q) => q)
  const typeById = new Map(types.map((row) => [row.id, row.code]))

  const overall = emptyLevelHist()
  const books: Record<string, Record<1 | 2 | 3 | 4 | 5, number>> = {}
  const samples: Array<Record<string, unknown>> = []
  const dimSplit = { split: 0, cloned: 0 }
  let typed = 0
  let untyped = 0
  let total = 0
  let written = 0
  let failed = 0
  let skippedVerified = 0

  for (const target of targets) {
    books[target.slug] = emptyLevelHist()
    const sources = await paged<{ problem_id: string; original_problem_number: string | null }>(
      admin,
      'problem_sources',
      'problem_id, original_problem_number',
      (q) => q.eq('source_document_id', target.sourceId),
    )
    const problemIds = [...new Set(sources.map((row) => row.problem_id))]
    const numberByProblem = new Map(sources.map((row) => [row.problem_id, String(row.original_problem_number ?? '').padStart(4, '0')]))
    const problems: Array<{ id: string; current_version_id: string | null; review_status: string }> = []
    for (let i = 0; i < problemIds.length; i += 200) {
      const { data, error } = await admin.from('problems').select('id, current_version_id, review_status').in('id', problemIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      problems.push(...((data ?? []) as typeof problems))
    }
    const versionIds = problems.map((row) => row.current_version_id).filter((id): id is string => Boolean(id))
    const problemByVersion = new Map(problems.filter((row) => row.current_version_id).map((row) => [row.current_version_id!, row]))
    const versions = new Map<string, string>()
    for (let i = 0; i < versionIds.length; i += 200) {
      const { data, error } = await admin.from('problem_versions').select('id, problem_text').in('id', versionIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      for (const row of data ?? []) versions.set(row.id as string, String(row.problem_text ?? ''))
    }
    const typeByVersion = new Map<string, string>()
    for (let i = 0; i < versionIds.length; i += 200) {
      const { data, error } = await admin
        .from('problem_type_assignments')
        .select('problem_version_id, hyper_problem_type_id')
        .in('problem_version_id', versionIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      for (const row of data ?? []) {
        const code = typeById.get(row.hyper_problem_type_id as string)
        if (code && !typeByVersion.has(row.problem_version_id as string)) typeByVersion.set(row.problem_version_id as string, code)
      }
    }

    const byLevel = new Map<number, Record<string, unknown>>()
    for (const [versionId, stem] of versions) {
      const problem = problemByVersion.get(versionId)
      if (!problem) continue
      if (problem.review_status === 'VERIFIED') {
        skippedVerified += 1
        continue
      }
      const storedType = typeByVersion.get(versionId) ?? null
      const used = typeForDifficulty(storedType)
      const estimate = scoreStoredCm2Difficulty({ stem, storedType })
      addLevel(overall, estimate.overall_level)
      addLevel(books[target.slug]!, estimate.overall_level)
      total += 1
      if (used) typed += 1
      else untyped += 1
      const split = new Set(Object.values(estimate.dim_levels)).size > 1
      if (split || estimate.overall_level === 1) dimSplit.split += 1
      else dimSplit.cloned += 1
      if (!byLevel.has(estimate.overall_level)) {
        byLevel.set(estimate.overall_level, {
          book: target.slug,
          number: numberByProblem.get(problem.id) ?? '?',
          type: used,
          level: estimate.overall_level,
          score: estimate.overall_score,
          dims: estimate.dim_levels,
          extras: estimate.extra_families,
          type_used: Boolean(used),
          preview: estimate.question_stem.slice(0, 140),
        })
      }
      if (!apply || !staff) continue
      const decision = {
        problem_id: problem.id,
        page: 0,
        problem_number: numberByProblem.get(problem.id) ?? '',
        unit_id: '미정',
        subunit_id: '미정',
        type_id: used ?? 'TYPE_UNCLEAR',
        unit_confidence: 0,
        type_confidence: used ? 0.8 : 0,
        difficulty_level: estimate.overall_level,
        difficulty_confidence: used ? 0.82 : 0.74,
        difficulty_engine: estimate.engine,
        dim_levels: estimate.dim_levels,
        type_used_for_difficulty: Boolean(used),
        key_test_points: [],
        solution_strategies: [],
        source_heading: null,
        overall: 'AUTO',
        reasons: [],
      } satisfies Cm2Decision
      const payload = cm2DifficultyRpcPayload({ decision, versionId })
      if (!payload) continue
      const rpc = await staff.rpc(DIFFICULTY_DIMS_RPC, { payload })
      if (rpc.error) {
        failed += 1
        continue
      }
      written += 1
    }
    samples.push(...byLevel.values())
  }

  const sanity = distributionLooksSane({ total, overall, books })
  const summary = {
    phase: apply ? 'cm2-difficulty-apply' : 'cm2-difficulty-dry-run',
    persist: apply,
    engine: CM2_DIFFICULTY_ARTIFACT,
    assigned_by: CM2_ASSIGNED_BY,
    student_care_accessed: false,
    problem_text_mutated: false,
    types_mutated: false,
    key_points_mutated: false,
    ssen_skipped: true,
    total,
    typed,
    untyped,
    written: apply ? written : 0,
    failed,
    skipped_verified: skippedVerified,
    overall,
    books,
    dim_split: dimSplit,
    sanity,
    samples: samples.sort((a, b) => Number(a.level) - Number(b.level)),
  }
  const dest = path.join(root, REPORT_DIR)
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, apply ? 'apply-result.json' : 'dry-run.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  return summary
}

const isMain = process.argv[1]?.includes('cm2DifficultyApplyCli')
if (isMain) {
  runCm2DifficultyApplyCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
