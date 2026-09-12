import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { nodePath, useCatalogs } from '../../lib/workflow/useCatalogs'

type Row = {
  id: string
  public_code: string
  review_status: string
  updated_at: string
  current_version_id: string | null
  version_no: number | null
  problem_text: string
  concept: string
  type: string
  curriculum: string
  conceptId: string
  typeId: string
  nodeId: string
  overall: string
}

export function QuestionListPage() {
  const { data: catalogs } = useCatalogs()
  const [params] = useSearchParams()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(params.get('review') ?? '')
  const [conceptId, setConceptId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [nodeId, setNodeId] = useState('')

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      setLoading(true)
      const { data: problems, error: problemError } = await client
        .from('problems')
        .select('id,public_code,review_status,updated_at,current_version_id')
        .order('updated_at', { ascending: false })
      if (problemError || !problems) {
        setError('문제 목록을 불러오지 못했습니다.')
        setLoading(false)
        return
      }
      const versionIds = problems.map((row) => row.current_version_id).filter(Boolean) as string[]
      const { data: versions } = versionIds.length
        ? await client
            .from('problem_versions')
            .select('id,version_no,problem_text')
            .in('id', versionIds)
        : { data: [] }
      const { data: concepts } = versionIds.length
        ? await client
            .from('problem_concepts')
            .select('problem_version_id,concept_id,is_primary,concepts(name)')
            .in('problem_version_id', versionIds)
        : { data: [] }
      const { data: types } = versionIds.length
        ? await client
            .from('problem_type_assignments')
            .select('problem_version_id,hyper_problem_type_id,hyper_problem_types(name)')
            .in('problem_version_id', versionIds)
        : { data: [] }
      const { data: curriculum } = versionIds.length
        ? await client
            .from('problem_curriculum')
            .select('problem_version_id,curriculum_node_id')
            .in('problem_version_id', versionIds)
        : { data: [] }
      const { data: difficulty } = versionIds.length
        ? await client
            .from('problem_difficulty')
            .select('problem_version_id,overall_difficulty,difficulty_source')
            .in('problem_version_id', versionIds)
            .eq('difficulty_source', 'HUMAN')
        : { data: [] }

      const versionMap = new Map((versions ?? []).map((row) => [row.id, row]))
      const next: Row[] = problems.map((problem) => {
        const version = problem.current_version_id ? versionMap.get(problem.current_version_id) : undefined
        const concept = (concepts ?? []).find(
          (row) => row.problem_version_id === problem.current_version_id && row.is_primary,
        )
        const type = (types ?? []).find((row) => row.problem_version_id === problem.current_version_id)
        const curr = (curriculum ?? []).find((row) => row.problem_version_id === problem.current_version_id)
        const diff = (difficulty ?? []).find((row) => row.problem_version_id === problem.current_version_id)
        const conceptName =
          concept && typeof concept.concepts === 'object' && concept.concepts && 'name' in concept.concepts
            ? String(concept.concepts.name)
            : ''
        const typeName =
          type && typeof type.hyper_problem_types === 'object' && type.hyper_problem_types && 'name' in type.hyper_problem_types
            ? String(type.hyper_problem_types.name)
            : ''
        return {
          id: problem.id,
          public_code: problem.public_code,
          review_status: problem.review_status,
          updated_at: problem.updated_at,
          current_version_id: problem.current_version_id,
          version_no: version?.version_no ?? null,
          problem_text: version?.problem_text ?? '',
          concept: conceptName,
          type: typeName,
          curriculum: curr && catalogs ? nodePath(catalogs.nodes, curr.curriculum_node_id) : '',
          conceptId: concept?.concept_id ?? '',
          typeId:
            type && 'hyper_problem_type_id' in type ? String(type.hyper_problem_type_id ?? '') : '',
          nodeId: curr?.curriculum_node_id ?? '',
          overall: diff?.overall_difficulty != null ? Number(diff.overall_difficulty).toFixed(2) : '—',
        }
      })
      setRows(next)
      setError(null)
      setLoading(false)
    })()
  }, [catalogs])

  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase()
    if (q && !row.public_code.toLowerCase().includes(q) && !row.problem_text.toLowerCase().includes(q)) return false
    if (status && row.review_status !== status) return false
    if (conceptId && row.conceptId !== conceptId) return false
    if (typeId && row.typeId !== typeId) return false
    if (nodeId && row.nodeId !== nodeId) return false
    return true
  })

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">문제 데이터베이스</p>
          <h1>문제 목록</h1>
        </div>
        <Link className="btn primary" to="/questions/new">
          신규 등록
        </Link>
      </div>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <input
          placeholder="코드 또는 본문 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="문제 검색"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="검수 상태">
          <option value="">모든 검수 상태</option>
          {Object.entries(REVIEW_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={conceptId} onChange={(event) => setConceptId(event.target.value)} aria-label="개념">
          <option value="">모든 개념</option>
          {(catalogs?.concepts ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={typeId} onChange={(event) => setTypeId(event.target.value)} aria-label="HYPER 유형">
          <option value="">모든 유형</option>
          {(catalogs?.types ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={nodeId} onChange={(event) => setNodeId(event.target.value)} aria-label="교육과정">
          <option value="">모든 교육과정</option>
          {(catalogs?.nodes ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {nodePath(catalogs?.nodes ?? [], item.id)}
            </option>
          ))}
        </select>
      </form>
      {loading ? <p className="muted">목록을 불러오는 중입니다.</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {!loading && filtered.length === 0 ? (
        <p className="banner">등록된 문제가 없거나 필터와 맞는 문제가 없습니다.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>코드</th>
              <th>본문</th>
              <th>교육과정</th>
              <th>개념</th>
              <th>유형</th>
              <th>난이도</th>
              <th>검수</th>
              <th>버전</th>
              <th>수정</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/questions/${row.id}`}>{row.public_code}</Link>
                </td>
                <td>{row.problem_text.slice(0, 72) || '—'}</td>
                <td>{row.curriculum || '—'}</td>
                <td>{row.concept || '—'}</td>
                <td>{row.type || '—'}</td>
                <td>{row.overall}</td>
                <td>
                  <span className={`status-pill ${row.review_status.toLowerCase()}`}>
                    {REVIEW_LABELS[row.review_status] ?? row.review_status}
                  </span>
                </td>
                <td>{row.version_no ? `v${row.version_no}` : '—'}</td>
                <td>{new Date(row.updated_at).toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
