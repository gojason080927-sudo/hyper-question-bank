import { spawnSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PIPELINE_TEACHER_EMAIL } from '../recognition/bookPipeline'

export const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
export const MIGRATION_VERSION = '20260911123000'
export const MIGRATION_NAME = 'hqb_figure_persistence_v1'

export async function createPipelineStaffClient(url: string, serviceKey: string): Promise<SupabaseClient> {
  const staff = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const link = await staff.auth.admin.generateLink({ type: 'magiclink', email: PIPELINE_TEACHER_EMAIL })
  const hashed = link.data?.properties?.hashed_token
  if (link.error || !hashed) {
    throw new Error(`staff magiclink: ${link.error?.message ?? 'no token'}`)
  }
  const verify = await staff.auth.verifyOtp({ token_hash: hashed, type: 'email' })
  if (verify.error || !verify.data.session) {
    throw new Error(`staff verify: ${verify.error?.message ?? 'no session'}`)
  }
  return staff
}

export function migrationCredentialsPresent(): { canApply: boolean; reason: string } {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) return { canApply: true, reason: 'SUPABASE_ACCESS_TOKEN' }
  if (process.env.DATABASE_URL?.trim()) return { canApply: true, reason: 'DATABASE_URL' }
  if (process.env.SUPABASE_DB_PASSWORD?.trim()) return { canApply: true, reason: 'SUPABASE_DB_PASSWORD' }
  return { canApply: false, reason: 'missing SUPABASE_ACCESS_TOKEN' }
}

export type MigrationApplyResult = {
  attempted: boolean
  applied: boolean
  reason: string
  via: 'management-api' | 'cli-db-push' | null
  http_status: number | null
}

function redact(text: string): string {
  return text.replace(/sbp_[A-Za-z0-9_]+/g, 'sbp_[redacted]').replace(/sb_secret_[A-Za-z0-9_]+/g, 'sb_secret_[redacted]').slice(0, 400)
}

export async function applyFigurePersistenceMigration(root: string, sql: string): Promise<MigrationApplyResult> {
  const creds = migrationCredentialsPresent()
  if (!creds.canApply || creds.reason !== 'SUPABASE_ACCESS_TOKEN') {
    return { attempted: false, applied: false, reason: creds.reason, via: null, http_status: null }
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN!.trim()
  const mgmt = await fetch(`https://api.supabase.com/v1/projects/${QUESTION_BANK_REF}/database/migrations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MIGRATION_NAME, query: sql }),
  })
  if (mgmt.ok) {
    return { attempted: true, applied: true, reason: 'applied', via: 'management-api', http_status: mgmt.status }
  }
  const mgmtBody = redact(await mgmt.text())
  const cli = spawnSync(
    'npx',
    ['--yes', 'supabase@latest', 'db', 'push', '--project-ref', QUESTION_BANK_REF, '--yes'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } },
  )
  const cliOut = redact(`${cli.stdout ?? ''}\n${cli.stderr ?? ''}`)
  if (cli.status === 0) {
    return { attempted: true, applied: true, reason: 'applied', via: 'cli-db-push', http_status: mgmt.status }
  }
  return {
    attempted: true,
    applied: false,
    reason: `management ${mgmt.status}: ${mgmtBody}; cli: ${cliOut}`.trim(),
    via: null,
    http_status: mgmt.status,
  }
}
