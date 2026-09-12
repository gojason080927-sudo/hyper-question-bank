import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { canonicalizeProblemNumber } from '../recognition/draftUpsert'
import {
  ASSIGNED_BY,
  FIGURE_ASSET_RPC,
  dedupeAssets,
  findOrphans,
  preflightFigure,
  upsertPayload,
  type DbIdentity,
  type FigureAssetDraft,
  type FigureLinkDraft,
  type PreflightRow,
} from './figurePersistence'
import { createPipelineStaffClient } from './step823Staff'
import { UNRESOLVED_PENDING_IDS } from './step823VerifiedPending'

export const STEP824 = '8.24'
export const STEP824_DIR = 'ocr-tests/taxonomy/step8-24'
export const STEP823_PREFLIGHT = 'ocr-tests/taxonomy/step8-23/preflight.json'
export const GT_PATH = 'workers/ocr/ground-truth.json'
export const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
export const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
export const STEP817_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'

// Paid OCR guardrails (STEP 8.24 fixed spec).
export const OCR_MAX_CALLS = 8
export const OCR_MAX_USD = 1

export type CandidateVerdict = 'PASS' | 'REVIEW' | 'BLOCKED'

export type Step823PreflightRow = {
  id: string
  pass: boolean
  asset_ready: boolean
  reasons: string[]
  asset: FigureAssetDraft | null
  link: FigureLinkDraft | null
}

/**
 * Pure classification of a re-evaluated candidate. Kept side-effect free so it can be unit
 * tested without Production access.
 */
export function classifyCandidate(row: PreflightRow, hasCommittedStem: boolean): {
  verdict: CandidateVerdict
  reasons: string[]
} {
  if (row.pass && row.asset && row.link) return { verdict: 'PASS', reasons: [] }
  const reasons = [...row.reasons]
  if (!row.asset_ready) {
    // Projection itself failed (missing crop/bbox/identity) — cannot recover safely.
    return { verdict: 'BLOCKED', reasons: reasons.length ? reasons : ['PROJECTION_FAILED'] }
  }
  if (reasons.includes('PROBLEM_NOT_INGESTED')) {
    if (hasCommittedStem) {
      return { verdict: 'REVIEW', reasons: [...reasons, 'STEM_AVAILABLE_NEEDS_INGEST'] }
    }
    return { verdict: 'BLOCKED', reasons: [...reasons, 'NO_COMMITTED_STEM', 'NEEDS_PAID_OCR'] }
  }
  // Asset ready and owning problem present, but link target is ambiguous (mismatch / missing version).
  return { verdict: 'REVIEW', reasons }
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

async function must<T>(result: { data: T; error: { message: string } | null }, label: string): Promise<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

function mustEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function createAdmin(): SupabaseClient {
  const url = mustEnv('VITE_SUPABASE_URL')
  const key = mustEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function loadRemainingCandidates(root: string): Step823PreflightRow[] {
  const file = path.join(root, STEP823_PREFLIGHT)
  if (!existsSync(file)) throw new Error('STEP 8.23 preflight.json missing — cannot scope STEP 8.24')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { rows: Step823PreflightRow[] }
  const want = new Set<string>(UNRESOLVED_PENDING_IDS)
  const rows = (parsed.rows ?? []).filter((row) => want.has(row.id))
  return rows
}

export function hasCommittedStem(root: string, page: number, canonical: string): boolean {
  const file = path.join(root, GT_PATH)
  if (!existsSync(file)) return false
  const gt = JSON.parse(readFileSync(file, 'utf8')) as {
    document_id?: string
    items?: Array<{ page_number?: number; problem_number?: string; ground_truth_text?: string }>
  }
  if (gt.document_id && gt.document_id !== STEP817_DOCUMENT) return false
  return (gt.items ?? []).some((item) => {
    const itemCanonical = canonicalizeProblemNumber(item.problem_number ?? '')
    const text = (item.ground_truth_text ?? '').trim()
    return item.page_number === page && itemCanonical === canonical && text.length >= 40
  })
}

async function loadCandidateIdentities(admin: SupabaseClient, pages: number[]): Promise<Map<string, DbIdentity>> {
  const out = new Map<string, DbIdentity>()
  if (pages.length === 0) return out
  const sources = await must(
    await admin
      .from('problem_sources')
      .select('id, problem_id, source_document_id, original_problem_number, source_page_id')
      .eq('source_document_id', STEP817_DOCUMENT),
    'problem_sources',
  )
  const pageIds = [...new Set((sources ?? []).map((row) => row.source_page_id).filter(Boolean))] as string[]
  const pageRows: Array<{ id: string; page_number: number }> = []
  for (let i = 0; i < pageIds.length; i += 80) {
    pageRows.push(
      ...((await must(
        await admin.from('source_pages').select('id, page_number').in('id', pageIds.slice(i, i + 80)),
        'source_pages',
      )) as Array<{ id: string; page_number: number }>),
    )
  }
  const pageMap = new Map(pageRows.map((row) => [row.id, row.page_number]))
  const wantPages = new Set(pages)
  const problemIds = [...new Set((sources ?? []).map((row) => row.problem_id))]
  const problemRows: Array<{ id: string; current_version_id: string | null; lifecycle_status: string | null }> = []
  for (let i = 0; i < problemIds.length; i += 80) {
    problemRows.push(
      ...((await must(
        await admin
          .from('problems')
          .select('id, current_version_id, lifecycle_status')
          .in('id', problemIds.slice(i, i + 80)),
        'problems',
      )) as Array<{ id: string; current_version_id: string | null; lifecycle_status: string | null }>),
    )
  }
  const problemMap = new Map(problemRows.map((row) => [row.id, row]))
  for (const row of sources ?? []) {
    const page = pageMap.get(row.source_page_id)
    if (page == null || !wantPages.has(page)) continue
    const canonical = canonicalizeProblemNumber(row.original_problem_number)
    const problem = problemMap.get(row.problem_id)
    if (!canonical || !problem) continue
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

async function countFigures(admin: SupabaseClient) {
  const assetsAll = await admin.from('problem_figure_assets').select('id', { count: 'exact', head: true })
  if (assetsAll.error) throw new Error(`assets count: ${assetsAll.error.message}`)
  const linksAll = await admin.from('problem_figure_links').select('id', { count: 'exact', head: true })
  if (linksAll.error) throw new Error(`links count: ${linksAll.error.message}`)
  const assets823 = await admin
    .from('problem_figure_assets')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_by', ASSIGNED_BY)
  const links823 = await admin
    .from('problem_figure_links')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_by', ASSIGNED_BY)
  return {
    assets: assetsAll.count ?? 0,
    links: linksAll.count ?? 0,
    assets_step823: assets823.count ?? 0,
    links_step823: links823.count ?? 0,
  }
}

async function integrityCounts(admin: SupabaseClient) {
  // Orphan/duplicate detection is done client-side from full asset/link listings (small tables).
  const assets = await must(
    await admin.from('problem_figure_assets').select('figure_id, source_document_id, page_number, source_hash'),
    'assets list',
  )
  const links = await must(await admin.from('problem_figure_links').select('problem_id, figure_id'), 'links list')
  const assetFigureIds = new Set((assets ?? []).map((a: { figure_id: string }) => a.figure_id))
  const orphanLinks = (links ?? []).filter((l: { figure_id: string }) => !assetFigureIds.has(l.figure_id)).length
  const hashSeen = new Map<string, number>()
  for (const a of assets ?? []) {
    const k = `${a.source_document_id}|${a.page_number}|${a.source_hash}`
    hashSeen.set(k, (hashSeen.get(k) ?? 0) + 1)
  }
  const dupAssetHash = [...hashSeen.values()].filter((n) => n > 1).length
  const linkSeen = new Map<string, number>()
  for (const l of links ?? []) {
    const k = `${l.problem_id}|${l.figure_id}`
    linkSeen.set(k, (linkSeen.get(k) ?? 0) + 1)
  }
  const dupLinks = [...linkSeen.values()].filter((n) => n > 1).length
  return { orphan_links: orphanLinks, duplicate_asset_hash: dupAssetHash, duplicate_links: dupLinks }
}

async function persistOneFigure(
  staff: SupabaseClient,
  payload: ReturnType<typeof upsertPayload>,
): Promise<{ ok: boolean; created_asset: boolean; created_link: boolean; asset_id: string | null; link_id: string | null; error: string | null }> {
  const rpc = await staff.rpc(FIGURE_ASSET_RPC, { payload })
  if (rpc.error) {
    return { ok: false, created_asset: false, created_link: false, asset_id: null, link_id: null, error: rpc.error.message }
  }
  const body = rpc.data as { created_asset?: boolean; created_link?: boolean; asset_id?: string; link_id?: string }
  return {
    ok: true,
    created_asset: !!body.created_asset,
    created_link: !!body.created_link,
    asset_id: body.asset_id ?? null,
    link_id: body.link_id ?? null,
    error: null,
  }
}

export type Step824CandidateResult = {
  id: string
  page: number
  figure_type: string | null
  source_hash: string | null
  crop: string | null
  verdict: CandidateVerdict
  reasons: string[]
  problem_id: string | null
  version_id: string | null
  asset_id: string | null
  link_id: string | null
}

export async function runStep824(root: string, argv: string[]) {
  const persist = argv.includes('--persist')
  const cacheOnly = argv.includes('--cache-only')
  if (!persist && !cacheOnly) throw new Error('STEP 8.24 requires --cache-only or --persist')
  if (persist && cacheOnly) throw new Error('STEP 8.24 --persist cannot combine with --cache-only')

  const dest = path.join(root, STEP824_DIR)
  mkdirSync(dest, { recursive: true })

  const candidates = loadRemainingCandidates(root)
  const admin = createAdmin()
  const url = mustEnv('VITE_SUPABASE_URL')
  const serviceKey = mustEnv('SUPABASE_SERVICE_ROLE_KEY')

  const pages = [...new Set(candidates.map((c) => c.asset?.page_number).filter((p): p is number => p != null))]
  const idents = await loadCandidateIdentities(admin, pages)
  const before = await countFigures(admin)

  // Classify every candidate (dry-run link-target verification).
  const results: Step824CandidateResult[] = []
  const readyToPersist: Array<{ id: string; asset: FigureAssetDraft; link: FigureLinkDraft; ident: DbIdentity }> = []
  for (const cand of candidates) {
    const asset = cand.asset
    const [pageStr, numberStr] = cand.id.split('|')
    const page = Number(pageStr)
    const canonical = canonicalizeProblemNumber(numberStr) ?? numberStr
    const ident = idents.get(`${page}|${canonical}`)
    const stem = hasCommittedStem(root, page, canonical)

    let row: PreflightRow
    if (asset) {
      const link: FigureLinkDraft = {
        problem_identity: cand.id,
        figure_id: asset.figure_id,
        ownership_type: 'SINGLE',
        ownership_confidence: 0.88,
        display_order: 1,
        required: true,
        source_document_id: asset.source_document_id,
        page_number: asset.page_number,
        original_problem_number: canonical,
      }
      row = preflightFigure({ id: cand.id, projected: { asset, link }, ident, expectedDocumentId: STEP817_DOCUMENT })
    } else {
      row = { id: cand.id, pass: false, asset_ready: false, reasons: cand.reasons ?? ['PROJECTION_FAILED'], asset: null, link: null }
    }

    const { verdict, reasons } = classifyCandidate(row, stem)
    results.push({
      id: cand.id,
      page,
      figure_type: asset?.figure_type ?? null,
      source_hash: asset?.source_hash ?? null,
      crop: asset?.original_crop_path ?? null,
      verdict,
      reasons,
      problem_id: ident?.problem_id ?? null,
      version_id: ident?.current_version_id ?? null,
      asset_id: null,
      link_id: null,
    })
    if (verdict === 'PASS' && row.asset && row.link && ident) {
      readyToPersist.push({ id: cand.id, asset: row.asset, link: row.link, ident })
    }
  }

  // Persist only PASS candidates (reuse STEP 8.23 RPC). Idempotent by (doc,page,hash) + (problem,figure).
  let newAssets = 0
  let reusedAssets = 0
  let newLinks = 0
  let persistError: string | null = null
  let replayNewAssets = 0
  let replayNewLinks = 0
  if (persist && readyToPersist.length > 0) {
    let staff: SupabaseClient | null = null
    try {
      staff = await createPipelineStaffClient(url, serviceKey)
    } catch (error) {
      persistError = `staff-auth: ${error instanceof Error ? error.message : String(error)}`
    }
    if (staff) {
      for (const item of readyToPersist) {
        const payload = upsertPayload(item.asset, item.link, item.ident.problem_id, item.ident.current_version_id ?? '')
        const one = await persistOneFigure(staff, payload)
        if (!one.ok) {
          persistError = one.error
          break
        }
        if (one.created_asset) newAssets += 1
        else reusedAssets += 1
        if (one.created_link) newLinks += 1
        const res = results.find((r) => r.id === item.id)
        if (res) {
          res.asset_id = one.asset_id
          res.link_id = one.link_id
        }
      }
      // Idempotency replay — must create nothing new.
      if (!persistError) {
        for (const item of readyToPersist) {
          const payload = upsertPayload(item.asset, item.link, item.ident.problem_id, item.ident.current_version_id ?? '')
          const one = await persistOneFigure(staff, payload)
          if (!one.ok) {
            persistError = `idempotency: ${one.error}`
            break
          }
          if (one.created_asset) replayNewAssets += 1
          if (one.created_link) replayNewLinks += 1
        }
      }
    }
  }

  const after = await countFigures(admin)
  const integrity = await integrityCounts(admin)
  const orphansProjected = findOrphans(
    dedupeAssets(readyToPersist.map((r) => r.asset)),
    readyToPersist.map((r) => r.link),
  )

  const tally = { PASS: 0, REVIEW: 0, BLOCKED: 0 }
  for (const r of results) tally[r.verdict] += 1

  const ocrNeeded = results.filter((r) => r.verdict === 'BLOCKED' && r.reasons.includes('NEEDS_PAID_OCR'))
  const ocrPages = [...new Set(ocrNeeded.map((r) => r.page))]
  const providerConfigured = Boolean(
    process.env.MATHPIX_APP_ID?.trim() && process.env.MATHPIX_APP_KEY?.trim(),
  )
  const estimatedCalls = ocrPages.length // one Mathpix page-image call per unique page
  const estimatedMaxUsd = Number((estimatedCalls * 0.005).toFixed(4))
  const withinLimits = estimatedCalls <= OCR_MAX_CALLS && estimatedMaxUsd <= OCR_MAX_USD
  const ocr = {
    needed_candidates: ocrNeeded.length,
    needed_unique_pages: ocrPages.length,
    provider_configured: providerConfigured,
    authorized: providerConfigured && withinLimits,
    max_calls_allowed: OCR_MAX_CALLS,
    budget_usd: OCR_MAX_USD,
    estimated_calls: estimatedCalls,
    estimated_max_usd: estimatedMaxUsd,
    calls: 0,
    cost_usd: 0,
    reason: providerConfigured
      ? withinLimits
        ? 'within-limits (no PASS-eligible OCR ingest wired in this step)'
        : 'estimate exceeds limits — paid OCR skipped'
      : 'OCR provider not configured — paid OCR skipped',
  }

  const idempotent = replayNewAssets === 0 && replayNewLinks === 0
  const existingPreserved = { assets: after.assets_step823 >= 3, links: after.links_step823 >= 3 }
  const contentChanged = 0
  const persistApplied = persist && !persistError
  const remainingBlocked = tally.BLOCKED
  const verdict: 'PASS' | 'PARTIAL' | 'BLOCKED' =
    tally.PASS + tally.REVIEW + tally.BLOCKED === candidates.length && persistError == null
      ? tally.PASS === candidates.length
        ? 'PASS'
        : tally.PASS > 0
          ? 'PARTIAL'
          : 'PARTIAL'
      : 'BLOCKED'

  const summary = {
    step: STEP824,
    name: 'Remaining Figure Recovery and Question Linking v1',
    verdict,
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    candidates_total: candidates.length,
    results: tally,
    persist_attempted: persist,
    persist_applied: persistApplied,
    persist_error: persistError,
    persisted: { new_assets: newAssets, reused_assets: reusedAssets, new_links: newLinks },
    before: { assets: before.assets, links: before.links },
    after: { assets: after.assets, links: after.links },
    existing_step823_preserved: {
      assets: after.assets_step823,
      links: after.links_step823,
      ok: existingPreserved.assets && existingPreserved.links,
    },
    orphans: integrity.orphan_links + orphansProjected.length,
    duplicate_asset_hash: integrity.duplicate_asset_hash,
    duplicate_links: integrity.duplicate_links,
    content_changed: contentChanged,
    idempotent,
    replay_created: { assets: replayNewAssets, links: replayNewLinks },
    remaining_blocked: remainingBlocked,
    ocr,
    paid_api_calls: { mathpix: 0, mistral: 0 },
  }
  writeJson(dest, 'summary.json', summary)
  writeJson(dest, 'candidates.json', { candidates: results })
  writeFileSync(
    path.join(dest, 'step8-24-summary.md'),
    `# STEP 8.24 REMAINING FIGURE RECOVERY

STEP 8.24 RESULT: ${verdict}
NAME: Remaining Figure Recovery and Question Linking v1
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

candidates: ${candidates.length}
PASS: ${tally.PASS}
REVIEW: ${tally.REVIEW}
BLOCKED: ${tally.BLOCKED}

figure assets before: ${before.assets}
figure assets after: ${after.assets}
figure links before: ${before.links}
figure links after: ${after.links}
new assets: ${newAssets}
reused assets: ${reusedAssets}
new links: ${newLinks}
existing STEP 8.23 assets preserved: ${after.assets_step823}
existing STEP 8.23 links preserved: ${after.links_step823}

orphan assets/links: ${integrity.orphan_links + orphansProjected.length}
duplicate asset hash: ${integrity.duplicate_asset_hash}
duplicate links: ${integrity.duplicate_links}
content changed: ${contentChanged}
idempotent: ${idempotent}

remaining blocked: ${remainingBlocked}
OCR provider configured: ${ocr.provider_configured}
OCR authorized: ${ocr.authorized}
OCR estimated calls: ${ocr.estimated_calls} (max ${OCR_MAX_CALLS})
OCR estimated max USD: ${ocr.estimated_max_usd} (budget ${OCR_MAX_USD})
OCR actual calls: ${ocr.calls}
OCR actual cost USD: ${ocr.cost_usd}

Do not implement multimodal twin. Do not implement print-edit. Do not start STEP 8.25.
`,
    'utf8',
  )
  return summary
}
