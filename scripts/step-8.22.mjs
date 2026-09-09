/**
 * STEP 8.22 — visual figure detection v1 + ownership v3.
 * Validation only. No production figure ingestion. Do not start 8.23.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.22 VISUAL FIGURE DETECTION v1')
console.log('Validation only. No paid OCR. No figure production ingestion. Do not start 8.23.')

if (!argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/lib/ingestion/step822.run.test.ts', '--reporter=verbose'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HQB_BOOK_8_22: '1',
      HQB_8_22_ARGV: argv.join(' '),
    },
  },
)
const latest = path.join(root, 'ocr-tests/taxonomy/step8-22/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`verdict: ${summary.verdict}`)
  console.log(`readiness: ${summary.readiness}`)
  console.log(`AUTO_FIGURE_SAFE: ${summary.auto}`)
  console.log(`FALSE_FIGURE_SAFE: ${summary.false_figure_safe}`)
  console.log('manifest: ocr-tests/taxonomy/step8-22/step8-22-summary.md')
}
process.exit(result.status ?? 1)
