/**
 * STEP 8.26 — pipeline job schema + progress counters.
 * No textbook run. No paid OCR. No problem persist.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.26 PIPELINE JOB SCHEMA')
console.log('Additive pipeline_runs/pipeline_items only. No textbook ingest. No paid OCR.')

if (argv.includes('--persist') && !argv.includes('--persist-schema')) {
  console.error('STEP 8.26 forbids --persist (problem writes). Use --cache-only or --persist-schema.')
  process.exit(1)
}
if (argv.includes('--allow-paid-api')) {
  console.error('STEP 8.26 forbids --allow-paid-api')
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
    'src/lib/ingestion/pipelineJob826.test.ts',
    'src/lib/ingestion/step826.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step826.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-26/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`PASS/REVIEW/BLOCKED: ${summary.results.PASS}/${summary.results.REVIEW}/${summary.results.BLOCKED}`)
  console.log(`schema applied: ${summary.schema_write.applied} (${summary.schema_write.reason})`)
  console.log(`paid mathpix/mistral: ${summary.paid_api_calls.mathpix}/${summary.paid_api_calls.mistral}`)
  console.log('manifest: ocr-tests/taxonomy/step8-26/step8-26-summary.md')
}
process.exit(0)
