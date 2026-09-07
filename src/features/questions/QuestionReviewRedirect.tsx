import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { resolveReviewVersionId, reviewPath } from '../../lib/workflow/reviewTarget'

export function QuestionReviewRedirect() {
  const { problemId } = useParams()
  const [target, setTarget] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const client = getSupabase()
    if (!client || !problemId) return
    void (async () => {
      const { data: problem, error: problemError } = await client
        .from('problems')
        .select('current_version_id')
        .eq('id', problemId)
        .single()
      if (problemError || !problem) {
        setError('문제를 찾을 수 없습니다.')
        setTarget(null)
        return
      }
      const { data: versions } = await client
        .from('problem_versions')
        .select('id,version_no,review_status')
        .eq('problem_id', problemId)
        .order('version_no')
      setTarget(resolveReviewVersionId(versions ?? [], problem.current_version_id))
    })()
  }, [problemId])

  if (error) return <main className="page"><p className="banner error">{error}</p></main>
  if (!problemId || target === undefined) {
    return <main className="page"><p className="muted">검수할 버전을 찾는 중입니다.</p></main>
  }
  if (!target) return <main className="page"><p className="banner error">검수할 버전이 없습니다.</p></main>
  return <Navigate to={reviewPath(problemId, target)} replace />
}
