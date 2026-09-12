/**
 * STEP 8.29 — dual-AI review on cached artifacts.
 * No problem/draft persist. No paid OCR. No STEP 8.30.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.29 DUAL-AI REVIEW ON CACHED ARTIFACTS')
console.log('STEP 8.28 26-item cache only. No draft persist. No paid OCR.')

if (argv.includes('--persist')) {
  console.error('STEP 8.29 forbids --persist (problem/draft writes). Use --cache-only.')
  process.exit(1)
}
if (argv.includes('--allow-paid-api')) {
  console.error('STEP 8.29 forbids --allow-paid-api')
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
    'src/lib/ingestion/dualAiReview829.test.ts',
    'src/lib/ingestion/step829.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step829.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-29/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`executed: ${summary.executed}`)
  console.log(`PASS/REVIEW/BLOCKED: ${summary.results.PASS}/${summary.results.REVIEW}/${summary.results.BLOCKED}`)
  console.log(`dual agree/disagree: ${summary.dual.agree}/${summary.dual.disagree}`)
  console.log(`paid mathpix/mistral: ${summary.paid_api_calls.mathpix}/${summary.paid_api_calls.mistral}`)
  console.log('manifest: ocr-tests/taxonomy/step8-29/step8-29-summary.md')
}
process.exit(0)
