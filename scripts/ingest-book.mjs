/**
 * Next-book single command. Default dry-run. --apply writes.
 * --mode=complete runs hash→QA→CLASSIFY→status.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const npx = spawnSync('npx', ['--yes', 'tsx', path.join(root, 'src/lib/ingestion/bookCompleteCli.ts'), ...argv], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(npx.status ?? 1)
