import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { REVIEW_LABELS } from '../../lib/workflow/labels'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'
import { ProblemStemDisplay } from '../questions/ProblemStemDisplay'
import { RangeStemReviewPanel, type RangeAuditItem, type RangeApply838 } from './RangeStemReviewPanel'
import { FullQaReviewPanel, type FullQaPayload } from './FullQaReviewPanel'
import { ReviewMinimize840Panel, type Review840Payload } from './ReviewMinimize840Panel'
import { CloseoutReviewPanel, type CloseoutPayload } from './CloseoutReviewPanel'

type QueueItem = {
  problem_id: string
  public_code: string
  review_status: string
  lifecycle_status: string
  current_version_id: string | null
  source_document_id: string
  source_title: string
  page_number: number | null
  original_problem_number: string | null
  problem_text: string | null
  origin: string | null
}

export function PipelineReviewPage() {
  const [params, setParams] = useSearchParams()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rangeItems, setRangeItems] = useState<RangeAuditItem[]>([])
  const [rangeApplies, setRangeApplies] = useState<RangeApply838[]>([])
  const [rangeSelected, setRangeSelected] = useState<string | null>(null)
  const [qaPayload, setQaPayload] = useState<FullQaPayload | null>(null)
  const [qaSelected, setQaSelected] = useState<string | null>(null)
  const [qa840Payload, setQa840Payload] = useState<Review840Payload | null>(null)
  const [qa840Selected, setQa840Selected] = useState<string | null>(null)
  const [closeoutPayload, setCloseoutPayload] = useState<CloseoutPayload | null>(null)
  const [closeoutSelected, setCloseoutSelected] = useState<string | null>(null)
  const source = params.get('source') ?? ''
  const rangeTab = source === 'range838'
  const qaTab = source === 'qa839'
  const qa840Tab = source === 'qa840'
  const closeoutTab = source === 'closeout'

  useEffect(() => {
    const client = getSupabase()
    if (!client) return
    void (async () => {
      const rpcSource = source === SSEN_SOURCE_DOCUMENT_ID ? SSEN_SOURCE_DOCUMENT_ID : null
      const { data, error: queueError } = await client.rpc('hqb_list_review_queue', {
        payload: { source_document_id: rpcSource },
      } as never)
      if (queueError || !data) {
        setError('확인 필요 목록을 불러오지 못했습니다.')
        return
      }
      let items = ((data as { items?: QueueItem[] }).items ?? []) as QueueItem[]
      if (source === 'other') items = items.filter((row) => row.source_document_id !== SSEN_SOURCE_DOCUMENT_ID)
      setQueue(items)
      setSelectedId(items[0]?.problem_id ?? null)
      setError(null)
    })()
  }, [source])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/step8-38-range-audit.json')
        if (!res.ok) return
        const payload = (await res.json()) as { candidates?: RangeAuditItem[]; applies?: RangeApply838[] }
        const items = payload.candidates ?? []
        setRangeItems(items)
        setRangeApplies(payload.applies ?? [])
        setRangeSelected(items[0]?.problem_id ?? null)
      } catch {
        setRangeItems([])
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/step8-39-full-qa.json')
        if (!res.ok) return
        const payload = (await res.json()) as FullQaPayload
        setQaPayload(payload)
        setQaSelected(payload.records?.[0]?.problem_id ?? null)
      } catch {
        setQaPayload(null)
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/step8-40-review-minimize.json')
        if (!res.ok) return
        const payload = (await res.json()) as Review840Payload
        setQa840Payload(payload)
        setQa840Selected(payload.records?.[0]?.problem_id ?? null)
      } catch {
        setQa840Payload(null)
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/ssen-book-closeout.json')
        if (!res.ok) return
        const payload = (await res.json()) as CloseoutPayload
        setCloseoutPayload(payload)
        const human = payload.records?.find((row) => row.verdict === 'HUMAN_FINAL_CHECK')
        setCloseoutSelected(human?.problem_id ?? payload.records?.[0]?.problem_id ?? null)
      } catch {
        setCloseoutPayload(null)
      }
    })()
  }, [])

  const selected = useMemo(() => queue.find((row) => row.problem_id === selectedId) ?? null, [queue, selectedId])
  const ssenCount = queue.filter((row) => row.source_document_id === SSEN_SOURCE_DOCUMENT_ID).length
  const otherCount = queue.length - ssenCount

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="kicker">강사 확인</p>
          <h1>확인 필요 큐</h1>
          <p className="muted">실제 문제의 확인 필요 상태입니다. 자동 확정하지 않습니다. 범위형 합침·전체검수 8.39·일괄대조 8.40·최종 마감은 별도 탭입니다.</p>
        </div>
        <Link className="btn ghost" to="/questions?review=NEEDS_REVIEW">
          문제 목록에서 보기
        </Link>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      <div className="filters pipeline-filters">
        <button
          type="button"
          className={`btn ${source === '' ? 'primary' : 'ghost'}`}
          onClick={() => setParams({}, { replace: true })}
        >
          전체 {queue.length}
        </button>
        <button
          type="button"
          className={`btn ${source === SSEN_SOURCE_DOCUMENT_ID ? 'primary' : 'ghost'}`}
          onClick={() => setParams({ source: SSEN_SOURCE_DOCUMENT_ID }, { replace: true })}
        >
          쎈수학 {source === SSEN_SOURCE_DOCUMENT_ID ? queue.length : ssenCount}
        </button>
        <button
          type="button"
          className={`btn ${source === 'other' ? 'primary' : 'ghost'}`}
          onClick={() => setParams({ source: 'other' }, { replace: true })}
        >
          다른 교재 {otherCount}
        </button>
        <button
          type="button"
          className={`btn ${rangeTab ? 'primary' : 'ghost'}`}
          onClick={() => setParams({ source: 'range838' }, { replace: true })}
        >
          범위형 합침 {rangeItems.length}
        </button>
        <button
          type="button"
          className={`btn ${qaTab ? 'primary' : 'ghost'}`}
          onClick={() => setParams({ source: 'qa839' }, { replace: true })}
        >
          전체검수 8.39 {qaPayload?.summary?.listed_inspected ?? 1242}
        </button>
        <button
          type="button"
          className={`btn ${qa840Tab ? 'primary' : 'ghost'}`}
          onClick={() => setParams({ source: 'qa840' }, { replace: true })}
        >
          일괄대조 8.40 {qa840Payload?.summary?.start_review ?? 128}
        </button>
        <button
          type="button"
          className={`btn ${closeoutTab ? 'primary' : 'ghost'}`}
          onClick={() => setParams({ source: 'closeout' }, { replace: true })}
        >
          최종 마감 {closeoutPayload?.summary?.start_review ?? 56}
        </button>
      </div>
      {closeoutTab ? (
        <CloseoutReviewPanel payload={closeoutPayload} selectedId={closeoutSelected} onSelect={setCloseoutSelected} />
      ) : qa840Tab ? (
        <ReviewMinimize840Panel payload={qa840Payload} selectedId={qa840Selected} onSelect={setQa840Selected} />
      ) : qaTab ? (
        <FullQaReviewPanel payload={qaPayload} selectedId={qaSelected} onSelect={setQaSelected} />
      ) : rangeTab ? (
        <RangeStemReviewPanel items={rangeItems} selectedId={rangeSelected} onSelect={setRangeSelected} applies={rangeApplies} />
      ) : (
        <div className="review-split">
          <table className="data-table">
            <thead>
              <tr>
                <th>교재</th>
                <th>페이지</th>
                <th>번호</th>
                <th>코드</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <tr
                  key={row.problem_id}
                  className={row.problem_id === selectedId ? 'is-selected' : undefined}
                  onClick={() => setSelectedId(row.problem_id)}
                >
                  <td>{row.source_title}</td>
                  <td>{row.page_number ?? '—'}</td>
                  <td>{row.original_problem_number ?? '—'}</td>
                  <td>{row.public_code}</td>
                  <td>
                    <span className="status-pill needs_review">{REVIEW_LABELS[row.review_status] ?? row.review_status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected ? (
            <section className="card review-detail">
              <p className="kicker">
                {selected.source_title} · p.{selected.page_number} · {selected.original_problem_number}
              </p>
              <h2>{selected.public_code}</h2>
              <p className="stem">
                <ProblemStemDisplay text={selected.problem_text || '—'} />
              </p>
              <div className="review-actions">
                <Link className="btn primary" to={`/questions/${selected.problem_id}/edit`}>
                  편집기로 이동
                </Link>
                <Link className="btn ghost" to={`/sources/${selected.source_document_id}/browse`}>
                  교재 목차
                </Link>
              </div>
            </section>
          ) : (
            <p className="muted">확인할 문제가 없습니다.</p>
          )}
        </div>
      )}
    </main>
  )
}
