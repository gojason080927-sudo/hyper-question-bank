/**
 * verify:step832 — acceptance for the STEP 8.32 full-book ingest freeze.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-32')
const specPath = path.join(root, 'docs/STEP8_32_FULL_SSEN_INGEST_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.32 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.32')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.32 spec must lock SSEN document id')
check(spec.includes('AUTO_APPROVED'), 'must mention AUTO_APPROVED policy change')
check(spec.includes('not** a prerequisite') || spec.includes('not a prerequisite') || spec.includes('not** a prerequisite for DRAFT'), 'must not require AUTO_APPROVED for DRAFT')
check(spec.includes('Never `VERIFIED`') || spec.includes('never VERIFIED') || spec.includes('Do not auto-set `VERIFIED`') || spec.includes('Auto-transition to `VERIFIED`'), 'must forbid VERIFIED')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never') || spec.includes('Never'), 'must refuse student-care')
check(spec.includes('192'), 'must lock 192 pages')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Full 192-page 쎈수학 공통수학1 ingest'), '8.25 freeze must redefine 8.32 as full ingest')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.32', `step must be 8.32 (got ${s.step})`)
check(
  s.status === 'CACHE_ONLY_PLANNED' || s.status === 'PROCESSED' || s.status === 'PERSISTED' || s.status === 'BLOCKED',
  `unexpected status ${s.status}`,
)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check(s.mistral_credentials === 'PRESENT' || s.mistral_credentials === 'ABSENT', 'mistral presence must be PRESENT/ABSENT only')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check((s.production_verified_writes ?? 1) === 0, 'verified writes must be 0')
check((s.production_figure_writes ?? 1) === 0, 'figure writes must be 0')
check((s.tally?.auto_approved ?? 1) === 0, 'must not set AUTO_APPROVED')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source items must be 0')

if (s.status === 'PROCESSED' || s.status === 'PERSISTED') {
  check((s.pages_processed ?? 0) === 192, `must process 192 pages (got ${s.pages_processed})`)
}

if (s.persist?.ran) {
  check((s.production_verified_writes ?? 1) === 0, 'persist must not write VERIFIED')
  check((s.persist.created ?? []).every((row) => row.status !== 'VERIFIED'), 'created rows must not be VERIFIED')
}

const dumped = JSON.stringify(s)
check(!/sk-/.test(dumped), 'summary must not contain key-like prefixes')
check(!/"api_key"/i.test(dumped), 'summary must not contain api_key fields')
check(!/"password"/i.test(dumped), 'summary must not contain password fields')

if (failures.length) {
  console.error('verify:step832 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step832 PASS — ${s.status} pages=${s.pages_processed} found=${s.problems_found} create=${s.tally?.create_draft} existing=${s.tally?.record_existing} review=${s.tally?.needs_review} blocked=${s.tally?.blocked} mistral=${s.paid_api_calls?.mistral} usd=${s.estimated_usd}`,
)
process.exit(0)
