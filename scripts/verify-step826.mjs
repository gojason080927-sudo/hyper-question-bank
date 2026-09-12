/**
 * verify:step826 — offline acceptance for the STEP 8.26 schema freeze.
 * No network, no Production problem writes, no paid OCR.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-26')
const specPath = path.join(root, 'docs/STEP8_26_PIPELINE_JOB_SCHEMA_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const sqlPath = path.join(root, 'supabase/migrations/20260912120000_hqb_pipeline_job_v1.sql')

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.26 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.26')
check(existsSync(sqlPath), 'missing additive migration')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('pipeline_runs'), '8.25 freeze must name pipeline_runs')
check(freeze.includes('pipeline_items'), '8.25 freeze must name pipeline_items')
check(freeze.includes('no textbook run'), '8.25 freeze must forbid textbook run in 8.26')

const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : ''
check(!/DROP\s+TABLE/i.test(sql.replace(/--[^\n]*/g, '')), 'migration must not DROP TABLE')
check(!/\bTRUNCATE\b/i.test(sql.replace(/--[^\n]*/g, '')), 'migration must not TRUNCATE')
check(sql.includes('CREATE TABLE IF NOT EXISTS public.pipeline_runs'), 'missing pipeline_runs')
check(sql.includes('CREATE TABLE IF NOT EXISTS public.pipeline_items'), 'missing pipeline_items')
check(!sql.includes('ocr_result_cache'), 'ocr_result_cache is out of 8.26 scope')
check(sql.includes('Do not start STEP 8.27'), 'migration must not start 8.27')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.26', `step must be 8.26 (got ${s.step})`)
check(s.status === 'SCHEMA_ONLY', `status must be SCHEMA_ONLY (got ${s.status})`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.textbook_run === false, 'textbook_run must be false')
check(s.next_step_started === false, 'must not start 8.27')
check(s.production_problem_writes === 0, 'problem writes must be 0')
check(s.production_figure_writes === 0, 'figure writes must be 0')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral must be 0')
check(s.frozen?.step812_expected_drafts === 265 || s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38 || s.frozen?.type_auto === 38, 'frozen type AUTO must stay 38')
check(s.original_pdf?.substituted === false, 'must not substitute original PDF')
check(s.results?.REVIEW === 0, '8.26 must not mint REVIEW by relaxing gates')

const pass = s.results?.PASS ?? 0
const blocked = s.results?.BLOCKED ?? 0
check(pass === 3, `schema/counters PASS must be 3 (got ${pass})`)
check(blocked === 11, `BLOCKED must be 11: textbook+ocr+pdf+8 carry-over (got ${blocked})`)

if (failures.length) {
  console.error('verify:step826 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step826 PASS — SCHEMA_ONLY problem_writes=0 figure_writes=0 paid=0 PASS=${pass} REVIEW=0 BLOCKED=${blocked}`,
)
process.exit(0)
