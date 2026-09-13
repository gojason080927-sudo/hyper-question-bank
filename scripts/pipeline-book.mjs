/**
 * Reusable per-book pipeline entry. Dry-run unless --persist.
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const npx = spawnSync(
  'npx',
  ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/bookPipelineRun.ts'), ...argv],
  { cwd: root, stdio: 'inherit' },
)
process.exit(npx.status ?? 1)
