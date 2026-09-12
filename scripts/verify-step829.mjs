/**
 * verify:step829 — offline acceptance for the STEP 8.29 dual-AI review freeze.
 * No network, no Production problem writes, no paid OCR.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-29')
const specPath = path.join(root, 'docs/STEP8_29_DUAL_AI_REVIEW_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const spec828Path = path.join(root, 'docs/STEP8_28_STRUCTURE_FROM_CACHE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const items828Path = path.join(root, 'ocr-tests/taxonomy/step8-28/items.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.29 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(spec828Path), 'missing STEP 8.28 spec')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.29')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')
check(existsSync(items828Path), 'missing STEP 8.28 items.json')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Dual-AI review pilot on cached artifacts'), '8.25 freeze must define 8.29')
check(freeze.includes('No unless a separate authorized freeze'), '8.25 freeze must keep 8.29 paid OCR gated')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.29 spec must lock SSEN document id')
check(spec.includes('Do not start 8.30') || spec.includes('does not start 8.30'), 'must not start 8.30')
check(spec.includes('0 calls / $0'), 'must cap paid OCR at 0')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'must refuse student-care')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const cached = existsSync(items828Path) ? JSON.parse(readFileSync(items828Path, 'utf8')) : {}
check((cached.items ?? []).length === 26, 'STEP 8.28 cache must have 26 items')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.29', `step must be 8.29 (got ${s.step})`)
check(s.status === 'CACHE_ONLY_REVIEWED' || s.status === 'CACHE_ONLY_BLOCKED', `unexpected status ${s.status}`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.next_step_started === false, 'must not start 8.30')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check(s.production_problem_writes === 0, 'problem writes must be 0')
check(s.production_figure_writes === 0, 'figure writes must be 0')
check((s.production_draft_writes ?? 1) === 0, 'draft writes must be 0')
check((s.production_pipeline_writes?.runs ?? 1) === 0, 'pipeline runs must be 0')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral must be 0')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check(s.results?.REVIEW === 0, '8.29 must not mint REVIEW by relaxing gates')
check((s.progress?.auto_approved ?? 1) === 0, '8.29 must not AUTO_APPROVED')
check((s.duplicates ?? 1) === 0, 'duplicate items must be 0')
check((s.orphans ?? 1) === 0, 'orphan items must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source items must be 0')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')

if (s.status === 'CACHE_ONLY_REVIEWED') {
  check(s.executed === true, 'reviewed run must execute locally')
  check((s.items ?? []).length === 26, 'reviewed run must cover 26 cached items')
  check((s.dual?.agree ?? 0) + (s.dual?.disagree ?? 0) === 26, 'agree+disagree must be 26')
  check(s.results?.PASS === 8, `PASS must be 8 (got ${s.results?.PASS})`)
  check(s.results?.BLOCKED === 11, `BLOCKED must be 11 (got ${s.results?.BLOCKED})`)
  check((s.items ?? []).every((row) => row.status !== 'AUTO_APPROVED'), 'must not AUTO_APPROVE')
  check(
    (s.items ?? []).every((row) => row.checker_a && row.checker_b && Array.isArray(row.diffs)),
    'each item must record both checkers and diffs',
  )
}

if (failures.length) {
  console.error('verify:step829 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step829 PASS — ${s.status} executed=${s.executed} agree=${s.dual?.agree} disagree=${s.dual?.disagree} paid=0 PASS=${s.results.PASS} REVIEW=0 BLOCKED=${s.results.BLOCKED}`,
)
process.exit(0)
