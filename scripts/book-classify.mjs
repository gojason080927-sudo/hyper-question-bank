/**
 * Classify persisted 공통수학2 drafts. Default dry-run.
 * Live: --apply
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
if (argv.includes('--help')) {
  console.log('usage: npm run classify:book -- [--book=gojaeng2] [--apply]')
  process.exit(0)
}

const tests = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'src/lib/taxonomy/cm2Classify.test.ts', '--reporter=dot'],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/bookClassifyCli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
