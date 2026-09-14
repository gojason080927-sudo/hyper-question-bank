/**
 * verify:ssen-classify — SSEN full classification contracts (offline).
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
const lib = readFileSync(path.join(root, 'src/lib/taxonomy/ssenFullClassify.ts'), 'utf8')
const tests = readFileSync(path.join(root, 'src/lib/taxonomy/ssenFullClassify.test.ts'), 'utf8')
const cli = readFileSync(path.join(root, 'src/lib/ingestion/ssenFullClassifyCli.ts'), 'utf8')
const source = readFileSync(path.join(root, 'src/features/sources/SourceDetailPage.tsx'), 'utf8')
const tsconfig = readFileSync(path.join(root, 'tsconfig.app.json'), 'utf8')

check(Boolean(pkg.scripts['verify:ssen-classify']), 'package.json must expose verify:ssen-classify')
check(Boolean(pkg.scripts['pipeline:ssen-classify']), 'package.json must expose pipeline:ssen-classify')
check(lib.includes('SSEN_FULL_CLASSIFY'), 'assigned by SSEN_FULL_CLASSIFY')
check(lib.includes('VERIFIED_BLOCKED'), 'protect VERIFIED')
check(lib.includes('TEACHER_EDIT'), 'protect TEACHER_EDIT')
check(lib.includes('ANSWER_KEY_LEAK'), 'do not clear answer-key leaks')
check(lib.includes('original_problem_number') && lib.includes('c_stage'), 'number-order inherit and C-stage break')
check(cli.includes('page-headings.json') || cli.includes('loadHeadings'), 'CLI loads page heading cache')
check(existsSync(path.join(root, 'ocr-tests/taxonomy/ssen-classify/page-headings.json')), 'page heading cache')
check(cli.includes('hqb_upsert_problem_classification') || cli.includes('CLASSIFICATION_RPC'), 'reuse classification RPC')
check(cli.includes('STUDENT_CARE'), 'refuse student-care')
check(cli.includes('--persist') || cli.includes('--apply'), 'gate persist')
check(!/review_status:\s*'VERIFIED'/.test(cli), 'CLI must not write VERIFIED')
check(tests.includes('maps every frozen SSEN type title'), 'tests cover 68 type titles')
check(tests.includes('실력 굳히기') && tests.includes('original problem number'), 'tests cover C-stage and number order')
check(tsconfig.includes('ssenFullClassifyCli.ts'), 'exclude classify CLI from app tsconfig')
check(source.includes('ssen-classify-status') || source.includes('유형 분류'), 'source detail shows type classification')
check(existsSync(path.join(root, 'scripts/ssen-full-classify.mjs')), 'classify script')

const migrationsDir = path.join(root, 'supabase/migrations')
if (existsSync(migrationsDir)) {
  const added = readdirSync(migrationsDir).filter((name) => /ssen-classify|full-classif/.test(name))
  check(added.length === 0, 'classify must not add a migration')
}

if (failures.length) {
  console.error('verify:ssen-classify FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:ssen-classify PASS')
