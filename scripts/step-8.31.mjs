/**
 * STEP 8.31 — e2e 26-sample recover / crop / OCR / compare / HUMAN_REVIEW persist.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.31 E2E PILOT — recover original, crop, OCR, compare, queue HUMAN_REVIEW')
console.log('Never VERIFIED. Never student-care. Mistral cap 30 calls / $2. Mathpix optional.')

if (argv.includes('--help') || !argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  console.log('       --run --persist --probe-production')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const tests = spawnSync(
  process.execPath,
  [
    vitestCli,
    'run',
    'src/lib/ingestion/e2ePilot831.test.ts',
    'src/lib/ingestion/step831.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const runnerArgs = argv.filter((flag) => flag !== '--run')
const hasCache = existsSync(path.join(root, '.ocr-temp/step8-31/crops/S01.png'))
if (runnerArgs.includes('--persist') && !hasCache) {
  console.error('STEP 8.31 persist requires recovered crops under .ocr-temp/step8-31/crops')
  process.exit(1)
}
if (hasCache && (runnerArgs.includes('--persist') || runnerArgs.includes('--probe-production') || runnerArgs.includes('--cache-only'))) {
  const npx = spawnSync(
    'npx',
    ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/step831Cli.ts'), ...runnerArgs],
    { cwd: root, stdio: 'inherit' },
  )
  if ((npx.status ?? 1) !== 0) process.exit(npx.status ?? 1)
}

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step831.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-31/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`compared: ${summary.tally?.compared}`)
  console.log(
    `AUTO/HUMAN_REVIEW/BLOCKED: ${summary.tally?.auto_approved}/${summary.tally?.human_review}/${summary.tally?.blocked}`,
  )
  console.log(`mistral new/cached: ${summary.paid_api_calls?.mistral}/${summary.paid_api_calls?.mistral_cached}`)
  console.log(`persist creates: ${summary.persist?.created?.length ?? 0}`)
}

if (argv.includes('--persist') || argv.includes('--probe-production')) {
  const probe = spawnSync(process.execPath, [path.join(root, 'scripts/probe-step831-production.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
  if ((probe.status ?? 1) !== 0) process.exit(probe.status ?? 1)
}

process.exit(0)
