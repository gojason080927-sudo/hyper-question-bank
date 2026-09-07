import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth/AuthProvider'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'

export function LoginPage() {
  const navigate = useNavigate()
  const { loading, session, profile, profileError, refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isSupabaseConfigured()) {
    return (
      <main className="page">
        <h1>로그인</h1>
        <p className="banner error">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가 없습니다.</p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="page">
        <p className="muted">로그인 상태를 확인하는 중입니다.</p>
      </main>
    )
  }

  if (session && profile) {
    return <Navigate to="/questions" replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const client = getSupabase()
    if (!client) return
    setBusy(true)
    setMessage(null)
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) {
      setMessage(error.message.includes('Invalid') ? '이메일 또는 비밀번호가 올바르지 않습니다.' : '로그인에 실패했습니다.')
      setBusy(false)
      return
    }
    await refresh()
    setBusy(false)
    navigate('/questions')
  }

  return (
    <main className="page narrow">
      <p className="kicker">강사 업무용</p>
      <h1>HYPER QUESTION BANK</h1>
      <p className="tagline">수동 등록 · 검수 워크플로</p>
      {session && profileError ? <p className="banner error">{profileError}</p> : null}
      <form className="card form" onSubmit={onSubmit}>
        <label>
          이메일
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>
        {message ? <p className="banner error">{message}</p> : null}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? '처리 중…' : '로그인'}
        </button>
      </form>
      <p className="hint">공개 가입은 닫혀 있습니다. 계정은 관리자가 발급합니다.</p>
    </main>
  )
}
