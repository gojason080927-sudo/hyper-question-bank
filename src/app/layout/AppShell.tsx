import { useState } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth/AuthProvider'

export function AppShell() {
  const { loading, session, profile, configured, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

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

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!profile) {
    return (
      <main className="page">
        <p className="banner error">이 계정으로 문제은행을 사용할 수 없습니다. 관리자에게 역할을 요청하세요.</p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            void signOut().then(() => navigate('/login'))
          }}
        >
          로그아웃
        </button>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          HYPER QUESTION BANK
        </NavLink>
        <button
          type="button"
          className="nav-toggle mobile-only"
          aria-expanded={menuOpen}
          aria-controls="app-nav"
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          onClick={() => setMenuOpen((value) => !value)}
        >
          메뉴
        </button>
        <nav id="app-nav" className={`nav ${menuOpen ? 'is-open' : ''}`} aria-label="주요 메뉴" onClick={() => setMenuOpen(false)}>
          <NavLink to="/questions">문제 목록</NavLink>
          <NavLink to="/questions/new">신규 등록</NavLink>
          <NavLink to="/worksheets">문제지</NavLink>
          <NavLink to="/sources">교재</NavLink>
          <NavLink to="/pipeline-review">검수 큐</NavLink>
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
