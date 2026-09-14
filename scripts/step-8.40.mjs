/**
 * STEP 8.40 — page-grouped contrast of leftover REVIEW_REQUIRED. Default DRY RUN.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
console.log('STEP 8.40 SSEN REVIEW MINIMIZE')
console.log('Never DELETE. Never VERIFIED/TEACHER_EDIT overwrite. Never paid OCR. Never student-care. Never 8.32-8.39 persist replay.')

const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/step840Cli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
