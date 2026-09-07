import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database.types'

let cached: SupabaseClient<Database> | null | undefined

function readConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  return { url, anonKey }
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = readConfig()
  return Boolean(url && anonKey)
}

export function getSupabase(): SupabaseClient<Database> | null {
  if (cached !== undefined) return cached
  const { url, anonKey } = readConfig()
  if (!url || !anonKey) {
    cached = null
    return cached
  }
  cached = createClient<Database>(url, anonKey)
  return cached
}
