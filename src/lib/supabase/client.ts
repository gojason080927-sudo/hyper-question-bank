import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

function readConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  return { url, anonKey }
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = readConfig()
  return Boolean(url && anonKey)
}

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const { url, anonKey } = readConfig()
  if (!url || !anonKey) {
    cached = null
    return cached
  }
  cached = createClient(url, anonKey)
  return cached
}
