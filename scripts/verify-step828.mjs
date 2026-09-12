/**
 * verify:step828 — offline acceptance for the STEP 8.28 structure-from-GT freeze.
 * No network, no Production problem writes, no paid OCR.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-28')
const specPath = path.join(root, 'docs/STEP8_28_STRUCTURE_FROM_CACHE_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const spec827Path = path.join(root, 'docs/STEP8_27_CACHE_ONLY_SEGMENTATION_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.28 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(spec827Path), 'missing STEP 8.27 spec')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.28')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Structure stem/choices/answer/explanation from existing OCR/GT only'), '8.25 freeze must define 8.28')
check(freeze.includes('Drafts only if a later freeze allows'), '8.25 freeze must keep 8.28 drafts gated')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.28 spec must lock SSEN document id')
check(spec.includes('190fb31b-03f5-43b9-b696-cce7a823a321'), '8.28 spec must name excluded SECOND id')
check(spec.includes('Do not start 8.29') || spec.includes('does not start 8.29'), 'must not start 8.29')
check(spec.includes('This freeze does not allow drafts') || spec.includes('does not allow drafts'), 'must deny drafts')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'must refuse student-care')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.28', `step must be 8.28 (got ${s.step})`)
check(s.status === 'CACHE_ONLY_STRUCTURED' || s.status === 'CACHE_ONLY_BLOCKED', `unexpected status ${s.status}`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.next_step_started === false, 'must not start 8.29')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check(s.production_problem_writes === 0, 'problem writes must be 0')
check(s.production_figure_writes === 0, 'figure writes must be 0')
check((s.production_draft_writes ?? 1) === 0, 'draft writes must be 0')
check((s.production_pipeline_writes?.runs ?? 1) === 0, 'pipeline runs must be 0')
check((s.production_pipeline_writes?.items ?? 1) === 0, 'pipeline items must be 0')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral must be 0')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check(s.frozen?.impliedNonTypeAuto === 227, 'remainder must stay 227')
check(s.frozen?.step823FigureAssets === 3, 'figure assets must stay 3')
check(s.frozen?.step823FigureLinks === 3, 'figure links must stay 3')
check(s.original_pdf?.substituted === false, 'must not substitute original PDF')
check(s.results?.REVIEW === 0, '8.28 must not mint REVIEW by relaxing gates')
check(s.progress_matches_items === true, 'progress counters must match items')
check((s.progress?.auto_approved ?? 1) === 0, '8.28 must not AUTO_APPROVED')
check((s.duplicates ?? 1) === 0, 'duplicate items must be 0')
check((s.orphans ?? 1) === 0, 'orphan items must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source items must be 0')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')

if (s.status === 'CACHE_ONLY_STRUCTURED') {
  check(s.executed === true, 'structured run must execute locally')
  check(s.dry_run?.pass === true, 'structured run dry-run must pass')
  check((s.items ?? []).length === 26, 'structured run must project 26 GT items')
  check(s.progress?.human_review === 22, `human_review must be 22 (got ${s.progress?.human_review})`)
  check(s.progress?.blocked === 4, `blocked items must be 4 identity-unstable (got ${s.progress?.blocked})`)
  check(s.results?.PASS === 7, `PASS must be 7 (got ${s.results?.PASS})`)
  check(s.results?.BLOCKED === 11, `BLOCKED must be 11 (got ${s.results?.BLOCKED})`)
  check((s.items ?? []).every((row) => row.explanation === null), 'must not invent explanations')
  check((s.items ?? []).every((row) => row.status !== 'AUTO_APPROVED'), 'must not AUTO_APPROVE')
}

if (s.status === 'CACHE_ONLY_BLOCKED') {
  check(s.executed === false, 'blocked run must not execute')
  check(s.dry_run?.pass === false, 'blocked run dry-run must fail')
  check((s.items ?? []).length === 0, 'blocked run must not invent pipeline items')
}

if (failures.length) {
  console.error('verify:step828 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step828 PASS — ${s.status} executed=${s.executed} problem_writes=0 paid=0 PASS=${s.results.PASS} REVIEW=0 BLOCKED=${s.results.BLOCKED}`,
)
process.exit(0)
