import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProblemStemDisplay } from '../questions/ProblemStemDisplay'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'

export type Review840Record = {
  problem_id: string
  public_code: string
  current_number: string
  source_page: number | null
  section_code: string | null
  major_code: string | null
  verdict: string
  priority: string | null
  root_cause: string | null
  verdict_reason: string
  signals: string[]
  rules?: string[]
  evidence: string[]
  stem: string
  proposed_stem: string | null
  teacher_edit: boolean
  verified: boolean
  neighbors_before?: Array<{ number: string; stem: string }>
  neighbors_after?: Array<{ number: string; stem: string }>
  page_numbers?: string[]
  original_page_available?: boolean
  katex?: { render_fail: number; max_width_px: number; overflow_360: boolean; overflow_a4_2col: boolean }
  has_figure?: boolean
  figure_needed?: boolean
}

export type Review840Payload = {
  inspected_at?: string
  summary?: {
    start_review: number
    unique_pages: number
    pass_false_positive: number
    auto_safe: number
    review_required: number
    blocked: number
    paid_ocr_candidate: number
    p1: number
    human_remaining: number
    paid_ocr_calls: number
  }
  p1?: Array<{ current_number: string; verdict: string; verdict_reason: string }>
  records?: Review840Record[]
  vercel?: { project_id?: string; git_repo?: string; team_slug?: string }
}

const VERDICTS = ['', 'PASS_FALSE_POSITIVE', 'AUTO_SAFE', 'REVIEW_REQUIRED', 'BLOCKED', 'PAID_OCR_CANDIDATE']
const PRIOS = ['', 'P0', 'P1', 'P2', 'P3', 'P4']

export function ReviewMinimize840Panel({
  payload,
  selectedId,
  onSelect,
}: {
  payload: Review840Payload | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const records = useMemo(() => payload?.records ?? [], [payload])
  const summary = payload?.summary
  const [verdict, setVerdict] = useState('')
  const [priority, setPriority] = useState('')
  const [signal, setSignal] = useState('')
  const [page, setPage] = useState('')
  const [major, setMajor] = useState('')
  const [figure, setFigure] = useState('')
  const [math, setMath] = useState('')
  const [range, setRange] = useState('')

  const filtered = useMemo(() => {
    return records.filter((row) => {
      if (verdict && row.verdict !== verdict) return false
      if (priority && row.priority !== priority) return false
      if (signal && !(row.signals ?? []).includes(signal) && !(row.rules ?? []).includes(signal)) return false
      if (page && String(row.source_page ?? '') !== page) return false
      if (major && row.major_code !== major) return false
      if (figure === 'needed' && !row.figure_needed) return false
      if (math === 'fail' && (row.katex?.render_fail ?? 0) <= 0) return false
      if (range === 'yes' && !(row.signals ?? []).some((code) => code.includes('RANGE'))) return false
      return true
    })
  }, [records, verdict, priority, signal, page, major, figure, math, range])

  const selected = filtered.find((row) => row.problem_id === selectedId) ?? filtered[0] ?? null
  const signalOptions = [...new Set(records.flatMap((row) => [...(row.signals ?? []), ...(row.rules ?? [])]))].sort()

  return (
    <div className="qa840">
      <section className="qa839-summary">
        <p className="kicker">일괄 대조 STEP 8.40</p>
        <h2>검수 후보 128 · 페이지 묶음 대조</h2>
        <p className="muted">
          시작 {summary?.start_review ?? 128} · 고유 페이지 {summary?.unique_pages ?? 0} · P1 {summary?.p1 ?? 9} · 유료 OCR{' '}
          {summary?.paid_ocr_calls ?? 0} · {payload?.inspected_at ?? '—'}
        </p>
        <div className="qa839-stats">
          <span>시작 128</span>
          <span>정상 오탐 {summary?.pass_false_positive ?? 0}</span>
          <span>자동 복원 {summary?.auto_safe ?? 0}</span>
          <span>사람 검수 {summary?.review_required ?? 0}</span>
          <span>BLOCKED {summary?.blocked ?? 0}</span>
          <span>고유 페이지 {summary?.unique_pages ?? 0}</span>
          <span>유료 OCR {summary?.paid_ocr_candidate ?? 0}</span>
        </div>
      </section>
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
          심각도
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIOS.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || '전체'}
              </option>
            ))}
          </select>
        </label>
        <label>
          오류 유형
          <select value={signal} onChange={(e) => setSignal(e.target.value)}>
            <option value="">전체</option>
            {signalOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          대단원
          <select value={major} onChange={(e) => setMajor(e.target.value)}>
            <option value="">전체</option>
            {['I', 'II', 'III', 'IV', 'V'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          페이지
          <input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" placeholder="47" />
        </label>
        <label>
          도형
          <select value={figure} onChange={(e) => setFigure(e.target.value)}>
            <option value="">전체</option>
            <option value="needed">도형 신호</option>
          </select>
        </label>
        <label>
          수식
          <select value={math} onChange={(e) => setMath(e.target.value)}>
            <option value="">전체</option>
            <option value="fail">렌더 실패</option>
          </select>
        </label>
        <label>
          공통 발문
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="">전체</option>
            <option value="yes">있음</option>
          </select>
        </label>
      </div>
      <div className="review-split qa840-split">
        <table className="data-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>페이지</th>
              <th>판정</th>
              <th>P</th>
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
                <td>{row.priority ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected ? (
          <section className="card review-detail">
            <p className="kicker">
              p.{selected.source_page ?? '—'} · {selected.current_number} · {selected.major_code}/{selected.section_code}
            </p>
            <h2>{selected.public_code}</h2>
            <p className="muted">{selected.verdict_reason}</p>
            <p>
              8.39 {selected.root_cause} · 규칙 {(selected.rules ?? []).join(', ') || '없음'} · 근거{' '}
              {selected.evidence.join(' · ') || '이웃 문항'}
            </p>
            <p className="muted">같은 페이지 번호 {(selected.page_numbers ?? []).join(', ') || '—'}</p>
            <div className="qa840-compare">
              <div>
                <p>
                  <strong>원본 페이지</strong>
                </p>
                <p className="muted">
                  {selected.original_page_available ? `p.${selected.source_page} 전체 페이지. 임의 crop 없음.` : '페이지 이미지 없음 — OCR/이웃만 사용'}
                </p>
                <Link className="btn ghost" to={`/sources/${SSEN_SOURCE_DOCUMENT_ID}/browse?page=${selected.source_page ?? 9}`}>
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
                  <p className="muted">자동 수정 없음. {selected.verdict === 'PASS_FALSE_POSITIVE' ? '정상 오탐으로 검수함에서 해제합니다.' : '사람이 원본과 비교합니다.'}</p>
                )}
              </div>
            </div>
            <div className="qa840-neighbors">
              <div>
                <p>
                  <strong>앞 문항</strong>
                </p>
                {(selected.neighbors_before ?? []).length ? (
                  selected.neighbors_before!.map((row) => (
                    <p key={row.number} className="stem">
                      {row.number} <ProblemStemDisplay text={row.stem} />
                    </p>
                  ))
                ) : (
                  <p className="muted">없음</p>
                )}
              </div>
              <div>
                <p>
                  <strong>뒤 문항</strong>
                </p>
                {(selected.neighbors_after ?? []).length ? (
                  selected.neighbors_after!.map((row) => (
                    <p key={row.number} className="stem">
                      {row.number} <ProblemStemDisplay text={row.stem} />
                    </p>
                  ))
                ) : (
                  <p className="muted">없음</p>
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
