/**
 * STEP 8.27 — cache-only batch segmentation on one already-stored textbook.
 * No problem persist. No paid OCR. No STEP 8.28.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.27 CACHE-ONLY BATCH SEGMENTATION')
console.log('One already-stored textbook. No problem persist. No paid OCR.')

if (argv.includes('--persist') && !argv.includes('--persist-pipeline')) {
  console.error('STEP 8.27 forbids --persist (problem writes). Use --cache-only.')
  process.exit(1)
}
if (argv.includes('--allow-paid-api')) {
  console.error('STEP 8.27 forbids --allow-paid-api')
  process.exit(1)
}

if (!argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const tests = spawnSync(
  process.execPath,
  [
    vitestCli,
    'run',
    'src/lib/ingestion/cacheSegment827.test.ts',
    'src/lib/ingestion/step827.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step827.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-27/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`executed: ${summary.executed}`)
  console.log(`PASS/REVIEW/BLOCKED: ${summary.results.PASS}/${summary.results.REVIEW}/${summary.results.BLOCKED}`)
  console.log(`dry-run pass: ${summary.dry_run.pass}`)
  console.log(`schema present: ${summary.schema_probe.present}`)
  console.log(`paid mathpix/mistral: ${summary.paid_api_calls.mathpix}/${summary.paid_api_calls.mistral}`)
  console.log('manifest: ocr-tests/taxonomy/step8-27/step8-27-summary.md')
}
process.exit(0)
