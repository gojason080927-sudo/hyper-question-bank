/**
 * STEP 8.23 — persist AUTO_FIGURE_SAFE figures via the 8.22 DB contract.
 * Default is cache-only projection + preflight. No paid OCR. No problem overwrite.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

console.log('STEP 8.23 FIGURE PERSISTENCE')
console.log('AUTO figures only. No paid OCR. No problem overwrite. No multimodal/print-edit.')

if (!argv.includes('--run')) {
  console.log('usage: --run --cache-only')
  process.exit(0)
}

const vitestCli = path.join(root, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', 'src/lib/ingestion/step823.run.test.ts', '--reporter=verbose'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HQB_BOOK_8_23: '1',
      HQB_8_23_ARGV: argv.filter((flag) => flag !== '--run').join(' ') || '--cache-only',
    },
  },
)
const latest = path.join(root, 'ocr-tests/taxonomy/step8-23/summary.json')
if (existsSync(latest)) {
  const summary = JSON.parse(readFileSync(latest, 'utf8'))
  console.log(`verdict: ${summary.verdict}`)
  console.log(`AUTO: ${summary.auto}`)
  console.log(`projected_assets: ${summary.projected_assets}`)
  console.log(`preflight_pass: ${summary.preflight_pass}`)
  console.log('manifest: ocr-tests/taxonomy/step8-23/step8-23-summary.md')
}
process.exit(result.status ?? 1)
