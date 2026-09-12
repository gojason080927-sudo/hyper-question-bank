/**
 * STEP 8.27 — SSEN layout OCR cache generation (still 8.27, not 8.28).
 * Verifies Production original.pdf and fills Mistral layout cache under a $1 cap.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.27 SSEN LAYOUT OCR CACHE')
console.log('Question Bank only. Mistral only. $1 cap. Do not start 8.28.')

if (!argv.includes('--run')) {
  console.log('usage: --run [--pdf=/tmp/hqb-ssen-ocr/original.pdf] [--cache-only]')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/lib/ingestion/ssenLayoutCache827.run.test.ts', '--reporter=verbose'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HQB_8_27_OCR: '1',
      HQB_8_27_OCR_ARGV: argv.join(' '),
    },
  },
)
const latest = path.join(root, 'ocr-tests/taxonomy/step8-27/ocr-cache-generation.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`sha match: ${summary.original?.match}`)
  console.log(`paid mistral/mathpix: ${summary.paid_api_calls?.mistral}/${summary.paid_api_calls?.mathpix}`)
  console.log(`user action: ${summary.user_action ?? '(none)'}`)
}
process.exit(result.status ?? 1)
