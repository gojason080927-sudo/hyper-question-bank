import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProblemStemDisplay } from '../questions/ProblemStemDisplay'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'

export type CloseoutRecord = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  verdict: string
  root_cause?: string | null
  verdict_reason: string
  signals?: string[]
  rules?: string[]
  evidence?: string[]
  stem: string
  proposed_stem: string | null
  teacher_edit?: boolean
  verified?: boolean
  create_draft_numbers?: string[]
}

export type CloseoutPayload = {
  inspected_at?: string
  book?: {
    banner?: string
    qa_complete?: boolean
    ready_for_use?: boolean
    human_exceptions?: number
    paid_ocr_usd?: number
    inspected_at?: string
  }
  summary?: {
    start_review: number
    unique_pages: number
    verified_by_source: number
    auto_safe: number
    pass_false_positive: number
    human_final_check: number
    paid_ocr_usd?: number
  }
  records?: CloseoutRecord[]
}

const VERDICTS = ['', 'VERIFIED_BY_SOURCE', 'AUTO_SAFE', 'PASS_FALSE_POSITIVE', 'HUMAN_FINAL_CHECK']

export function CloseoutReviewPanel({
  payload,
  selectedId,
  onSelect,
}: {
  payload: CloseoutPayload | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const records = useMemo(() => payload?.records ?? [], [payload])
  const summary = payload?.summary
  const [verdict, setVerdict] = useState('')
  const [page, setPage] = useState('')

  const filtered = useMemo(() => {
    return records.filter((row) => {
      if (verdict && row.verdict !== verdict) return false
      if (page && String(row.source_page ?? '') !== page) return false
      return true
    })
  }, [records, verdict, page])

  const selected = filtered.find((row) => row.problem_id === selectedId) ?? filtered[0] ?? null
  const human = records.filter((row) => row.verdict === 'HUMAN_FINAL_CHECK')

  return (
    <div className="qa840 closeout-panel">
      <section className="qa839-summary">
        <p className="kicker">쎈수학 최종 마감</p>
        <h2>{payload?.book?.banner ?? '전체검사 완료'}</h2>
        <p className="muted">
          시작 {summary?.start_review ?? 56} · 고유 페이지 {summary?.unique_pages ?? 0} · OCR $
          {(summary?.paid_ocr_usd ?? payload?.book?.paid_ocr_usd ?? 0).toFixed(4)} · {payload?.inspected_at ?? payload?.book?.inspected_at ?? '—'}
        </p>
        <div className="qa839-stats">
          <span>원본 확인 {summary?.verified_by_source ?? 0}</span>
          <span>자동 복원 {summary?.auto_safe ?? 0}</span>
          <span>정상 오탐 {summary?.pass_false_positive ?? 0}</span>
          <span>사람 확인 {summary?.human_final_check ?? 0}</span>
          <span>사용 가능 {payload?.book?.ready_for_use ? '예' : 'P1 잔여'}</span>
        </div>
      </section>
      {human.length ? (
        <section className="card closeout-exceptions">
          <p>
            <strong>예외 검수 {human.length}문항</strong>
          </p>
          <ul className="closeout-exception-links">
            {human.map((row) => (
              <li key={row.problem_id}>
                <button type="button" className="chip" onClick={() => onSelect(row.problem_id)}>
                  {row.current_number} p.{row.source_page ?? '—'}
                </button>
                <Link className="btn ghost" to={`/questions/${row.problem_id}/edit`}>
                  바로 이동
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="qa839-filters qa840-filters">
        <label>
          판정
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
            {VERDICTS.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || '전체'}
              </option>
            ))}
          </select>
        </label>
        <label>
          페이지
          <input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      <div className="review-split qa840-split">
        <table className="data-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>페이지</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.problem_id}
                className={row.problem_id === selected?.problem_id ? 'is-selected' : undefined}
                onClick={() => onSelect(row.problem_id)}
              >
                <td>{row.current_number}</td>
                <td>{row.source_page ?? '—'}</td>
                <td>
                  <span className={`status-pill ${row.verdict.toLowerCase()}`}>{row.verdict}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected ? (
          <section className="card review-detail">
            <p className="kicker">
              p.{selected.source_page ?? '—'} · {selected.current_number}
            </p>
            <h2>{selected.public_code}</h2>
            <p className="muted">{selected.verdict_reason}</p>
            <p>
              {selected.root_cause} · {(selected.rules ?? []).join(', ') || '규칙 없음'}
            </p>
            <div className="qa840-compare">
              <div>
                <p>
                  <strong>원본 페이지</strong>
                </p>
                <Link className="btn ghost" to={`/sources/${SSEN_SOURCE_DOCUMENT_ID}?page=${selected.source_page ?? 1}`}>
                  원본 보기
                </Link>
              </div>
              <div>
                <p>
                  <strong>현재 문항</strong>
                </p>
                <p className="stem">
                  <ProblemStemDisplay text={selected.stem || '—'} />
                </p>
              </div>
              <div>
                <p>
                  <strong>수정 후보</strong>
                </p>
                {selected.proposed_stem ? (
                  <p className="stem">
                    <ProblemStemDisplay text={selected.proposed_stem} />
                  </p>
                ) : (
                  <p className="muted">
                    {selected.verdict === 'PASS_FALSE_POSITIVE' ? '정상 오탐입니다.' : '자동 수정 없음. 사람이 원본과 비교합니다.'}
                  </p>
                )}
              </div>
            </div>
            <div className="review-actions">
              <Link className="btn primary" to={`/questions/${selected.problem_id}/edit`}>
                편집
              </Link>
              <Link className="btn ghost" to={`/worksheets/new?problemId=${selected.problem_id}`}>
                문제지 추가
              </Link>
            </div>
          </section>
        ) : (
          <p className="muted">조건에 맞는 문항이 없습니다.</p>
        )}
      </div>
    </div>
  )
}
