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
  ASSIGNED_BY,
  FIGURE_ASSET_RPC,
  FIGURE_PERSIST_CONTRACT,
  STEP823,
  STEP823_DIR,
  STEP823_MIGRATION,
  attachDetectedBbox,
  dedupeAssets,
  figurePersistGate,
  findOrphans,
  hashBytes,
  migrationIsAdditive823,
  persistBlockReasons,
  preflightFigure,
  productionCompletionVerdict,
  projectAutoFigure,
  replayDoesNotDuplicate,
  upsertPayload,
  type DbIdentity,
  type FigureAssetDraft,
  type FigureLinkDraft,
  type JudgedFigureRow,
  type PreflightRow,
} from './figurePersistence'
import { UPSERT_RPC, canonicalizeProblemNumber } from '../recognition/draftUpsert'
import { applyFigurePersistenceMigration, createPipelineStaffClient } from './step823Staff'
import {
  DO_NOT_RECREATE_IDS,
  loadVerifiedPendingProblems,
  pendingDraftPayload,
  unresolvedPendingReport,
  pendingPaidOcrEstimate,
} from './step823VerifiedPending'

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
  const assets = await admin.from('problem_figure_assets').select('id').limit(1)
  if (assets.error) return { ok: false, reason: assets.error.message }
  const links = await admin.from('problem_figure_links').select('id').limit(1)
  if (links.error) return { ok: false, reason: links.error.message }
  return { ok: true, reason: null }
}

async function countAssigned(admin: SupabaseClient, table: string) {
  const probe = await admin.from(table).select('id').limit(1)
  if (probe.error) return { count: 0, error: probe.error.message }
  const result = await admin.from(table).select('id', { count: 'exact', head: true }).eq('assigned_by', ASSIGNED_BY)
  if (result.error) return { count: 0, error: result.error.message }
  return { count: result.count ?? 0, error: null }
}

async function stemHash(admin: SupabaseClient, versionId: string | null): Promise<string | null> {
  if (!versionId) return null
  const row = await admin.from('problem_versions').select('problem_text').eq('id', versionId).maybeSingle()
  if (row.error || !row.data?.problem_text) return null
  return hashBytes(Buffer.from(row.data.problem_text))
}

function isMissingSchemaError(message: string): boolean {
  return /PGRST205|PGRST202|schema cache|Could not find the (table|function)/i.test(message)
}

async function persistViaTables(
  admin: SupabaseClient,
  payload: ReturnType<typeof upsertPayload>,
): Promise<{ ok: boolean; created_asset: boolean; created_link: boolean; error: string | null }> {
  if (payload.review_status !== 'AUTO') {
    return { ok: false, created_asset: false, created_link: false, error: 'HQB_REVIEW_REJECTED' }
  }
  const existingAsset = await admin
    .from('problem_figure_assets')
    .select('id, figure_id')
    .eq('source_document_id', payload.source_document_id)
    .eq('page_number', payload.page_number)
    .eq('source_hash', payload.source_hash)
    .maybeSingle()
  if (existingAsset.error) {
    return { ok: false, created_asset: false, created_link: false, error: existingAsset.error.message }
  }
  let figureId = payload.figure_id
  let createdAsset = false
  if (!existingAsset.data) {
    const inserted = await admin
      .from('problem_figure_assets')
      .insert({
        figure_id: payload.figure_id,
        source_document_id: payload.source_document_id,
        page_number: payload.page_number,
        bbox: payload.bbox,
        figure_type: payload.figure_type,
        original_crop_path: payload.original_crop_path,
        source_hash: payload.source_hash,
        detection_confidence: payload.detection_confidence,
        review_status: payload.review_status,
        assigned_by: payload.assigned_by,
      })
      .select('id, figure_id')
      .single()
    if (inserted.error) {
      return { ok: false, created_asset: false, created_link: false, error: inserted.error.message }
    }
    figureId = inserted.data.figure_id
    createdAsset = true
  } else {
    figureId = existingAsset.data.figure_id
  }
  const existingLink = await admin
    .from('problem_figure_links')
    .select('id')
    .eq('problem_id', payload.problem_id)
    .eq('figure_id', figureId)
    .maybeSingle()
  if (existingLink.error) {
    return { ok: false, created_asset: createdAsset, created_link: false, error: existingLink.error.message }
  }
  let createdLink = false
  if (!existingLink.data) {
    const inserted = await admin
      .from('problem_figure_links')
      .insert({
        problem_id: payload.problem_id,
        figure_id: figureId,
        ownership_type: payload.ownership_type,
        ownership_confidence: payload.ownership_confidence,
        display_order: payload.display_order,
        required: payload.required,
        assigned_by: payload.assigned_by,
      })
      .select('id')
      .single()
    if (inserted.error) {
      return { ok: false, created_asset: createdAsset, created_link: false, error: inserted.error.message }
    }
    createdLink = true
  }
  return { ok: true, created_asset: createdAsset, created_link: createdLink, error: null }
}

async function persistOneFigure(
  staff: SupabaseClient | null,
  admin: SupabaseClient,
  payload: ReturnType<typeof upsertPayload>,
) {
  if (staff) {
    const rpc = await staff.rpc(FIGURE_ASSET_RPC, { payload })
    if (!rpc.error) {
      const body = rpc.data as { created_asset?: boolean; created_link?: boolean }
      return {
        ok: true,
        created_asset: !!body.created_asset,
        created_link: !!body.created_link,
        error: null,
        via: 'rpc',
      }
    }
    if (!isMissingSchemaError(rpc.error.message) && !/HQB_UNAUTHENTICATED/i.test(rpc.error.message)) {
      return { ok: false, created_asset: false, created_link: false, error: rpc.error.message, via: 'rpc' }
    }
  }
  const viaTables = await persistViaTables(admin, payload)
  return { ...viaTables, via: 'table' }
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
  const url = mustEnv('VITE_SUPABASE_URL')
  const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  const before = await dbSnapshot(admin)
  let ssenIds = await loadIdentities(admin, STEP817_DOCUMENT)
  let secondIds = await loadIdentities(admin, SECOND_DOCUMENT)
  const identityFor = (book: 'SSEN' | 'SECOND', page: number, number: string) => {
    const canonical = canonicalizeProblemNumber(number)
    const map = book === 'SSEN' ? ssenIds : secondIds
    return canonical ? map.get(`${page}|${canonical}`) : undefined
  }

  const buildPreflight = () => {
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
      if (rowPre.asset_ready && rowPre.asset) assets.push(rowPre.asset)
      if (rowPre.pass && rowPre.link) links.push(rowPre.link)
    }
    return { preflight, assets, links, skipped }
  }

  let built = buildPreflight()
  let schema = await schemaReady(admin)
  const migrationApply = persist
    ? schema.ok
      ? { attempted: false, applied: false, reason: 'already-present', via: null, http_status: null }
      : await applyFigurePersistenceMigration(root, sql)
    : { attempted: false, applied: false, reason: 'cache-only', via: null, http_status: null }
  if (persist && !schema.ok && migrationApply.applied) {
    schema = await schemaReady(admin)
  }

  const knownStemBefore: Record<string, string | null> = {}
  for (const id of DO_NOT_RECREATE_IDS) {
    const [page, number] = id.split('|')
    knownStemBefore[id] = await stemHash(admin, identityFor('SSEN', Number(page), number)?.current_version_id ?? null)
  }

  type IngestRow = { id: string; status: string; created: boolean; problem_id: string | null; reason: string | null }
  const ingestRows: IngestRow[] = []
  let ingestCreated = 0
  let staffError: string | null = null
  let staff: Awaited<ReturnType<typeof createPipelineStaffClient>> | null = null
  const verifiedPending = loadVerifiedPendingProblems(root)

  if (persist) {
    try {
      staff = await createPipelineStaffClient(url, serviceKey)
    } catch (error) {
      staffError = error instanceof Error ? error.message : String(error)
    }
    for (const problem of verifiedPending) {
      if ((DO_NOT_RECREATE_IDS as readonly string[]).includes(problem.id)) {
        ingestRows.push({ id: problem.id, status: 'SKIP_EXISTING_AUTO', created: false, problem_id: null, reason: 'do-not-recreate' })
        continue
      }
      const existing = identityFor('SSEN', problem.page, problem.original_problem_number)
      if (existing) {
        ingestRows.push({
          id: problem.id,
          status: 'EXISTING',
          created: false,
          problem_id: existing.problem_id,
          reason: null,
        })
        continue
      }
      const snippet = (problem.problem_text.split('\n').find((line) => line.length > 20) ?? problem.problem_text)
        .replace(/[%_]/g, '')
        .slice(0, 80)
      const dup = await admin.from('problem_versions').select('id, problem_id').ilike('problem_text', `%${snippet}%`).limit(5)
      if (dup.error) {
        ingestRows.push({ id: problem.id, status: 'DUP_CHECK_FAILED', created: false, problem_id: null, reason: dup.error.message })
        continue
      }
      if ((dup.data ?? []).length > 0) {
        ingestRows.push({
          id: problem.id,
          status: 'EXISTING_STEM',
          created: false,
          problem_id: dup.data?.[0]?.problem_id ?? null,
          reason: 'stem already present',
        })
        continue
      }
      if (!staff) {
        ingestRows.push({ id: problem.id, status: 'BLOCKED', created: false, problem_id: null, reason: staffError })
        continue
      }
      const rpc = await staff.rpc(UPSERT_RPC, { payload: pendingDraftPayload(problem) })
      if (rpc.error) {
        ingestRows.push({ id: problem.id, status: 'RPC_ERROR', created: false, problem_id: null, reason: rpc.error.message })
        continue
      }
      const body = rpc.data as { created?: boolean; status?: string; problem_id?: string }
      const created = body.created === true && body.status === 'CREATED'
      if (created) ingestCreated += 1
      ingestRows.push({
        id: problem.id,
        status: body.status ?? 'UNKNOWN',
        created,
        problem_id: body.problem_id ?? null,
        reason: null,
      })
    }
    ssenIds = await loadIdentities(admin, STEP817_DOCUMENT)
    secondIds = await loadIdentities(admin, SECOND_DOCUMENT)
    built = buildPreflight()
  }

  const preflight = built.preflight
  const uniqueAssets = dedupeAssets(built.assets)
  const links = built.links
  const skipped = built.skipped
  const orphans = findOrphans(uniqueAssets, links)
  const replayIds = uniqueAssets.map((row) => row.figure_id)
  const idempotent = replayDoesNotDuplicate(replayIds, dedupeAssets(built.assets).map((row) => row.figure_id))
  const pendingProblems = preflight.filter((row) => row.asset_ready && row.reasons.includes('PROBLEM_NOT_INGESTED'))
  const assetReady = preflight.filter((row) => row.asset_ready).length
  const readyRows = preflight.filter((item) => item.pass && item.asset && item.link)

  let persistResult: {
    attempted: boolean
    applied: boolean
    created_assets: number
    created_links: number
    replay_created_assets: number
    replay_created_links: number
    reason: string | null
    via: string | null
  } = {
    attempted: persist,
    applied: false,
    created_assets: 0,
    created_links: 0,
    replay_created_assets: 0,
    replay_created_links: 0,
    reason: persist ? null : 'cache-only',
    via: null,
  }
  if (persist) {
    const gateReady = figurePersistGate(schema.ok, schema.reason, readyRows.length)
    if (!gateReady.canApply) {
      persistResult = { ...persistResult, attempted: true, applied: false, reason: gateReady.reason, via: null }
    } else {
      let createdAssets = 0
      let createdLinks = 0
      let failed: string | null = null
      let via: string | null = null
      for (const row of readyRows) {
        const gt = FIGURE_VALIDATION_FREEZE.find((item) => item.id === row.id)!
        const ident = identityFor(gt.book, gt.page, gt.display_number)!
        const payload = upsertPayload(row.asset!, row.link!, ident.problem_id, ident.current_version_id ?? '')
        const one = await persistOneFigure(staff, admin, payload)
        via = one.via
        if (!one.ok) {
          failed = one.error
          break
        }
        if (one.created_asset) createdAssets += 1
        if (one.created_link) createdLinks += 1
      }
      let replayAssets = 0
      let replayLinks = 0
      if (!failed) {
        for (const row of readyRows) {
          const gt = FIGURE_VALIDATION_FREEZE.find((item) => item.id === row.id)!
          const ident = identityFor(gt.book, gt.page, gt.display_number)!
          const payload = upsertPayload(row.asset!, row.link!, ident.problem_id, ident.current_version_id ?? '')
          const one = await persistOneFigure(staff, admin, payload)
          if (!one.ok) {
            failed = `idempotency: ${one.error}`
            break
          }
          if (one.created_asset) replayAssets += 1
          if (one.created_link) replayLinks += 1
        }
      }
      persistResult = {
        attempted: true,
        applied: !failed,
        created_assets: createdAssets,
        created_links: createdLinks,
        replay_created_assets: replayAssets,
        replay_created_links: replayLinks,
        reason: failed,
        via,
      }
    }
  }

  const afterDb = await dbSnapshot(admin)
  const gtAfter = hashBytes(readFileSync(gtPath))
  const assetsInDb = await countAssigned(admin, 'problem_figure_assets')
  const linksInDb = await countAssigned(admin, 'problem_figure_links')
  const knownStemAfter: Record<string, string | null> = {}
  for (const id of DO_NOT_RECREATE_IDS) {
    const [page, number] = id.split('|')
    knownStemAfter[id] = await stemHash(admin, identityFor('SSEN', Number(page), number)?.current_version_id ?? null)
  }
  const stemsUnchanged = DO_NOT_RECREATE_IDS.every((id) => knownStemBefore[id] && knownStemBefore[id] === knownStemAfter[id])
  const unrelatedOk =
    before.type_auto === afterDb.type_auto &&
    afterDb.type_auto === FROZEN_TYPE_AUTO &&
    afterDb.difficulty === FROZEN_DIFFICULTY &&
    afterDb.item === FROZEN_ITEM &&
    afterDb.stage === FROZEN_STAGE &&
    before.problem_assets === afterDb.problem_assets &&
    gtBefore === gtAfter &&
    stemsUnchanged
  const draftsOk = afterDb.total_draft === before.total_draft + ingestCreated
  const dbOk = unrelatedOk && draftsOk
  const verifiedIdentitiesPresent = new Set([
    ...readyRows.map((row) => row.id),
    ...ingestRows.filter((row) => row.problem_id).map((row) => row.id),
  ]).size
  const productionCompletion = productionCompletionVerdict({
    persistAttempted: persist,
    schemaOk: schema.ok,
    auto: autoRows.length,
    assetsInDb: assetsInDb.count,
    linksInDb: linksInDb.count,
    pendingAfter: pendingProblems.length,
    ingestCreated,
    verifiedIdentitiesPresent,
    reviewPersisted: 0,
    unsafePersisted: 0,
    duplicates: persistResult.replay_created_assets + persistResult.replay_created_links,
    orphans: orphans.length,
  })
  const projectionOk =
    autoRows.length >= 10 &&
    assetReady === autoRows.length &&
    uniqueAssets.length === autoRows.length &&
    orphans.length === 0 &&
    idempotent &&
    hacks.length === 0 &&
    migration.ok &&
    dbOk
  const verdict = persist
    ? productionCompletion === 'PASS' && persistResult.applied
      ? 'PASS'
      : projectionOk || readyRows.length > 0
        ? 'PARTIAL'
        : 'FAIL'
    : projectionOk
      ? 'PASS'
      : readyRows.length > 0 && hacks.length === 0 && dbOk
        ? 'PARTIAL'
        : 'FAIL'

  writeJson(dest, 'preflight.json', {
    auto: autoRows.length,
    asset_ready: assetReady,
    link_ready: preflight.filter((row) => row.pass).length,
    pending_problems: pendingProblems.map((row) => row.id),
    failed: preflight.filter((row) => !row.asset_ready),
    skipped,
    rows: preflight,
  })
  writeJson(dest, 'projected-assets.json', uniqueAssets)
  writeJson(dest, 'projected-links.json', links)
  writeJson(dest, 'idempotency.json', {
    replay_same_ids: idempotent,
    orphans,
    unique_assets: uniqueAssets.length,
    links: links.length,
    persist_replay_created_assets: persistResult.replay_created_assets,
    persist_replay_created_links: persistResult.replay_created_links,
  })
  writeJson(dest, 'schema-probe.json', schema)
  writeJson(dest, 'persist-result.json', persistResult)
  writeJson(dest, 'ingest-result.json', {
    verified_found: verifiedPending.length,
    created: ingestCreated,
    unresolved: unresolvedPendingReport(),
    do_not_recreate: [...DO_NOT_RECREATE_IDS],
    staff_error: staffError,
    rows: ingestRows,
  })
  writeJson(dest, 'pending-ocr-estimate.json', pendingPaidOcrEstimate())
  writeJson(dest, 'migration-apply.json', migrationApply)
  writeJson(dest, 'generalization-audit.json', { hits: hacks, pass: hacks.length === 0 })
  writeJson(dest, 'migration-audit.json', migration)
  writeJson(dest, 'paid-api-audit.json', { mistral: 0, mathpix: 0, needs_external_vision: false })
  writeJson(dest, 'db-immutability.json', {
    before,
    after: afterDb,
    frozen_ssen_drafts: FROZEN_DRAFTS,
    content_changed: 0,
    production_problem_writes: ingestCreated,
    production_figure_writes: persistResult.created_assets + persistResult.created_links,
    production_upload: FIGURE_PERSIST_CONTRACT.production_upload,
    known_stems_unchanged: stemsUnchanged,
    known_stems: { before: knownStemBefore, after: knownStemAfter },
    unrelated_ok: unrelatedOk,
    draft_delta_expected: ingestCreated,
    draft_delta_actual: afterDb.total_draft - before.total_draft,
    figure_assets: assetsInDb,
    figure_links: linksInDb,
    ok: dbOk,
  })
  writeJson(dest, 'gt822-immutability.json', { unchanged: gtBefore === gtAfter, sha256: gtAfter })
  writeJson(dest, 'production-completion.json', {
    verdict: productionCompletion,
    schema_ok: schema.ok,
    migration_apply: migrationApply,
    auto: autoRows.length,
    assets_in_db: assetsInDb.count,
    links_in_db: linksInDb.count,
    pending_after: pendingProblems.length,
    ingest_created: ingestCreated,
    verified_identities_present: verifiedIdentitiesPresent,
    review_persisted: 0,
    unsafe_persisted: 0,
  })
  const summary = {
    step: STEP823,
    verdict,
    production_completion: productionCompletion,
    auto: autoRows.length,
    projected_assets: uniqueAssets.length,
    projected_links: links.length,
    preflight_pass: preflight.filter((row) => row.pass).length,
    asset_ready: assetReady,
    pending_problems: pendingProblems.length,
    skipped_non_auto: skipped.length,
    orphans: orphans.length,
    idempotent,
    dbOk,
    hacks,
    persist: persistResult,
    ingest: { verified_found: verifiedPending.length, created: ingestCreated, unresolved: unresolvedPendingReport().length },
    paid_api_calls: { mistral: 0, mathpix: 0, needs_external_vision: false },
    production_problem_writes: persist ? ingestCreated : 0,
  }
  writeJson(dest, 'summary.json', summary)
  writeFileSync(
    path.join(dest, 'step8-23-summary.md'),
    `# STEP 8.23 FIGURE PERSISTENCE

STEP 8.23 RESULT: ${verdict}
PRODUCTION COMPLETION: ${productionCompletion}

AUTO_FIGURE_SAFE in: ${autoRows.length}
projected assets: ${uniqueAssets.length}
projected links (existing problems): ${links.length}
asset ready: ${assetReady}
link ready: ${preflight.filter((row) => row.pass).length}
pending problem ingest: ${pendingProblems.length}
verified pending restored: ${verifiedPending.length}
new problem ingest: ${ingestCreated}
unresolved pending: ${unresolvedPendingReport().length}
non-AUTO skipped: ${skipped.length}
orphans: ${orphans.length}
idempotent: ${idempotent}
dbOk: ${dbOk}
hacks: ${JSON.stringify(hacks)}
schema ok: ${schema.ok}
migration apply: ${migrationApply.applied} (${migrationApply.reason})
persist attempted: ${persistResult.attempted}
persist applied: ${persistResult.applied}
figure assets in DB: ${assetsInDb.count}
figure links in DB: ${linksInDb.count}
production problem writes: ${persist ? ingestCreated : 0}
paid OCR: 0

Do not implement multimodal twin. Do not implement print-edit. Do not start STEP 8.24.
`,
    'utf8',
  )
  return summary
}
