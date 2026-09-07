import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { KatexText } from '../../lib/math/KatexText'
import { reviewPath } from '../../lib/workflow/reviewTarget'

type VersionRow = {
  id: string
  version_no: number
  review_status: string
  origin: string
  problem_text: string
  created_at: string
}

export function QuestionVersionsPage() {
  const { problemId } = useParams()
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<string>('')
  const [tex, setTex] = useState('')
  const [answer, setAnswer] = useState('')
  const [reviews, setReviews] = useState<Array<{ status: string; note: string | null }>>([])

  useEffect(() => {
    const client = getSupabase()
    if (!client || !problemId) return
    void (async () => {
      const { data: problem } = await client.from('problems').select('current_version_id').eq('id', problemId).single()
      setCurrentId(problem?.current_version_id ?? null)
      const { data } = await client
        .from('problem_versions')
        .select('id,version_no,review_status,origin,problem_text,created_at')
        .eq('problem_id', problemId)
        .order('version_no')
      setVersions(data ?? [])
      setSelected(problem?.current_version_id ?? data?.[0]?.id ?? null)
    })()
  }, [problemId])

  useEffect(() => {
    const client = getSupabase()
    if (!client || !selected) return
    void (async () => {
      const version = versions.find((row) => row.id === selected)
      setDetail(version?.problem_text ?? '')
      const { data: expressions } = await client
        .from('math_expressions')
        .select('latex_expression,original_expression')
        .eq('problem_version_id', selected)
        .limit(1)
      setTex(expressions?.[0]?.latex_expression || expressions?.[0]?.original_expression || '')
      const { data: answers } = await client
        .from('problem_answers')
        .select('answer_text,numeric_value')
        .eq('problem_version_id', selected)
        .limit(1)
      setAnswer(answers?.[0]?.answer_text ?? (answers?.[0]?.numeric_value != null ? String(answers[0].numeric_value) : ''))
      const { data: reviewRows } = await client
        .from('reviews')
        .select('status,note')
        .eq('problem_version_id', selected)
        .order('created_at')
      setReviews(reviewRows ?? [])
    })()
  }, [selected, versions])

  return (
    <main className="page wide">
      <p className="kicker">버전 이력</p>
      <h1>과거 버전은 읽기 전용입니다</h1>
      <div className="split">
        <ul className="version-list">
          {versions.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={selected === row.id ? 'chip active' : 'chip'}
                onClick={() => setSelected(row.id)}
              >
                v{row.version_no} · {REVIEW_LABELS[row.review_status] ?? row.review_status}
                {row.id === currentId ? ' · 현재' : ''}
              </button>
              {problemId ? (
                <p>
                  <Link to={reviewPath(problemId, row.id)}>이 버전 검수</Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <section className="card">
          <p className="stem">{detail}</p>
          {tex ? <p><KatexText tex={tex} /></p> : null}
          <p><strong>정답</strong> {answer || '—'}</p>
          <h2>이 버전의 검수 이력</h2>
          {reviews.length === 0 ? <p className="muted">이 버전 전용 검수 기록이 없습니다.</p> : (
            <ul>
              {reviews.map((row, index) => (
                <li key={index}>{REVIEW_LABELS[row.status] ?? row.status} · {row.note || '메모 없음'}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p><Link to={`/questions/${problemId}`}>상세로 돌아가기</Link></p>
    </main>
  )
}
