import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canReview, REVIEW_LABELS } from '../../lib/workflow/labels'
import { parseHqBError, verifyGateIssues, isUsableLicense } from '../../lib/workflow/validation'
import { defaultHumanDifficulty } from '../../lib/workflow/difficulty'
import { KatexText } from '../../lib/math/KatexText'

export function QuestionReviewPage() {
  const { problemId } = useParams()
  const { profile } = useAuth()
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Record<string, unknown> | null>(null)
  const [license, setLicense] = useState('UNKNOWN')
  const [targetVersionId, setTargetVersionId] = useState<string | null>(null)

  useEffect(() => {
    const client = getSupabase()
    if (!client || !problemId) return
    void (async () => {
      const { data: problem } = await client.from('problems').select('public_code,current_version_id').eq('id', problemId).single()
      if (!problem) return
      const { data: versions } = await client
        .from('problem_versions')
        .select('id,review_status,version_no')
        .eq('problem_id', problemId)
        .order('version_no', { ascending: false })
      const draft = (versions ?? []).find((row) => row.review_status !== 'VERIFIED' && row.review_status !== 'REJECTED')
      const target = draft?.id ?? problem.current_version_id
      setTargetVersionId(target)
      const { data } = await client.rpc('hqb_fetch_problem_bundle', { p_public_code: problem.public_code })
      setBundle((data ?? null) as Record<string, unknown> | null)
      const { data: sources } = await client
        .from('problem_sources')
        .select('source_documents(license_status)')
        .eq('problem_id', problemId)
        .maybeSingle()
      const doc = sources?.source_documents as { license_status?: string } | null
      setLicense(doc?.license_status ?? 'UNKNOWN')
    })()
  }, [problemId])

  const issues = useMemo(() => {
    if (!bundle) return []
    const concepts = (bundle.concepts as Array<{ is_primary?: boolean }>) ?? []
    const difficulty = ((bundle.difficulty as Array<{ difficulty_source: string }>) ?? []).find((row) => row.difficulty_source === 'HUMAN') as
      | {
          concept_difficulty: number
          calculation_complexity: number
          reasoning_depth: number
          condition_complexity: number
          representation_complexity: number
          trap_level: number
        }
      | undefined
    const version = bundle.current_version as { problem_text?: string } | undefined
    return verifyGateIssues({
      problemText: version?.problem_text ?? '',
      hasSource: ((bundle.sources as unknown[]) ?? []).length > 0,
      hasLicense: Boolean(license),
      hasCurrentVersion: Boolean(targetVersionId),
      hasCurriculum: ((bundle.curriculum as unknown[]) ?? []).length > 0,
      primaryConceptCount: concepts.filter((row) => row.is_primary).length,
      hyperTypeCount: ((bundle.hyper_types as unknown[]) ?? []).length,
      strategyCount: ((bundle.strategies as unknown[]) ?? []).length,
      targetCount: ((bundle.targets as unknown[]) ?? []).length,
      hasHumanDifficulty: Boolean(difficulty),
      difficulty: difficulty ?? defaultHumanDifficulty(),
      hasAnswer: ((bundle.answers as unknown[]) ?? []).length > 0,
      hasExpression: ((bundle.expressions as unknown[]) ?? []).length > 0,
    })
  }, [bundle, license, targetVersionId])

  if (!bundle) return <main className="page"><p className="muted">검수 화면을 준비하는 중입니다.</p></main>
  const problem = bundle.problem as { public_code: string; review_status: string }
  const version = bundle.current_version as { version_no: number; problem_text: string }
  const expressions = (bundle.expressions as Array<{ latex_expression?: string; original_expression: string }>) ?? []
  const allowed = canReview(profile?.role)

  return (
    <main className="page wide">
      <p className="kicker">검수</p>
      <h1>{problem.public_code}</h1>
      <p>
        <span className={`status-pill ${problem.review_status.toLowerCase()}`}>
          내용 검수: {REVIEW_LABELS[problem.review_status] ?? problem.review_status}
        </span>{' '}
        <span className={`status-pill ${isUsableLicense(license) ? 'verified' : 'needs_review'}`}>사용권: {license}</span>
      </p>
      <section className="card">
        <p className="stem">{version.problem_text}</p>
        {expressions[0] ? <p><KatexText tex={expressions[0].latex_expression || expressions[0].original_expression} /></p> : null}
        <p><strong>현재 표시 버전</strong> v{version.version_no}</p>
      </section>
      {issues.length ? (
        <section className="card">
          <h2>누락 항목</h2>
          <ul className="issue-list">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="banner success">확정에 필요한 항목이 있습니다.</p>
      )}
      <section className="card">
        <label>
          검수 메모
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {!allowed ? (
          <p className="banner warn">이 문제는 검수 권한이 있는 계정만 확정할 수 있습니다. 현재 역할: {profile?.role}</p>
        ) : null}
        {message ? <p className="banner error">{message}</p> : null}
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              const client = getSupabase()
              if (!client || !targetVersionId) return
              setBusy(true)
              const { error } = await client.rpc('hqb_submit_for_review', { p_version_id: targetVersionId, p_note: note })
              setBusy(false)
              setMessage(error ? parseHqBError(error.message) : null)
            }}
          >
            검수 요청
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !allowed || issues.length > 0}
            onClick={async () => {
              const client = getSupabase()
              if (!client || !targetVersionId) return
              setBusy(true)
              const { error } = await client.rpc('hqb_verify_problem_version', { p_version_id: targetVersionId, p_note: note })
              setBusy(false)
              if (error) {
                setMessage(parseHqBError(error.message))
                return
              }
              setMessage(null)
              window.location.reload()
            }}
          >
            VERIFIED 확정
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !allowed}
            onClick={async () => {
              const client = getSupabase()
              if (!client || !targetVersionId) return
              setBusy(true)
              const { error } = await client.rpc('hqb_reject_problem_version', {
                p_version_id: targetVersionId,
                p_note: note,
              })
              setBusy(false)
              setMessage(error ? parseHqBError(error.message) : null)
            }}
          >
            반려
          </button>
          <Link to={`/questions/${problemId}`}>상세로</Link>
        </div>
      </section>
    </main>
  )
}
