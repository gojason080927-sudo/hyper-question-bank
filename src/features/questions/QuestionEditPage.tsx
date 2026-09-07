import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { useCatalogs } from '../../lib/workflow/useCatalogs'
import { emptyForm, buildPayload, type ProblemFormState } from '../../lib/workflow/formState'
import { parseHqBError } from '../../lib/workflow/validation'
import { beginSubmit, releaseSubmit } from '../../lib/workflow/submitLock'
import { ProblemForm } from './ProblemForm'
import { loadFormFromVersion } from './loadForm'

export function QuestionEditPage() {
  const { problemId } = useParams()
  const navigate = useNavigate()
  const { data: catalogs, loading: catalogLoading, error: catalogError } = useCatalogs()
  const [state, setState] = useState<ProblemFormState>(emptyForm())
  const [baseline, setBaseline] = useState<string>('')
  const [versionId, setVersionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const submitLock = useRef({ current: false })

  useEffect(() => {
    const client = getSupabase()
    if (!client || !problemId) return
    void (async () => {
      const { data: problem, error: problemError } = await client
        .from('problems')
        .select('id,current_version_id')
        .eq('id', problemId)
        .single()
      if (problemError || !problem) {
        setError('문제를 찾을 수 없습니다.')
        setLoading(false)
        return
      }
      const { data: versions } = await client
        .from('problem_versions')
        .select('id,review_status,version_no')
        .eq('problem_id', problemId)
        .order('version_no')
      const openDraft = (versions ?? []).find(
        (row) => row.review_status !== 'VERIFIED' && row.review_status !== 'REJECTED',
      )
      const current = (versions ?? []).find((row) => row.id === problem.current_version_id)
      let targetId = openDraft?.id ?? current?.id ?? null
      if (!openDraft && current?.review_status === 'VERIFIED') {
        const { data: cloned, error: cloneError } = await client.rpc('hqb_clone_problem_version', {
          p_problem_id: problemId,
          p_change_reason: 'UI 수정 — 새 초안 버전',
          p_content_overrides: {},
        })
        if (cloneError) {
          setError(parseHqBError(cloneError.message))
          setLoading(false)
          return
        }
        targetId = (cloned as { version_id?: string })?.version_id ?? null
      }
      if (!targetId) {
        setError('편집할 버전을 만들지 못했습니다.')
        setLoading(false)
        return
      }
      const form = await loadFormFromVersion(client, problemId, targetId)
      setState(form)
      setBaseline(JSON.stringify(form))
      setVersionId(targetId)
      setLoading(false)
    })()
  }, [problemId])

  if (loading || catalogLoading) return <main className="page"><p className="muted">편집할 버전을 준비하는 중입니다.</p></main>
  if (catalogError || !catalogs) {
    return <main className="page"><p className="banner error">{catalogError ?? '분류 정보를 불러오지 못했습니다.'}</p></main>
  }

  return (
    <main className="page wide">
      <p className="kicker">편집</p>
      <h1>문제 수정</h1>
      <p className="hint">VERIFIED 문제는 덮어쓰지 않고 새 초안 버전을 만듭니다. 확정 전까지 기존 공개 버전은 유지됩니다.</p>
      <ProblemForm
        catalogs={catalogs}
        state={state}
        setState={setState}
        dirty={JSON.stringify(state) !== baseline}
        submitting={submitting}
        error={error}
        submitLabel="초안 저장"
        onSubmit={async () => {
          const client = getSupabase()
          if (!client || !versionId) return
          if (!beginSubmit(submitLock.current)) return
          setSubmitting(true)
          setError(null)
          const { error: saveError } = await client.rpc('hqb_update_draft_version', {
            p_version_id: versionId,
            payload: buildPayload(state),
          })
          if (saveError) {
            releaseSubmit(submitLock.current)
            setSubmitting(false)
            setError(parseHqBError(saveError.message))
            console.error(saveError)
            return
          }
          if (problemId) navigate(`/questions/${problemId}`)
        }}
      />
    </main>
  )
}
