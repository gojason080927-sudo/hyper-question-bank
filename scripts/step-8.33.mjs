/**
 * STEP 8.33 — auto QA + NEEDS_REVIEW minimization + fingerprint search prep.
 * Paid OCR forbidden. Never VERIFIED. Does not re-run STEP 8.32 ingest.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.33 AUTO QA + SEARCH PREP')
console.log('Do not re-run STEP 8.32 ingest. Never VERIFIED.')

if (argv.includes('--allow-paid-api')) {
  console.error('STEP 8.33 forbids --allow-paid-api')
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
    'src/lib/ingestion/autoQa833.test.ts',
    'src/lib/ingestion/step833.run.test.ts',
    '--reporter=verbose',
  ],
  { cwd: root, stdio: 'inherit' },
)
if ((tests.status ?? 1) !== 0) process.exit(tests.status ?? 1)

const runnerArgs = argv.filter((flag) => flag !== '--run')
const needsRunner =
  runnerArgs.includes('--persist') ||
  runnerArgs.includes('--probe-production') ||
  runnerArgs.includes('--cache-only')
if (needsRunner) {
  const npx = spawnSync(
    'npx',
    ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/step833Cli.ts'), ...runnerArgs],
    { cwd: root, stdio: 'inherit' },
  )
  if ((npx.status ?? 1) !== 0) process.exit(npx.status ?? 1)
}

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step833.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-33/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`inspected: ${summary.inspected} scoped: ${summary.scoped_needs_review}`)
  console.log(`cleared/human: ${summary.auto_cleared}/${summary.human_review_remaining}`)
  console.log(`fingerprints: ${summary.fingerprints_written} embeddings: ${summary.embeddings_written}`)
}

if (argv.includes('--persist') || argv.includes('--probe-production')) {
  const probe = spawnSync(process.execPath, [path.join(root, 'scripts/probe-step833-production.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
  if ((probe.status ?? 1) !== 0) process.exit(probe.status ?? 1)
}

process.exit(0)
