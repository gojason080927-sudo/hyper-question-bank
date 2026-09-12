/**
 * STEP 8.24 — Remaining Figure Recovery and Question Linking v1.
 * Re-evaluates the 8 STEP 8.23 pending figure candidates against current Production and
 * persists only PASS candidates via the existing STEP 8.23 RPC. No paid OCR unless configured
 * and within limits. No problem overwrite. No multimodal/print-edit. Does not start STEP 8.25.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.24 REMAINING FIGURE RECOVERY')
console.log('AUTO figures only. Reuse STEP 8.23 persistence path. No problem overwrite.')

if (!argv.includes('--run')) {
  console.log('usage: --run --cache-only | --run --persist')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/lib/ingestion/step824.run.test.ts', '--reporter=verbose'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HQB_BOOK_8_24: '1',
      HQB_8_24_ARGV: argv.filter((flag) => flag !== '--run').join(' ') || '--cache-only',
    },
  },
)
const latest = path.join(root, 'ocr-tests/taxonomy/step8-24/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`verdict: ${summary.verdict}`)
  console.log(`PASS/REVIEW/BLOCKED: ${summary.results.PASS}/${summary.results.REVIEW}/${summary.results.BLOCKED}`)
  console.log(`persisted new assets/links: ${summary.persisted.new_assets}/${summary.persisted.new_links}`)
  console.log(`OCR calls: ${summary.ocr.calls} cost USD: ${summary.ocr.cost_usd}`)
  console.log('manifest: ocr-tests/taxonomy/step8-24/step8-24-summary.md')
}
process.exit(result.status ?? 1)
