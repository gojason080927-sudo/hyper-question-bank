import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'
import {
  FROZEN_PIPELINE_COUNTS,
  STEP824_BLOCKED_CANDIDATE_IDS,
  mapToGoldStandard,
} from './batchPipeline825'
import { fingerprintGtItem, parseGtFile, type GtItem } from './structureFromCache828'
import type { Step828CachedItem } from './dualAiReview829'
import {
  STEP830,
  STEP830_DOCUMENT,
  STEP830_PAID_OCR_CAP,
  assertNoAutoApprovedUnlessSectionD,
  assertNoGoldVerify,
  bboxValid,
  bboxesOverlap,
  compareCachedItem,
  denyPaidOcr830,
  emptyCompareInventory,
  emptyFileEvidence,
  evaluateDryRun,
  isForbiddenCropSubstitute,
  mapImageCompareToPipeline,
  parseManifestFile,
  projectStep830Targets,
  ssenPagePngPath,
  tallyCompare,
  tallyVerdicts,
  type FileEvidence,
  type ManifestBbox,
  type ManifestSample,
  type Step829ReviewInput,
} from './imageCompare830'

function gt(partial: Partial<GtItem> = {}): GtItem {
  return {
    sample_id: 'S04',
    page_number: 12,
    problem_number: '0040',
    ground_truth_text:
      '0040 | 대표 문제\n두 다항식 A=2x²-4xy+6y²\n① a\n② b\n③ c\n④ d\n⑤ e',
    ground_truth_math: ['A=2x²-4xy+6y²'],
    ground_truth_choices: ['a', 'b', 'c', 'd', 'e'],
    has_figure: false,
    has_table: false,
    ...partial,
  }
}

function cached(item: GtItem, status: Step828CachedItem['status'] = 'HUMAN_REVIEW'): Step828CachedItem {
  return {
    candidate_id: item.sample_id,
    page_number: item.page_number,
    problem_number: item.problem_number,
    status,
    reasons: ['STRUCTURED_FROM_GT'],
    choice_count: item.ground_truth_choices.length,
    answer_candidate: null,
    explanation: null,
    content_fingerprint: fingerprintGtItem(item),
  }
}

function review(
  item: GtItem,
  partial: Partial<Step829ReviewInput> = {},
): Step829ReviewInput {
  return {
    candidate_id: item.sample_id,
    status: 'HUMAN_REVIEW',
    agrees: true,
    dual_would_auto: true,
    checker_a: { checker: 'A', identity: 0.92, structure: 0.9, math: 0.9, figureOwnership: 1 },
    checker_b: { checker: 'B', identity: 0.9, structure: 0.88, math: 0.85, figureOwnership: 1 },
    reasons: ['DUAL_AGREE', 'IMAGE_COMPARE_NOT_RUN'],
    ...partial,
  }
}

function sample(item: GtItem, partial: Partial<ManifestSample> = {}): ManifestSample {
  return {
    sample_id: item.sample_id,
    document_id: STEP830_DOCUMENT,
    page_number: item.page_number,
    bbox: { x: 0.04, y: 0.11, width: 0.45, height: 0.28, unit: 'normalized', origin: 'top-left' },
    crop_file: `data/crops/${item.sample_id}.png`,
    crop_sha256: 'abc',
    crop_bytes: 10,
    ...partial,
  }
}

function cropOk(): FileEvidence {
  return {
    present: true,
    path: 'workers/ocr/data/crops/S04.png',
    sha256: 'abc',
    bytes: 10,
    sha256_match: true,
    substituted: false,
    used_as_crop: true,
    source_kind: 'step7_crop',
  }
}

function pageOk(): FileEvidence {
  return {
    present: true,
    path: ssenPagePngPath(12),
    sha256: 'page',
    bytes: 100,
    sha256_match: null,
    substituted: false,
    used_as_crop: false,
    source_kind: 'ssen_figure_page',
  }
}

describe('STEP 8.30 scope freeze', () => {
  it('locks SSEN and names original-image compare from the 8.25 freeze', () => {
    expect(STEP830).toBe('8.30')
    expect(STEP830_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    const freeze = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md'),
      'utf8',
    )
    expect(freeze).toContain('Original-image compare gate')
    expect(freeze).toMatch(/\*\*8\.30\*\*.*\| No \| No \|/)
    const spec = readFileSync(
      path.join(process.cwd(), 'docs/STEP8_30_ORIGINAL_IMAGE_COMPARE_v1.md'),
      'utf8',
    )
    expect(spec).toContain(STEP830_DOCUMENT)
    expect(spec).toContain('Do not start 8.31')
    expect(spec).toContain('0 calls / $0')
    expect(spec).toContain('CROP_CACHE_MISSING')
    expect([...STEP824_BLOCKED_CANDIDATE_IDS]).toEqual([...UNRESOLVED_PENDING_IDS])
    expect(FROZEN_PIPELINE_COUNTS.step812ExpectedDrafts).toBe(265)
    expect(FROZEN_PIPELINE_COUNTS.frozenTypeAuto).toBe(38)
  })
})

describe('STEP 8.30 image compare mapping', () => {
  it('BLOCKED when crop is missing and never treats that as PASS', () => {
    const item = gt()
    const row = compareCachedItem({
      cached: cached(item),
      review: review(item),
      gt: item,
      sample: sample(item),
      crop: emptyFileEvidence(),
      pagePng: pageOk(),
      siblingBboxes: [],
    })
    expect(row.status).toBe('BLOCKED')
    expect(row.compared).toBe(false)
    expect(row.image_compare_pass).toBe(false)
    expect(row.reasons).toContain('CROP_CACHE_MISSING')
    expect(row.reasons).toContain('PAGE_PNG_NOT_USED_AS_CROP')
    expect(row.checks.identity).toBe('NOT_COMPARED')
    expect(row.checks.stem).toBe('NOT_COMPARED')
    expect(row.checks.choices).toBe('NOT_COMPARED')
    expect(row.checks.math).toBe('NOT_COMPARED')
    expect(row.checks.figure).toBe('NOT_COMPARED')
    expect(row.checks.boundary).toBe('NOT_COMPARED')
    expect(mapToGoldStandard(row.status).mayVerify).toBe(false)
    expect(row.page_png.used_as_crop).toBe(false)
  })

  it('BLOCKED on missing original page even if dual would auto', () => {
    const mapped = mapImageCompareToPipeline({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      cropHashMatch: true,
      pagePresent: false,
      pageUsedAsCrop: false,
      substituted: false,
      imageComparePass: false,
      dualWouldAuto: true,
      hasFigure: false,
    })
    expect(mapped.status).toBe('BLOCKED')
    expect(mapped.reasons).toContain('ORIGINAL_PAGE_MISSING')
  })

  it('does not AUTO_APPROVE when crop hash matches but pixels were not read', () => {
    const item = gt()
    const row = compareCachedItem({
      cached: cached(item),
      review: review(item),
      gt: item,
      sample: sample(item),
      crop: cropOk(),
      pagePng: pageOk(),
      siblingBboxes: [],
    })
    expect(row.status).toBe('HUMAN_REVIEW')
    expect(row.reasons).toContain('IMAGE_COMPARE_PIXELS_UNREADABLE_WITHOUT_OCR')
    expect(row.image_compare_pass).toBe(false)
    expect(row.compared).toBe(false)
    expect(() => assertNoAutoApprovedUnlessSectionD([row])).not.toThrow()
  })

  it('BLOCKED on crop hash mismatch and figure-crop substitutes', () => {
    const mismatch = mapImageCompareToPipeline({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      cropHashMatch: false,
      pagePresent: true,
      pageUsedAsCrop: false,
      substituted: false,
      imageComparePass: false,
      dualWouldAuto: true,
      hasFigure: false,
    })
    expect(mismatch.status).toBe('BLOCKED')
    expect(mismatch.reasons).toContain('CROP_HASH_MISMATCH')

    const substitute = compareCachedItem({
      cached: cached(gt()),
      review: review(gt()),
      gt: gt(),
      sample: sample(gt()),
      crop: {
        ...cropOk(),
        path: 'ocr-tests/taxonomy/step8-22/crops/12-0045.png',
        source_kind: 'figure_crop',
        used_as_crop: true,
      },
      pagePng: pageOk(),
      siblingBboxes: [],
    })
    expect(substitute.status).toBe('BLOCKED')
    expect(substitute.reasons).toContain('CROP_CACHE_MISSING')
    expect(isForbiddenCropSubstitute('ocr-tests/taxonomy/step8-22/crops/12-0045.png')).toBe(true)
    expect(isForbiddenCropSubstitute('ocr-tests/taxonomy/step8-18/pages/page-026.png')).toBe(true)
  })

  it('keeps upstream BLOCKED and fingerprint drift BLOCKED', () => {
    const blocked = compareCachedItem({
      cached: cached(gt(), 'BLOCKED'),
      review: review(gt(), { status: 'BLOCKED', dual_would_auto: false, agrees: false }),
      gt: gt(),
      sample: sample(gt()),
      crop: emptyFileEvidence(),
      pagePng: emptyFileEvidence(),
      siblingBboxes: [],
    })
    expect(blocked.status).toBe('BLOCKED')
    expect(blocked.reasons).toContain('UPSTREAM_BLOCKED')
    expect(blocked.reasons).toContain('CROP_CACHE_MISSING')
    expect(blocked.reasons).toContain('ORIGINAL_PAGE_MISSING')

    const item = gt()
    const row = cached(item)
    row.content_fingerprint = 'tampered'
    const drifted = compareCachedItem({
      cached: row,
      review: review(item),
      gt: item,
      sample: sample(item),
      crop: cropOk(),
      pagePng: pageOk(),
      siblingBboxes: [],
    })
    expect(drifted.status).toBe('BLOCKED')
    expect(drifted.reasons).toContain('CONTENT_FINGERPRINT_DRIFT')
    expect(() => assertNoGoldVerify([drifted])).not.toThrow()
  })

  it('AUTO_APPROVED only when image compare actually PASSed and dual would auto', () => {
    const auto = mapImageCompareToPipeline({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      cropHashMatch: true,
      pagePresent: true,
      pageUsedAsCrop: false,
      substituted: false,
      imageComparePass: true,
      dualWouldAuto: true,
      hasFigure: false,
    })
    expect(auto.status).toBe('AUTO_APPROVED')
    const noDual = mapImageCompareToPipeline({
      fingerprintOk: true,
      upstreamStatus: 'HUMAN_REVIEW',
      dualStatus: 'HUMAN_REVIEW',
      cropPresent: true,
      cropHashMatch: true,
      pagePresent: true,
      pageUsedAsCrop: false,
      substituted: false,
      imageComparePass: true,
      dualWouldAuto: false,
      hasFigure: false,
    })
    expect(noDual.status).toBe('HUMAN_REVIEW')
  })
})

describe('STEP 8.30 bbox helpers and dry-run', () => {
  it('validates normalized bboxes and detects overlap', () => {
    const a: ManifestBbox = { x: 0.05, y: 0.12, width: 0.62, height: 0.16, unit: 'normalized', origin: 'top-left' }
    const b: ManifestBbox = { x: 0.05, y: 0.68, width: 0.62, height: 0.24, unit: 'normalized', origin: 'top-left' }
    const c: ManifestBbox = { x: 0.68, y: 0.1, width: 0.28, height: 0.22, unit: 'normalized', origin: 'top-left' }
    expect(bboxValid(a)).toBe(true)
    expect(bboxesOverlap(a, b)).toBe(false)
    expect(bboxesOverlap(a, c)).toBe(false)
    expect(bboxesOverlap(a, { ...a, y: 0.2 })).toBe(true)
    expect(
      bboxesOverlap(
        { x: 0.04, y: 0.1, width: 0.45, height: 0.28, unit: 'normalized', origin: 'top-left' },
        { x: 0.04, y: 0.38, width: 0.45, height: 0.22, unit: 'normalized', origin: 'top-left' },
      ),
    ).toBe(false)
  })

  it('BLOCKED dry-run when STEP 8.28/8.29 caches are missing', () => {
    const dry = evaluateDryRun({
      inventory: emptyCompareInventory(),
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(false)
    expect(dry.blockers).toEqual(
      expect.arrayContaining(['STEP828_CACHE_MISSING', 'STEP829_CACHE_MISSING', 'GT_CACHE_MISSING']),
    )
    expect(dry.ocr_network_calls).toBe(0)
    expect(dry.draft_persist).toBe(false)
  })

  it('PASSes dry-run when 26 cached items, dual reviews, and frozen GT hash match', () => {
    const inventory = emptyCompareInventory()
    inventory.step828_items_present = true
    inventory.step828_count = 26
    inventory.step829_reviews_present = true
    inventory.step829_count = 26
    inventory.gt_present = true
    inventory.gt_count = 26
    inventory.gt_sha256 = '31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb'
    inventory.manifest_present = true
    inventory.manifest_count = 26
    const dry = evaluateDryRun({
      inventory,
      problemPersistRequested: false,
      paidApiRequested: false,
      mixedTextbook: false,
    })
    expect(dry.pass).toBe(true)
    expect(dry.compare_targets).toBe(26)
    const targets = projectStep830Targets({
      dryRun: dry,
      executed: true,
      originalPdfPresent: false,
      originalPdfIsSecondBook: false,
      cropPresent: 0,
    })
    const tally = tallyVerdicts(targets)
    expect(tally.PASS).toBe(9)
    expect(tally.REVIEW).toBe(0)
    expect(tally.BLOCKED).toBe(12)
    expect(targets.find((row) => row.id === 'step7_crops')?.verdict).toBe('BLOCKED')
    expect(FEATURE_FLAGS.paidOcrRoutingEnabled).toBe(false)
    expect(STEP830_PAID_OCR_CAP).toEqual({ maxCalls: 0, maxUsd: 0 })
    expect(denyPaidOcr830()).toEqual({ authorized: false, reason: 'STEP_PAID_OCR_CAP_ZERO' })
  })
})

describe('STEP 8.30 real STEP 8.28 / 8.29 cache', () => {
  it('compares all 26 cached items without substituting missing crops', () => {
    const gtFile = parseGtFile(
      JSON.parse(readFileSync(path.join(process.cwd(), 'workers/ocr/ground-truth.json'), 'utf8')),
    )
    const cachedFile = JSON.parse(
      readFileSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-28/items.json'), 'utf8'),
    ) as { items: Step828CachedItem[] }
    const reviewsFile = JSON.parse(
      readFileSync(path.join(process.cwd(), 'ocr-tests/taxonomy/step8-29/reviews.json'), 'utf8'),
    ) as { items: Step829ReviewInput[] }
    const manifest = parseManifestFile(
      JSON.parse(readFileSync(path.join(process.cwd(), 'workers/ocr/corpus-manifest.json'), 'utf8')),
    )
    expect(cachedFile.items).toHaveLength(26)
    expect(reviewsFile.items).toHaveLength(26)
    expect(manifest.samples).toHaveLength(26)
    const gtById = new Map(gtFile.items.map((row) => [row.sample_id, row]))
    const reviewById = new Map(reviewsFile.items.map((row) => [row.candidate_id, row]))
    const sampleById = new Map(manifest.samples.map((row) => [row.sample_id, row]))
    const compared = cachedFile.items.map((row) => {
      const match = gtById.get(row.candidate_id)
      const dual = reviewById.get(row.candidate_id)
      const man = sampleById.get(row.candidate_id)
      expect(match).toBeTruthy()
      expect(dual).toBeTruthy()
      expect(man).toBeTruthy()
      return compareCachedItem({
        cached: row,
        review: dual!,
        gt: match!,
        sample: man!,
        crop: emptyFileEvidence(),
        pagePng: [12, 20].includes(row.page_number)
          ? {
              present: true,
              path: ssenPagePngPath(row.page_number),
              sha256: 'ignored',
              bytes: 1,
              sha256_match: null,
              substituted: false,
              used_as_crop: false,
              source_kind: 'ssen_figure_page',
            }
          : emptyFileEvidence(),
        siblingBboxes: manifest.samples
          .filter((other) => other.page_number === row.page_number && other.sample_id !== row.candidate_id)
          .map((other) => other.bbox),
      })
    })
    expect(() => assertNoAutoApprovedUnlessSectionD(compared)).not.toThrow()
    expect(() => assertNoGoldVerify(compared)).not.toThrow()
    const tally = tallyCompare(compared)
    expect(tally.crop_present).toBe(0)
    expect(tally.crop_missing).toBe(26)
    expect(tally.page_png_present).toBe(6)
    expect(tally.page_png_missing).toBe(20)
    expect(tally.compared).toBe(0)
    expect(tally.auto_approved).toBe(0)
    expect(tally.human_review).toBe(0)
    expect(tally.blocked).toBe(26)
    expect(compared.every((row) => row.checks.identity === 'NOT_COMPARED')).toBe(true)
    expect(compared.every((row) => row.declared_bbox_overlap === false)).toBe(true)
    expect(compared.filter((row) => row.reasons.includes('PAGE_PNG_NOT_USED_AS_CROP'))).toHaveLength(6)
    expect(compared.every((row) => row.content_fingerprint === fingerprintGtItem(gtById.get(row.candidate_id)!))).toBe(
      true,
    )
  })
})
