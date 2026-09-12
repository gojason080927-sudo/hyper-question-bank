/**
 * verify:step831 — offline acceptance for the STEP 8.31 confidence-gate freeze.
 * No paid OCR. AUTO_APPROVED only if 8.25 §D all hold.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-31')
const specPath = path.join(root, 'docs/STEP8_31_CONFIDENCE_GATE_PERSIST_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const spec830Path = path.join(root, 'docs/STEP8_30_ORIGINAL_IMAGE_COMPARE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const items828Path = path.join(root, 'ocr-tests/taxonomy/step8-28/items.json')
const reviews829Path = path.join(root, 'ocr-tests/taxonomy/step8-29/reviews.json')
const compares830Path = path.join(root, 'ocr-tests/taxonomy/step8-30/compares.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.31 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(spec830Path), 'missing STEP 8.30 spec')
check(existsSync(summaryPath), 'missing summary.json — run npm run pipeline:8.31')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')
check(existsSync(items828Path), 'missing STEP 8.28 items.json')
check(existsSync(reviews829Path), 'missing STEP 8.29 reviews.json')
check(existsSync(compares830Path), 'missing STEP 8.30 compares.json')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('Confidence gate persist **DRAFT** + queue `HUMAN_REVIEW`'), '8.25 freeze must define 8.31')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.31 spec must lock SSEN document id')
check(spec.includes('0 calls / $0'), 'must cap paid OCR at 0')
check(spec.includes('Do not AUTO_APPROVE those items on confidence score alone'), 'must not AUTO from 8.30 fail')
check(spec.includes('does not start 8.32') || spec.includes('Do not start 8.32'), 'must not start 8.32')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'must refuse student-care')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const cached = existsSync(items828Path) ? JSON.parse(readFileSync(items828Path, 'utf8')) : {}
check((cached.items ?? []).length === 26, 'STEP 8.28 cache must have 26 items')
const reviews = existsSync(reviews829Path) ? JSON.parse(readFileSync(reviews829Path, 'utf8')) : {}
check((reviews.items ?? []).length === 26, 'STEP 8.29 cache must have 26 reviews')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.31', `step must be 8.31 (got ${s.step})`)
check(
  s.status === 'CACHE_ONLY_GATED' || s.status === 'CACHE_ONLY_BLOCKED' || s.status === 'PERSISTED',
  `unexpected status ${s.status}`,
)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.next_step_started === false, 'must not start 8.32')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'new mistral must be 0')
check(s.mistral_credentials === 'PRESENT' || s.mistral_credentials === 'ABSENT', 'mistral presence must be PRESENT/ABSENT only')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.frozenTypeAuto === 38, 'frozen type AUTO must stay 38')
check(s.results?.REVIEW === 0, '8.31 must not mint target REVIEW by relaxing gates')
check((s.tally?.auto_approved ?? 1) === 0, 'must not AUTO_APPROVED without §D')
check((s.tally?.create_draft ?? 1) === 0, 'must not CREATE_DRAFT without AUTO_APPROVED')
check((s.production_verified_writes ?? 1) === 0, 'verified writes must be 0')
check((s.production_figure_writes ?? 1) === 0, 'figure writes must be 0')
check((s.duplicates ?? 1) === 0, 'duplicate items must be 0')
check((s.orphans ?? 1) === 0, 'orphan items must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source items must be 0')
check(s.gt_mutated === false, 'GT file must not be mutated')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')
check((s.persist_plan_ok ?? false) === true, 'persist plan must be safe')

const dumped = JSON.stringify(s)
check(!/sk-/.test(dumped), 'summary must not contain key-like prefixes')
check(!/"api_key"/i.test(dumped), 'summary must not contain api_key fields')
check(!/"password"/i.test(dumped), 'summary must not contain password fields')

if (s.executed) {
  check((s.items ?? []).length === 26, 'gated run must cover 26 cached items')
  check((s.items ?? []).every((row) => row.status !== 'AUTO_APPROVED'), 'must not AUTO_APPROVE')
  check((s.items ?? []).every((row) => row.section_d_all_met === false), '§D must remain unmet')
  check((s.items ?? []).every((row) => row.image_compare_pass === false), 'image compare must not pass')
  check((s.items ?? []).every((row) => row.crop_source_kind !== 'ssen_figure_page'), 'must not substitute page PNG')
  if ((s.tally?.crop_present ?? 0) === 26) {
    check((s.tally?.human_review ?? 0) === 22, `HUMAN_REVIEW must be 22 (got ${s.tally?.human_review})`)
    check((s.tally?.blocked ?? 0) === 4, `BLOCKED must be 4 (got ${s.tally?.blocked})`)
    check((s.tally?.frozen_hash_match ?? 1) === 0, 'recovered hashes must not match frozen STEP 7 bytes')
    const blocked = (s.items ?? []).filter((row) => row.status === 'BLOCKED').map((row) => row.candidate_id)
    check(
      JSON.stringify([...blocked].sort()) === JSON.stringify(['S02', 'S03', 'S16', 'S24']),
      `BLOCKED ids must be S02/S03/S16/S24 (got ${blocked.join(',')})`,
    )
  } else {
    check((s.tally?.auto_approved ?? 1) === 0, 'missing crops must not AUTO')
    check((s.items ?? []).every((row) => row.status === 'BLOCKED' || row.status === 'HUMAN_REVIEW'), 'unknown status')
  }
}

if (s.persist?.ran) {
  check((s.persist.created ?? []).length === 0, 'persist must not create new problem drafts in this freeze')
  check((s.production_problem_writes ?? 1) === 0, 'problem writes must be 0')
}

if (failures.length) {
  console.error('verify:step831 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step831 PASS — ${s.status} AUTO=${s.tally?.auto_approved} HUMAN_REVIEW=${s.tally?.human_review} BLOCKED=${s.tally?.blocked} paid=0 crops=${s.tally?.crop_present} PASS=${s.results?.PASS} REVIEW=0 BLOCKED_TARGETS=${s.results?.BLOCKED}`,
)
process.exit(0)
