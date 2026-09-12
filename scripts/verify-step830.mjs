/**
 * verify:step830 — offline acceptance for the STEP 8.30 original-image compare freeze.
 * No network, no Production problem writes, no paid OCR.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-30')
const specPath = path.join(root, 'docs/STEP8_30_ORIGINAL_IMAGE_COMPARE_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const spec828Path = path.join(root, 'docs/STEP8_28_STRUCTURE_FROM_CACHE_v1.md')
const spec829Path = path.join(root, 'docs/STEP8_29_DUAL_AI_REVIEW_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const items828Path = path.join(root, 'ocr-tests/taxonomy/step8-28/items.json')
const reviews829Path = path.join(root, 'ocr-tests/taxonomy/step8-29/reviews.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.30 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(spec828Path), 'missing STEP 8.28 spec')
check(existsSync(spec829Path), 'missing STEP 8.29 spec')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.30')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')
check(existsSync(items828Path), 'missing STEP 8.28 items.json')
check(existsSync(reviews829Path), 'missing STEP 8.29 reviews.json')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Original-image compare gate'), '8.25 freeze must define 8.30')
check(freeze.includes('| **8.30** | Original-image compare gate | No | No |'), '8.25 freeze must keep 8.30 writes/OCR off')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.30 spec must lock SSEN document id')
check(spec.includes('Do not start 8.31') || spec.includes('does not start 8.31'), 'must not start 8.31')
check(spec.includes('0 calls / $0'), 'must cap paid OCR at 0')
check(spec.includes('CROP_CACHE_MISSING'), 'must fail closed on missing crops')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'must refuse student-care')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const cached = existsSync(items828Path) ? JSON.parse(readFileSync(items828Path, 'utf8')) : {}
check((cached.items ?? []).length === 26, 'STEP 8.28 cache must have 26 items')
const reviews = existsSync(reviews829Path) ? JSON.parse(readFileSync(reviews829Path, 'utf8')) : {}
check((reviews.items ?? []).length === 26, 'STEP 8.29 cache must have 26 reviews')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.30', `step must be 8.30 (got ${s.step})`)
check(s.status === 'CACHE_ONLY_COMPARED' || s.status === 'CACHE_ONLY_BLOCKED', `unexpected status ${s.status}`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.next_step_started === false, 'must not start 8.31')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check(s.production_problem_writes === 0, 'problem writes must be 0')
check(s.production_figure_writes === 0, 'figure writes must be 0')
check((s.production_draft_writes ?? 1) === 0, 'draft writes must be 0')
check((s.production_pipeline_writes?.runs ?? 1) === 0, 'pipeline runs must be 0')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral must be 0')
check(s.mistral_credentials === 'PRESENT' || s.mistral_credentials === 'ABSENT', 'mistral presence must be PRESENT/ABSENT only')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check(s.results?.REVIEW === 0, '8.30 must not mint REVIEW by relaxing gates')
check((s.progress?.auto_approved ?? 1) === 0, '8.30 must not AUTO_APPROVED without §D')
check((s.duplicates ?? 1) === 0, 'duplicate items must be 0')
check((s.orphans ?? 1) === 0, 'orphan items must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source items must be 0')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')

const dumped = JSON.stringify(s)
check(!/sk-/.test(dumped), 'summary must not contain key-like prefixes')
check(!/"api_key"/i.test(dumped), 'summary must not contain api_key fields')

if (s.status === 'CACHE_ONLY_COMPARED') {
  check(s.executed === true, 'compared run must execute locally')
  check((s.items ?? []).length === 26, 'compared run must cover 26 cached items')
  check(s.results?.PASS === 9, `PASS must be 9 (got ${s.results?.PASS})`)
  check(s.results?.BLOCKED === 12, `BLOCKED must be 12 (got ${s.results?.BLOCKED})`)
  check((s.compare?.crop_present ?? 1) === 0, 'STEP 7 crops must be absent on this runner')
  check((s.compare?.crop_missing ?? 0) === 26, 'all 26 crops must be missing')
  check((s.compare?.compared ?? 1) === 0, 'compare-complete must be 0 without crops')
  check((s.compare?.blocked ?? 0) === 26, 'all 26 items must be BLOCKED')
  check((s.items ?? []).every((row) => row.status === 'BLOCKED'), 'must BLOCK missing crops, never PASS')
  check((s.items ?? []).every((row) => row.status !== 'AUTO_APPROVED'), 'must not AUTO_APPROVE')
  check(
    (s.items ?? []).every((row) => Array.isArray(row.reasons) && row.reasons.includes('CROP_CACHE_MISSING')),
    'each item must record CROP_CACHE_MISSING',
  )
  check(
    (s.items ?? []).every((row) => row.checks && row.checks.identity === 'NOT_COMPARED'),
    'visual checks must stay NOT_COMPARED without pixels',
  )
  check(
    (s.items ?? []).every((row) => row.page_png?.used_as_crop === false),
    'page PNGs must not be used as crop substitutes',
  )
}

if (failures.length) {
  console.error('verify:step830 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step830 PASS — ${s.status} executed=${s.executed} crops=${s.compare?.crop_present}/${s.compare?.crop_missing} compared=${s.compare?.compared} paid=0 PASS=${s.results.PASS} REVIEW=0 BLOCKED=${s.results.BLOCKED}`,
)
process.exit(0)
