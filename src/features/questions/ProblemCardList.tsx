import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { MixedKatexText } from '../../lib/math/MixedKatexText'
import type { ProblemListViewModel } from '../../lib/questions/problemCardModel'

type Props = {
  items: ProblemListViewModel[]
  selectedId?: string | null
  checkedIds?: string[]
  showCheckbox?: boolean
  onSelect?: (id: string) => void
  onToggleCheck?: (id: string, checked: boolean) => void
}

export function ProblemCardList({ items, selectedId, checkedIds = [], showCheckbox, onSelect, onToggleCheck }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function select(id: string) {
    onSelect?.(id)
  }

  function onCardKey(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(id)
    }
  }

  function stop(event: MouseEvent) {
    event.stopPropagation()
  }

  return (
    <ul className="problem-card-list mobile-only">
      {items.map((item) => {
        const selected = item.id === selectedId
        const open = Boolean(expanded[item.id])
        return (
          <li key={item.id}>
            <article
              className={`problem-card ${selected ? 'is-selected' : ''}`}
              tabIndex={0}
              aria-current={selected ? 'true' : undefined}
              aria-label={item.selectLabel}
              onClick={() => select(item.id)}
              onKeyDown={(event) => onCardKey(event, item.id)}
            >
              {showCheckbox ? (
                <label className="problem-card-check" onClick={stop} onKeyDown={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`${item.publicCode} 선택`}
                    checked={checkedIds.includes(item.id)}
                    onChange={(event) => onToggleCheck?.(item.id, event.target.checked)}
                  />
                  선택
                </label>
              ) : null}
              <p className="problem-card-book">{item.sourceTitle}</p>
              <p className="problem-card-unit">{item.unitPath}</p>
              <p className="problem-card-meta">
                <span>{item.pageLabel}</span>
                <span>{item.typeName}</span>
                <span>{item.difficultyLabel}</span>
                <span className={`status-pill ${item.reviewStatus.toLowerCase()}`}>{item.reviewLabel}</span>
              </p>
              <div className={`problem-card-stem ${open ? 'is-open' : ''}`}>
                {item.stem ? <MixedKatexText text={item.stem} /> : '—'}
              </div>
              <div className="problem-card-actions" onClick={stop}>
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={`${item.pageLabel} 본문 전체 보기`}
                  onClick={() => setExpanded((current) => ({ ...current, [item.id]: !open }))}
                >
                  {open ? '접기' : '전체 보기'}
                </button>
                {onSelect ? (
                  <button type="button" className="btn ghost" aria-label={`${item.selectLabel} 미리보기`} onClick={() => select(item.id)}>
                    미리보기
                  </button>
                ) : (
                  <Link className="btn ghost" to={`/questions/${item.id}`} aria-label={`${item.selectLabel} 미리보기`}>
                    미리보기
                  </Link>
                )}
                <Link className="btn ghost" to={item.editHref} aria-label={`${item.pageLabel} 편집`}>
                  편집
                </Link>
                <Link className="btn primary" to={item.worksheetHref} aria-label={`${item.pageLabel} 문제지 추가`}>
                  문제지 추가
                </Link>
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
