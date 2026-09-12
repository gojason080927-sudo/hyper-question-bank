import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { FEATURE_AREAS } from '../../utils/features'

export function DashboardPage() {
  const supabaseReady = isSupabaseConfigured()

  return (
    <main className="page">
      <header className="hero">
        <p className="kicker">MASTER v1 · STEP 6</p>
        <h1>HYPER QUESTION BANK</h1>
        <p className="tagline">원본 PDF · 영역 인식 · 초안 · 검수</p>
        <p className={`status ${supabaseReady ? 'ready' : 'pending'}`}>
          Supabase: {supabaseReady ? '환경변수 연결됨' : '미연결 (앱은 정상 표시)'}
        </p>
      </header>

      <section className="grid" aria-label="기능 영역">
        {FEATURE_AREAS.map((area) => {
          const href =
            area.id === 'questions' || area.id === 'classification'
              ? '/questions'
              : area.id === 'review'
                ? '/pipeline-review'
                : area.id === 'sources' || area.id === 'extraction'
                  ? '/sources'
                  : null
          return (
            <article key={area.id} className="card">
              <p className="code">{area.code}</p>
              <h2>{area.title}</h2>
              <p>{area.summary}</p>
              {href ? (
                <Link className="card-link" to={href}>
                  열기
                </Link>
              ) : (
                <button type="button" disabled>
                  준비 중
                </button>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}
