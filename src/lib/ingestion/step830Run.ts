/**
 * STEP 8.30 runner — original-image compare on cached STEP 8.28 / 8.29 / STEP 7 crops.
 * Default: inventory + gates + local artifacts. No paid OCR. No problem/draft writes.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { parsePaidGate } from '../ocr/paidGate'
import { hasMistralCredentials } from '../ocr/mistralSecrets'
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
} from './batchPipeline825'
import { SECOND_DOCUMENT, SECOND_PDF_SHA256, SECOND_SAMPLE_PAGES_DIR } from './cacheSegment827'
import {
  EXPECTED_GT_COUNT,
  GT_PATH,
  MANIFEST_PATH,
  STEP828_GT_SHA256,
  parseGtFile,
} from './structureFromCache828'
import {
  ASSIGNED_BY,
  SSEN_FIGURE_CROPS_DIR,
  STEP828_ITEMS_PATH,
  STEP829_REVIEWS_PATH,
  STEP830,
  STEP830_DIR,
  STEP830_DOCUMENT,
  STEP830_DOCUMENT_TITLE,
  STEP830_PAID_OCR_CAP,
  assertNoAutoApprovedUnlessSectionD,
  assertNoContentRewrite,
  assertNoGoldVerify,
  bookPipelinePagePngPath,
  compareCachedItem,
  denyPaidOcr830,
  emptyCompareInventory,
  emptyFileEvidence,
  evaluateDryRun,
  findDuplicateCandidateIds,
  findOrphanItems,
  findWrongSourceItems,
  originalPagePngPath,
  parseManifestFile,
  progressFromItems,
  progressMatchesItems,
  projectStep830Targets,
  ssenPagePngPath,
  step7CropPath,
  tallyCompare,
  tallyVerdicts,
  type FileEvidence,
  type ImageCompareRecord,
  type ManifestSample,
  type Step829ReviewInput,
} from './imageCompare830'
import type { Step828CachedItem } from './dualAiReview829'

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

export type Step830Summary = {
  step: '8.30'
  name: string
  status: 'CACHE_ONLY_BLOCKED' | 'CACHE_ONLY_COMPARED'
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
  mistral_credentials: 'PRESENT' | 'ABSENT'
  frozen: typeof FROZEN_PIPELINE_COUNTS
  original_pdf: ReturnType<typeof emptyCompareInventory>['original_pdf']
  dry_run: ReturnType<typeof evaluateDryRun>
  items: ImageCompareRecord[]
  progress: ReturnType<typeof progressFromItems>
  progress_matches_items: boolean
  compare: ReturnType<typeof tallyCompare>
  duplicates: number
  orphans: number
  wrong_source: number
  gt_mutated: boolean
  content_rewrites: 0
  targets: ReturnType<typeof projectStep830Targets>
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

function listPngCount(dirPath: string): number {
  if (!existsSync(dirPath)) return 0
  return readdirSync(dirPath).filter((name) => name.toLowerCase().endsWith('.png')).length
}

function inventoryCrop(root: string, sample: ManifestSample): FileEvidence {
  const relative = step7CropPath(sample.crop_file)
  const abs = path.join(root, relative)
  if (!existsSync(abs)) return emptyFileEvidence()
  const bytes = readFileSync(abs)
  const sha = createHash('sha256').update(bytes).digest('hex')
  return {
    present: true,
    path: relative,
    sha256: sha,
    bytes: bytes.length,
    sha256_match: sha === sample.crop_sha256 && bytes.length === sample.crop_bytes,
    substituted: false,
    used_as_crop: true,
    source_kind: 'step7_crop',
  }
}

function inventoryPagePng(root: string, page: number): FileEvidence {
  const candidates: Array<{ relative: string; kind: FileEvidence['source_kind'] }> = [
    { relative: originalPagePngPath(page), kind: 'original_page' },
    { relative: bookPipelinePagePngPath(page), kind: 'book_pipeline_page' },
    { relative: ssenPagePngPath(page), kind: 'ssen_figure_page' },
  ]
  for (const row of candidates) {
    const abs = path.join(root, row.relative)
    if (!existsSync(abs)) continue
    const bytes = readFileSync(abs)
    return {
      present: true,
      path: row.relative,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      sha256_match: null,
      substituted: false,
      used_as_crop: false,
      source_kind: row.kind,
    }
  }
  return emptyFileEvidence()
}

function inventoryCaches(root: string): {
  inventory: ReturnType<typeof emptyCompareInventory>
  cached: Step828CachedItem[]
  reviews: Step829ReviewInput[]
  gtItems: ReturnType<typeof parseGtFile>['items']
  samples: ManifestSample[]
} {
  const inventory = emptyCompareInventory()
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
  inventory.figure_crops_inventoried = listPngCount(path.join(root, SSEN_FIGURE_CROPS_DIR))
  inventory.second_pages_inventoried = listPngCount(path.join(root, SECOND_SAMPLE_PAGES_DIR))

  const itemsPath = path.join(root, STEP828_ITEMS_PATH)
  const reviewsPath = path.join(root, STEP829_REVIEWS_PATH)
  const gtPath = path.join(root, GT_PATH)
  const manifestPath = path.join(root, MANIFEST_PATH)
  let cached: Step828CachedItem[] = []
  let reviews: Step829ReviewInput[] = []
  let samples: ManifestSample[] = []

  if (existsSync(itemsPath)) {
    const parsed = JSON.parse(readFileSync(itemsPath, 'utf8')) as { items?: Step828CachedItem[] }
    cached = parsed.items ?? []
    inventory.step828_items_present = true
    inventory.step828_count = cached.length
  }
  if (existsSync(reviewsPath)) {
    const parsed = JSON.parse(readFileSync(reviewsPath, 'utf8')) as { items?: Step829ReviewInput[] }
    reviews = parsed.items ?? []
    inventory.step829_reviews_present = true
    inventory.step829_count = reviews.length
  }
  if (existsSync(manifestPath)) {
    const parsed = parseManifestFile(JSON.parse(readFileSync(manifestPath, 'utf8')))
    samples = parsed.samples
    inventory.manifest_present = true
    inventory.manifest_count = samples.length
  }
  if (!existsSync(gtPath)) return { inventory, cached, reviews, gtItems: [], samples }
  const raw = readFileSync(gtPath)
  const gtFile = parseGtFile(JSON.parse(raw.toString('utf8')))
  inventory.gt_present = true
  inventory.gt_count = gtFile.items.length
  inventory.gt_sha256 = createHash('sha256').update(raw).digest('hex')
  inventory.gt_sha256_after = inventory.gt_sha256
  return { inventory, cached, reviews, gtItems: gtFile.items, samples }
}

export async function runStep830(root: string, argv: string[]): Promise<Step830Summary> {
  const gate = parsePaidGate(argv)
  if (argv.includes('--persist')) {
    throw new Error('STEP 8.30 forbids problem persist. Image compare is cache-only.')
  }
  if (argv.includes('--allow-paid-api') || gate.allowPaidApi) {
    throw new Error('STEP 8.30 forbids paid OCR')
  }
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) {
    throw new Error('paid OCR routing must stay false in STEP 8.30')
  }

  const { inventory, cached, reviews, gtItems, samples } = inventoryCaches(root)
  const dryRun = evaluateDryRun({
    inventory,
    problemPersistRequested: false,
    paidApiRequested: false,
    mixedTextbook: inventory.original_pdf.is_second_book && inventory.original_pdf.substituted,
  })

  const executed = dryRun.pass
  const gtById = new Map(gtItems.map((row) => [row.sample_id, row]))
  const reviewById = new Map(reviews.map((row) => [row.candidate_id, row]))
  const sampleById = new Map(samples.map((row) => [row.sample_id, row]))
  const siblingsByPage = new Map<number, ManifestSample[]>()
  for (const sample of samples) {
    const list = siblingsByPage.get(sample.page_number) ?? []
    list.push(sample)
    siblingsByPage.set(sample.page_number, list)
  }

  const items: ImageCompareRecord[] = []
  if (executed) {
    for (const row of cached) {
      const gt = gtById.get(row.candidate_id)
      const review = reviewById.get(row.candidate_id)
      const sample = sampleById.get(row.candidate_id)
      if (!gt) throw new Error(`STEP 8.30 missing GT for ${row.candidate_id}`)
      if (!review) throw new Error(`STEP 8.30 missing STEP 8.29 review for ${row.candidate_id}`)
      if (!sample) throw new Error(`STEP 8.30 missing manifest sample for ${row.candidate_id}`)
      const siblings = (siblingsByPage.get(sample.page_number) ?? [])
        .filter((other) => other.sample_id !== sample.sample_id)
        .map((other) => other.bbox)
      items.push(
        compareCachedItem({
          cached: row,
          review,
          gt,
          sample,
          crop: inventoryCrop(root, sample),
          pagePng: inventoryPagePng(root, sample.page_number),
          siblingBboxes: siblings,
        }),
      )
    }
    assertNoAutoApprovedUnlessSectionD(items)
    assertNoGoldVerify(items)
    assertNoContentRewrite(items, gtById)
  }

  const gtPath = path.join(root, GT_PATH)
  if (existsSync(gtPath)) {
    inventory.gt_sha256_after = sha256File(gtPath)
    inventory.mutated = inventory.gt_sha256_after !== inventory.gt_sha256
  }
  if (inventory.mutated) throw new Error('STEP 8.30 must not mutate ground-truth.json')

  const compare = tallyCompare(items)
  inventory.crop_present = compare.crop_present
  inventory.crop_missing = compare.crop_missing
  inventory.page_png_present = compare.page_png_present
  inventory.page_png_missing = compare.page_png_missing

  const progress = progressFromItems(items)
  const targets = projectStep830Targets({
    dryRun,
    executed,
    originalPdfPresent: inventory.original_pdf.present,
    originalPdfIsSecondBook: inventory.original_pdf.is_second_book,
    cropPresent: compare.crop_present,
  })
  const results = tallyVerdicts(targets)
  denyPaidOcr830()

  const productionCounts = argv.includes('--probe-production')
    ? await probeProductionCounts()
    : skippedCounts('cache-only_no_probe')

  const mistralCredentials = hasMistralCredentials() ? 'PRESENT' : 'ABSENT'

  const summary: Step830Summary = {
    step: STEP830,
    name: 'Original-image compare gate on cached crops',
    status: executed ? 'CACHE_ONLY_COMPARED' : 'CACHE_ONLY_BLOCKED',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    next_step_started: false,
    textbook: { id: STEP830_DOCUMENT, title: STEP830_DOCUMENT_TITLE },
    executed,
    execution_count: executed ? 1 : 0,
    production_problem_writes: 0,
    production_figure_writes: 0,
    production_pipeline_writes: { runs: 0, items: 0 },
    production_draft_writes: 0,
    production_counts: productionCounts,
    paid_api_calls: { mathpix: 0, mistral: 0 },
    paid_ocr_cap: { max_calls: STEP830_PAID_OCR_CAP.maxCalls, max_usd: STEP830_PAID_OCR_CAP.maxUsd },
    mistral_credentials: mistralCredentials,
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: inventory.original_pdf,
    dry_run: dryRun,
    items,
    progress,
    progress_matches_items: progressMatchesItems(progress, items),
    compare,
    duplicates: findDuplicateCandidateIds(items).length,
    orphans: findOrphanItems(items, STEP830_DOCUMENT).length,
    wrong_source: findWrongSourceItems(items).length,
    gt_mutated: inventory.mutated,
    content_rewrites: 0,
    targets,
    results,
  }

  const dest = path.join(root, STEP830_DIR)
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
      crop: row.crop,
      page_png: {
        present: row.page_png.present,
        path: row.page_png.path,
        bytes: row.page_png.bytes,
        used_as_crop: row.page_png.used_as_crop,
        source_kind: row.page_png.source_kind,
        substituted: row.page_png.substituted,
      },
      bbox_valid: row.bbox_valid,
      declared_bbox_overlap: row.declared_bbox_overlap,
      checks: row.checks,
      compared: row.compared,
      image_compare_pass: row.image_compare_pass,
      dual_agrees: row.dual_agrees,
      dual_would_auto: row.dual_would_auto,
      upstream_status: row.upstream_status,
      dual_status: row.dual_status,
      has_figure: row.has_figure,
      has_table: row.has_table,
      choice_count: row.choice_count,
      content_fingerprint: row.content_fingerprint,
    })),
  })
  writeJson(dest, 'dry-run.json', dryRun)
  writeJson(dest, 'targets.json', { targets, second_document: SECOND_DOCUMENT })
  writeJson(dest, 'inventory.json', inventory)
  writeJson(dest, 'compares.json', {
    assigned_by: ASSIGNED_BY,
    count: items.length,
    compare,
    items: items.map((row) => ({
      candidate_id: row.candidate_id,
      status: row.status,
      reasons: row.reasons,
      crop_present: row.crop.present && row.crop.used_as_crop,
      page_png_present: row.page_png.present,
      page_png_used_as_crop: row.page_png.used_as_crop,
      compared: row.compared,
      image_compare_pass: row.image_compare_pass,
      checks: row.checks,
      dual_would_auto: row.dual_would_auto,
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
    step829_reviews: inventory.step829_count,
  })
  writeFileSync(
    path.join(dest, 'step8-30-summary.md'),
    `# STEP 8.30 ORIGINAL-IMAGE COMPARE ON CACHED CROPS

STEP 8.30 RESULT: ${summary.status}
NAME: ${summary.name}
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

textbook: ${STEP830_DOCUMENT_TITLE}
source_document_id: ${STEP830_DOCUMENT}
cached items: ${inventory.step828_count}
dual reviews: ${inventory.step829_count}
gt sha256: ${inventory.gt_sha256 ?? '(missing)'}
assigned_by: ${ASSIGNED_BY}

executed: ${executed}
execution count: ${summary.execution_count}
dry-run pass: ${dryRun.pass}
dry-run blockers: ${dryRun.blockers.join(', ') || '(none)'}

item total: ${items.length}
crop present/missing: ${compare.crop_present}/${compare.crop_missing}
page png present/missing: ${compare.page_png_present}/${compare.page_png_missing}
compare completed/not compared: ${compare.compared}/${compare.not_compared}
AUTO_APPROVED/HUMAN_REVIEW/BLOCKED: ${compare.auto_approved}/${compare.human_review}/${compare.blocked}
progress auto_approved: ${progress.auto_approved}
progress human_review: ${progress.human_review}
progress blocked: ${progress.blocked}
progress matches items: ${summary.progress_matches_items}
duplicates: ${summary.duplicates}
orphans: ${summary.orphans}
wrong source: ${summary.wrong_source}
gt mutated: ${inventory.mutated}
content rewrites: 0
figure crops inventoried (not substituted): ${inventory.figure_crops_inventoried}
second pages inventoried (excluded): ${inventory.second_pages_inventoried}

Production pipeline writes: runs=0 items=0
production problem writes: 0
production figure writes: 0
production draft writes: 0
production counts probed: ${productionCounts.queried}
production counts reason: ${productionCounts.reason}
production drafts: ${productionCounts.drafts}
production type AUTO: ${productionCounts.type_auto}
production figures: ${productionCounts.figure_assets}/${productionCounts.figure_links}
production pipeline: ${productionCounts.pipeline_runs}/${productionCounts.pipeline_items}

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
mistral credentials: ${mistralCredentials}

Do not implement STEP 8.31. Do not persist drafts. Do not call paid OCR.
Do not mix SECOND book ${SECOND_DOCUMENT}.
Do not process the full textbook.
Do not substitute missing STEP 7 crops.
Do not set AUTO_APPROVED unless 8.25 §D all hold.
Do not set VERIFIED.
`,
    'utf8',
  )
  return summary
}
