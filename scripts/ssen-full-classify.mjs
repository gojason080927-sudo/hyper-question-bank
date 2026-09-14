/**
 * 쎈수학 공통수학1 전체 분류. Default DRY RUN. --apply writes AUTO type/unit.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
console.log('SSEN FULL CLASSIFY')
console.log('Never DELETE. Never VERIFIED. Never student-care. Never 8.32-8.40 persist replay.')

const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/ssenFullClassifyCli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
