/**
 * verify:step825 — offline acceptance for the STEP 8.25 design freeze.
 * No network, no Production, no paid OCR.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-25')
const specPath = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const summaryPath = path.join(dir, 'summary.json')
const modulePath = path.join(root, 'src/lib/ingestion/batchPipeline825.ts')
const pendingPath = path.join(root, 'src/lib/ingestion/step823VerifiedPending.ts')

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

check(existsSync(specPath), 'missing docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
check(existsSync(summaryPath), 'missing ocr-tests/taxonomy/step8-25/summary.json')
check(existsSync(modulePath), 'missing src/lib/ingestion/batchPipeline825.ts')

const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
check(spec.includes('DESIGN FREEZE'), 'spec must declare DESIGN FREEZE')
check(spec.includes('AUTO_APPROVED'), 'spec must define AUTO_APPROVED')
check(spec.includes('AI_FIXED'), 'spec must define AI_FIXED')
check(spec.includes('HUMAN_REVIEW'), 'spec must define HUMAN_REVIEW')
check(spec.includes('BLOCKED'), 'spec must define BLOCKED')
check(spec.includes('FAILED'), 'spec must define FAILED')
check(!spec.includes('pwuswjauzdxewmtgoitf') || spec.includes('never'), 'spec must refuse student-care access')
check(spec.includes('Do not start 8.26') || spec.includes('do not implement here'), 'spec must not start 8.26')

const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : {}
check(s.step === '8.25', `step must be 8.25 (got ${s.step})`)
check(s.status === 'DESIGN_FREEZE', `status must be DESIGN_FREEZE (got ${s.status})`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', 'target_ref must be question-bank production')
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.runtime_ingest_implemented === false, 'runtime ingest must not be implemented')
check((s.production_writes ?? 1) === 0, 'production_writes must be 0')
check((s.paid_api_calls?.mathpix ?? 1) === 0, 'mathpix calls must be 0')
check((s.paid_api_calls?.mistral ?? 1) === 0, 'mistral calls must be 0')
check(s.frozen?.step812_expected_drafts === 265, 'frozen drafts must stay 265')
check(s.frozen?.type_auto === 38, 'frozen type AUTO must stay 38')
check(s.frozen?.implied_non_type_auto === 227, 'implied remainder must stay 227')
check(s.frozen?.step823_figure_assets === 3, 'STEP 8.23 assets must stay 3')
check(s.frozen?.step823_figure_links === 3, 'STEP 8.23 links must stay 3')
check(s.step824_carry_over?.blocked === 8, 'STEP 8.24 carry-over blocked must stay 8')
check(Array.isArray(s.step824_carry_over?.ids) && s.step824_carry_over.ids.length === 8, 'must list 8 carry-over ids')

const pendingSrc = existsSync(pendingPath) ? readFileSync(pendingPath, 'utf8') : ''
for (const id of s.step824_carry_over?.ids ?? []) {
  check(pendingSrc.includes(`'${id}'`), `carry-over id ${id} must remain in step823VerifiedPending.ts`)
}

const requiredStatuses = ['AUTO_APPROVED', 'AI_FIXED', 'HUMAN_REVIEW', 'BLOCKED', 'FAILED']
for (const status of requiredStatuses) {
  check((s.pipeline_item_statuses ?? []).includes(status), `summary missing status ${status}`)
}
check(!(s.pipeline_item_statuses ?? []).includes('VERIFIED'), 'pipeline statuses must not include VERIFIED')

if (failures.length) {
  console.error('verify:step825 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}

console.log(
  `verify:step825 PASS — DESIGN_FREEZE production_writes=0 paid=0 blocked_carryover=${s.step824_carry_over.blocked} drafts=${s.frozen.step812_expected_drafts} type_auto=${s.frozen.type_auto}`,
)
process.exit(0)
