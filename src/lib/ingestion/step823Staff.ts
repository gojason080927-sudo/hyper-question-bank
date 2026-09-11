import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PIPELINE_TEACHER_EMAIL } from '../recognition/bookPipeline'

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
  if (process.env.DATABASE_URL?.trim()) return { canApply: true, reason: 'DATABASE_URL' }
  if (process.env.SUPABASE_DB_PASSWORD?.trim()) return { canApply: true, reason: 'SUPABASE_DB_PASSWORD' }
  return { canApply: false, reason: 'missing SUPABASE_DB_PASSWORD and DATABASE_URL' }
}
