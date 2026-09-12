/**
 * STEP 8.32 — full 192-page SSEN ingest. Paid OCR allowed with both cost flags.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.32 FULL SSEN 192-PAGE INGEST')
console.log('AUTO_APPROVED is not required for DRAFT persist. Never VERIFIED.')

if (argv.includes('--help') || !argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  console.log('       --run --allow-paid-api --i-understand-this-costs-money --persist --probe-production')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const tests = spawnSync(
  process.execPath,
  [
    vitestCli,
    'run',
    'src/lib/ingestion/fullBookIngest832.test.ts',
    'src/lib/ingestion/step832.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const runnerArgs = argv.filter((flag) => flag !== '--run')
const needsRunner =
  runnerArgs.includes('--persist') ||
  runnerArgs.includes('--probe-production') ||
  runnerArgs.includes('--allow-paid-api') ||
  runnerArgs.includes('--cache-only')
if (needsRunner) {
  const npx = spawnSync(
    'npx',
    ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/step832Cli.ts'), ...runnerArgs],
    { cwd: root, stdio: 'inherit' },
  )
  if ((npx.status ?? 1) !== 0) process.exit(npx.status ?? 1)
}

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step832.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-32/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`pages: ${summary.pages_processed} found: ${summary.problems_found}`)
  console.log(
    `create/existing/review/blocked: ${summary.tally?.create_draft}/${summary.tally?.record_existing}/${summary.tally?.needs_review}/${summary.tally?.blocked}`,
  )
  console.log(`mistral new/cached usd: ${summary.paid_api_calls?.mistral}/${summary.paid_api_calls?.mistral_cached} ${summary.estimated_usd}`)
}

if (argv.includes('--persist') || argv.includes('--probe-production')) {
  const probe = spawnSync(process.execPath, [path.join(root, 'scripts/probe-step832-production.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
  if ((probe.status ?? 1) !== 0) process.exit(probe.status ?? 1)
}

process.exit(0)
