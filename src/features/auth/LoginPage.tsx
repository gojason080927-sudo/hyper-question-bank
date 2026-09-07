import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { parseHqBError } from '../../lib/workflow/validation'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const client = getSupabase()
    if (!client) return
    setBusy(true)
    setMessage(null)
    const action =
      mode === 'login'
        ? client.auth.signInWithPassword({ email, password })
        : client.auth.signUp({ email, password })
    const { error } = await action
    if (error) {
      setMessage(error.message.includes('Invalid') ? '이메일 또는 비밀번호가 올바르지 않습니다.' : '로그인에 실패했습니다.')
      setBusy(false)
      return
    }
    if (mode === 'signup') {
      const { error: bootError } = await client.rpc('hqb_bootstrap_admin')
      if (bootError && !/HQB_ADMIN_EXISTS/.test(bootError.message)) {
        setMessage(parseHqBError(bootError.message))
        setBusy(false)
        return
      }
    }
    setBusy(false)
    navigate('/questions')
  }

  return (
    <main className="page narrow">
      <p className="kicker">강사 업무용</p>
      <h1>HYPER QUESTION BANK</h1>
      <p className="tagline">수동 등록 · 검수 워크플로</p>
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
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>
        {message ? <p className="banner error">{message}</p> : null}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? '처리 중…' : mode === 'login' ? '로그인' : '계정 만들기'}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? '처음이면 계정 만들기' : '이미 계정이 있으면 로그인'}
        </button>
      </form>
    </main>
  )
}
