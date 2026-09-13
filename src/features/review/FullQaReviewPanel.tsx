import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProblemStemDisplay } from '../questions/ProblemStemDisplay'
import { SSEN_SOURCE_DOCUMENT_ID } from '../../lib/outline/ssenToc'

export type FullQaRecord = {
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
  stem: string
  proposed_stem: string | null
  katex: { render_fail: number; max_width_px: number; overflow_360: boolean; overflow_a4_2col: boolean }
  has_figure: boolean
  figure_needed: boolean
  evidence: string[]
  teacher_edit: boolean
  verified: boolean
}

export type FullQaPayload = {
  inspected_at?: string
  summary?: {
    listed_inspected: number
    pages_inspected: number
    pass: number
    auto_safe: number
    review_required: number
    paid_ocr_candidate: number
    blocked: number
    p0: number
    p1: number
    p2: number
    p3: number
    p4: number
  }
  pdf_sha256?: string | null
  records?: FullQaRecord[]
}

const VERDICTS = ['', 'PASS', 'AUTO_SAFE', 'REVIEW_REQUIRED', 'PAID_OCR_CANDIDATE', 'BLOCKED']
const PRIOS = ['', 'P0', 'P1', 'P2', 'P3', 'P4']

export function FullQaReviewPanel({
  payload,
  selectedId,
  onSelect,
}: {
  payload: FullQaPayload | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const records = useMemo(() => payload?.records ?? [], [payload])
  const summary = payload?.summary
  const [verdict, setVerdict] = useState('')
  const [priority, setPriority] = useState('')
  const [signal, setSignal] = useState('')
  const [page, setPage] = useState('')
  const [number, setNumber] = useState('')
  const [major, setMajor] = useState('')
  const [figure, setFigure] = useState('')
  const [math, setMath] = useState('')
  const [range, setRange] = useState('')

  const filtered = useMemo(() => {
    return records.filter((row) => {
      if (verdict && row.verdict !== verdict) return false
      if (priority && row.priority !== priority) return false
      if (signal && !row.signals.includes(signal)) return false
      if (page && String(row.source_page ?? '') !== page) return false
      if (number && !row.current_number.includes(number)) return false
      if (major && row.major_code !== major) return false
      if (figure === 'needed' && !row.figure_needed) return false
      if (figure === 'missing' && !(row.figure_needed && !row.has_figure)) return false
      if (math === 'fail' && row.katex.render_fail <= 0) return false
      if (range === 'yes' && !row.signals.some((code) => code.includes('RANGE'))) return false
      return true
    })
  }, [records, verdict, priority, signal, page, number, major, figure, math, range])

  const selected = filtered.find((row) => row.problem_id === selectedId) ?? filtered[0] ?? null
  const signalOptions = [...new Set(records.flatMap((row) => row.signals))].sort()

  return (
    <div className="qa839">
      <section className="qa839-summary">
        <p className="kicker">전체검수 STEP 8.39</p>
        <h2>쎈수학 1,242 · 192페이지</h2>
        <p className="muted">
          검사 {summary?.listed_inspected ?? 0}/1242 · 페이지 {summary?.pages_inspected ?? 0}/192 · {payload?.inspected_at ?? '—'} · PDF{' '}
          {payload?.pdf_sha256 ? payload.pdf_sha256.slice(0, 12) : '없음'}
        </p>
        <div className="qa839-stats">
          <span>PASS {summary?.pass ?? 0}</span>
          <span>AUTO_SAFE {summary?.auto_safe ?? 0}</span>
          <span>검수 {summary?.review_required ?? 0}</span>
          <span>유료 OCR {summary?.paid_ocr_candidate ?? 0}</span>
          <span>BLOCKED {summary?.blocked ?? 0}</span>
          <span>P0 {summary?.p0 ?? 0}</span>
          <span>P1 {summary?.p1 ?? 0}</span>
          <span>P2 {summary?.p2 ?? 0}</span>
          <span>P3 {summary?.p3 ?? 0}</span>
          <span>P4 {summary?.p4 ?? 0}</span>
        </div>
      </section>
      <div className="qa839-filters">
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
          <input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" placeholder="9" />
        </label>
        <label>
          번호
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="0002" />
        </label>
        <label>
          도형
          <select value={figure} onChange={(e) => setFigure(e.target.value)}>
            <option value="">전체</option>
            <option value="needed">도형 신호</option>
            <option value="missing">도형 누락</option>
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
          범위 발문
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="">전체</option>
            <option value="yes">있음</option>
          </select>
        </label>
      </div>
      <div className="review-split qa839-split">
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
              신호 {selected.signals.join(', ') || '없음'} · KaTeX fail {selected.katex.render_fail} · width {selected.katex.max_width_px}px
              {selected.katex.overflow_360 ? ' · overflow 360' : ''}
              {selected.katex.overflow_a4_2col ? ' · overflow A4 2단' : ''}
            </p>
            <div className="qa839-compare">
              <div>
                <p>
                  <strong>원본 근거</strong>
                </p>
                <p className="muted">{selected.evidence.join(' · ') || '페이지 이미지 없음 — 기존 OCR/이웃 문항만 사용'}</p>
              </div>
              <div>
                <p>
                  <strong>현재 문제</strong>
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
                  <p className="muted">자동 수정 없음. 현재 stem을 검수합니다.</p>
                )}
              </div>
            </div>
            <div className="review-actions">
              <Link className="btn primary" to={`/questions/${selected.problem_id}/edit`}>
                편집
              </Link>
              <Link className="btn ghost" to={`/sources/${SSEN_SOURCE_DOCUMENT_ID}/browse?page=${selected.source_page ?? 9}`}>
                원본 보기
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
