/**
 * verify:closeout — SSEN book closeout + ingest:book contracts (offline).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const lib = readFileSync(path.join(root, 'src/lib/ingestion/ssenBookCloseout.ts'), 'utf8')
const tests = readFileSync(path.join(root, 'src/lib/ingestion/ssenBookCloseout.test.ts'), 'utf8')
const cli = readFileSync(path.join(root, 'src/lib/ingestion/ssenBookCloseoutCli.ts'), 'utf8')
const pipeline = readFileSync(path.join(root, 'src/lib/ingestion/bookCompletePipeline.ts'), 'utf8')
const ingestCli = readFileSync(path.join(root, 'src/lib/ingestion/bookCompleteCli.ts'), 'utf8')
const review = readFileSync(path.join(root, 'src/features/review/PipelineReviewPage.tsx'), 'utf8')
const source = readFileSync(path.join(root, 'src/features/sources/SourceDetailPage.tsx'), 'utf8')
const worksheets = readFileSync(path.join(root, 'src/features/worksheets/WorksheetListPage.tsx'), 'utf8')
const tsconfig = readFileSync(path.join(root, 'tsconfig.app.json'), 'utf8')

check(Boolean(pkg.scripts['verify:closeout']), 'package.json must expose verify:closeout')
check(Boolean(pkg.scripts['ingest:book']), 'package.json must expose ingest:book')
check(Boolean(pkg.scripts['pipeline:ssen-closeout']), 'package.json must expose pipeline:ssen-closeout')
check(Boolean(pkg.scripts['verify:step840']), 'must keep verify:step840')
check(lib.includes('COST_CAP_USD = 1'), 'cost cap $1')
check(lib.includes('TEACHER_EDIT'), 'protect TEACHER_EDIT')
check(lib.includes('VERIFIED_BY_SOURCE'), 'define VERIFIED_BY_SOURCE')
check(lib.includes('HUMAN_FINAL_CHECK'), 'define HUMAN_FINAL_CHECK')
check(lib.includes('P1_GOLD'), 'P1 gold stems')
check(lib.includes('0331') && lib.includes('0333') && lib.includes('0381'), 'P1 numbers in gold table only')
check(cli.includes('hqb_apply_auto_clean_text'), 'reuse AUTO_CLEAN RPC')
check(cli.includes('STUDENT_CARE'), 'refuse student-care')
check(cli.includes('--persist') || cli.includes('--apply'), 'gate persist')
check(cli.includes('COST_CAP_USD') || cli.includes('cost cap'), 'cli cost cap')
check(!cli.includes('p_stem'), 'RPC arg is p_cleaned_text')
check(cli.includes('p_cleaned_text'), 'RPC arg p_cleaned_text')
check(pipeline.includes('genericOutlineAdapter'), 'TOC adapter')
check(pipeline.includes('--apply'), 'default dry-run, apply writes')
check(pipeline.includes('identical_pdf'), 'same hash skip')
check(!pipeline.includes('0331'), 'pipeline must not hardcode SSEN P1 numbers')
check(ingestCli.includes('source lock') || ingestCli.includes('acquireLock'), 'source lock')
check(review.includes('closeout') && review.includes('CloseoutReviewPanel'), 'review tab')
check(source.includes('book-qa-status'), 'source detail QA status')
check(source.includes('sourcePipelineLabel'), 'source detail uses book-ready pipeline overlay')
check(source.includes('분류 대기'), 'source detail separates live review queue from leftover human')
check(review.includes('사람 확인 잔여와는 별개'), 'pipeline review copy separates live queue from closeout')
const statusJson = JSON.parse(readFileSync(path.join(root, 'public/ssen-book-status.json'), 'utf8'))
check(statusJson.human_exceptions === 0, 'frozen human_exceptions is 0')
check(statusJson.freeze?.live_needs_review === 9, 'freeze live_needs_review is the classification queue')
check(statusJson.freeze?.closeout_human_exceptions === 0, 'freeze closeout_human_exceptions matches leftover HUMAN')
check(statusJson.freeze?.ssen_needs_review === statusJson.freeze?.live_needs_review, 'legacy ssen_needs_review aliases live queue')
const labels = readFileSync(path.join(root, 'src/lib/outline/instructorLabels.ts'), 'utf8')
check(labels.includes('sourcePipelineLabel'), 'instructor overlay labels')
check(existsSync(path.join(root, 'src/lib/outline/instructorLabels.test.ts')), 'instructor label tests')
check(worksheets.includes('테스트·빈 문제지 숨기기'), 'hide test/empty worksheets')
check(worksheets.includes('hqb_archive_worksheet'), 'archive not delete')
check(!worksheets.includes('delete') && !worksheets.includes('DELETE'), 'worksheet UI must not delete')
check(tsconfig.includes('ssenBookCloseoutCli.ts'), 'exclude closeout CLI from app tsconfig')
check(tsconfig.includes('bookCompleteCli.ts'), 'exclude ingest CLI from app tsconfig')
check(tests.includes('TEACHER_EDIT'), 'tests protect TEACHER_EDIT')
check(tests.includes('0331'), 'tests cover P1')
check(tests.includes('paidBudgetAllows') || tests.includes('$1'), 'tests cover cost cap')
check(existsSync(path.join(root, 'scripts/ssen-closeout.mjs')), 'closeout script')
check(existsSync(path.join(root, 'scripts/ingest-book.mjs')), 'ingest:book script')

const migrationsDir = path.join(root, 'supabase/migrations')
if (existsSync(migrationsDir)) {
  const added = readdirSync(migrationsDir).filter((name) => /closeout|8\.41|841/.test(name))
  check(added.length === 0, 'closeout must not add a migration')
}

if (failures.length) {
  console.error('verify:closeout FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:closeout PASS')
