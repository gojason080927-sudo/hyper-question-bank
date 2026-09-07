import { isSupabaseConfigured } from '../../lib/supabase/client'
import { FEATURE_AREAS } from '../../utils/features'

export function DashboardPage() {
  const supabaseReady = isSupabaseConfigured()

  return (
    <main className="page">
      <header className="hero">
        <p className="kicker">MASTER v1 · STEP 1</p>
        <h1>HYPER QUESTION BANK</h1>
        <p className="tagline">수학 문제 데이터베이스 · 유사문제 분석 시스템</p>
        <p className={`status ${supabaseReady ? 'ready' : 'pending'}`}>
          Supabase: {supabaseReady ? '환경변수 연결됨' : '미연결 (앱은 정상 표시)'}
        </p>
      </header>

      <section className="grid" aria-label="기능 영역">
        {FEATURE_AREAS.map((area) => (
          <article key={area.id} className="card">
            <p className="code">{area.code}</p>
            <h2>{area.title}</h2>
            <p>{area.summary}</p>
            <button type="button" disabled>
              준비 중
            </button>
          </article>
        ))}
      </section>
    </main>
  )
}
