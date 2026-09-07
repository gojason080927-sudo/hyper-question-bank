import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth/AuthProvider'

export function AppShell() {
  const { loading, session, profile, configured, signOut } = useAuth()
  const navigate = useNavigate()

  if (!configured) {
    return (
      <main className="page">
        <p className="banner error">Supabase 공개 환경변수가 없습니다. 앱은 표시되지만 데이터를 불러올 수 없습니다.</p>
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

  if (!session || !profile) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          HYPER QUESTION BANK
        </NavLink>
        <nav className="nav" aria-label="주요 메뉴">
          <NavLink to="/questions">문제 목록</NavLink>
          <NavLink to="/questions/new">신규 등록</NavLink>
        </nav>
        <div className="session">
          <span className="role-pill">{profile.role}</span>
          <span className="muted">{profile.display_name}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void signOut().then(() => navigate('/login'))
            }}
          >
            로그아웃
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
