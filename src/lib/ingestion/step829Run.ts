/**
 * STEP 8.29 runner — dual-AI review on cached STEP 8.28 / STEP 7 GT artifacts.
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
  EXPECTED_GT_COUNT,
  GT_PATH,
  STEP828_GT_SHA256,
  parseGtFile,
} from './structureFromCache828'
import {
  ASSIGNED_BY,
  STEP828_ITEMS_PATH,
  STEP829,
  STEP829_DIR,
  STEP829_DOCUMENT,
  STEP829_DOCUMENT_TITLE,
  STEP829_PAID_OCR_CAP,
  assertNoAutoApproved,
  assertNoGoldVerify,
  denyPaidOcr829,
  emptyDualInventory,
  evaluateDryRun,
  findDuplicateCandidateIds,
  findOrphanItems,
  findWrongSourceItems,
  progressFromItems,
  progressMatchesItems,
  projectStep829Targets,
  reviewCachedItem,
  tallyDual,
  tallyVerdicts,
  type DualInventory,
  type DualReviewRecord,
  type Step828CachedItem,
} from './dualAiReview829'

export type ProductionCounts = {
  queried: boolean
  reason: string
  drafts: number | null
  type_auto: number | null
  figure_assets: number | null
  figure_links: number | null
  pipeline_runs: number | null
  pipeline_items: number | null
}

export type Step829Summary = {
  step: '8.29'
  name: string
  status: 'CACHE_ONLY_BLOCKED' | 'CACHE_ONLY_REVIEWED'
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
  original_pdf: DualInventory['original_pdf']
  dry_run: ReturnType<typeof evaluateDryRun>
  items: DualReviewRecord[]
  progress: ReturnType<typeof progressFromItems>
  progress_matches_items: boolean
  dual: ReturnType<typeof tallyDual>
  duplicates: number
  orphans: number
  wrong_source: number
  gt_mutated: boolean
  content_rewrites: 0
  targets: ReturnType<typeof projectStep829Targets>
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
    return {
      queried: true,
      reason: 'read_only',
      drafts: await countExact(url, key, 'problems', { lifecycle_status: 'DRAFT' }),
      type_auto: await countExact(url, key, 'problem_classification_meta', {
        classification_status: 'AUTO',
      }),
      figure_assets: await countExact(url, key, 'problem_figure_assets'),
      figure_links: await countExact(url, key, 'problem_figure_links'),
      pipeline_runs: await countExact(url, key, 'pipeline_runs'),
      pipeline_items: await countExact(url, key, 'pipeline_items'),
    }
  } catch (error) {
    return skippedCounts(error instanceof Error ? error.message : 'probe_failed')
  }
}

function inventoryCaches(root: string): {
  inventory: DualInventory
  cached: Step828CachedItem[]
  gtItems: ReturnType<typeof parseGtFile>['items']
} {
  const inventory = emptyDualInventory()
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
  const itemsPath = path.join(root, STEP828_ITEMS_PATH)
  const gtPath = path.join(root, GT_PATH)
  let cached: Step828CachedItem[] = []
  if (existsSync(itemsPath)) {
    const parsed = JSON.parse(readFileSync(itemsPath, 'utf8')) as { items?: Step828CachedItem[] }
    cached = parsed.items ?? []
    inventory.step828_items_present = true
    inventory.step828_count = cached.length
  }
  if (!existsSync(gtPath)) return { inventory, cached, gtItems: [] }
  const raw = readFileSync(gtPath)
  const gtFile = parseGtFile(JSON.parse(raw.toString('utf8')))
  inventory.gt_present = true
  inventory.gt_count = gtFile.items.length
  inventory.gt_sha256 = createHash('sha256').update(raw).digest('hex')
  inventory.gt_sha256_after = inventory.gt_sha256
  return { inventory, cached, gtItems: gtFile.items }
}

export async function runStep829(root: string, argv: string[]): Promise<Step829Summary> {
  const gate = parsePaidGate(argv)
  if (argv.includes('--persist')) {
    throw new Error('STEP 8.29 forbids problem persist. Dual review is cache-only.')
  }
  if (argv.includes('--allow-paid-api') || gate.allowPaidApi) {
    throw new Error('STEP 8.29 forbids paid OCR')
  }
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) {
    throw new Error('paid OCR routing must stay false in STEP 8.29')
  }

  const { inventory, cached, gtItems } = inventoryCaches(root)
  const dryRun = evaluateDryRun({
    inventory,
    problemPersistRequested: false,
    paidApiRequested: false,
    mixedTextbook: inventory.original_pdf.is_second_book && inventory.original_pdf.substituted,
  })

  const executed = dryRun.pass
  const byId = new Map(gtItems.map((row) => [row.sample_id, row]))
  const items: DualReviewRecord[] = []
  if (executed) {
    for (const row of cached) {
      const gt = byId.get(row.candidate_id)
      if (!gt) {
        throw new Error(`STEP 8.29 missing GT for ${row.candidate_id}`)
      }
      items.push(reviewCachedItem(row, gt))
    }
    assertNoAutoApproved(items)
    assertNoGoldVerify(items)
  }

  const gtPath = path.join(root, GT_PATH)
  if (existsSync(gtPath)) {
    inventory.gt_sha256_after = sha256File(gtPath)
    inventory.mutated = inventory.gt_sha256_after !== inventory.gt_sha256
  }
  if (inventory.mutated) throw new Error('STEP 8.29 must not mutate ground-truth.json')

  const progress = progressFromItems(items)
  const dual = tallyDual(items)
  const targets = projectStep829Targets({
    dryRun,
    executed,
    originalPdfPresent: inventory.original_pdf.present,
    originalPdfIsSecondBook: inventory.original_pdf.is_second_book,
  })
  const results = tallyVerdicts(targets)
  denyPaidOcr829()

  const productionCounts = argv.includes('--probe-production')
    ? await probeProductionCounts()
    : skippedCounts('cache-only_no_probe')

  const summary: Step829Summary = {
    step: STEP829,
    name: 'Dual-AI review pilot on cached artifacts',
    status: executed ? 'CACHE_ONLY_REVIEWED' : 'CACHE_ONLY_BLOCKED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP829_DOCUMENT, title: STEP829_DOCUMENT_TITLE },
    executed,
    execution_count: executed ? 1 : 0,
    production_problem_writes: 0,
    production_figure_writes: 0,
    production_pipeline_writes: { runs: 0, items: 0 },
    production_draft_writes: 0,
    production_counts: productionCounts,
    paid_api_calls: { mathpix: 0, mistral: 0 },
    paid_ocr_cap: { max_calls: STEP829_PAID_OCR_CAP.maxCalls, max_usd: STEP829_PAID_OCR_CAP.maxUsd },
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: inventory.original_pdf,
    dry_run: dryRun,
    items,
    progress,
    progress_matches_items: progressMatchesItems(progress, items),
    dual,
    duplicates: findDuplicateCandidateIds(items).length,
    orphans: findOrphanItems(items, STEP829_DOCUMENT).length,
    wrong_source: findWrongSourceItems(items).length,
    gt_mutated: inventory.mutated,
    content_rewrites: 0,
    targets,
    results,
  }

  const dest = path.join(root, STEP829_DIR)
  mkdirSync(dest, { recursive: true })
  writeJson(dest, 'summary.json', {
    ...summary,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      stage: row.stage,
      status: row.status,
      reasons: row.reasons,
      page_number: row.page_number,
      problem_number: row.problem_number,
      agrees: row.agrees,
      dual_would_auto: row.dual_would_auto,
      checker_a: row.checker_a,
      checker_b: row.checker_b,
      diffs: row.diffs,
      upstream_status: row.upstream_status,
      content_fingerprint: row.content_fingerprint,
    })),
  })
  writeJson(dest, 'dry-run.json', dryRun)
  writeJson(dest, 'targets.json', { targets, second_document: SECOND_DOCUMENT })
  writeJson(dest, 'inventory.json', inventory)
  writeJson(dest, 'reviews.json', {
    assigned_by: ASSIGNED_BY,
    count: items.length,
    dual,
    items: summary.items.map((row) => ({
      candidate_id: row.candidate_id,
      status: row.status,
      agrees: row.agrees,
      dual_would_auto: row.dual_would_auto,
      checker_a: row.checker_a,
      checker_b: row.checker_b,
      diffs: row.diffs,
      reasons: row.reasons,
    })),
  })
  writeJson(dest, 'gt-lock.json', {
    path: GT_PATH,
    sha256: inventory.gt_sha256,
    sha256_after: inventory.gt_sha256_after,
    expected_sha256: STEP828_GT_SHA256,
    count: inventory.gt_count,
    expected_count: EXPECTED_GT_COUNT,
    mutated: inventory.mutated,
    step828_items: inventory.step828_count,
  })
  writeFileSync(
    path.join(dest, 'step8-29-summary.md'),
    `# STEP 8.29 DUAL-AI REVIEW ON CACHED ARTIFACTS

STEP 8.29 RESULT: ${summary.status}
NAME: ${summary.name}
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

textbook: ${STEP829_DOCUMENT_TITLE}
source_document_id: ${STEP829_DOCUMENT}
cached items: ${inventory.step828_count}
gt sha256: ${inventory.gt_sha256 ?? '(missing)'}
assigned_by: ${ASSIGNED_BY}

executed: ${executed}
execution count: ${summary.execution_count}
dry-run pass: ${dryRun.pass}
dry-run blockers: ${dryRun.blockers.join(', ') || '(none)'}

item total: ${items.length}
dual agree: ${dual.agree}
dual disagree: ${dual.disagree}
dual would AUTO (evidence only): ${dual.dual_would_auto}
progress auto_approved: ${progress.auto_approved}
progress human_review: ${progress.human_review}
progress blocked: ${progress.blocked}
progress matches items: ${summary.progress_matches_items}
duplicates: ${summary.duplicates}
orphans: ${summary.orphans}
wrong source: ${summary.wrong_source}
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

Do not implement STEP 8.30. Do not persist drafts. Do not call paid OCR.
Do not mix SECOND book ${SECOND_DOCUMENT}.
Do not process the full textbook.
Do not set AUTO_APPROVED or VERIFIED.
`,
    'utf8',
  )
  return summary
}
