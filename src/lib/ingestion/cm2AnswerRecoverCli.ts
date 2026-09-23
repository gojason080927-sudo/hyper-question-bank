/**
 * Dry-run publisher answer/explanation recovery from existing OCR.
 * Never writes Production. No --apply path.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { GANYEOM2_SPEC, TYPELEVEL2_SPEC, WANJA2_SPEC } from './bookIngestSpec'
import {
  CM2_ANSWER_ENGINE,
  matchExtracts,
  parseAnswerPages,
  summarizeMatches,
  type Cm2AnswerMatch,
  type Cm2AnswerProfile,
  type Cm2RegisteredProblem,
} from './cm2AnswerRecover'
import { QUESTION_BANK_REF, STUDENT_CARE_REF } from './math2Persist'

const REPORT_DIR = 'ocr-tests/taxonomy/cm2-answer-recover'

const TARGETS = [
  { spec: GANYEOM2_SPEC, profile: 'quick_key' as const },
  { spec: WANJA2_SPEC, profile: 'reprint_explain' as const },
  { spec: TYPELEVEL2_SPEC, profile: 'reprint_explain' as const },
]

function adminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) throw new Error('CM2_ANSWER_SUPABASE: missing env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('CM2_ANSWER_FORBIDDEN: hyper-student-care refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('CM2_ANSWER_WRONG_PROJECT')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function paged<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  apply?: (q: ReturnType<SupabaseClient['from']>) => ReturnType<SupabaseClient['from']>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    let q = admin.from(table).select(columns).range(from, from + 999) as ReturnType<SupabaseClient['from']>
    if (apply) q = apply(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 1000) break
    from += 1000
  }
  return rows
}

function reasonCounts(matches: Cm2AnswerMatch[]) {
  const counts: Record<string, number> = {}
  for (const row of matches) {
    for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1
  }
  return counts
}

function sampleAuto(matches: Cm2AnswerMatch[]) {
  const auto = matches.filter((row) => row.verdict === 'AUTO')
  const preferred = auto.filter((row) => row.extract.answer_text && (row.overlap >= 0.6 || !row.extract.reprint_stem))
  const picked = [...preferred.filter((row) => row.extract.explanation), ...preferred, ...auto].slice(0, 8)
  const unique = [...new Map(picked.map((row) => [row.extract.number, row])).values()].slice(0, 3)
  return unique.map((row) => ({
    number: row.extract.number,
    page: row.extract.page,
    overlap: row.overlap,
    answer: row.extract.answer_text,
    stem: row.stem_preview,
    reprint: row.extract.reprint_stem,
    explanation: row.extract.explanation?.slice(0, 180) ?? null,
    same_problem: !row.extract.reprint_stem || row.overlap >= 0.6,
  }))
}

function riskSamples(matches: Cm2AnswerMatch[]) {
  const review = matches.filter((row) => row.verdict === 'REVIEW').slice(0, 4)
  const unmatched = matches.filter((row) => row.verdict === 'UNMATCHED').slice(0, 3)
  return {
    auto: sampleAuto(matches),
    review: review.map((row) => ({
      number: row.extract.number,
      page: row.extract.page,
      reasons: row.reasons,
      overlap: row.overlap,
      answer: row.extract.answer_text,
      stem: row.stem_preview,
      reprint: row.extract.reprint_stem,
    })),
    unmatched: unmatched.map((row) => ({
      number: row.extract.number,
      page: row.extract.page,
      reasons: row.reasons,
      preview: row.extract.source_preview,
    })),
  }
}

export async function runCm2AnswerRecoverCli(root = process.cwd(), argv = process.argv.slice(2)) {
  if (argv.some((flag) => /persist|apply|upsert|register/i.test(flag))) {
    throw new Error('CM2_ANSWER_NO_WRITE: dry-run only; Production writes are forbidden')
  }
  const only = argv.find((arg) => arg.startsWith('--book='))?.slice('--book='.length)
  const targets = TARGETS.filter((row) => !only || row.spec.slug === only)
  if (!targets.length) throw new Error(`CM2_ANSWER_UNKNOWN_BOOK: ${only}`)

  const admin = adminClient()
  const books: Array<Record<string, unknown>> = []

  for (const target of targets) {
    const pages = await paged<{ page_number: number; extracted_text: string | null }>(
      admin,
      'source_pages',
      'page_number, extracted_text',
      (q) => q.eq('source_document_id', target.spec.sourceId).order('page_number'),
    )
    const sources = await paged<{ problem_id: string; original_problem_number: string | null }>(
      admin,
      'problem_sources',
      'problem_id, original_problem_number',
      (q) => q.eq('source_document_id', target.spec.sourceId),
    )
    const problems: Array<{ id: string; current_version_id: string | null }> = []
    const ids = [...new Set(sources.map((row) => row.problem_id))]
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from('problems').select('id, current_version_id').in('id', ids.slice(i, i + 200))
      if (error) throw new Error(error.message)
      problems.push(...((data ?? []) as typeof problems))
    }
    const versionIds = problems.map((row) => row.current_version_id).filter((id): id is string => Boolean(id))
    const versions = new Map<string, string>()
    for (let i = 0; i < versionIds.length; i += 200) {
      const { data, error } = await admin.from('problem_versions').select('id, problem_text').in('id', versionIds.slice(i, i + 200))
      if (error) throw new Error(error.message)
      for (const row of data ?? []) versions.set(row.id as string, String(row.problem_text ?? ''))
    }
    const problemById = new Map(problems.map((row) => [row.id, row]))
    const registered: Cm2RegisteredProblem[] = sources.flatMap((row) => {
      const problem = problemById.get(row.problem_id)
      if (!problem?.current_version_id) return []
      return [
        {
          problem_id: row.problem_id,
          version_id: problem.current_version_id,
          number: String(row.original_problem_number ?? '').padStart(4, '0'),
          problem_text: versions.get(problem.current_version_id) ?? '',
        },
      ]
    })
    const extracts = parseAnswerPages(
      pages.map((row) => ({ page: row.page_number, text: String(row.extracted_text ?? '') })),
      target.profile,
      target.spec.pageCount,
    )
    const matches = matchExtracts(extracts, registered, target.spec.sourceId)
    const summary = summarizeMatches(target.spec.slug, target.profile as Cm2AnswerProfile, matches)
    books.push({
      ...summary,
      title: target.spec.title,
      source_id: target.spec.sourceId,
      registered: registered.length,
      pages: pages.length,
      reason_counts: reasonCounts(matches),
      samples: riskSamples(matches),
    })
  }

  const report = {
    phase: 'cm2-answer-recover-dry-run',
    persist: false,
    engine: CM2_ANSWER_ENGINE,
    student_care_accessed: false,
    problem_text_mutated: false,
    types_mutated: false,
    difficulty_mutated: false,
    books,
  }
  const dest = path.join(root, REPORT_DIR)
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, 'dry-run.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
  return report
}

const isMain = process.argv[1]?.includes('cm2AnswerRecoverCli')
if (isMain) {
  runCm2AnswerRecoverCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
