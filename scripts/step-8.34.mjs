/**
 * STEP 8.34 — residual exception cleanup + pgvector search + reusable book pipeline.
 * Does not re-run STEP 8.32 or 8.33 from scratch. Never VERIFIED.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.34 EXCEPTIONS + VECTOR + BOOK PIPELINE')
console.log('Do not re-run STEP 8.32 or 8.33 ingest. Never VERIFIED.')

if (argv.includes('--help') || !argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  console.log('       --run --persist --probe-production')
  console.log('       npm run pipeline:book -- --dry-run --pdf=... --source-document-id=...')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const tests = spawnSync(
  process.execPath,
  [
    vitestCli,
    'run',
    'src/lib/ingestion/exceptionCleanup834.test.ts',
    'src/lib/ingestion/embeddings834.test.ts',
    'src/lib/ingestion/bookPipeline834.test.ts',
    'src/lib/ingestion/step834.run.test.ts',
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
    ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/step834Cli.ts'), ...runnerArgs],
    { cwd: root, stdio: 'inherit' },
  )
  if ((npx.status ?? 1) !== 0) process.exit(npx.status ?? 1)
}

const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-step834.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1)

const latest = path.join(root, 'ocr-tests/taxonomy/step8-34/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`status: ${summary.status}`)
  console.log(`residuals: ${summary.inspected_residuals} auto=${summary.auto_resolved} human=${summary.human_review_remaining}`)
  console.log(`embeddings: ${summary.embeddings?.written} model=${summary.embeddings?.model}`)
}

if (argv.includes('--persist') || argv.includes('--probe-production')) {
  const probe = spawnSync(process.execPath, [path.join(root, 'scripts/probe-step834-production.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
  if ((probe.status ?? 1) !== 0) process.exit(probe.status ?? 1)
}

process.exit(0)
