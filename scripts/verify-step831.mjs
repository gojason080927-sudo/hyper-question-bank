/**
 * verify:step831 — acceptance for the 26-sample e2e pilot freeze.
 * Does not call paid OCR. Does not rewrite Production.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-31')
const specPath = path.join(root, 'docs/STEP8_31_E2E_PILOT_COMPLETION_v1.md')
const freezePath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const queuePath = path.join(dir, 'review-queue.json')
const gtPath = path.join(root, 'workers/ocr/ground-truth.json')
const expectedSha = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing STEP 8.31 spec')
check(existsSync(freezePath), 'missing STEP 8.25 freeze')
check(existsSync(summaryPath), 'missing summary.json — run STEP 8.31')
check(existsSync(queuePath), 'missing review-queue.json')
check(existsSync(gtPath), 'missing STEP 7 ground-truth.json')
check(existsSync(path.join(root, 'src/features/review/PipelineReviewPage.tsx')), 'missing pipeline review UI')
check(existsSync(path.join(root, 'scripts/generate-step831-crops.py')), 'missing crop generator')

const freeze = existsSync(freezePath) ? readFileSync(freezePath, 'utf8') : ''
check(freeze.includes('| **8.31** | Confidence gate persist **DRAFT** + queue `HUMAN_REVIEW`'), '8.25 freeze must keep 8.31 row')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), '8.31 spec must lock SSEN document id')
check(spec.includes('max 30') || spec.includes('30 calls'), 'must cap Mistral at 30')
check(spec.includes('$2'), 'must cap cost at $2')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'must refuse student-care')
check(spec.includes('NEVER VERIFIED') || spec.includes('never VERIFIED') || spec.includes('Never VERIFIED'), 'must forbid VERIFIED')

const gtBytes = existsSync(gtPath) ? readFileSync(gtPath) : Buffer.from('')
check(createHash('sha256').update(gtBytes).digest('hex') === expectedSha, 'ground-truth.json bytes must stay frozen')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.31', `step must be 8.31 (got ${s.step})`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'wrong project ref')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.textbook?.id === '9ff369b4-5b16-4cb8-bfc3-a6b180c18703', 'must lock SSEN source')
check((s.production_verified_writes ?? 1) === 0, 'verified writes must be 0')
check((s.production_figure_writes ?? 1) === 0, 'figure writes must be 0')
check((s.content_rewrites ?? 1) === 0, 'content rewrites must be 0')
check((s.duplicates ?? 1) === 0, 'duplicates must be 0')
check((s.orphans ?? 1) === 0, 'orphans must be 0')
check((s.wrong_source ?? 1) === 0, 'wrong source must be 0')
check(s.gt_mutated === false, 'GT must not be mutated')
check(s.gt_sha256 === expectedSha, 'summary must record frozen GT sha')
check((s.tally?.auto_approved ?? 1) === 0, 'must not AUTO_APPROVE')
check((s.tally?.compared ?? 0) === 26, 'must compare all 26 samples')
check((s.tally?.human_review ?? 0) === 22, 'HUMAN_REVIEW must be 22')
check((s.tally?.blocked ?? 0) === 4, 'BLOCKED must be 4 (S02/S03/S16/S24)')
check((s.tally?.crop_present ?? 0) === 26, 'all 26 recovered crops must be present')
check((s.items ?? []).length === 26, 'summary must list 26 items')
check((s.items ?? []).every((row) => row.status !== 'AUTO_APPROVED'), 'no AUTO_APPROVED items')
check((s.items ?? []).every((row) => row.compared === true), 'every item must have been compared')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix must stay 0')
check((s.paid_api_calls?.mistral ?? 99) <= 30, 'mistral new calls must be <= 30')
check((s.milestone_estimated_usd ?? 99) <= 2, 'milestone USD must be <= 2')
check(s.frozen?.step812ExpectedDrafts === 265, 'frozen drafts must stay 265')
check(s.mistral_credentials === 'PRESENT' || s.mistral_credentials === 'ABSENT', 'credentials presence only')

const blocked = (s.items ?? []).filter((row) => row.status === 'BLOCKED').map((row) => row.candidate_id)
check(blocked.sort().join(',') === 'S02,S03,S16,S24', `blocked ids ${blocked.join(',')}`)

const queue = existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, 'utf8')) : {}
check((queue.items ?? []).length === 26, 'review queue must have 26 items')
check(queue.assigned_by === 'STEP_8_31', 'queue assigned_by must be STEP_8_31')
check(
  (queue.items ?? []).every((row) => Array.isArray(row.reasons) && row.reasons.length > 0),
  'each queue item must have reasons',
)
check(
  (queue.items ?? []).every((row) => row.crop_url && String(row.crop_url).startsWith('/review-crops/')),
  'each queue item must point at a crop URL',
)

const dumped = JSON.stringify(s) + JSON.stringify(queue)
check(!/sk-/.test(dumped), 'artifacts must not contain key-like prefixes')
check(!/"api_key"/i.test(dumped), 'artifacts must not contain api_key fields')
check(!/MISTRAL_API_KEY=/.test(dumped), 'artifacts must not contain MISTRAL_API_KEY')

const app = readFileSync(path.join(root, 'src/app/App.tsx'), 'utf8')
check(app.includes('pipeline-review'), 'App must route /pipeline-review')
const shell = readFileSync(path.join(root, 'src/app/layout/AppShell.tsx'), 'utf8')
check(shell.includes('pipeline-review'), 'AppShell must link 검수')

if (failures.length) {
  console.error('verify:step831 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step831 PASS — compared=${s.tally.compared} HUMAN_REVIEW=${s.tally.human_review} BLOCKED=${s.tally.blocked} AUTO=${s.tally.auto_approved} mistral_new=${s.paid_api_calls.mistral} creates=${s.persist?.created?.length ?? 0}`,
)
process.exit(0)
