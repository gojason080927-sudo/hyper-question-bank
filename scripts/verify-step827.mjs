/**
 * verify:step827 — offline acceptance for the STEP 8.27 cache-only segmentation freeze.
 * No network, no Production problem writes, no paid OCR.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-27')
const specPath = path.join(root, 'docs/STEP8_27_CACHE_ONLY_SEGMENTATION_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const spec826Path = path.join(root, 'docs/STEP8_26_PIPELINE_JOB_SCHEMA_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const sqlPath = path.join(root, 'supabase/migrations/20260912120000_hqb_pipeline_job_v1.sql')
const huntPath = path.join(dir, 'cache-hunt.json')
const prodPath = path.join(dir, 'production-schema.json')


const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.27 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(spec826Path), 'missing STEP 8.26 spec')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.27')
check(existsSync(sqlPath), 'missing STEP 8.26 additive migration')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Cache-only batch segmentation on **one** already-stored textbook'), '8.25 freeze must define 8.27')
check(freeze.includes('No new problems unless explicitly scoped'), '8.25 freeze must forbid unscoped problem writes')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.27 spec must lock SSEN document id')
check(spec.includes('190fb31b-03f5-43b9-b696-cce7a823a321'), '8.27 spec must name excluded SECOND id')
check(spec.includes('Do not start 8.28') || spec.includes('does not start 8.28'), 'must not start 8.28')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'must refuse student-care')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.27', `step must be 8.27 (got ${s.step})`)
check(s.status === 'CACHE_ONLY_BLOCKED' || s.status === 'CACHE_ONLY_EXECUTED', `unexpected status ${s.status}`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.next_step_started === false, 'must not start 8.28')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check(s.production_problem_writes === 0, 'problem writes must be 0')
check(s.production_figure_writes === 0, 'figure writes must be 0')
check((s.production_pipeline_writes?.runs ?? 1) === 0 || s.executed === true, 'pipeline runs only if executed')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral must be 0')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check(s.frozen?.impliedNonTypeAuto === 227, 'remainder must stay 227')
check(s.frozen?.step823FigureAssets === 3, 'figure assets must stay 3')
check(s.frozen?.step823FigureLinks === 3, 'figure links must stay 3')
check(s.original_pdf?.substituted === false, 'must not substitute original PDF')
check(s.results?.REVIEW === 0, '8.27 must not mint REVIEW by relaxing gates')
check(s.progress_matches_items === true, 'progress counters must match items')
check((s.progress?.auto_approved ?? 1) === 0, '8.27 must not AUTO_APPROVED')
check((s.duplicates ?? 1) === 0, 'duplicate items must be 0')
check((s.orphans ?? 1) === 0, 'orphan items must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source items must be 0')

check(s.schema_write?.attempted !== true || s.schema_probe?.present === true, 'must not attempt schema apply blindly')

if (s.status === 'CACHE_ONLY_BLOCKED') {
  check(s.executed === false, 'blocked run must not execute')
  check(s.dry_run?.pass === false, 'blocked run dry-run must fail')
  check((s.items ?? []).length === 0, 'blocked run must not invent pipeline items')
  const pass = s.results?.PASS
  const blocked = s.results?.BLOCKED
  const schemaOk = s.schema_probe?.present === true
  if (schemaOk) {
    check(pass === 5, `schema-present PASS must be 5 (got ${pass})`)
    check(blocked === 13, `schema-present BLOCKED must be 13 (got ${blocked})`)
  } else {
    check(pass === 4, `PASS must be 4 (got ${pass})`)
    check(blocked === 14, `BLOCKED must be 14 (got ${blocked})`)
  }
  check((s.dry_run?.blockers ?? []).includes('LAYOUT_OCR_CACHE_MISSING') || (s.dry_run?.blockers ?? []).includes('CANDIDATES_CACHE_MISSING'), 'cache miss must still block execute')
}

check(existsSync(huntPath), 'missing cache-hunt.json')
check(existsSync(prodPath), 'missing production-schema.json')
const hunt = existsSync(huntPath) ? JSON.parse(readFileSync(huntPath, 'utf8')) : {}
const prod = existsSync(prodPath) ? JSON.parse(readFileSync(prodPath, 'utf8')) : {}
check(hunt.found?.layout_ocr_cache === false, 'must not invent layout cache')
check(hunt.downloaded_from_internet === false, 'must not download cache from the internet')
check((hunt.paid_ocr_calls?.mathpix ?? 1) === 0, 'hunt mathpix must be 0')
check(prod.project_ref === 'owpxsmdcxjmsgadkdsci', 'production-schema must be question-bank')
check(prod.student_care_accessed === false, 'production-schema must not touch student-care')
check(prod.auth?.jwt_shape_used_as_validity_test === false, 'must not judge tokens by JWT shape')
check(prod.ssen_source?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'production-schema must lock SSEN')
check(prod.second_source_excluded?.used === false, 'SECOND source must stay unused')
check(prod.ssen_source?.file_hash !== prod.second_source_excluded?.file_hash, 'SSEN and SECOND hashes must differ')
check((prod.pipeline_counts_after_schema?.runs ?? 1) === 0, 'pipeline runs must stay 0 until cache exists')
check((prod.pipeline_counts_after_schema?.items ?? 1) === 0, 'pipeline items must stay 0 until cache exists')
check(prod.tables?.pipeline_runs === true && prod.tables?.pipeline_items === true, '8.26 tables must exist after apply')
check(prod.live_counts_read_only?.figure_assets === 3 && prod.live_counts_read_only?.figure_links === 3, 'figures must stay 3/3')


if (failures.length) {
  console.error('verify:step827 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step827 PASS — ${s.status} executed=${s.executed} problem_writes=0 paid=0 PASS=${s.results.PASS} REVIEW=0 BLOCKED=${s.results.BLOCKED}`,
)
process.exit(0)
