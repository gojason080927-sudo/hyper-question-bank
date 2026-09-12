/**
 * STEP 8.26 runner — additive schema artifacts + progress counters.
 * Default is cache-only. No textbook ingest. No paid OCR. No problem writes.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { FEATURE_FLAGS } from './adaptiveRouter'
import { parsePaidGate } from '../ocr/paidGate'
import { findPdfByHash } from './step821Pilot'
import {
  FROZEN_PIPELINE_COUNTS,
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
} from './batchPipeline825'
import {
  EXPECTED_PDF_SHA256,
  MIGRATION_NAME,
  MIGRATION_VERSION,
  STEP826,
  STEP826_DIR,
  STEP826_MIGRATION,
  STEP826_PAID_OCR_CAP,
  denyPaidOcr826,
  migrationIsAdditive826,
  projectStep826Targets,
  tallyVerdicts,
  type Step826Target,
} from './pipelineJob826'
import { migrationCredentialsPresent } from './step823Staff'

export type Step826Summary = {
  step: '8.26'
  name: string
  status: 'SCHEMA_ONLY'
  target_ref: string
  student_care_accessed: boolean
  textbook_run: false
  next_step_started: false
  production_problem_writes: 0
  production_figure_writes: 0
  schema_write: {
    attempted: boolean
    applied: boolean
    reason: string
  }
  paid_api_calls: { mathpix: 0; mistral: 0 }
  paid_ocr_cap: { max_calls: 0; max_usd: 0 }
  frozen: typeof FROZEN_PIPELINE_COUNTS
  original_pdf: {
    expected_sha256: string
    present: boolean
    hash_match: boolean | null
    substituted: false
    path: string | null
  }
  targets: Step826Target[]
  results: { PASS: number; REVIEW: number; BLOCKED: number }
  migration_additive: { ok: boolean; reasons: string[] }
}

function writeJson(dest: string, name: string, value: unknown) {
  writeFileSync(path.join(dest, name), JSON.stringify(value, null, 2), 'utf8')
}

function locateExpectedPdf(root: string): { present: boolean; path: string | null; hash: string | null } {
  const named = path.join(root, 'second-common-math1.pdf')
  if (existsSync(named)) {
    const hash = createHash('sha256').update(readFileSync(named)).digest('hex')
    if (hash === EXPECTED_PDF_SHA256) return { present: true, path: named, hash }
    return { present: true, path: null, hash }
  }
  const hashed = findPdfByHash(path.join(root, 'fixtures/pdf'), EXPECTED_PDF_SHA256)
  if (hashed) {
    const hash = createHash('sha256').update(readFileSync(hashed)).digest('hex')
    return { present: true, path: hashed, hash }
  }
  return { present: false, path: null, hash: null }
}

function tokenLooksReal(value: string | undefined): boolean {
  const token = value?.trim() ?? ''
  return token.length > 80 && token.split('.').length >= 3
}

async function applySchemaIfAllowed(root: string, sql: string, persistSchema: boolean): Promise<{
  attempted: boolean
  applied: boolean
  reason: string
}> {
  if (!persistSchema) return { attempted: false, applied: false, reason: 'cache-only' }
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (url && !url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const creds = migrationCredentialsPresent()
  if (!creds.canApply || creds.reason !== 'SUPABASE_ACCESS_TOKEN') {
    return { attempted: false, applied: false, reason: creds.reason }
  }
  if (!tokenLooksReal(process.env.SUPABASE_ACCESS_TOKEN)) {
    return { attempted: false, applied: false, reason: 'access_token_placeholder' }
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN!.trim()
  const mgmt = await fetch(`https://api.supabase.com/v1/projects/${QUESTION_BANK_REF}/database/migrations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MIGRATION_NAME, query: sql }),
  })
  if (mgmt.ok) return { attempted: true, applied: true, reason: 'applied', }
  const status = mgmt.status
  await mgmt.text()
  const cli = spawnSync(
    'npx',
    ['--yes', 'supabase@latest', 'db', 'push', '--project-ref', QUESTION_BANK_REF, '--yes'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } },
  )
  if (cli.status === 0) return { attempted: true, applied: true, reason: 'applied-cli' }
  return { attempted: true, applied: false, reason: `management ${status}; cli_exit ${cli.status}` }
}

export async function runStep826(root: string, argv: string[]): Promise<Step826Summary> {
  const gate = parsePaidGate(argv)
  if (argv.includes('--persist') && !argv.includes('--persist-schema')) {
    throw new Error('STEP 8.26 forbids problem persist. Schema only: --persist-schema')
  }
  if (argv.includes('--allow-paid-api') || gate.allowPaidApi) {
    throw new Error('STEP 8.26 forbids paid OCR')
  }
  if (FEATURE_FLAGS.paidOcrRoutingEnabled) {
    throw new Error('paid OCR routing must stay false in STEP 8.26')
  }

  const sqlPath = path.join(root, STEP826_MIGRATION)
  if (!existsSync(sqlPath)) throw new Error('STEP 8.26 migration missing')
  const sql = readFileSync(sqlPath, 'utf8')
  const additive = migrationIsAdditive826(sql)
  if (!additive.ok) throw new Error(`migration not additive: ${additive.reasons.join(',')}`)

  const pdf = locateExpectedPdf(root)
  const persistSchema = argv.includes('--persist-schema')
  const schemaWrite = await applySchemaIfAllowed(root, sql, persistSchema)

  const targets = projectStep826Targets({
    sqlAdditiveOk: additive.ok,
    sqlReasons: additive.reasons,
    originalPdfPresent: pdf.present,
    originalPdfHashMatch: pdf.present ? pdf.hash === EXPECTED_PDF_SHA256 : null,
  })
  const results = tallyVerdicts(targets)
  const paid = denyPaidOcr826()

  const summary: Step826Summary = {
    step: STEP826,
    name: 'Pipeline job schema + progress counters v1',
    status: 'SCHEMA_ONLY',
    target_ref: QUESTION_BANK_REF,
    student_care_accessed: false,
    textbook_run: false,
    next_step_started: false,
    production_problem_writes: 0,
    production_figure_writes: 0,
    schema_write: schemaWrite,
    paid_api_calls: { mathpix: 0, mistral: 0 },
    paid_ocr_cap: { max_calls: STEP826_PAID_OCR_CAP.maxCalls, max_usd: STEP826_PAID_OCR_CAP.maxUsd },
    frozen: FROZEN_PIPELINE_COUNTS,
    original_pdf: {
      expected_sha256: EXPECTED_PDF_SHA256,
      present: pdf.present,
      hash_match: pdf.present ? pdf.hash === EXPECTED_PDF_SHA256 : null,
      substituted: false,
      path: pdf.path,
    },
    targets,
    results,
    migration_additive: additive,
  }

  const dest = path.join(root, STEP826_DIR)
  mkdirSync(dest, { recursive: true })
  writeJson(dest, 'summary.json', summary)
  writeJson(dest, 'targets.json', { targets, paid_ocr: paid })
  writeFileSync(
    path.join(dest, 'step8-26-summary.md'),
    `# STEP 8.26 PIPELINE JOB SCHEMA

STEP 8.26 RESULT: SCHEMA_ONLY
NAME: Pipeline job schema + progress counters v1
TARGET REF: ${QUESTION_BANK_REF} (hyper-student-care NOT accessed)

textbook run: false
next step started: false
production problem writes: 0
production figure writes: 0
schema apply attempted: ${schemaWrite.attempted}
schema apply applied: ${schemaWrite.applied}
schema apply reason: ${schemaWrite.reason}

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
original PDF present: ${pdf.present}
original PDF substituted: false
migration version: ${MIGRATION_VERSION}

Do not implement STEP 8.27. Do not implement multimodal twin. Do not implement print-edit.
Do not call paid OCR. Do not ingest a textbook.
`,
    'utf8',
  )
  return summary
}
