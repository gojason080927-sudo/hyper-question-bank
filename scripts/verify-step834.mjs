/**
 * verify:step834 — acceptance for residual cleanup + pgvector + reusable pipeline.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-34')
const specPath = path.join(root, 'docs/STEP8_34_EXCEPTIONS_VECTOR_PIPELINE_v1.md')
const lockPath = path.join(root, 'docs/STEP8_34_EMBEDDING_MODEL_LOCK_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const migrationPath = path.join(root, 'supabase/migrations/20260913010000_hqb_pgvector_embeddings_v1.sql')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.34 spec')
check(existsSync(lockPath), 'missing embedding model lock')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(migrationPath), 'missing additive pgvector migration')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.34')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.34 spec must lock SSEN document id')
check(spec.includes('Never `VERIFIED`') || spec.includes('never VERIFIED') || spec.includes('Do not auto-set `VERIFIED`'), 'must forbid VERIFIED')
check(spec.includes('pgvector'), 'must mention pgvector')
check(spec.includes('mistral-embed'), 'must lock mistral-embed')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never') || spec.includes('Never'), 'must refuse student-care')

const lock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : ''
check(lock.includes('mistral-embed'), 'lock must name mistral-embed')
check(lock.includes('1024'), 'lock must name 1024 dimensions')
check(lock.includes('$0.10') || lock.includes('$0.1'), 'lock must record list price')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('8.34'), '8.25 freeze must define 8.34')

const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
check(sql.includes('CREATE EXTENSION IF NOT EXISTS vector'), 'migration must enable pgvector')
check(sql.includes('vector(1024)'), 'migration must lock 1024-d embeddings')
check(sql.includes('hqb_search_similar_problems'), 'migration must add search RPC')
check(sql.includes('hqb_is_staff'), 'search/RLS must use staff check')
check(sql.includes('DROP TABLE') === false, 'migration must not drop tables')
check(!sql.includes('DELETE FROM public.problems'), 'migration must not delete problems')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.34', `step must be 8.34 (got ${s.step})`)
check(
  s.status === 'CACHE_ONLY_PLANNED' || s.status === 'CLEANED' || s.status === 'PERSISTED' || s.status === 'BLOCKED',
  `unexpected status ${s.status}`,
)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral_ocr ?? 1) === 0, 'mistral OCR new calls must be 0')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check((s.production_verified_writes ?? 1) === 0, 'verified writes must be 0')
check((s.production_figure_writes ?? 1) === 0, 'figure writes must be 0')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.inspected_residuals ?? 0) > 0, 'must inspect remaining residuals')
check(s.embeddings?.model === 'mistral-embed', 'must lock mistral-embed in summary')
check(s.embeddings?.dimensions === 1024, 'must lock 1024-d in summary')
check(s.pipeline?.stages?.includes('EMBEDDING'), 'pipeline must include embedding stage')
check(s.pipeline?.extra_writes_on_rerun === 0, 'idempotent extra writes must be 0')

const dumped = JSON.stringify(s)
check(!/sk-/.test(dumped), 'summary must not contain key-like prefixes')
check(!/"api_key"/i.test(dumped), 'summary must not contain api_key fields')
check(!/"password"/i.test(dumped), 'summary must not contain password fields')

if (failures.length) {
  console.error('verify:step834 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step834 PASS — ${s.status} residuals=${s.inspected_residuals} auto=${s.auto_resolved} human=${s.human_review_remaining} embed=${s.embeddings?.written}`,
)
process.exit(0)
