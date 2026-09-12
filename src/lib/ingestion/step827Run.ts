/**
 * STEP 8.27 runner — cache-only batch segmentation dry-run.
 * Default: inventory + gates + artifacts. No paid OCR. No problem writes.
 * Production pipeline_runs/items are written only if dry-run PASSes and schema is confirmed.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { parsePaidGate } from '../ocr/paidGate'
import { compareCacheFileName } from '../ocr/ocrCompare'
import { MISTRAL_PROVIDER } from '../ocr/mathOcrTypes'
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
} from './batchPipeline825'
import {
  ASSIGNED_BY,
  LAYOUT_CACHE_PROFILE,
  REQUIRED_CACHE_PATHS,
  SECOND_DOCUMENT,
  SECOND_PDF_SHA256,
  SECOND_SAMPLE_LAYOUT,
  SECOND_SAMPLE_PAGES_DIR,
  SSEN_FIGURE_PAGES_DIR,
  STEP827,
  STEP827_DIR,
  STEP827_DOCUMENT,
  STEP827_DOCUMENT_TITLE,
  STEP827_PAID_OCR_CAP,
  denyPaidOcr827,
  emptyInventory,
  evaluateDryRun,
  isolated826ApplyAllowed,
  progressFromItems,
  progressMatchesItems,
  projectStep827Targets,
  tallyVerdicts,
  accessTokenUsable,
  type CacheInventory,
  type SchemaProbe,
  type SegmentPipelineItem,
} from './cacheSegment827'

export type Step827Summary = {
  step: '8.27'
  name: string
  status: 'CACHE_ONLY_BLOCKED' | 'CACHE_ONLY_EXECUTED'
  target_ref: string
  student_care_accessed: boolean
  next_step_started: false
  textbook: { id: string; title: string }
  executed: boolean
  execution_count: 0 | 1
  production_problem_writes: 0
  production_figure_writes: 0
  production_pipeline_writes: { runs: 0 | 1; items: number }
  schema_probe: SchemaProbe
  schema_write: { attempted: boolean; applied: boolean; reason: string }
  paid_api_calls: { mathpix: 0; mistral: 0 }
  paid_ocr_cap: { max_calls: 0; max_usd: 0 }
  frozen: typeof FROZEN_PIPELINE_COUNTS
  original_pdf: CacheInventory['original_pdf']
  dry_run: ReturnType<typeof evaluateDryRun>
  items: SegmentPipelineItem[]
  progress: ReturnType<typeof progressFromItems>
  progress_matches_items: boolean
  duplicates: number
  orphans: number
  wrong_source: number
  targets: ReturnType<typeof projectStep827Targets>
  results: { PASS: number; REVIEW: number; BLOCKED: number }
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort()
    .map((name) => path.join(dir, name))
}

function padPage(page: number): string {
  return String(page).padStart(3, '0')
}

function pagePngCandidates(root: string, page: number): string[] {
  return [
    path.join(root, REQUIRED_CACHE_PATHS.originalPages, `page-${padPage(page)}.png`),
    path.join(root, REQUIRED_CACHE_PATHS.bookPipelinePages, `page-${padPage(page)}.png`),
  ]
}

function inventoryCache(root: string): CacheInventory {
  const inventory = emptyInventory()
  inventory.candidates_present = existsSync(path.join(root, REQUIRED_CACHE_PATHS.candidates))
  inventory.mistral_dir_present = existsSync(path.join(root, REQUIRED_CACHE_PATHS.mistralDir))
  inventory.original_pages_present = existsSync(path.join(root, REQUIRED_CACHE_PATHS.originalPages))
  inventory.book_pipeline_pages_present = existsSync(path.join(root, REQUIRED_CACHE_PATHS.bookPipelinePages))
  inventory.ssen_figure_page_pngs = listPngs(path.join(root, SSEN_FIGURE_PAGES_DIR)).map((file) =>
    path.relative(root, file),
  )
  inventory.second_sample_page_pngs = listPngs(path.join(root, SECOND_SAMPLE_PAGES_DIR)).map((file) =>
    path.relative(root, file),
  )
  inventory.second_layout_present = existsSync(path.join(root, SECOND_SAMPLE_LAYOUT))

  const pageSet = new Set<number>()
  if (inventory.candidates_present) {
    try {
      const loaded = JSON.parse(readFileSync(path.join(root, REQUIRED_CACHE_PATHS.candidates), 'utf8')) as {
        candidates?: Array<{ page?: number; layout_kind?: string }>
      }
      for (const row of loaded.candidates ?? []) {
        if (typeof row.page === 'number' && row.layout_kind === 'PROBLEM') pageSet.add(row.page)
      }
    } catch {
      inventory.candidates_present = false
    }
  }
  for (const dir of [REQUIRED_CACHE_PATHS.originalPages, REQUIRED_CACHE_PATHS.bookPipelinePages]) {
    for (const file of listPngs(path.join(root, dir))) {
      const match = /page-(\d+)\.png$/i.exec(path.basename(file))
      if (match) pageSet.add(Number(match[1]))
    }
  }

  for (const page of [...pageSet].sort((a, b) => a - b)) {
    const pngPath = pagePngCandidates(root, page).find((file) => existsSync(file)) ?? null
    let layoutPath: string | null = null
    if (pngPath) {
      const sha = createHash('sha256').update(readFileSync(pngPath)).digest('hex')
      const named = path.join(
        root,
        REQUIRED_CACHE_PATHS.mistralDir,
        compareCacheFileName(MISTRAL_PROVIDER, sha, LAYOUT_CACHE_PROFILE),
      )
      if (existsSync(named)) layoutPath = named
    }
    const row = {
      page,
      png_path: pngPath ? path.relative(root, pngPath) : null,
      layout_cache_path: layoutPath ? path.relative(root, layoutPath) : null,
      hit: Boolean(pngPath && layoutPath),
      book: 'SSEN' as const,
    }
    if (row.hit) inventory.layout_hits.push(row)
    else inventory.layout_misses.push(row)
  }

  const secondNamed = path.join(root, 'second-common-math1.pdf')
  if (existsSync(secondNamed)) {
    const hash = createHash('sha256').update(readFileSync(secondNamed)).digest('hex')
    inventory.original_pdf = {
      present: true,
      path: path.relative(root, secondNamed),
      sha256: hash,
      is_second_book: hash === SECOND_PDF_SHA256,
      substituted: false,
    }
  }

  return inventory
}

function skippedSchemaProbe(reason: string): SchemaProbe {
  const isolated = isolated826ApplyAllowed(null)
  return {
    queried: false,
    present: null,
    reason,
    tables: { pipeline_runs: null, pipeline_items: null },
    rpcs: {
      hqb_start_pipeline_run: null,
      hqb_upsert_pipeline_item: null,
      hqb_pipeline_progress_from_items: null,
    },
    isolated_826_apply_allowed: isolated.allowed,
    isolated_826_apply_reason: isolated.reason,
  }
}

async function probeProductionSchema(): Promise<SchemaProbe> {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')

  const access = process.env.SUPABASE_ACCESS_TOKEN
  if (!accessTokenUsable(access)) {
    return skippedSchemaProbe('SUPABASE_ACCESS_TOKEN_MISSING')
  }

  const token = access!.trim()
  const mgmt = await fetch(`https://api.supabase.com/v1/projects/${QUESTION_BANK_REF}/database/migrations`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!mgmt.ok) {
    const isolated = isolated826ApplyAllowed(null)
    return {
      queried: true,
      present: null,
      reason: `management_http_${mgmt.status}`,
      tables: { pipeline_runs: null, pipeline_items: null },
      rpcs: {
        hqb_start_pipeline_run: null,
        hqb_upsert_pipeline_item: null,
        hqb_pipeline_progress_from_items: null,
      },
      isolated_826_apply_allowed: isolated.allowed,
      isolated_826_apply_reason: isolated.reason,
    }
  }
  const rows = (await mgmt.json()) as Array<{ version?: string }>
  const versions = rows.map((row) => String(row.version ?? ''))
  const applied = versions.includes('20260912120000')
  const pending = applied ? [] : ['20260912120000']
  const isolatedNow = isolated826ApplyAllowed(applied ? [] : pending)
  return {
    queried: true,
    present: applied,
    reason: applied ? 'migration_history_has_20260912120000' : 'migration_not_in_history',
    tables: { pipeline_runs: applied, pipeline_items: applied },
    rpcs: {
      hqb_start_pipeline_run: applied,
      hqb_upsert_pipeline_item: applied,
      hqb_pipeline_progress_from_items: applied,
    },
    isolated_826_apply_allowed: isolatedNow.allowed,
    isolated_826_apply_reason: isolatedNow.reason,
  }
}

export async function runStep827(root: string, argv: string[]): Promise<Step827Summary> {
  const gate = parsePaidGate(argv)
  if (argv.includes('--persist') && !argv.includes('--persist-pipeline')) {
    throw new Error('STEP 8.27 forbids problem persist')
  }
  if (argv.includes('--allow-paid-api') || gate.allowPaidApi) {
    throw new Error('STEP 8.27 forbids paid OCR')
  }
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) {
    throw new Error('paid OCR routing must stay false in STEP 8.27')
  }

  const inventory = inventoryCache(root)
  const schema = argv.includes('--probe-production')
    ? await probeProductionSchema()
    : skippedSchemaProbe('cache-only_no_probe')
  const dryRun = evaluateDryRun({
    inventory,
    schema,
    problemPersistRequested: argv.includes('--persist') && !argv.includes('--persist-pipeline'),
    paidApiRequested: false,
    mixedTextbook: false,
  })

  const executed = false
  const items: SegmentPipelineItem[] = []
  const progress = progressFromItems(items)
  const targets = projectStep827Targets({
    dryRun,
    schemaPresent: schema.present,
    executed,
    originalPdfPresent: inventory.original_pdf.present,
    originalPdfIsSecondBook: inventory.original_pdf.is_second_book,
  })
  const results = tallyVerdicts(targets)
  denyPaidOcr827()

  const summary: Step827Summary = {
    step: STEP827,
    name: 'Cache-only batch segmentation on one already-stored textbook',
    status: executed ? 'CACHE_ONLY_EXECUTED' : 'CACHE_ONLY_BLOCKED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP827_DOCUMENT, title: STEP827_DOCUMENT_TITLE },
    executed,
    execution_count: 0,
    production_problem_writes: 0,
    production_figure_writes: 0,
    production_pipeline_writes: { runs: 0, items: 0 },
    schema_probe: schema,
    schema_write: {
      attempted: false,
      applied: schema.present === true,
      reason:
        schema.present === true
          ? 'already_on_production_do_not_reapply'
          : schema.isolated_826_apply_allowed
            ? 'isolated_apply_allowed_not_run_from_cache_only_runner'
            : schema.isolated_826_apply_reason,
    },
    paid_api_calls: { mathpix: 0, mistral: 0 },
    paid_ocr_cap: { max_calls: STEP827_PAID_OCR_CAP.maxCalls, max_usd: STEP827_PAID_OCR_CAP.maxUsd },
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: inventory.original_pdf,
    dry_run: dryRun,
    items,
    progress,
    progress_matches_items: progressMatchesItems(progress, items),
    duplicates: 0,
    orphans: 0,
    wrong_source: 0,
    targets,
    results,
  }

  const dest = path.join(root, STEP827_DIR)
  mkdirSync(dest, { recursive: true })
  writeJson(dest, 'summary.json', summary)
  writeJson(dest, 'dry-run.json', dryRun)
  writeJson(dest, 'targets.json', { targets, excluded: dryRun.excluded, second_document: SECOND_DOCUMENT })
  writeJson(dest, 'inventory.json', inventory)
  writeFileSync(
    path.join(dest, 'step8-27-summary.md'),
    `# STEP 8.27 CACHE-ONLY SEGMENTATION

STEP 8.27 RESULT: ${summary.status}
NAME: ${summary.name}
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

textbook: ${STEP827_DOCUMENT_TITLE}
source_document_id: ${STEP827_DOCUMENT}
cache profile: ${LAYOUT_CACHE_PROFILE}
assigned_by: ${ASSIGNED_BY}

executed: ${executed}
execution count: 0
dry-run pass: ${dryRun.pass}
dry-run blockers: ${dryRun.blockers.join(', ') || '(none)'}

input pages (layout cache SSEN): ${dryRun.input_pages}
cache hits: ${dryRun.cache_hits}
cache misses: ${dryRun.cache_misses}
segment targets: ${dryRun.segment_targets}
expected pipeline_runs: ${dryRun.expected_pipeline_runs}
expected pipeline_items: ${dryRun.expected_pipeline_items}

Production pipeline writes: runs=${summary.production_pipeline_writes.runs} items=${summary.production_pipeline_writes.items}
production problem writes: 0
production figure writes: 0
schema probed: ${schema.queried}
schema present: ${String(schema.present)}
schema probe reason: ${schema.reason}
schema apply attempted: false
schema apply applied: false
isolated 8.26 apply allowed: ${schema.isolated_826_apply_allowed}
isolated 8.26 apply reason: ${schema.isolated_826_apply_reason}

item total: ${items.length}
progress total: ${progress.total}
progress auto_approved: ${progress.auto_approved}
progress human_review: ${progress.human_review}
progress blocked: ${progress.blocked}
progress failed: ${progress.failed}
progress matches items: ${summary.progress_matches_items}
duplicates: 0
orphans: 0
wrong source: 0

PASS: ${results.PASS}
REVIEW: ${results.REVIEW}
BLOCKED: ${results.BLOCKED}

frozen drafts: ${FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts}
frozen type AUTO: ${FROZEN_PIPELINE_COUNTS.frozenTypeAuto}
implied remainder: ${FROZEN_PIPELINE_COUNTS.impliedNonTypeAuto}
STEP 8.23 figures: ${FROZEN_PIPELINE_COUNTS.step823FigureAssets}/${FROZEN_PIPELINE_COUNTS.step823FigureLinks}
STEP 8.24 blocked carry-over: ${FROZEN_PIPELINE_COUNTS.step824BlockedRemaining}

paid OCR mathpix/mistral: 0/0
paid OCR cap: 0 / $0
original PDF present: ${inventory.original_pdf.present}
original PDF is SECOND book: ${inventory.original_pdf.is_second_book}
original PDF substituted: false
original PDF required for cache-only: false

Do not implement STEP 8.28. Do not persist problems. Do not call paid OCR.
Do not mix SECOND book ${SECOND_DOCUMENT}.
`,
    'utf8',
  )
  return summary
}
