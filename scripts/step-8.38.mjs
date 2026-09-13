/**
 * STEP 8.38 — range-stem restore. Default DRY RUN. Pass --persist only after safety.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
console.log('STEP 8.38 RANGE STEM RESTORE')
console.log('Never DELETE. Never VERIFIED/TEACHER_EDIT overwrite. Never paid OCR. Never student-care.')

const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/step838Cli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
