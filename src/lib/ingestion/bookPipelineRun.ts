/**
 * Reusable per-book pipeline CLI. Dry-run unless --persist is explicit.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runStep834 } from './step834Run'
import {
  SSEN_BOOK_INPUT,
  parseBookPipelineFlags834,
  validateBookInput834,
} from './bookPipeline834'

const argv = process.argv.slice(2)
const flags = parseBookPipelineFlags834(argv)
const merged = { ...SSEN_BOOK_INPUT, ...flags.input }
const valid = validateBookInput834(merged)
if (!valid.ok || !valid.value) {
  console.error(`pipeline:book missing inputs: ${valid.reasons.join(', ')}`)
  console.error(
    'usage: npm run pipeline:book -- --dry-run --pdf=PATH --source-document-id=UUID --title=NAME --subject=SUB --curriculum=CUR --from-page=N --to-page=N --ocr-policy=cache-only',
  )
  process.exit(1)
}

if (valid.value.source_document_id !== SSEN_BOOK_INPUT.source_document_id && flags.persist) {
  console.error('STEP 8.34 refuses to persist a new textbook. Dry-run only for other books.')
  process.exit(1)
}

const runnerFlags = flags.persist
  ? ['--persist', '--probe-production', '--cache-only']
  : ['--cache-only', '--dry-run']
const summary = await runStep834(process.cwd(), runnerFlags)
const dir = path.join(process.cwd(), 'ocr-tests/taxonomy/step8-34')
mkdirSync(dir, { recursive: true })
if (summary.pipeline) {
  writeFileSync(path.join(dir, 'book-pipeline-manifest.json'), JSON.stringify(summary.pipeline, null, 2), 'utf8')
}
if (!existsSync(path.join(dir, 'summary.json'))) {
  console.error('pipeline:book did not write summary.json')
  process.exit(1)
}
console.log(
  `pipeline:book source=${valid.value.source_document_id} dry_run=${summary.pipeline?.dry_run} writes=${summary.pipeline?.production_writes} extra=${summary.pipeline?.extra_writes_on_rerun}`,
)
