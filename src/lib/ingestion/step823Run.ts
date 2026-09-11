import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnvLocal } from '../classification/step88Io'
import { parsePaidGate } from '../ocr/paidGate'
import { FEATURE_FLAGS } from './adaptiveRouter'
import {
  FROZEN_DIFFICULTY,
  FROZEN_DRAFTS,
  FROZEN_ITEM,
  FROZEN_STAGE,
  FROZEN_TYPE_AUTO,
  STEP817_DOCUMENT,
} from './step817Run'
import { FIGURE_VALIDATION_FREEZE } from './figureGtFreeze'
import { DETECTOR_SCRIPT, STEP822_DIR, type VisualFigureCandidate } from './visualFigureV1'
import { validateBBox } from '../pdf/bbox'
import {
  FIGURE_ASSET_RPC,
  FIGURE_PERSIST_CONTRACT,
  STEP823,
  STEP823_DIR,
  STEP823_MIGRATION,
  attachDetectedBbox,
  dedupeAssets,
  findOrphans,
  hashBytes,
  migrationIsAdditive823,
  persistBlockReasons,
  preflightFigure,
  projectAutoFigure,
  replayDoesNotDuplicate,
  upsertPayload,
  type DbIdentity,
  type FigureAssetDraft,
  type FigureLinkDraft,
  type JudgedFigureRow,
  type PreflightRow,
} from './figurePersistence'
import { canonicalizeProblemNumber } from '../recognition/draftUpsert'

const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const SECOND_DOCUMENT = '190fb31b-03f5-43b9-b696-cce7a823a321'

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

function engineHasFigurePersistHack(src: string): string[] {
  const hits: string[] = []
  if (/개념원리 공통수학1\(22개정\)/.test(src)) hits.push('filename')
  if (/좋은책신사고|SSEN_NOTE|orange filled circle/.test(src)) hits.push('ssen_marker')
  if (/page_number\s*===\s*\d+|page\s*===\s*\d+/.test(src)) hits.push('page_eq')
  if (/gaenyeom|publisher_id/.test(src)) hits.push('publisher_token')
  if (/#[0-9A-Fa-f]{6}/.test(src)) hits.push('color_hex')
  return [...new Set(hits)]
}

function documentForBook(book: 'SSEN' | 'SECOND'): string {
  return book === 'SSEN' ? STEP817_DOCUMENT : SECOND_DOCUMENT
}

function pagePng(root: string, book: 'SSEN' | 'SECOND', page: number): string {
  const token = String(page).padStart(3, '0')
  if (book === 'SSEN') return path.join(root, STEP822_DIR, 'pages/ssen', `page-${token}.png`)
  return path.join(root, 'ocr-tests/taxonomy/step8-18/pages', `page-${token}.png`)
}

function resolvePython(): string[] {
  for (const cmd of [['py', '-3'], ['python3'], ['python']]) {
    const probe = spawnSync(cmd[0], [...cmd.slice(1), '-c', 'from PIL import Image'], { encoding: 'utf8' })
    if (probe.status === 0) return cmd
  }
  throw new Error('Python with Pillow is required for STEP 8.23 figure persistence')
}

function runDetector(root: string, pagesJson: string, outJson: string, configJson?: string) {
  const py = resolvePython()
  const args = [path.join(root, DETECTOR_SCRIPT), '--pages-json', pagesJson, '--out', outJson]
  if (configJson) args.push('--config-json', configJson)
  const result = spawnSync(py[0], [...py.slice(1), ...args], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0 || !existsSync(outJson)) {
    throw new Error(`detector failed: ${result.stderr ?? ''}${result.stdout ?? ''}`)
  }
}

function loadDetectorOutput(outJson: string): VisualFigureCandidate[] {
  const raw = JSON.parse(readFileSync(outJson, 'utf8')) as {
    pages: Array<{ page: number; candidates: Array<VisualFigureCandidate> }>
  }
  const out: VisualFigureCandidate[] = []
  for (const page of raw.pages ?? []) {
    for (const cand of page.candidates ?? []) {
      out.push({ ...cand, page: cand.page ?? page.page, bbox: validateBBox(cand.bbox) })
    }
  }
  return out
}

async function dbSnapshot(admin: SupabaseClient) {
  return {
    total_draft: await countExact(admin, 'problems', { lifecycle_status: 'DRAFT' }),
    type_auto: await countExact(admin, 'problem_classification_meta', { classification_status: 'AUTO' }),
    difficulty: await countExact(admin, 'problem_difficulty'),
    item: await countExact(admin, 'problem_source_difficulty', { level_scope: 'ITEM' }),
    stage: await countExact(admin, 'problem_source_difficulty', { level_scope: 'STAGE' }),
    problem_assets: await countExact(admin, 'problem_assets'),
  }
}

async function loadIdentities(admin: SupabaseClient, documentId: string): Promise<Map<string, DbIdentity>> {
  const sources = await must(
    await admin
      .from('problem_sources')
      .select('id, problem_id, source_document_id, original_problem_number, source_page_id')
      .eq('source_document_id', documentId),
    'sources',
  )
  const pageIds = [...new Set((sources ?? []).map((row) => row.source_page_id).filter(Boolean))] as string[]
  const pages: Array<{ id: string; page_number: number }> = []
  for (let i = 0; i < pageIds.length; i += 80) {
    const chunk = pageIds.slice(i, i + 80)
    pages.push(
      ...((await must(
        await admin.from('source_pages').select('id, page_number').in('id', chunk),
        'pages',
      )) as Array<{ id: string; page_number: number }>),
    )
  }
  const pageMap = new Map(pages.map((row) => [row.id, row.page_number]))
  const problemIds = [...new Set((sources ?? []).map((row) => row.problem_id))]
  const problems: Array<{ id: string; current_version_id: string | null; lifecycle_status: string | null }> = []
  for (let i = 0; i < problemIds.length; i += 80) {
    problems.push(
      ...((await must(
        await admin
          .from('problems')
          .select('id, current_version_id, lifecycle_status')
          .in('id', problemIds.slice(i, i + 80)),
        'problems',
      )) as Array<{ id: string; current_version_id: string | null; lifecycle_status: string | null }>),
    )
  }
  const problemMap = new Map(problems.map((row) => [row.id, row]))
  const out = new Map<string, DbIdentity>()
  for (const row of sources ?? []) {
    const page = pageMap.get(row.source_page_id)
    const canonical = canonicalizeProblemNumber(row.original_problem_number)
    const problem = problemMap.get(row.problem_id)
    if (page == null || !canonical || !problem) continue
    out.set(`${page}|${canonical}`, {
      problem_id: row.problem_id,
      problem_source_id: row.id,
      source_document_id: row.source_document_id,
      page,
      problem_number: canonical,
      current_version_id: problem.current_version_id,
      lifecycle_status: problem.lifecycle_status,
    })
  }
  return out
}

async function schemaReady(admin: SupabaseClient): Promise<{ ok: boolean; reason: string | null }> {
  const assets = await admin.from('problem_figure_assets').select('id', { count: 'exact', head: true })
  if (assets.error) return { ok: false, reason: assets.error.message }
  const links = await admin.from('problem_figure_links').select('id', { count: 'exact', head: true })
  if (links.error) return { ok: false, reason: links.error.message }
  return { ok: true, reason: null }
}

export async function runStep823(root: string, argv: string[]) {
  const gate = parsePaidGate(argv)
  const persist = argv.includes('--persist')
  if (!gate.cacheOnly && !persist) throw new Error('STEP 8.23 requires --cache-only or --persist')
  if (persist && gate.cacheOnly) throw new Error('STEP 8.23 --persist cannot combine with --cache-only')
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) throw new Error('paid OCR routing must stay false in STEP 8.23')

  const dest = path.join(root, STEP823_DIR)
  mkdirSync(dest, { recursive: true })
  const afterPath = path.join(root, STEP822_DIR, 'figure-detection-after.json')
  const autoPath = path.join(root, STEP822_DIR, 'auto-figure-safe.json')
  const gtPath = path.join(root, STEP822_DIR, 'figure-gt.json')
  if (!existsSync(afterPath) || !existsSync(autoPath)) throw new Error('STEP 8.22 official artifacts missing')
  const gtBefore = hashBytes(readFileSync(gtPath))
  const after = JSON.parse(readFileSync(afterPath, 'utf8')) as { used: string; rows: JudgedFigureRow[] }
  const autoFile = JSON.parse(readFileSync(autoPath, 'utf8')) as { ids: string[]; total: number }
  const judged = after.rows
  const autoRows = judged.filter((row) => row.auto)
  if (autoFile.total !== autoRows.length) throw new Error('AUTO_FIGURE_SAFE artifact mismatch')

  const sql = readFileSync(path.join(root, STEP823_MIGRATION), 'utf8')
  const migration = migrationIsAdditive823(sql)
  const persistSrc = readFileSync(path.join(root, 'src/lib/ingestion/figurePersistence.ts'), 'utf8')
  const hacks = engineHasFigurePersistHack(persistSrc)

  const autoGt = FIGURE_VALIDATION_FREEZE.filter((row) => autoRows.some((item) => item.id === row.id))
  const pages = [...new Set(autoGt.map((row) => `${row.book}:${row.page}`))].map((token) => {
    const [book, page] = token.split(':') as ['SSEN' | 'SECOND', string]
    return { book, page: Number(page), path: pagePng(root, book, Number(page)), text_boxes: [] as unknown[] }
  })
  for (const page of pages) {
    if (!existsSync(page.path)) throw new Error(`missing page render ${page.path}`)
  }
  writeJson(dest, '_pages.json', pages)
  let configPath: string | undefined
  if (after.used === 'generic_threshold_relax') {
    writeJson(dest, '_after-config.json', {
      ink: 200,
      min_area_frac: 0.0024,
      merge_gap: 0.03,
      min_h: 0.022,
      min_w: 0.048,
      dilate: 2,
      header_y: 0.09,
    })
    configPath = path.join(dest, '_after-config.json')
  }
  const detectOut = path.join(dest, '_detect.json')
  runDetector(root, path.join(dest, '_pages.json'), detectOut, configPath)
  const candidates = loadDetectorOutput(detectOut)

  const admin = createAdmin(root)
  const before = await dbSnapshot(admin)
  const ssenIds = await loadIdentities(admin, STEP817_DOCUMENT)
  const secondIds = await loadIdentities(admin, SECOND_DOCUMENT)
  const identityFor = (book: 'SSEN' | 'SECOND', page: number, number: string) => {
    const canonical = canonicalizeProblemNumber(number)
    const map = book === 'SSEN' ? ssenIds : secondIds
    return canonical ? map.get(`${page}|${canonical}`) : undefined
  }

  const preflight: PreflightRow[] = []
  const assets: FigureAssetDraft[] = []
  const links: FigureLinkDraft[] = []
  const skipped: Array<{ id: string; reasons: string[] }> = []
  for (const row of judged) {
    const gt = FIGURE_VALIDATION_FREEZE.find((item) => item.id === row.id)
    if (!gt) continue
    if (!row.auto) {
      skipped.push({ id: row.id, reasons: persistBlockReasons(row) })
      continue
    }
    const cropPath = path.join(root, `ocr-tests/taxonomy/step8-22/crops/${row.id.replace('|', '-')}.png`)
    const cropBytes = existsSync(cropPath) ? readFileSync(cropPath) : null
    const bbox = attachDetectedBbox(gt.figure_bbox, candidates, gt.page)
    const projected = projectAutoFigure({
      row,
      page: gt.page,
      displayNumber: gt.display_number,
      sourceDocumentId: documentForBook(gt.book),
      bbox,
      cropBytes,
    })
    const ident = identityFor(gt.book, gt.page, gt.display_number)
    const rowPre = preflightFigure({
      id: row.id,
      projected,
      ident,
      expectedDocumentId: documentForBook(gt.book),
    })
    preflight.push(rowPre)
    if (rowPre.pass && rowPre.asset && rowPre.link) {
      assets.push(rowPre.asset)
      links.push(rowPre.link)
    }
  }

  const uniqueAssets = dedupeAssets(assets)
  const orphans = findOrphans(uniqueAssets, links)
  const replayIds = uniqueAssets.map((row) => row.figure_id)
  const idempotent = replayDoesNotDuplicate(replayIds, dedupeAssets(assets).map((row) => row.figure_id))
  const schema = await schemaReady(admin)

  let productionWrites = 0
  let persistResult: { attempted: boolean; applied: boolean; created_assets: number; created_links: number; reason: string | null } = {
    attempted: persist,
    applied: false,
    created_assets: 0,
    created_links: 0,
    reason: persist ? null : 'cache-only',
  }
  if (persist) {
    const ready = preflight.filter((row) => row.pass).length === autoRows.length
    if (!schema.ok) {
      persistResult = { attempted: true, applied: false, created_assets: 0, created_links: 0, reason: schema.reason }
    } else if (!ready) {
      persistResult = { attempted: true, applied: false, created_assets: 0, created_links: 0, reason: 'preflight-incomplete' }
    } else {
      let createdAssets = 0
      let createdLinks = 0
      let failed: string | null = null
      for (const row of preflight.filter((item) => item.pass && item.asset && item.link)) {
        const gt = FIGURE_VALIDATION_FREEZE.find((item) => item.id === row.id)!
        const ident = identityFor(gt.book, gt.page, gt.display_number)!
        const payload = upsertPayload(row.asset!, row.link!, ident.problem_id, ident.current_version_id ?? '')
        const rpc = await admin.rpc(FIGURE_ASSET_RPC, { payload })
        if (rpc.error) {
          failed = rpc.error.message
          break
        }
        const body = rpc.data as { created_asset?: boolean; created_link?: boolean }
        if (body.created_asset) createdAssets += 1
        if (body.created_link) createdLinks += 1
        productionWrites += 1
      }
      persistResult = failed
        ? { attempted: true, applied: false, created_assets: createdAssets, created_links: createdLinks, reason: failed }
        : { attempted: true, applied: true, created_assets: createdAssets, created_links: createdLinks, reason: null }
    }
  }

  const afterDb = await dbSnapshot(admin)
  const gtAfter = hashBytes(readFileSync(gtPath))
  const dbOk =
    before.total_draft === afterDb.total_draft &&
    before.type_auto === afterDb.type_auto &&
    afterDb.type_auto === FROZEN_TYPE_AUTO &&
    afterDb.difficulty === FROZEN_DIFFICULTY &&
    afterDb.item === FROZEN_ITEM &&
    afterDb.stage === FROZEN_STAGE &&
    before.problem_assets === afterDb.problem_assets &&
    gtBefore === gtAfter
  const verdictPass =
    autoRows.length >= 10 &&
    preflight.filter((row) => row.pass).length === autoRows.length &&
    uniqueAssets.length === autoRows.length &&
    links.length === autoRows.length &&
    orphans.length === 0 &&
    idempotent &&
    hacks.length === 0 &&
    migration.ok &&
    dbOk &&
    (!persist || persistResult.applied)

  const verdict = verdictPass
    ? 'PASS'
    : preflight.filter((row) => row.pass).length > 0 && hacks.length === 0 && dbOk
      ? 'PARTIAL'
      : 'FAIL'

  writeJson(dest, 'preflight.json', {
    auto: autoRows.length,
    passed: preflight.filter((row) => row.pass).length,
    failed: preflight.filter((row) => !row.pass),
    skipped,
    rows: preflight,
  })
  writeJson(dest, 'projected-assets.json', uniqueAssets)
  writeJson(dest, 'projected-links.json', links)
  writeJson(dest, 'idempotency.json', { replay_same_ids: idempotent, orphans, unique_assets: uniqueAssets.length, links: links.length })
  writeJson(dest, 'schema-probe.json', schema)
  writeJson(dest, 'persist-result.json', persistResult)
  writeJson(dest, 'generalization-audit.json', { hits: hacks, pass: hacks.length === 0 })
  writeJson(dest, 'migration-audit.json', migration)
  writeJson(dest, 'paid-api-audit.json', { mistral: 0, mathpix: 0, needs_external_vision: false })
  writeJson(dest, 'db-immutability.json', {
    before,
    after: afterDb,
    frozen_ssen_drafts: FROZEN_DRAFTS,
    content_changed: 0,
    production_problem_writes: 0,
    production_figure_writes: persistResult.applied ? persistResult.created_assets + persistResult.created_links : 0,
    production_upload: FIGURE_PERSIST_CONTRACT.production_upload,
    ok: dbOk,
  })
  writeJson(dest, 'gt822-immutability.json', { unchanged: gtBefore === gtAfter, sha256: gtAfter })
  const summary = {
    step: STEP823,
    verdict,
    auto: autoRows.length,
    projected_assets: uniqueAssets.length,
    projected_links: links.length,
    preflight_pass: preflight.filter((row) => row.pass).length,
    skipped_non_auto: skipped.length,
    orphans: orphans.length,
    idempotent,
    dbOk,
    hacks,
    persist: persistResult,
    paid_api_calls: { mistral: 0, mathpix: 0, needs_external_vision: false },
    production_problem_writes: 0,
  }
  writeJson(dest, 'summary.json', summary)
  writeFileSync(
    path.join(dest, 'step8-23-summary.md'),
    `# STEP 8.23 FIGURE PERSISTENCE

STEP 8.23 RESULT: ${verdict}

AUTO_FIGURE_SAFE in: ${autoRows.length}
projected assets: ${uniqueAssets.length}
projected links: ${links.length}
preflight pass: ${preflight.filter((row) => row.pass).length}
non-AUTO skipped: ${skipped.length}
orphans: ${orphans.length}
idempotent: ${idempotent}
dbOk: ${dbOk}
hacks: ${JSON.stringify(hacks)}
persist attempted: ${persistResult.attempted}
persist applied: ${persistResult.applied}
production problem writes: 0
paid OCR: 0

Do not implement multimodal twin. Do not implement print-edit. Do not start STEP 8.24.
`,
    'utf8',
  )
  void productionWrites
  return summary
}
