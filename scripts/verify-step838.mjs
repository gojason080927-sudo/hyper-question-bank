/**
 * verify:step838 — range-stem restore (offline file/contract checks).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const spec = path.join(root, 'docs/STEP8_38_RANGE_STEM_RESTORE_v1.md')
const freeze = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const lib = readFileSync(path.join(root, 'src/lib/ingestion/rangeStemRestore838.ts'), 'utf8')
const tests = readFileSync(path.join(root, 'src/lib/ingestion/rangeStemRestore838.test.ts'), 'utf8')
const review = readFileSync(path.join(root, 'src/features/review/PipelineReviewPage.tsx'), 'utf8')
const browse = readFileSync(path.join(root, 'src/features/sources/SourceBrowsePage.tsx'), 'utf8')
const cards = readFileSync(path.join(root, 'src/features/questions/ProblemCardList.tsx'), 'utf8')
const ws = readFileSync(path.join(root, 'src/features/worksheets/WorksheetBuilderPage.tsx'), 'utf8')
const cli = readFileSync(path.join(root, 'src/lib/ingestion/step838Cli.ts'), 'utf8')

check(existsSync(spec), 'missing 8.38 spec')
check(existsSync(freeze), 'missing 8.25 freeze')
check(existsSync(path.join(root, 'src/lib/ingestion/rangeStemRestore838.ts')), 'missing restore lib')
check(existsSync(path.join(root, 'src/lib/ingestion/rangeStemRestore838.test.ts')), 'missing restore tests')
check(existsSync(path.join(root, 'src/features/questions/ProblemStemDisplay.tsx')), 'missing stem display')
check(existsSync(path.join(root, 'src/features/review/RangeStemReviewPanel.tsx')), 'missing range review panel')
check(Boolean(pkg.scripts['verify:step838']), 'package.json must expose verify:step838')
check(Boolean(pkg.scripts['pipeline:8.38']), 'package.json must expose pipeline:8.38')

const specText = readFileSync(spec, 'utf8')
check(specText.includes('795a205'), 'spec must lock PR #22 merge commit')
check(specText.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), 'spec must lock SSEN id')
check(specText.includes('1,242'), 'spec must freeze listed count')
check(specText.includes('AUTO_SAFE'), 'spec must define AUTO_SAFE')
check(!specText.includes('pwuswjauzdxewmtgoitf') || /never|Never/.test(specText), 'must refuse student-care')

const freezeText = readFileSync(freeze, 'utf8')
check(freezeText.includes('8.38'), '8.25 freeze must list 8.38')

check(lib.includes('TEACHER_EDIT'), 'lib must protect TEACHER_EDIT')
check(lib.includes('VERIFIED'), 'lib must protect VERIFIED')
check(lib.includes('composeTargetStem'), 'lib must compose target stems')
check(cli.includes('--persist'), 'cli must gate persist')
check(cli.includes('hqb_apply_auto_clean_text'), 'cli must reuse AUTO_CLEAN RPC')
check(!cli.includes('pwuswjauzdxewmtgoitf') || cli.includes('STUDENT_CARE'), 'cli must refuse student-care ref')

check(tests.includes('[0003~0004]'), 'tests must parse 0003-0004')
check(tests.includes('[3~4]'), 'tests must parse one-digit ranges')
check(tests.includes('TEACHER_EDIT'), 'tests must cover TEACHER_EDIT')
check(tests.includes('VERIFIED'), 'tests must cover VERIFIED')
check(tests.includes('idempotent'), 'tests must cover idempotent rerun')
check(tests.includes('$[0,1]$') || tests.includes('\\sqrt[3]{8}'), 'tests must avoid math false positives')
check(tests.includes('worksheetItemHasSharedCondition') || tests.includes('standalone'), 'tests must cover worksheet-alone condition')

check(review.includes('range838') && review.includes('RangeStemReviewPanel'), 'review queue must expose range tab')
check(cards.includes('ProblemStemDisplay'), 'mobile cards must render shared prompt display')
check(browse.includes('ProblemStemDisplay'), 'browse must render shared prompt display')
check(ws.includes('ProblemStemDisplay'), 'worksheet A4 must include shared condition')
check(ws.includes('MixedKatexText'), 'worksheet must keep KaTeX for explanations')

const migrationsDir = path.join(root, 'supabase/migrations')
if (existsSync(migrationsDir)) {
  const added = readdirSync(migrationsDir).filter((name) => name.includes('838') || name.includes('step838') || name.includes('range_stem'))
  check(added.length === 0, '8.38 must not add a migration')
}

if (failures.length) {
  console.error('verify:step838 FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:step838 PASS')
