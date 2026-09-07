import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { KatexText } from '../../lib/math/KatexText'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { isUsableLicense } from '../../lib/workflow/validation'
import { nodePath, useCatalogs } from '../../lib/workflow/useCatalogs'

type Bundle = {
  problem: {
    id: string
    public_code: string
    review_status: string
    current_version_id: string
    use_status: string
  }
  current_version: {
    id: string
    version_no: number
    problem_text: string
    instruction: string | null
    review_status: string
  }
  sources: Array<{ document_title: string; page_number: number | null; source_type_label: string | null }>
  curriculum: Array<{ name: string; framework_name: string; node_id: string }>
  concepts: Array<{ name: string; is_primary: boolean }>
  hyper_types: Array<{ name: string }>
  strategies: Array<{ name: string; steps: Array<{ step_no: number; label: string }> }>
  expressions: Array<{ original_expression: string; latex_expression: string | null; structure_skeleton: string | null }>
  conditions: Array<{ name: string }>
  targets: Array<{ name: string }>
  reasoning: Array<{ name: string }>
  difficulty: Array<{
    difficulty_source: string
    overall_difficulty: number
    concept_difficulty: number
    calculation_complexity: number
    reasoning_depth: number
    condition_complexity: number
    representation_complexity: number
    trap_level: number
  }>
  answers: Array<{ answer_type: string; answer_text: string | null; numeric_value: number | null }>
  explanations: Array<{ content: string }>
  reviews: Array<{ status: string; reviewer: string | null; note: string | null; reviewed_at: string | null }>
}

export function QuestionDetailPage() {
  const { problemId } = useParams()
  const { data: catalogs } = useCatalogs()
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [license, setLicense] = useState<string>('UNKNOWN')
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string>('')

  useEffect(() => {
    const client = getSupabase()
    if (!client || !problemId) return
    void (async () => {
      const { data: problem } = await client.from('problems').select('public_code').eq('id', problemId).single()
      if (!problem) {
        setError('문제를 찾을 수 없습니다.')
        return
      }
      setCode(problem.public_code)
      const { data, error: fetchError } = await client.rpc('hqb_fetch_problem_bundle', {
        p_public_code: problem.public_code,
      })
      if (fetchError || !data) {
        setError('문제 상세를 불러오지 못했습니다.')
        return
      }
      setBundle(data as Bundle)
      const { data: sources } = await client
        .from('problem_sources')
        .select('source_documents(license_status)')
        .eq('problem_id', problemId)
        .eq('is_primary_source', true)
        .maybeSingle()
      const doc = sources?.source_documents as { license_status?: string } | null
      setLicense(doc?.license_status ?? 'UNKNOWN')
    })()
  }, [problemId])

  if (error) return <main className="page"><p className="banner error">{error}</p></main>
  if (!bundle) return <main className="page"><p className="muted">문제를 불러오는 중입니다.</p></main>
  const human = bundle.difficulty.find((row) => row.difficulty_source === 'HUMAN')
  const expr = bundle.expressions[0]

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">{code}</p>
          <h1>문제 상세</h1>
        </div>
        <div className="actions">
          <Link className="btn" to={`/questions/${problemId}/edit`}>수정</Link>
          <Link className="btn" to={`/questions/${problemId}/review`}>검수</Link>
          <Link className="btn" to={`/questions/${problemId}/versions`}>버전 이력</Link>
        </div>
      </div>
      <section className="card">
        <p>
          <span className={`status-pill ${bundle.problem.review_status.toLowerCase()}`}>
            내용 검수: {REVIEW_LABELS[bundle.problem.review_status] ?? bundle.problem.review_status}
          </span>{' '}
          <span className={`status-pill ${isUsableLicense(license) ? 'verified' : 'needs_review'}`}>
            사용권: {license}
          </span>{' '}
          <span className="muted">현재 버전 v{bundle.current_version.version_no}</span>
        </p>
        <p className="hint">내용이 확정되어도 UNKNOWN/RESTRICTED 자료는 문제지 사용 가능이 아닙니다.</p>
        <p><strong>출처</strong> {bundle.sources[0]?.document_title ?? '없음'}</p>
        <p><strong>지시문</strong> {bundle.current_version.instruction || '—'}</p>
        <p className="stem">{bundle.current_version.problem_text}</p>
        {expr ? (
          <p>
            <strong>수식</strong> <KatexText tex={expr.latex_expression || expr.original_expression} />
            {expr.structure_skeleton ? <span className="muted"> · skeleton {expr.structure_skeleton}</span> : null}
          </p>
        ) : null}
        <p>
          <strong>정답</strong>{' '}
          {bundle.answers[0]?.answer_text ?? bundle.answers[0]?.numeric_value ?? '없음'}
        </p>
        {bundle.explanations[0] ? <p><strong>해설</strong> {bundle.explanations[0].content}</p> : null}
      </section>
      <section className="card">
        <h2>분류</h2>
        <p><strong>교육과정</strong> {bundle.curriculum[0] ? nodePath(catalogs?.nodes ?? [], bundle.curriculum[0].node_id) || bundle.curriculum[0].name : '—'}</p>
        <p><strong>개념</strong> {bundle.concepts.map((row) => `${row.name}${row.is_primary ? ' (PRIMARY)' : ''}`).join(', ') || '—'}</p>
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
        <h2>검수 이력</h2>
        {bundle.reviews.length === 0 ? <p className="muted">아직 검수 기록이 없습니다.</p> : (
          <ul>
            {bundle.reviews.map((row, index) => (
              <li key={index}>
                {REVIEW_LABELS[row.status] ?? row.status} · {row.note || '메모 없음'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
