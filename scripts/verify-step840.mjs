/**
 * verify:step840 — review-minimize contracts (offline).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const spec = path.join(root, 'docs/STEP8_40_REVIEW_MINIMIZE_v1.md')
const freeze = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const lib = readFileSync(path.join(root, 'src/lib/ingestion/ssenReviewMinimize840.ts'), 'utf8')
const tests = readFileSync(path.join(root, 'src/lib/ingestion/ssenReviewMinimize840.test.ts'), 'utf8')
const cli = readFileSync(path.join(root, 'src/lib/ingestion/step840Cli.ts'), 'utf8')
const review = readFileSync(path.join(root, 'src/features/review/PipelineReviewPage.tsx'), 'utf8')
const panel = readFileSync(path.join(root, 'src/features/review/ReviewMinimize840Panel.tsx'), 'utf8')
const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')

check(existsSync(spec), 'missing 8.40 spec')
check(existsSync(path.join(root, 'src/lib/ingestion/ssenReviewMinimize840.ts')), 'missing 8.40 lib')
check(existsSync(path.join(root, 'src/lib/ingestion/ssenReviewMinimize840.test.ts')), 'missing 8.40 tests')
check(Boolean(pkg.scripts['verify:step840']), 'package.json must expose verify:step840')
check(Boolean(pkg.scripts['pipeline:8.40']), 'package.json must expose pipeline:8.40')
check(Boolean(pkg.scripts['verify:step839']), 'must keep verify:step839')
check(Boolean(pkg.scripts['verify:step838']), 'must keep verify:step838')

const specText = readFileSync(spec, 'utf8')
check(specText.includes('d0fa5d2'), 'spec must lock PR #24 merge commit')
check(specText.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), 'spec must lock SSEN id')
check(specText.includes('1,242'), 'spec must freeze listed count')
check(specText.includes('PASS_FALSE_POSITIVE'), 'spec must define PASS_FALSE_POSITIVE')
check(specText.includes('AUTO_SAFE'), 'spec must define AUTO_SAFE')
check(specText.includes('prj_q7khSRjjjAmwWcfs1FRsEobT1hXC'), 'spec must record Vercel projectId')
check(specText.includes('gojason080927-sudo/hyper-question-bank'), 'spec must lock Git repo')
check(!specText.includes('pwuswjauzdxewmtgoitf') || /never|Never/.test(specText), 'must refuse student-care')

const freezeText = readFileSync(freeze, 'utf8')
check(freezeText.includes('8.40'), '8.25 freeze must list 8.40')
check(freezeText.includes('8.39'), '8.25 freeze must keep 8.39')

check(lib.includes('TEACHER_EDIT'), 'lib must protect TEACHER_EDIT')
check(lib.includes('VERIFIED'), 'lib must protect VERIFIED')
check(lib.includes('1242') || lib.includes('SSEN_LISTED_FROZEN'), 'lib must freeze 1242')
check(lib.includes('PASS_FALSE_POSITIVE'), 'lib must define PASS_FALSE_POSITIVE')
check(cli.includes('--persist'), 'cli must gate persist')
check(cli.includes('hqb_apply_auto_clean_text'), 'cli must reuse AUTO_CLEAN RPC')
check(cli.includes('STUDENT_CARE'), 'cli must refuse student-care')
check(cli.includes('8.32') && cli.includes('Never'), 'must not replay 8.32 persist')
check(!cli.includes('mathpix.com/v3') && !cli.includes('mistral.ai'), 'cli must not call paid OCR APIs')

check(tests.includes('TEACHER_EDIT'), 'tests must cover TEACHER_EDIT')
check(tests.includes('VERIFIED'), 'tests must cover VERIFIED')
check(tests.includes('idempotent'), 'tests must cover idempotent rerun')
check(tests.includes('PASS_FALSE_POSITIVE'), 'tests must cover false positives')
check(tests.includes('P1') || tests.includes('TOO_SHORT'), 'tests must cover P1 short stems')
check(tests.includes('128'), 'tests must cover the 128 census')
check(tests.includes('61'), 'tests must cover 61 pages')

check(review.includes('qa840') && review.includes('ReviewMinimize840Panel'), 'review queue must expose 8.40 tab')
check(review.includes('qa839'), 'must keep 8.39 tab')
check(panel.includes('qa840-compare'), 'panel must compare original/current/candidate')
check(panel.includes('PASS_FALSE_POSITIVE'), 'panel must filter PASS_FALSE_POSITIVE')
check(panel.includes('neighbors_before'), 'panel must show neighbor items')
check(/\.review-split[\s\S]*@media \(max-width: 900px\)[\s\S]*review-split\.qa840-split/.test(css) || /qa840-split/.test(css), 'mobile CSS must stack qa840 split')
check(css.includes('pass_false_positive'), 'CSS must style PASS_FALSE_POSITIVE')

const migrationsDir = path.join(root, 'supabase/migrations')
if (existsSync(migrationsDir)) {
  const added = readdirSync(migrationsDir).filter((name) => name.includes('840') || name.includes('step840'))
  check(added.length === 0, '8.40 must not add a migration')
}

if (failures.length) {
  console.error('verify:step840 FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:step840 PASS')
