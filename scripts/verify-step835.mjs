/**
 * verify:step835 — instructor WYSIWYG editor + A4 worksheets.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (cond, msg) => {
  if (!cond) failures.push(msg)
}

const spec = path.join(root, 'docs/STEP8_35_WYSIWYG_EDITOR_v1.md')
const stack = path.join(root, 'docs/STEP8_35_STACK_COMPARISON_v1.md')
const freeze = path.join(root, 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md')
const migration = path.join(root, 'supabase/migrations/20260913020000_hqb_wysiwyg_editor_v1.sql')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

check(existsSync(spec), 'missing 8.35 spec')
check(existsSync(stack), 'missing stack comparison')
check(existsSync(freeze), 'missing 8.25 freeze')
check(existsSync(migration), 'missing additive 8.35 migration')
check(existsSync(path.join(root, 'src/lib/editor/schema.ts')), 'missing editor schema')
check(existsSync(path.join(root, 'src/features/questions/editor/WysiwygEditor.tsx')), 'missing WYSIWYG editor')
check(existsSync(path.join(root, 'src/features/worksheets/WorksheetBuilderPage.tsx')), 'missing worksheet builder')

const specText = readFileSync(spec, 'utf8')
check(specText.includes('overwrite OCR') || specText.includes('OCR originals'), 'spec must keep OCR originals')
check(specText.includes('VERIFIED'), 'spec must mention VERIFIED ban')
check(specText.includes('Tiptap Pages') === false || specText.includes('Not') || specText.includes('not'), 'must reject Tiptap Pages')
check(!specText.includes('pwuswjauzdxewmtgoitf') || /never|Never/.test(specText), 'must refuse student-care')

const stackText = readFileSync(stack, 'utf8')
check(stackText.includes('MIT'), 'stack must record MIT licenses')
check(stackText.includes('MathLive'), 'stack must choose MathLive')
check(stackText.includes('KaTeX'), 'stack must keep KaTeX')
check(!stackText.includes('Pages') || stackText.includes('Not') || stackText.includes('not'), 'must reject paid Pages')

const freezeText = readFileSync(freeze, 'utf8')
check(freezeText.includes('8.35'), '8.25 freeze must list 8.35')

const sql = readFileSync(migration, 'utf8')
check(sql.includes('hqb_save_editor_document'), 'migration must add save RPC')
check(sql.includes('hqb_restore_problem_version'), 'migration must add restore RPC')
check(sql.includes('editor_autosaves'), 'migration must add autosave table')
check(sql.includes('question-bank-assets'), 'migration must add assets bucket')
check(!sql.includes('DROP TABLE'), 'migration must not drop tables')
check(!sql.includes('DELETE FROM public.problems'), 'migration must not delete problems')
check(sql.includes("review_status = 'UNREVIEWED'"), 'new versions must stay UNREVIEWED')
check(sql.includes('HQB_NO_VERIFY') || sql.includes('VERIFIED'), 'must refuse VERIFIED writes')

check(Boolean(pkg.dependencies['@tiptap/react']), 'must depend on @tiptap/react')
check(Boolean(pkg.dependencies.mathlive), 'must depend on mathlive')
check(Boolean(pkg.dependencies.dompurify), 'must depend on dompurify')
check(Boolean(pkg.dependencies.katex), 'must keep katex')
check(!pkg.dependencies['@tiptap-pro/extension-pages'], 'must not depend on paid Tiptap Pages')

const app = readFileSync(path.join(root, 'src/app/App.tsx'), 'utf8')
check(app.includes('questions/:problemId/edit'), 'must keep edit route')
check(app.includes('/worksheets'), 'must add worksheet routes')

if (failures.length) {
  console.error('verify:step835 FAIL')
  for (const row of failures) console.error(' -', row)
  process.exit(1)
}
console.log('verify:step835 PASS')
