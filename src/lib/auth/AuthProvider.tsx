/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../supabase/client'
import { parseStaffProfile, type StaffProfile } from './parseStaffProfile'

export type { StaffProfile }

type AuthState = {
  loading: boolean
  session: Session | null
  profile: StaffProfile | null
  profileError: string | null
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
  const [profileError, setProfileError] = useState<string | null>(null)

  async function loadProfile(active: Session | null) {
    if (!client || !active) {
      setProfile(null)
      setProfileError(null)
      return
    }
    const { data, error } = await client.rpc('hqb_my_profile')
    if (error) {
      setProfile(null)
      setProfileError('프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    const parsed = parseStaffProfile(data)
    if (!parsed) {
      setProfile(null)
      setProfileError('이 계정에 강사 프로필이 없습니다. 관리자에게 역할을 요청하세요.')
      return
    }
    setProfile(parsed)
    setProfileError(null)
  }

  async function refresh() {
    if (!client) {
      setSession(null)
      setProfile(null)
      setProfileError(null)
      setLoading(false)
      return
    }
    setLoading(true)
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
      setLoading(true)
      void loadProfile(next).finally(() => setLoading(false))
    })
    return () => sub.subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      profile,
      profileError,
      configured: Boolean(client),
      refresh,
      signOut: async () => {
        await client?.auth.signOut()
        setProfile(null)
        setProfileError(null)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, session, profile, profileError, client],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
