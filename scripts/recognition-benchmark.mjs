import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', 'src/lib/recognition/benchmark.test.ts'],
  { cwd: root, stdio: 'inherit', shell: false },
)
process.exit(result.status ?? 1)
