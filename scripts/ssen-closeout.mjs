/**
 * 쎈수학 공통수학1 closeout. Default DRY RUN.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
console.log('SSEN BOOK CLOSEOUT')
console.log('Never DELETE. Never VERIFIED/TEACHER_EDIT overwrite. Never student-care. Never 8.32-8.40 persist replay. Cost cap $1.')

const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/ssenBookCloseoutCli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
