/**
 * Cache-only generic book split. Never paid OCR / persist.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
if (argv.includes('--help')) {
  console.log('usage: npm run segment:book -- --book=ganyeom2')
  process.exit(0)
}

const tests = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'src/lib/ingestion/bookSegment.test.ts', '--reporter=dot'],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/bookSegmentCli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
