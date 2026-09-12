/**
 * STEP 8.31 — confidence gate + HUMAN_REVIEW queue. Paid OCR forbidden.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.31 CONFIDENCE GATE + DRAFT PERSIST + HUMAN_REVIEW QUEUE')
console.log('26 cached samples only. No paid OCR. AUTO_APPROVED only if 8.25 §D all hold.')

if (argv.includes('--allow-paid-api')) {
  console.error('STEP 8.31 forbids --allow-paid-api')
  process.exit(1)
}

if (argv.includes('--help') || !argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  console.log('       --run --persist --probe-production --cache-only')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const tests = spawnSync(
  process.execPath,
  [
    vitestCli,
    'run',
    'src/lib/ingestion/confidenceGate831.test.ts',
    'src/lib/ingestion/step831.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const runnerArgs = argv.filter((flag) => flag !== '--run')
if (runnerArgs.includes('--persist') || runnerArgs.includes('--probe-production')) {
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
  console.log(`status: ${summary.status}`)
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
