import { Link } from 'react-router-dom'
import { DIFFICULTY_FIELDS, overallDifficulty } from '../../../lib/workflow/difficulty'
import { REVIEW_LABELS } from '../../../lib/workflow/labels'
import { nodePath, type Catalogs } from '../../../lib/workflow/useCatalogs'
import type { ProblemFormState } from '../../../lib/workflow/formState'
import { addChoice, defaultChoices, markAnswer, moveChoice, removeChoice, shouldShowChoices } from '../../../lib/editor/choices'
import type { ChoiceLayout, ItemFormat } from '../../../lib/editor/schema'

type VersionRow = { id: string; version_no: number; origin: string; review_status: string; created_at: string }

type Props = {
  catalogs: Catalogs
  state: ProblemFormState
  onChange: (next: ProblemFormState) => void
  choiceLayout: ChoiceLayout
  onChoiceLayout: (layout: ChoiceLayout) => void
  versions: VersionRow[]
  currentVersionId: string | null
  onRestore: (versionId: string) => void
  problemId: string
  editorRevision: number
  reviewStatus: string
}

export function MetadataPane({
  catalogs,
  state,
  onChange,
  choiceLayout,
  onChoiceLayout,
  versions,
  currentVersionId,
  onRestore,
  problemId,
  editorRevision,
  reviewStatus,
}: Props) {
  function patch(partial: Partial<ProblemFormState>) {
    onChange({ ...state, ...partial })
  }

  return (
    <aside className="editor-pane meta-pane card">
      <h2>분류 · 검수</h2>
      <p className="muted">
        검수 {REVIEW_LABELS[reviewStatus] ?? reviewStatus} · 저장 잠금 #{editorRevision}
      </p>
      <label>
        문항 형식
        <select
          value={state.itemFormat}
          onChange={(event) => {
            const itemFormat = event.target.value as ItemFormat
            patch({
              itemFormat: itemFormat === 'MULTIPLE_CHOICE' ? 'MULTIPLE_CHOICE' : itemFormat === 'CONSTRUCTED_RESPONSE' ? 'CONSTRUCTED_RESPONSE' : 'SHORT_ANSWER',
              choices: itemFormat === 'MULTIPLE_CHOICE' && state.choices.length === 0 ? defaultChoices(5) : state.choices,
            })
          }}
        >
          <option value="SHORT_ANSWER">단답</option>
          <option value="MULTIPLE_CHOICE">객관식</option>
          <option value="CONSTRUCTED_RESPONSE">서술형</option>
        </select>
      </label>
      {shouldShowChoices(state.itemFormat) ? (
        <div>
          <h3>선택지</h3>
          <select value={choiceLayout} onChange={(event) => onChoiceLayout(event.target.value as ChoiceLayout)}>
            <option value="VERTICAL">세로</option>
            <option value="TWO_COLUMN">2열</option>
            <option value="HORIZONTAL">가로</option>
          </select>
          {state.choices.map((choice, index) => (
            <div className="choice-row" key={choice.label + index}>
              <span>{choice.label}</span>
              <input
                aria-label={`선택지 ${choice.label}`}
                value={choice.choice_text}
                onChange={(event) => {
                  const choices = [...state.choices]
                  choices[index] = { ...choice, choice_text: event.target.value }
                  patch({ choices })
                }}
              />
              <input
                aria-label={`선택지 ${choice.label} 수식`}
                placeholder="LaTeX"
                value={choice.math_expression}
                onChange={(event) => {
                  const choices = [...state.choices]
                  choices[index] = { ...choice, math_expression: event.target.value }
                  patch({ choices })
                }}
              />
              <label>
                <input
                  type="checkbox"
                  checked={Boolean((choice as { is_answer?: boolean }).is_answer)}
                  onChange={() => patch({ choices: markAnswer(state.choices, index) })}
                />
                정답
              </label>
              <button type="button" className="btn ghost" onClick={() => patch({ choices: moveChoice(state.choices, index, Math.max(0, index - 1)) })}>
                ↑
              </button>
              <button type="button" className="btn ghost" onClick={() => patch({ choices: moveChoice(state.choices, index, Math.min(state.choices.length - 1, index + 1)) })}>
                ↓
              </button>
              <button type="button" className="btn ghost" onClick={() => patch({ choices: removeChoice(state.choices, index) })}>
                삭제
              </button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => patch({ choices: addChoice(state.choices) })}>
            선택지 추가
          </button>
        </div>
      ) : (
        <p className="hint">서술형/단답은 시험지에 선택지가 없고, 정답지는 해설만 표시합니다.</p>
      )}
      <label>
        정답
        <input value={state.answerText} onChange={(event) => patch({ answerText: event.target.value })} />
      </label>
      <label>
        해설 (시험지 숨김)
        <textarea rows={4} value={state.explanation} onChange={(event) => patch({ explanation: event.target.value })} />
      </label>
      <label>
        교육과정
        <select value={state.curriculumNodeId} onChange={(event) => patch({ curriculumNodeId: event.target.value })}>
          <option value="">선택</option>
          {catalogs.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {nodePath(catalogs.nodes, node.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        HYPER 유형
        <select value={state.typeId} onChange={(event) => patch({ typeId: event.target.value })}>
          <option value="">선택</option>
          {catalogs.types.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {DIFFICULTY_FIELDS.map((field) => (
        <label key={field.key}>
          {field.label}
          <select
            value={state.difficulty[field.key]}
            onChange={(event) =>
              patch({ difficulty: { ...state.difficulty, [field.key]: Number(event.target.value) } })
            }
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p>overall {overallDifficulty(state.difficulty)}</p>
      <h3>버전</h3>
      <ul className="version-list">
        {versions.map((row) => (
          <li key={row.id}>
            v{row.version_no} · {row.origin}
            {row.id === currentVersionId ? ' · 현재' : ''}
            {row.id !== currentVersionId ? (
              <button type="button" className="btn ghost" onClick={() => onRestore(row.id)}>
                이 버전으로 복원
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p>
        <Link to={`/questions/${problemId}/versions`}>전체 이력</Link>
      </p>
    </aside>
  )
}
