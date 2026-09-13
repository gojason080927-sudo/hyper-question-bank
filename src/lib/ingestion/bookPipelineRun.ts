/**
 * Reusable per-book pipeline CLI. Dry-run unless --persist is explicit.
 * Dry-run writes a book manifest only and does not clobber STEP 8.34 persist summaries.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runStep834 } from './step834Run'
import {
  BOOK_PIPELINE_STAGES,
  SSEN_BOOK_INPUT,
  dryRunWrites834,
  emptyProgress834,
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

const dir = path.join(process.cwd(), 'ocr-tests/taxonomy/step8-34')
mkdirSync(dir, { recursive: true })

if (!flags.persist) {
  const writes = dryRunWrites834(false, true)
  const manifest = {
    source_document_id: valid.value.source_document_id,
    title: valid.value.title,
    pages: { from: valid.value.from_page, to: valid.value.to_page },
    dry_run: true,
    persist: false,
    stages: [...BOOK_PIPELINE_STAGES],
    progress: emptyProgress834(),
    estimated_usd: 0,
    actual_usd: 0,
    paid_calls: { mistral_ocr: 0, mistral_embed: 0 },
    production_writes: writes.writes,
    extra_writes_on_rerun: writes.extra_on_rerun,
    cross_book_duplicates: 0,
    checkpoint: {
      source_document_id: valid.value.source_document_id,
      completed_stages: [...BOOK_PIPELINE_STAGES],
      completed_pages: Array.from(
        { length: valid.value.to_page - valid.value.from_page + 1 },
        (_, i) => valid.value.from_page + i,
      ),
      failed_pages: [],
      failed_items: [],
      items_ok: 0,
      dry_run: true,
    },
  }
  writeFileSync(path.join(dir, 'book-pipeline-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  console.log(
    `pipeline:book source=${valid.value.source_document_id} dry_run=true writes=${manifest.production_writes} extra=${manifest.extra_writes_on_rerun}`,
  )
  process.exit(0)
}

const summary = await runStep834(process.cwd(), ['--persist', '--probe-production'])
if (summary.pipeline) {
  writeFileSync(path.join(dir, 'book-pipeline-manifest.json'), JSON.stringify(summary.pipeline, null, 2), 'utf8')
}
console.log(
  `pipeline:book source=${valid.value.source_document_id} dry_run=${summary.pipeline?.dry_run} writes=${summary.pipeline?.production_writes} extra=${summary.pipeline?.extra_writes_on_rerun}`,
)
