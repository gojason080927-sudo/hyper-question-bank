/**
 * verify:step837 — instructor UI (mobile + math + heading cleanup). Offline.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const spec = path.join(root, 'docs/STEP8_37_INSTRUCTOR_UI_v1.md')
const freeze = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

check(existsSync(spec), 'missing 8.37 spec')
check(existsSync(freeze), 'missing 8.25 freeze')
check(existsSync(path.join(root, 'src/lib/outline/formatOutlineTitle.ts')), 'missing outline title formatter')
check(existsSync(path.join(root, 'src/lib/outline/formatOutlineTitle.test.ts')), 'missing outline title tests')
check(existsSync(path.join(root, 'src/lib/math/splitMathForDisplay.ts')), 'missing display math splitter')
check(existsSync(path.join(root, 'src/lib/math/safeKatex.ts')), 'missing KaTeX fallback helper')
check(existsSync(path.join(root, 'src/lib/questions/problemCardModel.ts')), 'missing shared problem view model')
check(existsSync(path.join(root, 'src/features/questions/ProblemCardList.tsx')), 'missing mobile problem cards')

const specText = readFileSync(spec, 'utf8')
check(specText.includes('368cc70'), 'spec must lock PR #21 merge commit')
check(specText.includes('9ff369b4-5b16-4cb8-bfc3-a6b180c18703'), 'spec must lock SSEN id')
check(specText.includes('1,242'), 'spec must freeze listed count')
check(specText.includes('No migration') || specText.includes('no migration'), 'spec must refuse migration by default')
check(!specText.includes('pwuswjauzdxewmtgoitf') || /never|Never/.test(specText), 'must refuse student-care')

const freezeText = readFileSync(freeze, 'utf8')
check(freezeText.includes('8.37'), '8.25 freeze must list 8.37')

const browse = readFileSync(path.join(root, 'src/features/sources/SourceBrowsePage.tsx'), 'utf8')
check(browse.includes('formatOutlineTitle'), 'browse must use display title formatter')
check(browse.includes('ProblemCardList'), 'browse must render mobile cards')
check(browse.includes('MixedKatexText') || browse.includes('ProblemStemDisplay'), 'browse must render KaTeX')
check(!browse.includes('{major.code} {major.title_normalized}'), 'browse must not concatenate raw codes')

const dash = readFileSync(path.join(root, 'src/features/dashboard/DashboardPage.tsx'), 'utf8')
check(dash.includes("area.id === 'worksheets'"), 'home must link worksheets')
check(dash.includes('/worksheets'), 'home worksheets href must exist')

const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
check(css.includes('problem-card'), 'css must include problem cards')
check(css.includes('word-break: keep-all'), 'css must keep Hangul from stacking')

const ws = readFileSync(path.join(root, 'src/features/worksheets/WorksheetBuilderPage.tsx'), 'utf8')
check(ws.includes('a4-viewport'), 'worksheet must scale A4')
check(ws.includes('MixedKatexText'), 'worksheet must render KaTeX')

check(Boolean(pkg.scripts['verify:step837']), 'package.json must expose verify:step837')

const migrationsDir = path.join(root, 'supabase/migrations')
if (existsSync(migrationsDir)) {
  const { readdirSync } = await import('node:fs')
  const added = readdirSync(migrationsDir).filter((name) => name.includes('837') || name.includes('step837') || name.includes('instructor_ui'))
  check(added.length === 0, '8.37 must not add a migration')
}

if (failures.length) {
  console.error('verify:step837 FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:step837 PASS')
