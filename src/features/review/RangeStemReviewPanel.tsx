import { Link } from 'react-router-dom'
import { ProblemStemDisplay } from '../questions/ProblemStemDisplay'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'

export type RangeAuditItem = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  detected_range: string | null
  keep: string
  shared: string
  current_stem: string
  verdict: 'AUTO_SAFE' | 'REVIEW_REQUIRED' | 'BLOCKED'
  verdict_reason: string
  planned_changes: string[]
  evidence: string[]
  teacher_edit: boolean
  verified: boolean
  origin: string | null
  extra_boundary: string[]
  kind: string
  targets: Array<{
    problem_number: number
    listed_count: number
    records: Array<{ id: string; public_code: string; stem: string; display_state: string }>
  }>
}

export function RangeStemReviewPanel({
  items,
  selectedId,
  onSelect,
}: {
  items: RangeAuditItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const selected = items.find((row) => row.problem_id === selectedId) ?? items[0] ?? null
  const counts = {
    AUTO_SAFE: items.filter((row) => row.verdict === 'AUTO_SAFE').length,
    REVIEW_REQUIRED: items.filter((row) => row.verdict === 'REVIEW_REQUIRED').length,
    BLOCKED: items.filter((row) => row.verdict === 'BLOCKED').length,
  }

  return (
    <div className="review-split">
      <div>
        <p className="muted">
          범위형 합침 {items.length}건 · AUTO_SAFE {counts.AUTO_SAFE} · 확인 필요 {counts.REVIEW_REQUIRED} · 보류 {counts.BLOCKED}
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>페이지</th>
              <th>범위</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.problem_id}
                className={row.problem_id === selected?.problem_id ? 'is-selected' : undefined}
                onClick={() => onSelect(row.problem_id)}
              >
                <td>{row.current_number}</td>
                <td>{row.source_page ?? '—'}</td>
                <td>{row.detected_range ?? '—'}</td>
                <td>
                  <span className={`status-pill ${row.verdict.toLowerCase()}`}>{row.verdict}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <section className="card review-detail">
          <p className="kicker">
            원본 페이지 p.{selected.source_page ?? '—'} · 앞 문제 {selected.current_number} · {selected.detected_range}
          </p>
          <h2>{selected.public_code}</h2>
          <p className="muted">{selected.verdict_reason}</p>
          <p>
            <strong>공통 발문 후보</strong>
          </p>
          <p className="stem">
            <ProblemStemDisplay text={selected.shared || '—'} />
          </p>
          <p>
            <strong>변경 전</strong>
          </p>
          <p className="stem">
            <ProblemStemDisplay text={selected.current_stem} />
          </p>
          <p>
            <strong>앞 문제에 남을 본문</strong>
          </p>
          <p className="stem">
            <ProblemStemDisplay text={selected.keep || '—'} />
          </p>
          <p>
            <strong>대상 문제</strong>
          </p>
          <ul className="reason-list">
            {selected.targets.map((target) => {
              const listed = target.records.find((row) => row.display_state === 'LISTED')
              return (
                <li key={target.problem_number}>
                  {String(target.problem_number).padStart(4, '0')} ({target.listed_count} listed)
                  {listed ? (
                    <>
                      {' '}
                      <Link to={`/questions/${listed.id}`}>{listed.public_code}</Link>
                      <div className="stem">
                        <ProblemStemDisplay text={listed.stem} />
                      </div>
                    </>
                  ) : (
                    ' — listed 없음'
                  )}
                </li>
              )
            })}
          </ul>
          {selected.extra_boundary.length ? <p className="muted">추가 경계: {selected.extra_boundary.join(', ')}</p> : null}
          <p className="muted">근거: {selected.evidence.join(', ') || '—'}</p>
          <div className="review-actions">
            <Link className="btn primary" to={`/questions/${selected.problem_id}/edit`}>
              편집기로 이동
            </Link>
            <Link className="btn ghost" to={`/sources/${SSEN_SOURCE_DOCUMENT_ID}/browse`}>
              원본 페이지 보기
            </Link>
            <Link className="btn ghost" to={`/questions/${selected.problem_id}`}>
              문제 미리보기
            </Link>
          </div>
        </section>
      ) : (
        <p className="muted">범위형 후보가 없습니다.</p>
      )}
    </div>
  )
}
