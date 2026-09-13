import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const spec = path.join(root, 'docs/STEP8_36_SSEN_OUTLINE_STABILIZE_v1.md')
const freeze = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const migration = path.join(root, 'supabase/migrations/20260913033000_hqb_ssen_outline_stabilize_v1.sql')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

check(existsSync(spec), 'missing 8.36 spec')
check(existsSync(freeze), 'missing 8.25 freeze')
check(existsSync(migration), 'missing additive 8.36 migration')
check(existsSync(path.join(root, 'src/lib/outline/ssenToc.ts')), 'missing frozen TOC')
check(existsSync(path.join(root, 'src/features/sources/SourceBrowsePage.tsx')), 'missing browse page')
check(existsSync(path.join(root, 'scripts/step-8.36.mjs')), 'missing persist script')

const specText = readFileSync(spec, 'utf8')
check(specText.includes('VERIFIED'), 'spec must mention VERIFIED ban')
check(specText.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), 'spec must lock SSEN id')
check(!specText.includes('pwuswjauzdxewmtgoitf') || /never|Never/.test(specText), 'must refuse student-care')

const freezeText = readFileSync(freeze, 'utf8')
check(freezeText.includes('8.36'), '8.25 freeze must list 8.36')

const sql = readFileSync(migration, 'utf8')
check(sql.includes('source_outline_nodes'), 'migration must add outline nodes')
check(sql.includes('hqb_list_problems'), 'migration must add paginated list RPC')
check(sql.includes('hqb_list_review_queue'), 'migration must add live review queue')
check(sql.includes('is_fixture'), 'migration must add fixture visibility')
check(!sql.includes('DROP TABLE'), 'migration must not drop tables')
check(!sql.includes('DELETE FROM public.problems'), 'migration must not delete problems')

const toc = readFileSync(path.join(root, 'src/lib/outline/ssenToc.ts'), 'utf8')
check(toc.includes('다항식의 연산'), 'TOC must use printed section titles')
check(toc.includes('행렬과 그 연산'), 'TOC must include unit 10 printed title')

const app = readFileSync(path.join(root, 'src/app/App.tsx'), 'utf8')
check(app.includes('sources/:documentId/browse'), 'must add textbook browse route')

const list = readFileSync(path.join(root, 'src/features/questions/QuestionListPage.tsx'), 'utf8')
check(list.includes('hqb_list_problems'), 'list must use server pagination')

check(Boolean(pkg.scripts['verify:step836']), 'package.json must expose verify:step836')
check(Boolean(pkg.scripts['pipeline:8.36']), 'package.json must expose pipeline:8.36')

if (failures.length) {
  console.error('verify:step836 FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:step836 PASS')
