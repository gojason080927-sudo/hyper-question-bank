/**
 * verify:step833 — acceptance for the STEP 8.33 auto QA + search prep freeze.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-33')
const specPath = path.join(root, 'docs/STEP8_33_AUTO_QA_SEARCH_PREP_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.33 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.33')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.33 spec must lock SSEN document id')
check(spec.includes('Never `VERIFIED`') || spec.includes('never VERIFIED') || spec.includes('Do not auto-set `VERIFIED`'), 'must forbid VERIFIED')
check(spec.includes('content_fingerprints'), 'must mention fingerprints')
check(spec.includes('problem_embeddings'), 'must record embeddings unavailability')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never') || spec.includes('Never'), 'must refuse student-care')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Auto QA + common-error correction'), '8.25 freeze must define 8.33')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.33', `step must be 8.33 (got ${s.step})`)
check(
  s.status === 'CACHE_ONLY_PLANNED' || s.status === 'QA_COMPLETED' || s.status === 'PERSISTED' || s.status === 'BLOCKED',
  `unexpected status ${s.status}`,
)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral new calls must be 0')
check((s.estimated_usd ?? 1) === 0, 'usd must be 0')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check((s.production_verified_writes ?? 1) === 0, 'verified writes must be 0')
check((s.production_figure_writes ?? 1) === 0, 'figure writes must be 0')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')
check((s.embeddings_written ?? 1) === 0, 'embeddings must stay 0 without pgvector')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.inspected ?? 0) === 1256, `must inspect 1256 STEP 8.32 items (got ${s.inspected})`)
check((s.human_review_remaining ?? 9999) < (s.inspected ?? 0), 'HUMAN_REVIEW must be smaller than inspected')

const dumped = JSON.stringify(s)
check(!/sk-/.test(dumped), 'summary must not contain key-like prefixes')
check(!/"api_key"/i.test(dumped), 'summary must not contain api_key fields')
check(!/"password"/i.test(dumped), 'summary must not contain password fields')

if (failures.length) {
  console.error('verify:step833 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step833 PASS — ${s.status} inspected=${s.inspected} cleared=${s.auto_cleared} human=${s.human_review_remaining} fp=${s.fingerprints_written} class=${s.classification_written}`,
)
process.exit(0)
