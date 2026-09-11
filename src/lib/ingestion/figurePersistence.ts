import { createHash } from 'node:crypto'
import { FIGURE_DB_CONTRACT, matchDetectedToTruth, type VisualFigureCandidate } from './visualFigureV1'
import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { canonicalizeProblemNumber } from '../recognition/draftUpsert'

export const STEP823 = '8.23'
export const STEP823_DIR = 'ocr-tests/taxonomy/step8-23'
export const STEP823_MIGRATION = 'supabase/migrations/20260911123000_hqb_figure_persistence_v1.sql'
export const FIGURE_ASSET_RPC = 'hqb_upsert_problem_figure'
export const FIGURE_DELETE_TEST_RPC = 'hqb_delete_test_figure_persistence'
export const ASSIGNED_BY = 'STEP_8_23'
export const ROLLBACK_ASSIGNED_BY = 'STEP_8_23_ROLLBACK_TEST'

export const FIGURE_PERSIST_CONTRACT = {
  ...FIGURE_DB_CONTRACT,
  implemented_in: STEP823,
  persist_auto_only: true,
  duplicate_pixels: false,
  production_upload: false,
  multimodal: false,
  print_edit: false,
  overwrite_problems: false,
}

export type JudgedFigureRow = {
  id: string
  book: 'SSEN' | 'SECOND'
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
}

export type FigureAssetDraft = {
  figure_id: string
  source_document_id: string
  page_number: number
  bbox: NormalizedBBox
  figure_type: string
  original_crop_path: string
  source_hash: string
  detection_confidence: number
  review_status: 'AUTO'
  assigned_by: string
}

export type FigureLinkDraft = {
  problem_identity: string
  figure_id: string
  ownership_type: 'SINGLE' | 'SHARED'
  ownership_confidence: number
  display_order: number
  required: boolean
  source_document_id: string
  page_number: number
  original_problem_number: string
}

export type DbIdentity = {
  problem_id: string
  problem_source_id: string
  source_document_id: string
  page: number
  problem_number: string
  current_version_id: string | null
  lifecycle_status: string | null
}

export type PreflightRow = {
  id: string
  pass: boolean
  asset_ready: boolean
  reasons: string[]
  asset: FigureAssetDraft | null
  link: FigureLinkDraft | null
}

export function cropRelPath(id: string): string {
  return `ocr-tests/taxonomy/step8-22/crops/${id.replace('|', '-')}.png`
}

export function figureIdFromHash(sourceDocumentId: string, page: number, sourceHash: string): string {
  const material = `${sourceDocumentId}|${page}|${sourceHash}`
  return `fig_${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

export function hashBytes(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function identityKey(page: number, number: string): string {
  const canonical = canonicalizeProblemNumber(number) ?? number.trim()
  return `${page}|${canonical}`
}

export function ownershipType(status: string | null): 'SINGLE' | 'SHARED' {
  return status?.startsWith('SHARED') ? 'SHARED' : 'SINGLE'
}

export function attachDetectedBbox(
  gtBbox: NormalizedBBox,
  candidates: VisualFigureCandidate[],
  page: number,
): NormalizedBBox | null {
  const matched = matchDetectedToTruth(
    candidates.filter((cand) => cand.page === page),
    gtBbox,
  )
  return matched ? validateBBox(matched.bbox) : null
}

export function projectAutoFigure(input: {
  row: JudgedFigureRow
  page: number
  displayNumber: string
  sourceDocumentId: string
  bbox: NormalizedBBox | null
  cropBytes: Uint8Array | null
  assignedBy?: string
}): { asset: FigureAssetDraft; link: FigureLinkDraft } | { reasons: string[] } {
  const reasons = persistBlockReasons(input.row)
  if (!input.bbox) reasons.push('MISSING_BBOX')
  if (!input.cropBytes || input.cropBytes.byteLength < 32) reasons.push('MISSING_CROP')
  if (!input.sourceDocumentId) reasons.push('MISSING_DOCUMENT')
  const canonical = canonicalizeProblemNumber(input.displayNumber)
  if (!canonical) reasons.push('IDENTITY_UNSTABLE')
  if (reasons.length || !input.bbox || !input.cropBytes || !canonical) return { reasons }
  const sourceHash = hashBytes(input.cropBytes)
  const figureId = figureIdFromHash(input.sourceDocumentId, input.page, sourceHash)
  const asset: FigureAssetDraft = {
    figure_id: figureId,
    source_document_id: input.sourceDocumentId,
    page_number: input.page,
    bbox: input.bbox,
    figure_type: input.row.figure_type ?? 'UNKNOWN_VISUAL',
    original_crop_path: cropRelPath(input.row.id),
    source_hash: sourceHash,
    detection_confidence: input.row.detection_confidence,
    review_status: 'AUTO',
    assigned_by: input.assignedBy ?? ASSIGNED_BY,
  }
  const link: FigureLinkDraft = {
    problem_identity: input.row.id,
    figure_id: figureId,
    ownership_type: ownershipType(input.row.ownership),
    ownership_confidence: input.row.ownership?.endsWith('_HIGH') ? 0.88 : 0.5,
    display_order: 1,
    required: true,
    source_document_id: input.sourceDocumentId,
    page_number: input.page,
    original_problem_number: canonical,
  }
  return { asset, link }
}

export function persistBlockReasons(row: JudgedFigureRow): string[] {
  const reasons: string[] = []
  if (!row.auto) reasons.push('NOT_AUTO')
  if (row.false_safe) reasons.push('FALSE_FIGURE_SAFE')
  if (row.review) reasons.push('REVIEW_BLOCKED')
  if (row.crop !== 'FIGURE_CROP_SAFE') reasons.push('CROP_NOT_SAFE')
  if (!row.detected) reasons.push('NOT_DETECTED')
  if (!row.owner_correct) reasons.push('OWNER_INCORRECT')
  return reasons
}

export function preflightFigure(input: {
  id: string
  projected: { asset: FigureAssetDraft; link: FigureLinkDraft } | { reasons: string[] }
  ident: DbIdentity | undefined
  expectedDocumentId: string
}): PreflightRow {
  const reasons: string[] = []
  if ('reasons' in input.projected) reasons.push(...input.projected.reasons)
  const asset = 'asset' in input.projected ? input.projected.asset : null
  const link = 'link' in input.projected ? input.projected.link : null
  if (!input.ident) reasons.push('PROBLEM_NOT_INGESTED')
  if (input.ident && input.ident.source_document_id !== input.expectedDocumentId) reasons.push('WRONG_DOCUMENT')
  if (asset && input.ident && asset.source_document_id !== input.ident.source_document_id) reasons.push('ASSET_DOCUMENT_MISMATCH')
  if (link && input.ident && canonicalizeProblemNumber(input.ident.problem_number) !== link.original_problem_number) {
    reasons.push('NUMBER_MISMATCH')
  }
  if (link && input.ident && input.ident.page !== link.page_number) reasons.push('PAGE_MISMATCH')
  if (input.ident && !input.ident.current_version_id) reasons.push('MISSING_CURRENT_VERSION')
  const projectionFailed = 'reasons' in input.projected
  const blocking = reasons.filter((reason) => reason !== 'PROBLEM_NOT_INGESTED')
  return {
    id: input.id,
    pass: blocking.length === 0 && !!asset && !!link && !!input.ident,
    asset_ready: !projectionFailed && !!asset,
    reasons,
    asset: projectionFailed ? null : asset,
    link: blocking.length || !input.ident ? null : link,
  }
}

export function dedupeAssets(assets: FigureAssetDraft[]): FigureAssetDraft[] {
  const seen = new Map<string, FigureAssetDraft>()
  for (const asset of assets) seen.set(asset.figure_id, asset)
  return [...seen.values()]
}

export function findOrphans(assets: FigureAssetDraft[], links: FigureLinkDraft[]): string[] {
  const ids = new Set(assets.map((row) => row.figure_id))
  return [...new Set(links.filter((link) => !ids.has(link.figure_id)).map((link) => link.figure_id))]
}

export function replayDoesNotDuplicate(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id, i) => id === second[i])
}

export function figurePersistGate(
  schemaOk: boolean,
  schemaReason: string | null,
  readyCount: number,
): { canApply: boolean; reason: string | null } {
  if (!schemaOk) return { canApply: false, reason: schemaReason ?? 'schema-missing' }
  if (readyCount < 1) return { canApply: false, reason: 'no-link-ready-auto' }
  return { canApply: true, reason: null }
}

export function productionCompletionVerdict(input: {
  persistAttempted: boolean
  schemaOk: boolean
  auto: number
  assetsInDb: number
  linksInDb: number
  pendingAfter: number
  ingestCreated: number
  reviewPersisted: number
  unsafePersisted: number
  duplicates: number
  orphans: number
}): 'PASS' | 'PARTIAL' | 'BLOCKED' {
  if (
    input.persistAttempted &&
    input.schemaOk &&
    input.assetsInDb === input.auto &&
    input.linksInDb === input.auto &&
    input.pendingAfter === 0 &&
    input.reviewPersisted === 0 &&
    input.unsafePersisted === 0 &&
    input.duplicates === 0 &&
    input.orphans === 0
  ) {
    return 'PASS'
  }
  if (!input.persistAttempted) return 'PARTIAL'
  if (!input.schemaOk && input.ingestCreated === 0 && input.linksInDb === 0) return 'BLOCKED'
  return 'PARTIAL'
}

export function migrationIsAdditive823(sql: string): { ok: boolean; reasons: string[] } {
  const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const reasons: string[] = []
  if (/DROP\s+TABLE/i.test(stripped)) reasons.push('DROP_TABLE')
  if (/DROP\s+COLUMN/i.test(stripped)) reasons.push('DROP_COLUMN')
  if (/\bTRUNCATE\b/i.test(stripped)) reasons.push('TRUNCATE')
  if (/INSERT\s+INTO\s+public\.problems\b/i.test(stripped)) reasons.push('WRITES_PROBLEMS')
  if (/INSERT\s+INTO\s+public\.problem_versions\b/i.test(stripped)) reasons.push('WRITES_VERSIONS')
  if (/UPDATE\s+public\.problems\b/i.test(stripped)) reasons.push('UPDATES_PROBLEMS')
  if (!/problem_figure_assets/.test(sql)) reasons.push('MISSING_ASSETS')
  if (!/problem_figure_links/.test(sql)) reasons.push('MISSING_LINKS')
  if (!/hqb_upsert_problem_figure/.test(sql)) reasons.push('MISSING_RPC')
  if (!/hqb_delete_test_figure_persistence/.test(sql)) reasons.push('MISSING_ROLLBACK')
  if (!/SET search_path = public/.test(sql)) reasons.push('MISSING_SEARCH_PATH')
  if (!/hqb_require_staff_writer/.test(sql)) reasons.push('MISSING_STAFF_CHECK')
  if (!/HQB_REVIEW_REJECTED/.test(sql)) reasons.push('MISSING_REVIEW_REJECT')
  if (!/REVOKE ALL ON FUNCTION public.hqb_upsert_problem_figure\(jsonb\) FROM PUBLIC, anon/.test(sql)) {
    reasons.push('MISSING_ANON_REVOKE')
  }
  return { ok: reasons.length === 0, reasons }
}

export function upsertPayload(asset: FigureAssetDraft, link: FigureLinkDraft, problemId: string, expectedVersionId: string) {
  return {
    figure_id: asset.figure_id,
    source_document_id: asset.source_document_id,
    page_number: asset.page_number,
    bbox: asset.bbox,
    figure_type: asset.figure_type,
    original_crop_path: asset.original_crop_path,
    source_hash: asset.source_hash,
    detection_confidence: asset.detection_confidence,
    review_status: asset.review_status,
    assigned_by: asset.assigned_by,
    problem_id: problemId,
    expected_version_id: expectedVersionId,
    ownership_type: link.ownership_type,
    ownership_confidence: link.ownership_confidence,
    display_order: link.display_order,
    required: link.required,
    original_problem_number: link.original_problem_number,
  }
}
