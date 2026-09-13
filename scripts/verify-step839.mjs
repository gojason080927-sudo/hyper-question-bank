/**
 * verify:step839 — full QA contracts (offline).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const spec = path.join(root, 'docs/STEP8_39_SSEN_FULL_QA_v1.md')
const freeze = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const lib = readFileSync(path.join(root, 'src/lib/ingestion/ssenFullQa839.ts'), 'utf8')
const tests = readFileSync(path.join(root, 'src/lib/ingestion/ssenFullQa839.test.ts'), 'utf8')
const cli = readFileSync(path.join(root, 'src/lib/ingestion/step839Cli.ts'), 'utf8')
const review = readFileSync(path.join(root, 'src/features/review/PipelineReviewPage.tsx'), 'utf8')
const panel = readFileSync(path.join(root, 'src/features/review/FullQaReviewPanel.tsx'), 'utf8')

check(existsSync(spec), 'missing 8.39 spec')
check(existsSync(path.join(root, 'src/lib/ingestion/ssenFullQa839.ts')), 'missing qa lib')
check(existsSync(path.join(root, 'src/lib/ingestion/ssenFullQa839.test.ts')), 'missing qa tests')
check(Boolean(pkg.scripts['verify:step839']), 'package.json must expose verify:step839')
check(Boolean(pkg.scripts['pipeline:8.39']), 'package.json must expose pipeline:8.39')
check(Boolean(pkg.scripts['verify:step838']), 'must keep verify:step838')

const specText = readFileSync(spec, 'utf8')
check(specText.includes('0b9e7e3'), 'spec must lock PR #23 merge commit')
check(specText.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), 'spec must lock SSEN id')
check(specText.includes('1,242'), 'spec must freeze listed count')
check(specText.includes('PAID_OCR_CANDIDATE'), 'spec must define paid OCR candidate')
check(specText.includes('AUTO_SAFE'), 'spec must define AUTO_SAFE')
check(!specText.includes('pwuswjauzdxewmtgoitf') || /never|Never/.test(specText), 'must refuse student-care')

const freezeText = readFileSync(freeze, 'utf8')
check(freezeText.includes('8.39'), '8.25 freeze must list 8.39')

check(lib.includes('TEACHER_EDIT'), 'lib must protect TEACHER_EDIT')
check(lib.includes('VERIFIED'), 'lib must protect VERIFIED')
check(lib.includes('SSEN_PAGE_COUNT'), 'lib must inspect 192 pages')
check(lib.includes('1242'), 'lib must freeze 1242')
check(cli.includes('--persist'), 'cli must gate persist')
check(cli.includes('hqb_apply_auto_clean_text'), 'cli must reuse AUTO_CLEAN RPC')
check(cli.includes('STUDENT_CARE'), 'cli must refuse student-care')
check(!cli.includes('pipeline:8.32') || cli.includes('Never 8.32'), 'must not replay 8.32 persist')

check(tests.includes('[0003~0004]'), 'tests must keep range parsing')
check(tests.includes('TEACHER_EDIT'), 'tests must cover TEACHER_EDIT')
check(tests.includes('VERIFIED'), 'tests must cover VERIFIED')
check(tests.includes('idempotent'), 'tests must cover idempotent rerun')
check(tests.includes('cache'), 'tests must cover cache')
check(tests.includes('overflow') || tests.includes('max_width_px'), 'tests must cover overflow px')
check(tests.includes('MISSING_CHOICES') || tests.includes('multiple-choice'), 'tests must cover choices')
check(tests.includes('POSSIBLE_FIGURE_MISSING') || tests.includes('figure'), 'tests must cover figures')

check(review.includes('qa839') && review.includes('FullQaReviewPanel'), 'review queue must expose 8.39 tab')
check(panel.includes('qa839-compare'), 'panel must compare original/current/candidate')
check(panel.includes('overflow_360'), 'panel must show overflow')
check(panel.includes('PAID_OCR_CANDIDATE'), 'panel must filter paid OCR')

const migrationsDir = path.join(root, 'supabase/migrations')
if (existsSync(migrationsDir)) {
  const added = readdirSync(migrationsDir).filter((name) => name.includes('839') || name.includes('step839'))
  check(added.length === 0, '8.39 must not add a migration')
}

if (failures.length) {
  console.error('verify:step839 FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:step839 PASS')
