/**
 * STEP 8.25 — Integrated textbook batch registration pipeline Design Freeze.
 * Offline types + tests + verify only. Refuses persist and paid OCR.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.25 BATCH REGISTRATION PIPELINE DESIGN FREEZE')
console.log('No Production writes. No paid OCR. No textbook ingest.')

if (argv.includes('--persist') || argv.includes('--allow-paid-api')) {
  console.error('STEP 8.25 forbids --persist and --allow-paid-api')
  process.exit(1)
}

if (!argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const tests = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/lib/ingestion/batchPipeline825.test.ts', '--reporter=verbose'],
  { cwd: root, stdio: 'inherit', env: { ...process.env } },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step825.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-25/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`production_writes: ${summary.production_writes}`)
  console.log(`paid mathpix/mistral: ${summary.paid_api_calls.mathpix}/${summary.paid_api_calls.mistral}`)
  console.log('manifest: ocr-tests/taxonomy/step8-25/step8-25-summary.md')
}
process.exit(0)
