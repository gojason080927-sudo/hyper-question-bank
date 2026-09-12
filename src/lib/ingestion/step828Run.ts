/**
 * STEP 8.28 runner — structure from existing STEP 7 OCR/GT.
 * Default: inventory + gates + local artifacts. No paid OCR. No problem/draft writes.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { parsePaidGate } from '../ocr/paidGate'
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
} from './batchPipeline825'
import { SECOND_DOCUMENT, SECOND_PDF_SHA256 } from './cacheSegment827'
import {
  ASSIGNED_BY,
  EXPECTED_GT_COUNT,
  GT_PATH,
  MANIFEST_PATH,
  STEP828,
  STEP828_DIR,
  STEP828_DOCUMENT,
  STEP828_DOCUMENT_TITLE,
  STEP828_GT_SHA256,
  STEP828_PAID_OCR_CAP,
  assertDraftPersistFrozenOff,
  assertNoAutoApproved,
  assertNoContentRewrite,
  denyPaidOcr828,
  emptyGtInventory,
  evaluateDryRun,
  findDuplicateCandidateIds,
  findOrphanItems,
  findWrongSourceItems,
  mapGtToPipeline,
  parseGtFile,
  progressFromItems,
  progressMatchesItems,
  projectStep828Targets,
  tallyVerdicts,
  type GtInventory,
  type StructurePipelineItem,
} from './structureFromCache828'

export type ProductionCounts = {
  queried: boolean
  reason: string
  drafts: number | null
  type_auto: number | null
  figure_assets: number | null
  figure_links: number | null
  pipeline_runs: number | null
  pipeline_items: number | null
  recognition_results_ssen: number | null
}

export type Step828Summary = {
  step: '8.28'
  name: string
  status: 'CACHE_ONLY_BLOCKED' | 'CACHE_ONLY_STRUCTURED'
  target_ref: string
  student_care_accessed: boolean
  next_step_started: false
  textbook: { id: string; title: string }
  executed: boolean
  execution_count: 0 | 1
  production_problem_writes: 0
  production_figure_writes: 0
  production_pipeline_writes: { runs: 0; items: 0 }
  production_draft_writes: 0
  production_counts: ProductionCounts
  paid_api_calls: { mathpix: 0; mistral: 0 }
  paid_ocr_cap: { max_calls: 0; max_usd: 0 }
  frozen: typeof FROZEN_PIPELINE_COUNTS
  original_pdf: GtInventory['original_pdf']
  dry_run: ReturnType<typeof evaluateDryRun>
  items: StructurePipelineItem[]
  progress: ReturnType<typeof progressFromItems>
  progress_matches_items: boolean
  duplicates: number
  orphans: number
  wrong_source: number
  gt_mutated: boolean
  content_rewrites: 0
  targets: ReturnType<typeof projectStep828Targets>
  results: { PASS: number; REVIEW: number; BLOCKED: number }
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function skippedCounts(reason: string): ProductionCounts {
  return {
    queried: false,
    reason,
    drafts: null,
    type_auto: null,
    figure_assets: null,
    figure_links: null,
    pipeline_runs: null,
    pipeline_items: null,
    recognition_results_ssen: null,
  }
}

async function countExact(
  url: string,
  key: string,
  table: string,
  filter?: Record<string, string>,
): Promise<number> {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter ?? {})) q = q.eq(column, value)
  const result = await q
  if (result.error) throw new Error(`${table} count: ${result.error.message}`)
  return result.count ?? 0
}

async function probeProductionCounts(): Promise<ProductionCounts> {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) return skippedCounts('SUPABASE_SERVICE_ROLE_KEY_MISSING')
  try {
    const drafts = await countExact(url, key, 'problems', { lifecycle_status: 'DRAFT' })
    const typeAuto = await countExact(url, key, 'problem_classification_meta', {
      classification_status: 'AUTO',
    })
    const figureAssets = await countExact(url, key, 'problem_figure_assets')
    const figureLinks = await countExact(url, key, 'problem_figure_links')
    const pipelineRuns = await countExact(url, key, 'pipeline_runs')
    const pipelineItems = await countExact(url, key, 'pipeline_items')
    const recognition = await countExact(url, key, 'recognition_results', {
      source_document_id: STEP828_DOCUMENT,
    })
    return {
      queried: true,
      reason: 'read_only',
      drafts,
      type_auto: typeAuto,
      figure_assets: figureAssets,
      figure_links: figureLinks,
      pipeline_runs: pipelineRuns,
      pipeline_items: pipelineItems,
      recognition_results_ssen: recognition,
    }
  } catch (error) {
    return skippedCounts(error instanceof Error ? error.message : 'probe_failed')
  }
}

function inventoryGt(root: string): { inventory: GtInventory; items: ReturnType<typeof parseGtFile>['items'] } {
  const inventory = emptyGtInventory()
  const gtPath = path.join(root, GT_PATH)
  const secondNamed = path.join(root, 'second-common-math1.pdf')
  if (existsSync(secondNamed)) {
    const hash = sha256File(secondNamed)
    inventory.original_pdf = {
      present: true,
      path: path.relative(root, secondNamed),
      sha256: hash,
      is_second_book: hash === SECOND_PDF_SHA256,
      substituted: false,
    }
  }
  if (!existsSync(gtPath)) return { inventory, items: [] }
  const raw = readFileSync(gtPath)
  const parsed = parseGtFile(JSON.parse(raw.toString('utf8')))
  inventory.present = true
  inventory.count = parsed.items.length
  inventory.document_id = parsed.document_id
  inventory.sha256 = createHash('sha256').update(raw).digest('hex')
  inventory.sha256_after = inventory.sha256
  return { inventory, items: parsed.items }
}

export async function runStep828(root: string, argv: string[]): Promise<Step828Summary> {
  const gate = parsePaidGate(argv)
  if (argv.includes('--persist')) {
    throw new Error('STEP 8.28 forbids problem persist. Drafts are frozen off.')
  }
  if (argv.includes('--allow-paid-api') || gate.allowPaidApi) {
    throw new Error('STEP 8.28 forbids paid OCR')
  }
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) {
    throw new Error('paid OCR routing must stay false in STEP 8.28')
  }

  const { inventory, items: gtItems } = inventoryGt(root)
  const dryRun = evaluateDryRun({
    inventory,
    problemPersistRequested: false,
    paidApiRequested: false,
    mixedTextbook: inventory.original_pdf.is_second_book && inventory.original_pdf.substituted,
  })

  const executed = dryRun.pass
  const items: StructurePipelineItem[] = executed ? gtItems.map((row) => mapGtToPipeline(row)) : []
  if (executed) {
    assertNoAutoApproved(items)
    assertDraftPersistFrozenOff(items)
    assertNoContentRewrite(items, gtItems)
  }

  const gtPath = path.join(root, GT_PATH)
  if (existsSync(gtPath)) {
    inventory.sha256_after = sha256File(gtPath)
    inventory.mutated = inventory.sha256_after !== inventory.sha256
  }
  if (inventory.mutated) throw new Error('STEP 8.28 must not mutate ground-truth.json')

  const progress = progressFromItems(items)
  const targets = projectStep828Targets({
    dryRun,
    executed,
    originalPdfPresent: inventory.original_pdf.present,
    originalPdfIsSecondBook: inventory.original_pdf.is_second_book,
  })
  const results = tallyVerdicts(targets)
  denyPaidOcr828()

  const productionCounts = argv.includes('--probe-production')
    ? await probeProductionCounts()
    : skippedCounts('cache-only_no_probe')

  const duplicates = findDuplicateCandidateIds(items).length
  const orphans = findOrphanItems(items, STEP828_DOCUMENT).length
  const wrongSource = findWrongSourceItems(items).length

  const summary: Step828Summary = {
    step: STEP828,
    name: 'Structure stem/choices/answer/explanation from existing OCR/GT only',
    status: executed ? 'CACHE_ONLY_STRUCTURED' : 'CACHE_ONLY_BLOCKED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP828_DOCUMENT, title: STEP828_DOCUMENT_TITLE },
    executed,
    execution_count: executed ? 1 : 0,
    production_problem_writes: 0,
    production_figure_writes: 0,
    production_pipeline_writes: { runs: 0, items: 0 },
    production_draft_writes: 0,
    production_counts: productionCounts,
    paid_api_calls: { mathpix: 0, mistral: 0 },
    paid_ocr_cap: { max_calls: STEP828_PAID_OCR_CAP.maxCalls, max_usd: STEP828_PAID_OCR_CAP.maxUsd },
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: inventory.original_pdf,
    dry_run: dryRun,
    items,
    progress,
    progress_matches_items: progressMatchesItems(progress, items),
    duplicates,
    orphans,
    wrong_source: wrongSource,
    gt_mutated: inventory.mutated,
    content_rewrites: 0,
    targets,
    results,
  }

  const dest = path.join(root, STEP828_DIR)
  mkdirSync(dest, { recursive: true })
  writeJson(dest, 'summary.json', {
    ...summary,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      stage: row.stage,
      status: row.status,
      reasons: row.reasons,
      source_document_id: row.source_document_id,
      page_number: row.page_number,
      problem_number: row.problem_number,
      choice_count: row.choices.length,
      answer_candidate: row.answer_candidate,
      explanation: row.explanation,
      has_figure: row.has_figure,
      has_table: row.has_table,
      content_fingerprint: row.content_fingerprint,
    })),
  })
  writeJson(dest, 'dry-run.json', dryRun)
  writeJson(dest, 'targets.json', { targets, excluded: dryRun.excluded, second_document: SECOND_DOCUMENT })
  writeJson(dest, 'inventory.json', inventory)
  writeJson(dest, 'items.json', {
    assigned_by: ASSIGNED_BY,
    count: items.length,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      page_number: row.page_number,
      problem_number: row.problem_number,
      status: row.status,
      reasons: row.reasons,
      choice_count: row.choices.length,
      answer_candidate: row.answer_candidate,
      explanation: row.explanation,
      content_fingerprint: row.content_fingerprint,
    })),
  })
  if (existsSync(path.join(root, MANIFEST_PATH))) {
    const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')) as {
      sample_count?: number
      ground_truth_file?: string
    }
    writeJson(dest, 'gt-lock.json', {
      path: GT_PATH,
      sha256: inventory.sha256,
      sha256_after: inventory.sha256_after,
      expected_sha256: STEP828_GT_SHA256,
      count: inventory.count,
      expected_count: EXPECTED_GT_COUNT,
      manifest_sample_count: manifest.sample_count ?? null,
      mutated: inventory.mutated,
    })
  }
  writeFileSync(
    path.join(dest, 'step8-28-summary.md'),
    `# STEP 8.28 STRUCTURE FROM EXISTING OCR/GT

STEP 8.28 RESULT: ${summary.status}
NAME: ${summary.name}
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

textbook: ${STEP828_DOCUMENT_TITLE}
source_document_id: ${STEP828_DOCUMENT}
gt path: ${GT_PATH}
gt sha256: ${inventory.sha256 ?? '(missing)'}
assigned_by: ${ASSIGNED_BY}

executed: ${executed}
execution count: ${summary.execution_count}
dry-run pass: ${dryRun.pass}
dry-run blockers: ${dryRun.blockers.join(', ') || '(none)'}

structure targets: ${dryRun.structure_targets}
item total: ${items.length}
progress total: ${progress.total}
progress auto_approved: ${progress.auto_approved}
progress human_review: ${progress.human_review}
progress blocked: ${progress.blocked}
progress failed: ${progress.failed}
progress matches items: ${summary.progress_matches_items}
duplicates: ${duplicates}
orphans: ${orphans}
wrong source: ${wrongSource}
gt mutated: ${inventory.mutated}
content rewrites: 0

Production pipeline writes: runs=0 items=0
production problem writes: 0
production figure writes: 0
production draft writes: 0
production counts probed: ${productionCounts.queried}
production counts reason: ${productionCounts.reason}

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

Do not implement STEP 8.29. Do not persist drafts. Do not call paid OCR.
Do not mix SECOND book ${SECOND_DOCUMENT}.
Do not process the full textbook.
`,
    'utf8',
  )
  return summary
}
