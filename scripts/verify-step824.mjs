/**
 * verify:step824 — offline acceptance check for STEP 8.24.
 * Validates the committed STEP 8.24 summary against the fixed-spec invariants. No network.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'ocr-tests/taxonomy/step8-24')
const summaryPath = path.join(dir, 'summary.json')
const candidatesPath = path.join(dir, 'candidates.json')

const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

if (!existsSync(summaryPath)) {
  console.error('verify:step824 FAIL — missing summary.json (run: node scripts/step-8.24.mjs --run --persist)')
  process.exit(1)
}

const s = JSON.parse(readFileSync(summaryPath, 'utf8'))
const c = existsSync(candidatesPath) ? JSON.parse(readFileSync(candidatesPath, 'utf8')) : { candidates: [] }

check(s.step === '8.24', `step must be 8.24 (got ${s.step})`)
check(s.target_ref === 'owpxsmdcxjmsgadkdsci', `target_ref must be owpxsmdcxjmsgadkdsci (got ${s.target_ref})`)
check(s.student_care_accessed === false, 'student_care_accessed must be false')
check(s.candidates_total === 8, `candidates_total must be 8 (got ${s.candidates_total})`)

const tally = s.results ?? {}
const sum = (tally.PASS ?? 0) + (tally.REVIEW ?? 0) + (tally.BLOCKED ?? 0)
check(sum === s.candidates_total, `PASS+REVIEW+BLOCKED (${sum}) must equal candidates_total (${s.candidates_total})`)

const validVerdicts = new Set(['PASS', 'REVIEW', 'BLOCKED'])
check(Array.isArray(c.candidates) && c.candidates.length === 8, `candidates.json must list 8 candidates (got ${c.candidates?.length})`)
for (const cand of c.candidates ?? []) {
  check(validVerdicts.has(cand.verdict), `candidate ${cand.id} has invalid verdict ${cand.verdict}`)
  check(Array.isArray(cand.reasons), `candidate ${cand.id} missing reasons`)
}

check(s.orphans === 0, `orphans must be 0 (got ${s.orphans})`)
check(s.duplicate_asset_hash === 0, `duplicate_asset_hash must be 0 (got ${s.duplicate_asset_hash})`)
check(s.duplicate_links === 0, `duplicate_links must be 0 (got ${s.duplicate_links})`)
check(s.content_changed === 0, `content_changed must be 0 (got ${s.content_changed})`)
check(s.idempotent === true, 'idempotent must be true')
check((s.replay_created?.assets ?? 0) === 0 && (s.replay_created?.links ?? 0) === 0, 'idempotency replay must create 0')

check(s.existing_step823_preserved?.assets >= 3, `existing STEP 8.23 assets must be >= 3 (got ${s.existing_step823_preserved?.assets})`)
check(s.existing_step823_preserved?.links >= 3, `existing STEP 8.23 links must be >= 3 (got ${s.existing_step823_preserved?.links})`)

// after == before + newly persisted
check(
  s.after?.assets === s.before?.assets + (s.persisted?.new_assets ?? 0),
  `after.assets (${s.after?.assets}) must equal before.assets (${s.before?.assets}) + new_assets (${s.persisted?.new_assets})`,
)
check(
  s.after?.links === s.before?.links + (s.persisted?.new_links ?? 0),
  `after.links (${s.after?.links}) must equal before.links (${s.before?.links}) + new_links (${s.persisted?.new_links})`,
)

// paid-OCR guardrails
check((s.ocr?.calls ?? 0) <= (s.ocr?.max_calls_allowed ?? 8), `OCR calls (${s.ocr?.calls}) exceed max (${s.ocr?.max_calls_allowed})`)
check((s.ocr?.cost_usd ?? 0) <= (s.ocr?.budget_usd ?? 1), `OCR cost (${s.ocr?.cost_usd}) exceeds budget (${s.ocr?.budget_usd})`)
check((s.paid_api_calls?.mathpix ?? 0) === (s.ocr?.calls ?? 0), 'paid_api_calls.mathpix must match ocr.calls')

if (failures.length) {
  console.error('verify:step824 FAIL')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(
  `verify:step824 PASS — candidates=${s.candidates_total} PASS=${tally.PASS} REVIEW=${tally.REVIEW} BLOCKED=${tally.BLOCKED} ` +
    `new_assets=${s.persisted.new_assets} new_links=${s.persisted.new_links} orphans=0 dup=0 idempotent=${s.idempotent} ` +
    `ocr_calls=${s.ocr.calls} ocr_cost=${s.ocr.cost_usd}`,
)
process.exit(0)
