import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { useAuth } from '../../lib/auth/AuthProvider'
import { canReview, REVIEW_LABELS } from '../../lib/workflow/labels'
import { parseHqBError, verifyGateIssues, isUsableLicense } from '../../lib/workflow/validation'
import { defaultHumanDifficulty, extractDifficultyDims } from '../../lib/workflow/difficulty'
import { isSameVersion } from '../../lib/workflow/reviewTarget'
import { KatexText } from '../../lib/math/KatexText'
import { nodePath, useCatalogs } from '../../lib/workflow/useCatalogs'
import { beginSubmit, releaseSubmit } from '../../lib/workflow/submitLock'

type VersionBundle = {
  problem: {
    id: string
    public_code: string
    review_status: string
    current_version_id: string
    use_status: string
  }
  current_pointer: { id: string; version_no: number; review_status: string }
  version: {
    id: string
    version_no: number
    review_status: string
    problem_text: string
    instruction: string | null
    is_current: boolean
  }
  license_status: string | null
  sources: Array<{ document_title: string; license_status?: string }>
  curriculum: Array<{ name: string; node_id: string }>
  concepts: Array<{ name: string; is_primary: boolean }>
  hyper_types: Array<{ name: string }>
  strategies: Array<{ name: string; steps: Array<{ step_no: number; label: string }> }>
  expressions: Array<{ latex_expression?: string | null; original_expression: string }>
  conditions: Array<{ name: string }>
  targets: Array<{ name: string }>
  reasoning: Array<{ name: string }>
  difficulty: Array<{
    difficulty_source: string
    concept_difficulty: number
    calculation_complexity: number
    reasoning_depth: number
    condition_complexity: number
    representation_complexity: number
    trap_level: number
    overall_difficulty: number
  }>
  choices: Array<{ label: string; choice_text: string }>
  answers: Array<{ answer_text: string | null; numeric_value: number | null }>
  explanations: Array<{ content: string }>
  reviews: Array<{ status: string; note: string | null }>
}

export function QuestionReviewPage() {
  const { problemId, versionId } = useParams()
  const { profile } = useAuth()
  const { data: catalogs } = useCatalogs()
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<VersionBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submitLock = useMemo(() => ({ current: false }), [])

  useEffect(() => {
    const client = getSupabase()
    if (!client || !problemId || !versionId) return
    void (async () => {
      const { data, error: fetchError } = await client.rpc('hqb_fetch_problem_version_bundle', {
        p_problem_id: problemId,
        p_version_id: versionId,
      })
      if (fetchError || !data) {
        setError(parseHqBError(fetchError?.message) || '검수 대상을 불러오지 못했습니다.')
        setBundle(null)
        return
      }
      setError(null)
      setBundle(data as VersionBundle)
    })()
  }, [problemId, versionId])

  const previewVersionId = bundle?.version.id ?? null
  const verifyVersionId = versionId ?? null
  const versionsMatch = Boolean(
    previewVersionId && verifyVersionId && isSameVersion(previewVersionId, verifyVersionId),
  )

  const issues = useMemo(() => {
    if (!bundle) return []
    const human = extractDifficultyDims(
      bundle.difficulty.find((row) => row.difficulty_source === 'HUMAN'),
    )
    const license = bundle.license_status ?? bundle.sources[0]?.license_status ?? ''
    return verifyGateIssues({
      problemText: bundle.version.problem_text ?? '',
      hasSource: bundle.sources.length > 0,
      hasLicense: Boolean(license),
      hasCurrentVersion: Boolean(bundle.version.id),
      hasCurriculum: bundle.curriculum.length > 0,
      primaryConceptCount: bundle.concepts.filter((row) => row.is_primary).length,
      hyperTypeCount: bundle.hyper_types.length,
      strategyCount: bundle.strategies.length,
      targetCount: bundle.targets.length,
      hasHumanDifficulty: Boolean(human),
      difficulty: human ?? defaultHumanDifficulty(),
      hasAnswer: bundle.answers.length > 0,
      hasExpression: bundle.expressions.length > 0,
    })
  }, [bundle])

  if (error) return <main className="page"><p className="banner error">{error}</p></main>
  if (!bundle || !versionId) {
    return <main className="page"><p className="muted">검수 화면을 준비하는 중입니다.</p></main>
  }

  const license = bundle.license_status ?? bundle.sources[0]?.license_status ?? 'UNKNOWN'
  const human = bundle.difficulty.find((row) => row.difficulty_source === 'HUMAN')
  const expr = bundle.expressions[0]
  const allowed = canReview(profile?.role)
  const reviewingDifferent = bundle.version.id !== bundle.current_pointer.id
  const alreadyVerified = bundle.version.review_status === 'VERIFIED'

  async function runAction(kind: 'submit' | 'verify' | 'reject') {
    const client = getSupabase()
    if (!client || !verifyVersionId || !versionsMatch) return
    if (!beginSubmit(submitLock)) return
    setBusy(true)
    setMessage(null)
    const rpc =
      kind === 'verify'
        ? client.rpc('hqb_verify_problem_version', { p_version_id: verifyVersionId, p_note: note })
        : kind === 'reject'
          ? client.rpc('hqb_reject_problem_version', { p_version_id: verifyVersionId, p_note: note })
          : client.rpc('hqb_submit_for_review', { p_version_id: verifyVersionId, p_note: note })
    const { error: actionError } = await rpc
    if (actionError) {
      releaseSubmit(submitLock)
      setBusy(false)
      setMessage(parseHqBError(actionError.message))
      return
    }
    window.location.reload()
  }

  return (
    <main className="page wide">
      <p className="kicker">검수</p>
      <h1>{bundle.problem.public_code}</h1>
      <section className="card">
        <p className="review-target">
          <strong>검수 대상:</strong> v{bundle.version.version_no}{' '}
          <span className={`status-pill ${bundle.version.review_status.toLowerCase()}`}>
            {REVIEW_LABELS[bundle.version.review_status] ?? bundle.version.review_status}
          </span>
        </p>
        <p>
          <strong>현재 확정본:</strong> v{bundle.current_pointer.version_no}{' '}
          <span className={`status-pill ${bundle.current_pointer.review_status.toLowerCase()}`}>
            {REVIEW_LABELS[bundle.current_pointer.review_status] ?? bundle.current_pointer.review_status}
          </span>
        </p>
        {reviewingDifferent ? (
          <p className="banner warn">현재 확정본과 다른 새 버전을 검수 중입니다.</p>
        ) : (
          <p className="hint">이 화면의 내용은 현재 확정본과 같은 버전입니다.</p>
        )}
        <p>
          <span className={`status-pill ${isUsableLicense(license) ? 'verified' : 'needs_review'}`}>
            사용권: {license}
          </span>{' '}
          <span className="muted">문제지 사용: {bundle.problem.use_status}</span>
        </p>
        <p className="hint">내용이 확정되어도 UNKNOWN/RESTRICTED 자료는 문제지 사용 가능이 아닙니다.</p>
      </section>

      <section className="card">
        <p><strong>출처</strong> {bundle.sources[0]?.document_title ?? '없음'}</p>
        <p><strong>지시문</strong> {bundle.version.instruction || '—'}</p>
        <p className="stem">{bundle.version.problem_text}</p>
        {expr ? <p><KatexText tex={expr.latex_expression || expr.original_expression} /></p> : null}
        {bundle.choices.length > 0 ? (
          <ol>
            {bundle.choices.map((choice) => (
              <li key={choice.label}>{choice.label}. {choice.choice_text}</li>
            ))}
          </ol>
        ) : null}
        <p>
          <strong>정답</strong>{' '}
          {bundle.answers[0]?.answer_text ?? bundle.answers[0]?.numeric_value ?? '없음'}
        </p>
        {bundle.explanations[0] ? <p><strong>해설</strong> {bundle.explanations[0].content}</p> : null}
      </section>

      <section className="card">
        <h2>분류</h2>
        <p>
          <strong>교육과정</strong>{' '}
          {bundle.curriculum[0]
            ? nodePath(catalogs?.nodes ?? [], bundle.curriculum[0].node_id) || bundle.curriculum[0].name
            : '—'}
        </p>
        <p>
          <strong>개념</strong>{' '}
          {bundle.concepts.map((row) => `${row.name}${row.is_primary ? ' (PRIMARY)' : ''}`).join(', ') || '—'}
        </p>
        <p><strong>HYPER 유형</strong> {bundle.hyper_types.map((row) => row.name).join(', ') || '—'}</p>
        <p><strong>전략</strong> {bundle.strategies[0]?.name || '—'}</p>
        {bundle.strategies[0]?.steps?.length ? (
          <ol className="steps">
            {bundle.strategies[0].steps.map((step) => (
              <li key={step.step_no}>{step.step_no}. {step.label}</li>
            ))}
          </ol>
        ) : null}
        <p><strong>조건</strong> {bundle.conditions.map((row) => row.name).join(', ') || '없음'}</p>
        <p><strong>목표</strong> {bundle.targets.map((row) => row.name).join(', ') || '—'}</p>
        <p><strong>추론</strong> {bundle.reasoning.map((row) => row.name).join(', ') || '—'}</p>
      </section>

      <section className="card">
        <h2>난이도</h2>
        {human ? (
          <p>
            개념 {human.concept_difficulty} · 계산 {human.calculation_complexity} · 추론 {human.reasoning_depth} · 조건{' '}
            {human.condition_complexity} · 표현 {human.representation_complexity} · 함정 {human.trap_level} → overall{' '}
            {Number(human.overall_difficulty).toFixed(2)} ({human.difficulty_source})
          </p>
        ) : (
          <p>HUMAN 난이도가 없습니다.</p>
        )}
      </section>

      <section className="card">
        <h2>이 버전의 검수 이력</h2>
        {bundle.reviews.length === 0 ? (
          <p className="muted">이 버전 전용 검수 기록이 없습니다.</p>
        ) : (
          <ul>
            {bundle.reviews.map((row, index) => (
              <li key={index}>{REVIEW_LABELS[row.status] ?? row.status} · {row.note || '메모 없음'}</li>
            ))}
          </ul>
        )}
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
        <p>
          <strong>확정 대상 version:</strong> v{bundle.version.version_no} ({bundle.version.id})
        </p>
        {!versionsMatch ? (
          <p className="banner error">미리보기 버전과 확정 대상이 다릅니다. 이 화면에서는 확정할 수 없습니다.</p>
        ) : null}
        {alreadyVerified ? (
          <p className="banner warn">이 버전은 이미 VERIFIED입니다. 내용을 바꾸려면 새 버전을 만드세요.</p>
        ) : null}
        <label>
          검수 메모
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {!allowed ? (
          <p className="banner warn">이 문제는 검수 권한이 있는 계정만 확정할 수 있습니다. 현재 역할: {profile?.role}</p>
        ) : null}
        {message ? <p className="banner error">{message}</p> : null}
        <div className="actions">
          <button type="button" className="btn" disabled={busy || !versionsMatch} onClick={() => void runAction('submit')}>
            검수 요청
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !allowed || issues.length > 0 || !versionsMatch || alreadyVerified}
            onClick={() => void runAction('verify')}
          >
            VERIFIED 확정
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !allowed || !versionsMatch}
            onClick={() => void runAction('reject')}
          >
            반려
          </button>
          <Link to={`/questions/${problemId}`}>상세로</Link>
          <Link to={`/questions/${problemId}/versions`}>버전 이력</Link>
        </div>
      </section>
    </main>
  )
}
