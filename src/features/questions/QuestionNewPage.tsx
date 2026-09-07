import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { useCatalogs } from '../../lib/workflow/useCatalogs'
import { emptyForm, buildPayload } from '../../lib/workflow/formState'
import { parseHqBError } from '../../lib/workflow/validation'
import { ProblemForm } from './ProblemForm'

export function QuestionNewPage() {
  const navigate = useNavigate()
  const { data: catalogs, loading, error: catalogError } = useCatalogs()
  const [state, setState] = useState(emptyForm)
  const [initial] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(state) !== JSON.stringify(initial)

  if (loading) return <main className="page"><p className="muted">분류 정보를 불러오는 중입니다.</p></main>
  if (catalogError || !catalogs) {
    return <main className="page"><p className="banner error">{catalogError ?? '분류 정보를 불러오지 못했습니다.'}</p></main>
  }

  return (
    <main className="page wide">
      <p className="kicker">신규 등록</p>
      <h1>문제 등록</h1>
      <ProblemForm
        catalogs={catalogs}
        state={state}
        setState={setState}
        dirty={dirty}
        submitting={submitting}
        error={error}
        submitLabel="초안 저장"
        onSubmit={async () => {
          const client = getSupabase()
          if (!client) return
          setSubmitting(true)
          setError(null)
          const { data, error: saveError } = await client.rpc('hqb_create_problem_draft', {
            payload: buildPayload(state),
          })
          setSubmitting(false)
          if (saveError) {
            setError(parseHqBError(saveError.message))
            console.error(saveError)
            return
          }
          const created = data as { problem_id?: string }
          if (created?.problem_id) navigate(`/questions/${created.problem_id}`)
        }}
      />
    </main>
  )
}
