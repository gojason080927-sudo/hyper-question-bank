import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase/client'
import { parseHqBError } from '../../lib/workflow/validation'
import {
  DEFAULT_A4_LAYOUT,
  paginateItems,
  type A4Layout,
  type WorksheetItemModel,
} from '../../lib/editor/a4Pagination'
import { examHidesExplanation } from '../../lib/editor/choices'
import { KatexText } from '../../lib/math/KatexText'

type ItemRow = {
  id: string
  problem_id: string
  problem_version_id: string
  order_no: number
  spacing_mm: number | null
  points: number | null
  force_page_break: boolean
  problem_text: string
  explanation: string
  answer: string
  choice_count: number
}

export function WorksheetBuilderPage() {
  const { worksheetId } = useParams()
  const [params] = useSearchParams()
  const [title, setTitle] = useState('HYPER 문제지')
  const [layout, setLayout] = useState<A4Layout>(DEFAULT_A4_LAYOUT)
  const [items, setItems] = useState<ItemRow[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; public_code: string; problem_text: string; current_version_id: string | null }>>([])
  const [similar, setSimilar] = useState<Array<{ problem_id: string; score?: number }>>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    const client = getSupabase()
    if (!client || !worksheetId) return
    void (async () => {
      const { data: sheet } = await client
        .from('worksheets')
        .select('title,layout,exam_kind')
        .eq('id', worksheetId)
        .single()
      if (sheet) {
        setTitle(sheet.title)
        setLayout({
          ...DEFAULT_A4_LAYOUT,
          ...((sheet.layout as Partial<A4Layout> | null) ?? {}),
          examKind: sheet.exam_kind === 'ANSWER_SHEET' ? 'ANSWER_SHEET' : 'EXAM',
        })
      }
      const { data: rows } = await client
        .from('worksheet_items')
        .select('id,problem_id,problem_version_id,order_no,spacing_mm,points,force_page_break')
        .eq('worksheet_id', worksheetId)
        .order('order_no')
      const versionIds = (rows ?? []).map((row) => row.problem_version_id)
      const { data: versions } = versionIds.length
        ? await client.from('problem_versions').select('id,problem_text,choice_count').in('id', versionIds)
        : { data: [] }
      const { data: answers } = versionIds.length
        ? await client.from('problem_answers').select('problem_version_id,answer_text,numeric_value').in('problem_version_id', versionIds)
        : { data: [] }
      const { data: explanations } = versionIds.length
        ? await client.from('problem_explanations').select('problem_version_id,content').in('problem_version_id', versionIds)
        : { data: [] }
      setItems(
        (rows ?? []).map((row) => {
          const version = (versions ?? []).find((item) => item.id === row.problem_version_id)
          const answer = (answers ?? []).find((item) => item.problem_version_id === row.problem_version_id)
          const explanation = (explanations ?? []).find((item) => item.problem_version_id === row.problem_version_id)
          return {
            ...row,
            spacing_mm: (row as { spacing_mm?: number | null }).spacing_mm ?? null,
            points: (row as { points?: number | null }).points ?? null,
            force_page_break: Boolean((row as { force_page_break?: boolean }).force_page_break),
            problem_text: version?.problem_text ?? '',
            choice_count: version?.choice_count ?? 0,
            answer: answer?.answer_text ?? (answer?.numeric_value != null ? String(answer.numeric_value) : ''),
            explanation: explanation?.content ?? '',
          }
        }),
      )
      const addId = params.get('problemId')
      const addVersion = params.get('versionId')
      if (addId && addVersion && !(rows ?? []).some((row) => row.problem_id === addId)) {
        const { data: version } = await client.from('problem_versions').select('problem_text,choice_count').eq('id', addVersion).single()
        setItems((current) => [
          ...current,
          {
            id: `local-${addId}`,
            problem_id: addId,
            problem_version_id: addVersion,
            order_no: current.length + 1,
            spacing_mm: 8,
            points: 5,
            force_page_break: false,
            problem_text: version?.problem_text ?? '',
            choice_count: version?.choice_count ?? 0,
            answer: '',
            explanation: '',
          },
        ])
      }
    })()
  }, [params, worksheetId])

  const models: WorksheetItemModel[] = items.map((row, index) => ({
    id: row.id,
    problemId: row.problem_id,
    versionId: row.problem_version_id,
    orderNo: index + 1,
    points: row.points,
    spacingMm: row.spacing_mm,
    forcePageBreak: row.force_page_break,
    stem: row.problem_text,
    hasFigure: false,
    figureHeightMm: 0,
    choiceCount: row.choice_count,
    explanation: row.explanation,
    answer: row.answer,
  }))
  const pages = useMemo(() => paginateItems(models, layout), [layout, models])

  async function searchProblems() {
    const client = getSupabase()
    if (!client) return
    const { data } = await client
      .from('problems')
      .select('id,public_code,current_version_id')
      .eq('lifecycle_status', 'DRAFT')
      .limit(40)
    const versionIds = (data ?? []).map((row) => row.current_version_id).filter(Boolean) as string[]
    const { data: versions } = versionIds.length
      ? await client.from('problem_versions').select('id,problem_text').in('id', versionIds)
      : { data: [] }
    const q = query.trim()
    setHits(
      (data ?? [])
        .map((row) => ({
          id: row.id,
          public_code: row.public_code,
          current_version_id: row.current_version_id,
          problem_text: versions?.find((item) => item.id === row.current_version_id)?.problem_text ?? '',
        }))
        .filter((row) => !q || row.public_code.includes(q) || row.problem_text.includes(q)),
    )
    if (items[0]) {
      const similarRes = await client.rpc('hqb_search_similar_problems', {
        payload: { problem_id: items[0].problem_id, k: 5 },
      })
      if (!similarRes.error && similarRes.data) {
        const payload = similarRes.data as { items?: Array<{ problem_id: string; score?: number }> } | Array<{ problem_id: string }>
        setSimilar(Array.isArray(payload) ? payload : payload.items ?? [])
      }
    }
  }

  async function persist() {
    const client = getSupabase()
    if (!client || !worksheetId) return
    const { error: updateError } = await client.rpc('hqb_update_worksheet', {
      p_worksheet_id: worksheetId,
      payload: { title, exam_kind: layout.examKind, layout },
    })
    if (updateError) {
      setError(parseHqBError(updateError.message))
      return
    }
    const { error: itemsError } = await client.rpc('hqb_replace_worksheet_items', {
      p_worksheet_id: worksheetId,
      payload: {
        items: items.map((row, index) => ({
          problem_id: row.problem_id,
          problem_version_id: row.problem_version_id,
          order_no: index + 1,
          spacing_mm: row.spacing_mm,
          points: row.points,
          force_page_break: row.force_page_break,
        })),
      },
    })
    if (itemsError) {
      setError(parseHqBError(itemsError.message))
      return
    }
    setInfo('문제지를 저장했습니다. VERIFIED는 변경되지 않습니다.')
  }

  return (
    <main className="page editor-page">
      <div className="page-head">
        <div>
          <p className="kicker">A4 조립</p>
          <h1>
            <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="문제지 제목" />
          </h1>
        </div>
        <div className="actions no-print">
          <Link className="btn ghost" to="/worksheets">목록</Link>
          <button type="button" className="btn" onClick={() => void persist()}>저장</button>
          <button type="button" className="btn primary" onClick={() => window.print()}>인쇄 / PDF</button>
        </div>
      </div>
      {error ? <p className="banner error no-print">{error}</p> : null}
      {info ? <p className="banner success no-print">{info}</p> : null}
      <section className="card no-print">
        <div className="grid-2">
          <label>
            단
            <select
              value={layout.columns}
              onChange={(event) => setLayout({ ...layout, columns: Number(event.target.value) === 2 ? 2 : 1 })}
            >
              <option value={1}>1단</option>
              <option value={2}>2단</option>
            </select>
          </label>
          <label>
            종류
            <select
              value={layout.examKind}
              onChange={(event) => setLayout({ ...layout, examKind: event.target.value === 'ANSWER_SHEET' ? 'ANSWER_SHEET' : 'EXAM' })}
            >
              <option value="EXAM">시험지</option>
              <option value="ANSWER_SHEET">정답지</option>
            </select>
          </label>
          <label>
            학교
            <input value={layout.header.school} onChange={(event) => setLayout({ ...layout, header: { ...layout.header, school: event.target.value } })} />
          </label>
          <label>
            학년
            <input value={layout.header.grade} onChange={(event) => setLayout({ ...layout, header: { ...layout.header, grade: event.target.value } })} />
          </label>
          <label>
            시험명
            <input value={layout.header.examName} onChange={(event) => setLayout({ ...layout, header: { ...layout.header, examName: event.target.value } })} />
          </label>
          <label>
            본문 글자
            <input
              type="number"
              value={layout.fontSizePt}
              onChange={(event) => setLayout({ ...layout, fontSizePt: Number(event.target.value) || 11 })}
            />
          </label>
        </div>
        <div className="filters">
          <input placeholder="문제 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className="btn" onClick={() => void searchProblems()}>검색 · 유사문항</button>
        </div>
        <ul>
          {hits.map((row) => (
            <li key={row.id}>
              {row.public_code} {row.problem_text.slice(0, 48)}
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  if (!row.current_version_id) return
                  setItems((current) => [
                    ...current,
                    {
                      id: `local-${row.id}-${current.length}`,
                      problem_id: row.id,
                      problem_version_id: row.current_version_id!,
                      order_no: current.length + 1,
                      spacing_mm: 8,
                      points: 5,
                      force_page_break: false,
                      problem_text: row.problem_text,
                      choice_count: 0,
                      answer: '',
                      explanation: '',
                    },
                  ])
                }}
              >
                추가
              </button>
            </li>
          ))}
        </ul>
        {similar.length ? (
          <p className="muted">유사 문항: {similar.map((row) => row.problem_id.slice(0, 8)).join(', ')}</p>
        ) : null}
      </section>
      <div className="a4-stage" style={{ ['--a4-font' as string]: `${layout.fontSizePt}pt` }}>
        {pages.map((page) => (
          <article className={`a4-page cols-${layout.columns}`} key={page.pageNo}>
            <header className="a4-header">
              <div>{layout.header.school} {layout.header.grade}</div>
              <strong>{layout.header.examName || title}</strong>
              <div>{layout.header.studentNameLabel}: ________</div>
            </header>
            <div className="a4-columns">
              {page.columns.map((col, colIndex) => (
                <div className="a4-col" key={colIndex}>
                  {col.map((item) => (
                    <section className="a4-item" key={item.id} style={{ marginBottom: `${item.spacingMm ?? 6}mm` }}>
                      <p>
                        <strong>{item.number}.</strong> ({item.points ?? 0}점) {item.stem}
                      </p>
                      {layout.examKind === 'ANSWER_SHEET' || !examHidesExplanation(layout.examKind) ? (
                        <p className="muted">
                          정답 {item.answer || '—'} {item.explanation ? <>· <KatexText tex={item.explanation} /></> : null}
                        </p>
                      ) : null}
                    </section>
                  ))}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      <ol className="no-print">
        {items.map((row, index) => (
          <li key={row.id}>
            {index + 1}. {row.problem_text.slice(0, 60)}
            <button type="button" className="btn ghost" onClick={() => setItems(items.filter((item) => item.id !== row.id))}>제거</button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const next = [...items]
                if (index === 0) return
                ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                setItems(next)
              }}
            >
              위로
            </button>
            <label>
              강제 쪽넘김
              <input
                type="checkbox"
                checked={row.force_page_break}
                onChange={(event) => {
                  const next = [...items]
                  next[index] = { ...row, force_page_break: event.target.checked }
                  setItems(next)
                }}
              />
            </label>
          </li>
        ))}
      </ol>
    </main>
  )
}
