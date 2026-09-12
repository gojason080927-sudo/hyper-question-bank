import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { KatexText } from '../../lib/math/KatexText'

type Check = 'PASS' | 'FAIL' | 'NOT_COMPARED'

type QueueItem = {
  candidate_id: string
  status: string
  reasons: string[]
  page_number: number
  problem_number: string | null
  canonical_number: string | null
  problem_id: string | null
  version_id: string | null
  public_code: string | null
  persist_action: string
  checks: Record<string, Check>
  crop_url: string
  review_path: string | null
  has_figure: boolean
  has_table: boolean
  choices: string[]
  math: string[]
  stem_preview: string
  ocr_preview: string
}

type LiveProblem = {
  id: string
  public_code: string
  review_status: string
  lifecycle_status: string
  current_version_id: string | null
}

const CHECK_LABELS: Record<string, string> = {
  identity: '번호',
  stem: '본문',
  choices: '선택지',
  math: '수식',
  figure: '도형',
  boundary: '경계',
}

export function PipelineReviewPage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [live, setLive] = useState<Record<string, LiveProblem>>({})
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/review-queue.json')
        if (!response.ok) throw new Error('검수 큐를 불러오지 못했습니다.')
        const data = (await response.json()) as { items?: QueueItem[] }
        const items = data.items ?? []
        setQueue(items)
        setSelectedId(items[0]?.candidate_id ?? null)
        const ids = items.map((row) => row.problem_id).filter((id): id is string => Boolean(id))
        const client = getSupabase()
        if (client && ids.length) {
          const { data: problems, error: problemError } = await client
            .from('problems')
            .select('id,public_code,review_status,lifecycle_status,current_version_id')
            .in('id', ids)
          if (!problemError && problems) {
            setLive(Object.fromEntries(problems.map((row) => [row.id, row])))
          }
        }
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '검수 큐를 불러오지 못했습니다.')
      }
    })()
  }, [])

  const selected = useMemo(
    () => queue.find((row) => row.candidate_id === selectedId) ?? null,
    [queue, selectedId],
  )
  const filtered = queue.filter((row) => {
    if (!filter) return true
    if (filter === 'HUMAN_REVIEW' || filter === 'BLOCKED') return row.status === filter
    return true
  })
  const liveRow = selected?.problem_id ? live[selected.problem_id] : null

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">STEP 8.31 파이럿</p>
          <h1>강사 검수 큐</h1>
          <p className="muted">원본 crop · 구조화 결과 · 차단 사유. 자동 확정하지 않습니다.</p>
        </div>
        <Link className="btn ghost" to="/questions?review=NEEDS_REVIEW">
          문제 목록 검수 필요
        </Link>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      <div className="filters">
        <button type="button" className={`btn ${filter === '' ? 'primary' : 'ghost'}`} onClick={() => setFilter('')}>
          전체 {queue.length}
        </button>
        <button
          type="button"
          className={`btn ${filter === 'HUMAN_REVIEW' ? 'primary' : 'ghost'}`}
          onClick={() => setFilter('HUMAN_REVIEW')}
        >
          HUMAN_REVIEW {queue.filter((row) => row.status === 'HUMAN_REVIEW').length}
        </button>
        <button
          type="button"
          className={`btn ${filter === 'BLOCKED' ? 'primary' : 'ghost'}`}
          onClick={() => setFilter('BLOCKED')}
        >
          BLOCKED {queue.filter((row) => row.status === 'BLOCKED').length}
        </button>
      </div>
      <div className="review-split">
        <table className="data-table">
          <thead>
            <tr>
              <th>샘플</th>
              <th>페이지</th>
              <th>번호</th>
              <th>상태</th>
              <th>Production</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.candidate_id}
                className={row.candidate_id === selectedId ? 'is-selected' : undefined}
                onClick={() => setSelectedId(row.candidate_id)}
              >
                <td>{row.candidate_id}</td>
                <td>{row.page_number}</td>
                <td>{row.problem_number ?? '—'}</td>
                <td>
                  <span className={`status-pill ${row.status === 'BLOCKED' ? 'rejected' : 'needs_review'}`}>
                    {row.status}
                  </span>
                </td>
                <td>{row.public_code ?? live[row.problem_id ?? '']?.public_code ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected ? (
          <section className="card review-detail">
            <p className="kicker">
              {selected.candidate_id} · p.{selected.page_number} · {selected.persist_action}
            </p>
            <h2>{selected.public_code ?? liveRow?.public_code ?? 'Production ID 없음'}</h2>
            {liveRow ? (
              <p>
                <span className={`status-pill ${liveRow.review_status.toLowerCase()}`}>
                  {REVIEW_LABELS[liveRow.review_status] ?? liveRow.review_status}
                </span>{' '}
                <span className="muted">{liveRow.lifecycle_status}</span>
              </p>
            ) : (
              <p className="muted">원본은 비교됐지만 Production 초안 identity가 없거나 차단입니다.</p>
            )}
            <div className="check-row">
              {Object.entries(CHECK_LABELS).map(([key, label]) => (
                <span key={key} className={`status-pill ${selected.checks[key] === 'PASS' ? 'verified' : 'needs_review'}`}>
                  {label}: {selected.checks[key]}
                </span>
              ))}
            </div>
            <img
              className="crop-frame"
              src={selected.crop_url}
              alt={`${selected.candidate_id} crop`}
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
            <p>
              <strong>본문</strong>
            </p>
            <p className="stem">{selected.stem_preview || '—'}</p>
            {selected.choices.length > 0 ? (
              <ol>
                {selected.choices.map((choice, index) => (
                  <li key={`${selected.candidate_id}-c-${index}`}>{choice}</li>
                ))}
              </ol>
            ) : null}
            {selected.math.length > 0 ? (
              <div>
                <p>
                  <strong>수식</strong>
                </p>
                {selected.math.map((tex, index) => (
                  <p key={`${selected.candidate_id}-m-${index}`}>
                    <KatexText tex={tex} />
                  </p>
                ))}
              </div>
            ) : null}
            <p>
              <strong>OCR 미리보기</strong>
            </p>
            <p className="stem">{selected.ocr_preview || '—'}</p>
            <p>
              <strong>도형</strong> {selected.has_figure ? '있음' : '없음'} · <strong>표</strong>{' '}
              {selected.has_table ? '있음' : '없음'}
            </p>
            <p>
              <strong>차단/검수 사유</strong>
            </p>
            <ul className="reason-list">
              {selected.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="review-actions">
              {selected.review_path ? (
                <Link className="btn primary" to={selected.review_path}>
                  기존 검수 화면에서 수정·승인·반려
                </Link>
              ) : (
                <p className="muted">검수 화면 링크 없음 (identity 불안정 또는 BLOCKED)</p>
              )}
            </div>
          </section>
        ) : (
          <p className="muted">큐 항목을 선택하세요.</p>
        )}
      </div>
    </main>
  )
}
