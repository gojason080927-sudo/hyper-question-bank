/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../supabase/client'
import type { StaffRole } from '../workflow/labels'

export type StaffProfile = {
  user_id: string
  role: StaffRole
  display_name: string | null
}

type AuthState = {
  loading: boolean
  session: Session | null
  profile: StaffProfile | null
  configured: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = getSupabase()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<StaffProfile | null>(null)

  async function loadProfile(active: Session | null) {
    if (!client || !active) {
      setProfile(null)
      return
    }
    const { data, error } = await client.rpc('hqb_my_profile')
    if (error || !data) {
      setProfile(null)
      return
    }
    const row = data as StaffProfile
    setProfile(row?.user_id ? row : null)
  }

  async function refresh() {
    if (!client) {
      setSession(null)
      setProfile(null)
      setLoading(false)
      return
    }
    const { data } = await client.auth.getSession()
    setSession(data.session)
    await loadProfile(data.session)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    if (!client) return
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      void loadProfile(next)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      profile,
      configured: Boolean(client),
      refresh,
      signOut: async () => {
        await client?.auth.signOut()
        setProfile(null)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, session, profile, client],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
