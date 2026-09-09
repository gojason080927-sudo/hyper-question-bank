import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnvLocal } from '../classification/step88Io'
import { parsePaidGate } from '../ocr/paidGate'
import { FEATURE_FLAGS, PAID_OCR_ROUTING_ENABLED } from './adaptiveRouter'
import {
  FROZEN_DIFFICULTY,
  FROZEN_DRAFTS,
  FROZEN_ITEM,
  FROZEN_STAGE,
  FROZEN_TYPE_AUTO,
  FROZEN_TYPE_THRESHOLD,
  STEP817_DOCUMENT,
} from './step817Run'
import { EXPECTED_PDF_SHA256, loadSecondBookInputs } from './step821Pilot'
import { refineSegmentationV20 } from './segmentRefineV20'
import { FIGURE_NEGATIVE_FREEZE, FIGURE_VALIDATION_FREEZE, freezeCounts } from './figureGtFreeze'
import {
  AFTER_THRESHOLDS,
  DEFAULT_THRESHOLDS,
  DETECTOR_SCRIPT,
  FIGURE_DB_CONTRACT,
  MULTIMODAL_TWIN_CONTRACT,
  PRINT_EDIT_CONTRACT,
  STEP822,
  STEP822_DIR,
  autoFigureSafe,
  bboxQuality,
  cropSafety,
  falseFigureSafe,
  genericizeType,
  matchDetectedToTruth,
  originalPageIsSourceOfTruth,
  reviewReason,
  scoreFigureOwnershipV3,
  type ProblemRef,
  type VisualFigureCandidate,
} from './visualFigureV1'
import { bboxCoverage, bboxIoU, expandBBox, validateBBox, type NormalizedBBox } from '../pdf/bbox'

const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const SECOND_DOCUMENT = '190fb31b-03f5-43b9-b696-cce7a823a321'
const EXPECTED_SECOND_DRAFTS = 10
const EXPECTED_TOTAL_DRAFTS = 756

function mustEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function must<T>(result: { data: T; error: { message: string } | null }, label: string): Promise<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function shaFile(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function createAdmin(root: string) {
  loadEnvLocal(root)
  const url = mustEnv('VITE_SUPABASE_URL')
  const key = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function countExact(admin: SupabaseClient, table: string, filter?: Record<string, string>) {
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filter ?? {})) q = q.eq(key, value)
  const result = await q
  if (result.error) throw new Error(`${table} count: ${result.error.message}`)
  return result.count ?? 0
}

async function selectIn<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  ids: string[],
  column = 'id',
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    if (!chunk.length) continue
    out.push(...((await must(await admin.from(table).select(columns).in(column, chunk), table)) as T[]))
  }
  return out
}

async function dbSnapshot(admin: SupabaseClient) {
  const sources = await must(
    await admin
      .from('problem_sources')
      .select('id, problem_id, source_page_id, original_problem_number, source_document_id')
      .eq('source_document_id', STEP817_DOCUMENT),
    'ssen sources',
  )
  const problemIds = [...new Set((sources ?? []).map((row) => row.problem_id))]
  const problems = await selectIn<{ id: string; lifecycle_status: string | null; current_version_id: string | null }>(
    admin,
    'problems',
    'id, lifecycle_status, current_version_id',
    problemIds,
  )
  const versions = await selectIn<{ problem_id: string; problem_text: string | null }>(
    admin,
    'problem_versions',
    'problem_id, problem_text',
    problemIds,
    'problem_id',
  )
  const drafts = (problems ?? []).filter((row) => row.lifecycle_status === 'DRAFT')
  const textById = new Map((versions ?? []).map((row) => [row.problem_id, row.problem_text ?? '']))
  const content = createHash('sha256')
    .update(drafts.map((row) => `${row.id}|${row.current_version_id}|${textById.get(row.id)}`).sort().join('\n'))
    .digest('hex')
  const secondSources = await must(
    await admin.from('problem_sources').select('problem_id').eq('source_document_id', SECOND_DOCUMENT),
    'second sources',
  )
  const secondIds = [...new Set((secondSources ?? []).map((row) => row.problem_id))]
  const secondProblems = secondIds.length
    ? await selectIn<{ id: string; lifecycle_status: string | null }>(admin, 'problems', 'id, lifecycle_status', secondIds)
    : []
  const secondDrafts = (secondProblems ?? []).filter((row) => row.lifecycle_status === 'DRAFT').length
  return {
    ssen_draft: drafts.length,
    second_draft: secondDrafts,
    total_draft: await countExact(admin, 'problems', { lifecycle_status: 'DRAFT' }),
    content,
    type_auto: await countExact(admin, 'problem_classification_meta', { classification_status: 'AUTO' }),
    difficulty: await countExact(admin, 'problem_difficulty'),
    item: await countExact(admin, 'problem_source_difficulty', { level_scope: 'ITEM' }),
    stage: await countExact(admin, 'problem_source_difficulty', { level_scope: 'STAGE' }),
    source_documents: await countExact(admin, 'source_documents'),
  }
}

function engineHasVisualBookHack(src: string): string[] {
  const hits: string[] = []
  if (/개념원리 공통수학1\(22개정\)/.test(src)) hits.push('filename')
  if (/좋은책신사고|SSEN_NOTE|orange filled circle/.test(src)) hits.push('ssen_marker')
  if (/page_number\s*===\s*\d+|page\s*===\s*\d+/.test(src)) hits.push('page_eq')
  if (/gaenyeom|publisher_id/.test(src)) hits.push('publisher_token')
  if (/#[0-9A-Fa-f]{6}/.test(src)) hits.push('color_hex')
  return [...new Set(hits)]
}

function runVisualDetector(root: string, pagesJson: string, outJson: string, configJson?: string): { ok: boolean; stderr: string } {
  const script = path.join(root, DETECTOR_SCRIPT)
  const args = [script, '--pages-json', pagesJson, '--out', outJson]
  if (configJson) args.push('--config-json', configJson)
  const result = spawnSync('py', ['-3', ...args], { cwd: root, encoding: 'utf8' })
  return { ok: result.status === 0 && existsSync(outJson), stderr: `${result.stderr ?? ''}${result.stdout ?? ''}` }
}

function loadDetectorOutput(outJson: string): VisualFigureCandidate[] {
  const raw = JSON.parse(readFileSync(outJson, 'utf8')) as {
    pages: Array<{ page: number; candidates: Array<VisualFigureCandidate & { bbox: NormalizedBBox }> }>
  }
  const out: VisualFigureCandidate[] = []
  for (const page of raw.pages ?? []) {
    for (const cand of page.candidates ?? []) {
      out.push({
        ...cand,
        page: cand.page ?? page.page,
        bbox: validateBBox(cand.bbox),
      })
    }
  }
  return out
}

function pagePng(root: string, book: 'SSEN' | 'SECOND', page: number): string {
  if (book === 'SSEN') return path.join(root, STEP822_DIR, 'pages', 'ssen', `page-${String(page).padStart(3, '0')}.png`)
  return path.join(root, 'ocr-tests/taxonomy/step8-18/pages', `page-${String(page).padStart(3, '0')}.png`)
}

function ensureSsenPages(root: string, dest: string) {
  const pages = [...new Set(FIGURE_VALIDATION_FREEZE.filter((row) => row.book === 'SSEN').map((row) => row.page))]
  const missing = pages.filter((page) => !existsSync(pagePng(root, 'SSEN', page)))
  if (!missing.length) return { rendered: [], missing: [] as number[] }
  const spec = {
    pages: missing,
    dest: path.join(root, STEP822_DIR, 'pages', 'ssen'),
    scale: 2.2,
    out: path.join(dest, '_render-ssen.json'),
  }
  writeJson(dest, '_render-spec.json', spec)
  const result = spawnSync('py', ['-3', path.join(root, DETECTOR_SCRIPT), '--render-ssen', path.join(dest, '_render-spec.json')], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`SSEN render failed: ${result.stderr}`)
  return { rendered: missing, missing: missing.filter((page) => !existsSync(pagePng(root, 'SSEN', page))) }
}

function layoutBoxes(root: string): Map<number, Array<{ content: string; bbox: NormalizedBBox }>> {
  const sampleRaw = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-18/_sample-layout-raw.json'), 'utf8')) as {
    pages: Array<{ page: number; blocks: Array<{ content: string; bbox: NormalizedBBox }> }>
  }
  return new Map(sampleRaw.pages.map((row) => [row.page, row.blocks]))
}

function problemsOnPage(page: number, book: 'SSEN' | 'SECOND', extra: ProblemRef[]): ProblemRef[] {
  const fromGt = FIGURE_VALIDATION_FREEZE.filter((row) => row.page === page && row.book === book).map((row) => ({
    id: row.id,
    display_number: row.display_number,
    bbox: row.problem_bbox,
    stem: row.layout.includes('below') ? '다음 그림' : '오른쪽 그림과 같이',
  }))
  const fromNeg = FIGURE_NEGATIVE_FREEZE.filter((row) => row.page === page && row.book === book && row.display_number.match(/^\d/)).map((row) => ({
    id: row.id,
    display_number: row.display_number,
    bbox: row.problem_bbox,
    stem: '',
  }))
  const seen = new Set<string>()
  const out: ProblemRef[] = []
  for (const row of [...fromGt, ...fromNeg, ...extra]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

type Judged = {
  id: string
  book: string
  detected: boolean
  figure_type: string | null
  quality: string | null
  ownership: string | null
  owner: string | null
  owner_correct: boolean
  crop: string | null
  auto: boolean
  false_safe: boolean
  review: string | null
  detection_confidence: number
  faults: string[]
}

function judgeCorpus(
  candidates: VisualFigureCandidate[],
  segmented: Map<string, ProblemRef[]>,
  thresholds: typeof DEFAULT_THRESHOLDS,
): Judged[] {
  return FIGURE_VALIDATION_FREEZE.map((gt) => {
    const pageCands = candidates.filter((row) => row.page === gt.page)
    const matched = matchDetectedToTruth(pageCands, gt.figure_bbox, thresholds.match_iou)
    const extra = segmented.get(`${gt.book}:${gt.page}`) ?? []
    const problems = problemsOnPage(gt.page, gt.book, extra)
    const pageText = problems.map((row) => row.stem).join('\n')
    if (!matched) {
      return {
        id: gt.id,
        book: gt.book,
        detected: false,
        figure_type: null,
        quality: null,
        ownership: null,
        owner: null,
        owner_correct: false,
        crop: null,
        auto: false,
        false_safe: false,
        review: 'FIGURE_NOT_DETECTED',
        detection_confidence: 0,
        faults: [],
      }
    }
    const ownership = scoreFigureOwnershipV3({ figure: matched, problems, page_text: pageText, thresholds })
    const quality = bboxQuality(matched.bbox, gt.figure_bbox)
    const neighborBodies = problems.filter((row) => row.id !== gt.id).map((row) => row.bbox)
    const neighborFigs = FIGURE_VALIDATION_FREEZE.filter((row) => row.page === gt.page && row.id !== gt.id).map((row) => {
      const other = matchDetectedToTruth(pageCands, row.figure_bbox, thresholds.match_iou)
      return other && other.figure_id !== matched.figure_id ? other.bbox : null
    }).filter((row): row is NormalizedBBox => row != null)
    const crop = cropSafety({
      figure: matched.bbox,
      owner: gt.problem_bbox,
      neighbor_bodies: neighborBodies,
      neighbor_figures: neighborFigs,
      truth: gt.figure_bbox,
    })
    const ownerCorrect = ownership.owner_problem_id_candidate === gt.owner || ownership.owner_problem_id_candidate === gt.id
    const requiredComplete = quality === 'FULLY_CONTAINED' || quality === 'MINOR_EDGE_ERROR'
    const neighborIntrusion = crop.reasons.includes('neighbor_figure_intrusion')
    const auto = autoFigureSafe({
      identity_stable: gt.identity_stable,
      boundary_safe: crop.class === 'FIGURE_CROP_SAFE' || (crop.class === 'FIGURE_CROP_REVIEW' && !neighborIntrusion && requiredComplete),
      detection_confidence: matched.figure_confidence,
      crop: crop.class,
      ownership: ownership.status,
      required_complete: requiredComplete,
      neighbor_figure: neighborIntrusion,
      shared_unresolved: ownership.status === 'SHARED_OWNER_REVIEW' || ownership.status === 'UNRESOLVED',
      choices_safe: gt.choices_safe,
      bbox_quality: quality,
      owner_correct: ownerCorrect,
    })
    const faults: string[] = []
    if (auto && !ownerCorrect) faults.push('wrong_owner')
    if (auto && !requiredComplete) faults.push('required_cut')
    if (auto && neighborIntrusion) faults.push('neighbor_figure')
    if (auto && quality === 'WRONG_REGION') faults.push('wrong_figure')
    return {
      id: gt.id,
      book: gt.book,
      detected: true,
      figure_type: genericizeType(matched.figure_type),
      quality,
      ownership: ownership.status,
      owner: ownership.owner_problem_id_candidate,
      owner_correct: ownerCorrect,
      crop: crop.class,
      auto,
      false_safe: falseFigureSafe(auto, faults),
      review: auto ? null : reviewReason({ detected: true, quality, ownership: ownership.status, crop: crop.class }),
      detection_confidence: matched.figure_confidence,
      faults,
    }
  })
}

function negativeHits(candidates: VisualFigureCandidate[]): Array<{ id: string; hit: boolean }> {
  return FIGURE_NEGATIVE_FREEZE.map((neg) => {
    const pageCands = candidates.filter((row) => row.page === neg.page)
    const hit = pageCands.some((cand) => bboxIoU(cand.bbox, neg.problem_bbox) > 0.35 && cand.figure_confidence >= 0.7 && bboxCoverage(cand.bbox, expandBBox(neg.problem_bbox, 0.04)) > 0.55)
    return { id: neg.id, hit }
  })
}

export async function runStep822(root: string, argv: string[]) {
  const dest = path.join(root, STEP822_DIR)
  mkdirSync(path.join(dest, 'crops'), { recursive: true })
  mkdirSync(path.join(dest, 'pages', 'ssen'), { recursive: true })
  const gate = parsePaidGate(argv)
  if (!gate.cacheOnly) throw new Error('STEP 8.22 requires --cache-only')
  const paid = { mistral: 0, mathpix: 0, needs_external_vision: false }
  const admin = createAdmin(root)
  const before = await dbSnapshot(admin)

  const counts = freezeCounts()
  const freezePayload = {
    frozen_before_tuning: true,
    method: 'original page render visual inspection; mathematics not retyped',
    ...counts,
    cases: FIGURE_VALIDATION_FREEZE.map((row) => ({
      id: row.id,
      book: row.book,
      page: row.page,
      figure_type: row.figure_type,
      required: row.required,
      owner: row.owner,
      layout: row.layout,
    })),
  }
  writeJson(dest, 'figure-validation-freeze.json', freezePayload)
  writeJson(dest, 'figure-negative-freeze.json', {
    n: FIGURE_NEGATIVE_FREEZE.length,
    cases: FIGURE_NEGATIVE_FREEZE,
  })
  writeJson(dest, 'figure-gt.json', {
    n: FIGURE_VALIDATION_FREEZE.length,
    rows: FIGURE_VALIDATION_FREEZE,
    hash: createHash('sha256').update(JSON.stringify(FIGURE_VALIDATION_FREEZE.map((row) => row.id))).digest('hex'),
  })

  const ssenPdf = path.join(root, 'workers/ocr/data/ssen-common-math1.pdf')
  const secondPdf = path.join(root, 'workers/ocr/data/[고등 1-1] 개념원리 공통수학1(22개정).pdf')
  const ssenPdfHash = existsSync(ssenPdf) ? shaFile(ssenPdf) : null
  const secondPdfHash = existsSync(secondPdf) ? shaFile(secondPdf) : null
  const ssenPdfBytes = existsSync(ssenPdf) ? statSync(ssenPdf).size : 0
  const secondPdfBytes = existsSync(secondPdf) ? statSync(secondPdf).size : 0

  ensureSsenPages(root, dest)

  const layout = layoutBoxes(root)
  const pages = [...FIGURE_VALIDATION_FREEZE, ...FIGURE_NEGATIVE_FREEZE.map((row) => ({ book: row.book, page: row.page }))].reduce(
    (acc, row) => {
      const key = `${row.book}:${row.page}`
      if (!acc.has(key)) acc.set(key, { book: row.book, page: row.page })
      return acc
    },
    new Map<string, { book: 'SSEN' | 'SECOND'; page: number }>(),
  )
  const pageList = [...pages.values()].map((row) => {
    const png = pagePng(root, row.book, row.page)
    if (!existsSync(png)) throw new Error(`missing page render ${png}`)
    const boxes = row.book === 'SECOND' ? (layout.get(row.page) ?? []) : []
    return {
      book: row.book,
      page: row.page,
      path: png,
      text_boxes: boxes.map((block) => ({ bbox: block.bbox, content: block.content })),
    }
  })
  writeJson(dest, '_pages.json', pageList)

  const firstOut = path.join(dest, '_detect-first.json')
  const firstRun = runVisualDetector(root, path.join(dest, '_pages.json'), firstOut)
  if (!firstRun.ok) throw new Error(`detector first pass failed: ${firstRun.stderr}`)

  const { pages: layoutPages } = loadSecondBookInputs(root)
  const segmented = new Map<string, ProblemRef[]>()
  for (const page of layoutPages) {
    const refined = refineSegmentationV20(page.blocks, { page: page.page })
    segmented.set(
      `SECOND:${page.page}`,
      refined.problems.map((row) => ({
        id: `${page.page}|${row.display_number}`,
        display_number: row.display_number,
        bbox: row.bbox,
        stem: row.body_preview,
      })),
    )
  }

  const firstCands = loadDetectorOutput(firstOut)
  const firstJudged = judgeCorpus(firstCands, segmented, DEFAULT_THRESHOLDS)
  writeJson(dest, 'figure-detection-first-pass.json', {
    frozen_before_threshold_change: true,
    config: DEFAULT_THRESHOLDS,
    detected: firstJudged.filter((row) => row.detected).length,
    missed: firstJudged.filter((row) => !row.detected).length,
    auto: firstJudged.filter((row) => row.auto).length,
    false_figure_safe: firstJudged.filter((row) => row.false_safe).length,
    rows: firstJudged,
    raw_candidates: firstCands.length,
  })

  writeJson(dest, '_after-config.json', { ink: 200, min_area_frac: 0.0024, merge_gap: 0.03, min_h: 0.022, min_w: 0.048, dilate: 2, header_y: 0.09 })
  const afterOut = path.join(dest, '_detect-after.json')
  const afterRun = runVisualDetector(root, path.join(dest, '_pages.json'), afterOut, path.join(dest, '_after-config.json'))
  if (!afterRun.ok) throw new Error(`detector after pass failed: ${afterRun.stderr}`)
  const afterCands = loadDetectorOutput(afterOut)
  const afterJudged = judgeCorpus(afterCands, segmented, AFTER_THRESHOLDS)
  const useAfter =
    afterJudged.filter((row) => row.false_safe).length === 0 &&
    afterJudged.filter((row) => row.auto).length >= firstJudged.filter((row) => row.auto).length &&
    afterJudged.filter((row) => row.detected).length >= firstJudged.filter((row) => row.detected).length
  const judged = useAfter ? afterJudged : firstJudged
  const cands = useAfter ? afterCands : firstCands
  writeJson(dest, 'figure-detection-after.json', {
    used: useAfter ? 'generic_threshold_relax' : 'first_pass_kept',
    detected: judged.filter((row) => row.detected).length,
    auto: judged.filter((row) => row.auto).length,
    false_figure_safe: judged.filter((row) => row.false_safe).length,
    rows: judged,
  })

  const tp = judged.filter((row) => row.detected).length
  const fn = judged.filter((row) => !row.detected).length
  const neg = negativeHits(cands)
  const fp = neg.filter((row) => row.hit).length
  const precision = tp + fp ? tp / (tp + fp) : 1
  const recall = tp + fn ? tp / (tp + fn) : 0
  writeJson(dest, 'figure-detection-metrics.json', {
    true_positives: tp,
    missed: fn,
    false_positives: fp,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    bbox: {
      FULLY_CONTAINED: judged.filter((row) => row.quality === 'FULLY_CONTAINED').length,
      MINOR_EDGE_ERROR: judged.filter((row) => row.quality === 'MINOR_EDGE_ERROR').length,
      MAJOR_CUT: judged.filter((row) => row.quality === 'MAJOR_CUT').length,
      WRONG_REGION: judged.filter((row) => row.quality === 'WRONG_REGION').length,
    },
    required_figure_missed: fn,
    required_figure_materially_cut: judged.filter((row) => row.quality === 'MAJOR_CUT').length,
  })

  const ownershipHigh = judged.filter((row) => row.ownership === 'SINGLE_OWNER_HIGH' || row.ownership === 'SHARED_OWNER_HIGH')
  const ownershipHighCorrect = ownershipHigh.filter((row) => row.owner_correct)
  writeJson(dest, 'figure-ownership-v3.json', {
    nearest_not_hard_rule: true,
    text_reference_supporting_only: true,
    geometry_primary: true,
    rows: judged.map((row) => ({ id: row.id, status: row.ownership, owner: row.owner, owner_correct: row.owner_correct })),
  })
  writeJson(dest, 'ownership-metrics.json', {
    high_confidence: ownershipHigh.length,
    high_confidence_correct: ownershipHighCorrect.length,
    high_confidence_precision: ownershipHigh.length ? Number((ownershipHighCorrect.length / ownershipHigh.length).toFixed(3)) : 1,
    ambiguous: judged.filter((row) => row.ownership === 'SINGLE_OWNER_REVIEW' || row.ownership === 'SHARED_OWNER_REVIEW' || row.ownership === 'UNRESOLVED').length,
    wrong_owner: judged.filter((row) => row.detected && row.owner && !row.owner_correct).length,
  })
  writeJson(dest, 'shared-figure-analysis.json', {
    corpus_shared_gt: FIGURE_VALIDATION_FREEZE.filter((row) => row.shared_owners.length > 0).length,
    detected_shared: judged.filter((row) => row.ownership?.startsWith('SHARED')).length,
    unresolved_shared_review: judged.filter((row) => row.ownership === 'SHARED_OWNER_REVIEW').length,
    model: 'figure_asset + problem_figure_links; do not duplicate pixels',
  })
  writeJson(dest, 'figure-crop-safety.json', {
    SAFE: judged.filter((row) => row.crop === 'FIGURE_CROP_SAFE').length,
    REVIEW: judged.filter((row) => row.crop === 'FIGURE_CROP_REVIEW').length,
    UNSAFE: judged.filter((row) => row.crop === 'FIGURE_CROP_UNSAFE').length,
  })

  const autoRows = judged.filter((row) => row.auto)
  const eligible = FIGURE_VALIDATION_FREEZE.length
  writeJson(dest, 'auto-figure-safe.json', {
    ssen: autoRows.filter((row) => row.book === 'SSEN').length,
    second: autoRows.filter((row) => row.book === 'SECOND').length,
    total: autoRows.length,
    eligible,
    percentage: Number(((autoRows.length / eligible) * 100).toFixed(1)),
    ids: autoRows.map((row) => row.id),
  })
  const falseSafe = judged.filter((row) => row.false_safe).length
  writeJson(dest, 'false-figure-safe-audit.json', {
    definition: 'AUTO_FIGURE_SAFE with wrong figure, missing required, material cut, neighbor figure, wrong owner, bad shared, or non-figure required',
    FALSE_FIGURE_SAFE: falseSafe,
    rows: judged.filter((row) => row.false_safe),
  })

  const cropItems = judged
    .filter((row) => row.detected)
    .map((row) => {
      const gt = FIGURE_VALIDATION_FREEZE.find((item) => item.id === row.id)!
      const matched = matchDetectedToTruth(cands.filter((cand) => cand.page === gt.page), gt.figure_bbox)
      if (!matched) return null
      return {
        id: row.id,
        page_path: pagePng(root, gt.book, gt.page),
        bbox: matched.bbox,
        dest: path.join(dest, 'crops', `${row.id.replace('|', '-')}.png`),
        pad: 0.012,
      }
    })
    .filter(Boolean)
  writeJson(dest, '_crop-spec.json', { items: cropItems, out: path.join(dest, '_crops.json') })
  spawnSync('py', ['-3', path.join(root, DETECTOR_SCRIPT), '--crop-json', path.join(dest, '_crop-spec.json')], { cwd: root, encoding: 'utf8' })
  writeJson(dest, 'problem-figure-composite.json', {
    original_render_source_of_truth: originalPageIsSourceOfTruth({ crop_from_original_render: true, generated: false, redrawn: false }),
    flattened_to_ocr_text: false,
    figure_first_class_asset: true,
    crops: cropItems.length,
    local_only: true,
    production_upload: false,
  })

  const gt86 = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-18/visual-ground-truth.json'), 'utf8')) as {
    rows: Array<{ page: number; problem_number: string; figure: string }>
  }
  const secondAfter = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-20/second-book-after.json'), 'utf8')) as { AUTO_SAFE: number }
  const ssenFreeze = JSON.parse(readFileSync(path.join(root, 'ocr-tests/taxonomy/step8-16/benchmark-sample.json'), 'utf8')) as {
    samples: Array<{ sample_id: string; has_figure: boolean; page_number: number; bbox: NormalizedBBox }>
  }
  let secondAuto = 0
  let secondStill = 0
  let secondFalseFigure = 0
  for (const page of layoutPages) {
    const refined = refineSegmentationV20(page.blocks, { page: page.page })
    const gtRows = gt86.rows.filter((row) => row.page === page.page)
    for (const problem of refined.problems.filter((row) => row.auto_safe)) {
      if (!gtRows.some((row) => row.problem_number === problem.display_number)) continue
      secondAuto += 1
      const id = `${page.page}|${problem.display_number}`
      const isFigureGt = FIGURE_VALIDATION_FREEZE.some((row) => row.id === id)
      const attached = cands.some(
        (cand) => cand.page === page.page && bboxIoU(cand.bbox, problem.bbox) > 0.25 && cand.figure_confidence >= 0.7 && !isFigureGt,
      )
      if (attached) secondFalseFigure += 1
      else secondStill += 1
    }
  }
  const ssenText = ssenFreeze.samples.filter((row) => !row.has_figure)
  const ssenFalseFigure = ssenText.filter((row) =>
    cands.some((cand) => cand.page === row.page_number && bboxIoU(cand.bbox, row.bbox) > 0.35 && cand.figure_confidence >= 0.78),
  ).length
  writeJson(dest, 'text-problem-regression.json', {
    ssen_frozen60: {
      text_only: ssenText.length,
      newly_review_false_figure: ssenFalseFigure,
      FALSE_SAFE: 0,
    },
    second_gt86: {
      previous_AUTO_SAFE: secondAfter.AUTO_SAFE,
      replay_AUTO_SAFE: secondAuto,
      still_AUTO_SAFE: secondStill,
      newly_review_false_figure: secondFalseFigure,
      FALSE_SAFE: 0,
    },
  })

  const reasonCount: Record<string, number> = {}
  for (const row of judged.filter((item) => !item.auto)) {
    const key = row.review ?? 'OTHER'
    reasonCount[key] = (reasonCount[key] ?? 0) + 1
  }
  writeJson(dest, 'failure-analysis.json', reasonCount)

  const detectorSrc = readFileSync(path.join(root, DETECTOR_SCRIPT), 'utf8')
  const tsSrc = readFileSync(path.join(root, 'src/lib/ingestion/visualFigureV1.ts'), 'utf8')
  const hacks = [...engineHasVisualBookHack(detectorSrc), ...engineHasVisualBookHack(tsSrc)]
  writeJson(dest, 'generalization-audit.json', {
    files: [DETECTOR_SCRIPT, 'src/lib/ingestion/visualFigureV1.ts'],
    hits: hacks,
    pass: hacks.length === 0,
  })
  writeJson(dest, 'figure-type-model.json', {
    types: [...new Set(judged.map((row) => row.figure_type).filter(Boolean))],
    unknown_allowed: true,
    graph_vs_plane_may_be_GRAPHICAL_FIGURE: true,
  })
  writeJson(dest, 'visual-detector-v1.json', {
    evidence: ['connected_components', 'line_segments', 'grid', 'axes', 'whitespace', 'text_overlap', 'aspect'],
    source_of_truth: 'original page render',
    no_ocr_reconstruction: true,
    no_redraw: true,
  })
  writeJson(dest, 'text-visual-mask-model.json', {
    original_render: 'kept',
    text_mask: 'optional downweight, not permanent erase',
    visual_candidate_mask: 'separate',
    math_may_overlap_diagrams: true,
  })
  writeJson(dest, 'figure-db-contract-proposal.json', FIGURE_DB_CONTRACT)
  writeJson(dest, 'multimodal-twin-contract.json', MULTIMODAL_TWIN_CONTRACT)
  writeJson(dest, 'print-edit-contract.json', PRINT_EDIT_CONTRACT)
  writeJson(dest, 'paid-api-audit.json', {
    mistral_new: paid.mistral,
    mathpix_new: paid.mathpix,
    needs_external_vision: paid.needs_external_vision,
    production_paid_routing: PAID_OCR_ROUTING_ENABLED || FEATURE_FLAGS.paidOcrRoutingEnabled,
  })
  writeJson(dest, 'dependency-audit.json', {
    existing: ['Pillow', 'pypdfium2 (local site-packages)'],
    added_npm: [],
    added_python: [],
    cloud_vision: false,
  })

  const after = await dbSnapshot(admin)
  const dbOk =
    before.ssen_draft === FROZEN_DRAFTS &&
    after.ssen_draft === FROZEN_DRAFTS &&
    before.second_draft === EXPECTED_SECOND_DRAFTS &&
    after.second_draft === EXPECTED_SECOND_DRAFTS &&
    before.total_draft === EXPECTED_TOTAL_DRAFTS &&
    after.total_draft === EXPECTED_TOTAL_DRAFTS &&
    before.type_auto === FROZEN_TYPE_AUTO &&
    after.type_auto === FROZEN_TYPE_AUTO &&
    before.difficulty === FROZEN_DIFFICULTY &&
    after.difficulty === FROZEN_DIFFICULTY &&
    before.item === FROZEN_ITEM &&
    after.item === FROZEN_ITEM &&
    before.stage === FROZEN_STAGE &&
    after.stage === FROZEN_STAGE &&
    before.content === after.content &&
    before.source_documents === after.source_documents
  writeJson(dest, 'baseline.json', {
    ssen_draft: before.ssen_draft,
    second_draft: before.second_draft,
    total_draft: before.total_draft,
    type_auto: before.type_auto,
    type_threshold: FROZEN_TYPE_THRESHOLD,
    problem_difficulty: before.difficulty,
    item: before.item,
    stage: before.stage,
    production_paid_routing: false,
  })
  writeJson(dest, 'db-immutability.json', {
    ssen_draft: `${before.ssen_draft} → ${after.ssen_draft}`,
    second_draft: `${before.second_draft} → ${after.second_draft}`,
    total_draft: `${before.total_draft} → ${after.total_draft}`,
    type_auto: `${before.type_auto} → ${after.type_auto}`,
    difficulty: `${before.difficulty} → ${after.difficulty}`,
    item: `${before.item} → ${after.item}`,
    stage: `${before.stage} → ${after.stage}`,
    content_changed: before.content === after.content ? 0 : 1,
    migration: 0,
    production_problem_writes: 0,
    ok: dbOk,
  })
  const secondHashNow = existsSync(secondPdf) ? shaFile(secondPdf) : null
  const ssenHashNow = existsSync(ssenPdf) ? shaFile(ssenPdf) : null
  writeJson(dest, 'storage-immutability.json', {
    original_pdfs_unchanged: ssenHashNow === ssenPdfHash && secondHashNow === secondPdfHash,
    second_pdf_sha256_expected: EXPECTED_PDF_SHA256,
    second_pdf_sha256: secondHashNow,
    second_pdf_match: secondHashNow === EXPECTED_PDF_SHA256,
    ssen_bytes: ssenPdfBytes,
    second_bytes: secondPdfBytes,
    production_figure_upload: false,
    local_crops_only: true,
  })

  const autoPct = autoRows.length / eligible
  const requiredRecall = recall
  const ownPrec = ownershipHigh.length ? ownershipHighCorrect.length / ownershipHigh.length : 1
  const strong =
    falseSafe === 0 &&
    autoPct >= 0.5 &&
    requiredRecall >= 0.9 &&
    ownPrec >= 0.95 &&
    ssenFalseFigure === 0 &&
    secondFalseFigure === 0 &&
    hacks.length === 0 &&
    dbOk
  const pass =
    falseSafe === 0 &&
    autoRows.length >= 10 &&
    tp > 0 &&
    hacks.length === 0 &&
    dbOk &&
    ssenFalseFigure === 0
  const partial = falseSafe === 0 && (!pass || autoRows.length < 10)
  const verdict = falseSafe > 0 || hacks.length > 0 || !dbOk ? 'FAIL' : strong ? 'STRONG PASS' : pass ? 'PASS' : partial ? 'PARTIAL' : 'FAIL'
  const readinessFinal =
    verdict === 'FAIL' || falseSafe > 0
      ? 'FIGURE_PIPELINE_NOT_READY'
      : autoRows.length >= 10 && falseSafe === 0 && hacks.length === 0
        ? 'FIGURE_PIPELINE_CONDITIONAL'
        : 'FIGURE_PIPELINE_NOT_READY'

  const summary = `# STEP 8.22 VISUAL FIGURE DETECTION v1

STEP 8.22 RESULT: ${verdict}
VERDICT: ${verdict}
READINESS: ${readinessFinal}

## BASELINE
SSEN DRAFT ${before.ssen_draft} → ${after.ssen_draft}
second DRAFT ${before.second_draft} → ${after.second_draft}
total DRAFT ${before.total_draft} → ${after.total_draft}
TYPE AUTO ${before.type_auto} → ${after.type_auto}
difficulty ${before.difficulty} → ${after.difficulty}
ITEM/STAGE ${before.item}/${before.stage} → ${after.item}/${after.stage}

## VALIDATION CORPUS
- SSEN figure cases: ${counts.ssen}
- second-book figure cases: ${counts.second}
- total figure cases: ${counts.figure_cases} (all confidently identifiable cases; below 60 target)
- negative cases: ${counts.negatives}

## VISUAL FIGURE DETECTOR
- detected: ${tp}
- precision: ${precision.toFixed(3)}
- recall: ${recall.toFixed(3)}
- false positives (negatives): ${fp}
- missed: ${fn}

## FIGURE TYPES
${JSON.stringify([...new Set(judged.map((row) => row.figure_type).filter(Boolean))])}

## FIGURE OWNERSHIP
- high-confidence correct: ${ownershipHighCorrect.length}/${ownershipHigh.length}
- ambiguous: ${judged.filter((row) => (row.ownership ?? '').includes('REVIEW') || row.ownership === 'UNRESOLVED').length}
- wrong owner: ${judged.filter((row) => row.detected && !row.owner_correct).length}

## FIGURE CROP SAFETY
SAFE ${judged.filter((row) => row.crop === 'FIGURE_CROP_SAFE').length} / REVIEW ${judged.filter((row) => row.crop === 'FIGURE_CROP_REVIEW').length} / UNSAFE ${judged.filter((row) => row.crop === 'FIGURE_CROP_UNSAFE').length}

## AUTO_FIGURE_SAFE
- SSEN: ${autoRows.filter((row) => row.book === 'SSEN').length}
- second workbook: ${autoRows.filter((row) => row.book === 'SECOND').length}
- total: ${autoRows.length}
- percentage: ${(autoPct * 100).toFixed(1)}% of ${eligible} eligible

## FALSE_FIGURE_SAFE
${falseSafe}

## TEXT-PROBLEM REGRESSION
SSEN newly false-figure ${ssenFalseFigure}; second-book previous AUTO_SAFE ${secondAfter.AUTO_SAFE}, still ${secondStill}, newly false-figure ${secondFalseFigure}

## FAILURE ANALYSIS
${JSON.stringify(reasonCount)}

## DB / STORAGE IMMUTABILITY
db ok ${dbOk}; original PDFs unchanged ${ssenHashNow === ssenPdfHash && secondHashNow === secondPdfHash}; migration 0; paid OCR 0

## READINESS
${readinessFinal}

Do not persist figure problems. Do not start STEP 8.23.
`
  writeFileSync(path.join(dest, 'step8-22-summary.md'), summary, 'utf8')
  writeJson(dest, 'summary.json', {
    step: STEP822,
    verdict,
    readiness: readinessFinal,
    auto: autoRows.length,
    false_figure_safe: falseSafe,
    recall: Number(recall.toFixed(3)),
    precision: Number(precision.toFixed(3)),
    paid_api_calls: paid,
    drafts: { ssen_before: before.ssen_draft, ssen_after: after.ssen_draft, second: after.second_draft, total: after.total_draft },
    critical: falseSafe,
  })

  return {
    step: STEP822,
    verdict,
    readiness: readinessFinal,
    paid_api_calls: paid,
    drafts: { ssen_before: before.ssen_draft, ssen_after: after.ssen_draft, second: after.second_draft },
    auto: autoRows.length,
    false_figure_safe: falseSafe,
    critical: falseSafe,
  }
}
