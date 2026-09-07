import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useBlocker } from 'react-router-dom'
import { KatexText } from '../../lib/math/KatexText'
import { overallDifficulty } from '../../lib/workflow/difficulty'
import { DIFFICULTY_FIELDS } from '../../lib/workflow/difficulty'
import {
  ANSWER_TYPES,
  DOCUMENT_TYPES,
  EXPRESSION_ROLES,
  LICENSE_STATUSES,
} from '../../lib/workflow/labels'
import { verifyGateIssues } from '../../lib/workflow/validation'
import { nodePath, type Catalogs } from '../../lib/workflow/useCatalogs'
import { type ProblemFormState } from '../../lib/workflow/formState'

type Props = {
  catalogs: Catalogs
  state: ProblemFormState
  setState: (next: ProblemFormState) => void
  dirty: boolean
  submitting: boolean
  error: string | null
  submitLabel: string
  onSubmit: () => Promise<void>
}

export function ProblemForm({
  catalogs,
  state,
  setState,
  dirty,
  submitting,
  error,
  submitLabel,
  onSubmit,
}: Props) {
  const [section, setSection] = useState('basic')
  const blocker = useBlocker(dirty && !submitting)
  const strategySteps = catalogs.steps.filter((step) => step.strategy_template_id === state.strategyId)
  const selectedDoc = catalogs.documents.find((doc) => doc.id === state.sourceDocumentId)
  const previewTex = state.expressions[0]?.latex_expression || state.expressions[0]?.original_expression
  const issues = useMemo(
    () =>
      verifyGateIssues({
        problemText: state.problemText,
        hasSource: state.sourceMode === 'existing' ? Boolean(state.sourceDocumentId) : Boolean(state.sourceTitle.trim()),
        hasLicense: Boolean(state.licenseStatus || selectedDoc?.license_status),
        hasCurrentVersion: true,
        hasCurriculum: Boolean(state.curriculumNodeId),
        primaryConceptCount: state.concepts.filter((row) => row.is_primary).length,
        hyperTypeCount: state.typeId ? 1 : 0,
        strategyCount: state.strategyId ? 1 : 0,
        targetCount: state.targetIds.length,
        hasHumanDifficulty: true,
        difficulty: state.difficulty,
        hasAnswer: Boolean(state.answerText.trim() || state.numericValue.trim()),
        hasExpression: state.expressions.some((row) => row.original_expression.trim()),
      }),
    [state, selectedDoc],
  )

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || submitting) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, submitting])

  function patch(partial: Partial<ProblemFormState>) {
    setState({ ...state, ...partial })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    await onSubmit()
  }

  return (
    <form className="workflow" onSubmit={handleSubmit}>
      {blocker.state === 'blocked' ? (
        <div className="banner warn" role="alertdialog">
          저장하지 않은 내용이 있습니다. 이 페이지를 떠나면 입력값이 사라질 수 있습니다.
          <span className="actions">
            <button type="button" className="btn ghost" onClick={() => blocker.reset()}>
              머무르기
            </button>
            <button type="button" className="btn" onClick={() => blocker.proceed()}>
              떠나기
            </button>
          </span>
        </div>
      ) : null}

      <nav className="section-nav" aria-label="등록 단계">
        {[
          ['basic', '1 기본정보'],
          ['content', '2 문제내용'],
          ['class', '3 분류'],
          ['solve', '4 풀이구조'],
          ['diff', '5 난이도'],
          ['preview', '6 미리보기'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={section === id ? 'chip active' : 'chip'}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === 'basic' ? (
        <section className="card">
          <h2>출처</h2>
          <fieldset className="inline-options">
            <legend>출처 지정 방법</legend>
            <label>
              <input
                type="radio"
                name="sourceMode"
                checked={state.sourceMode === 'existing'}
                onChange={() => patch({ sourceMode: 'existing' })}
              />
              기존 자료 선택
            </label>
            <label>
              <input
                type="radio"
                name="sourceMode"
                checked={state.sourceMode === 'new'}
                onChange={() => patch({ sourceMode: 'new' })}
              />
              새 자료 등록
            </label>
          </fieldset>
          {state.sourceMode === 'existing' ? (
            <label>
              기존 자료
              <select
                value={state.sourceDocumentId}
                onChange={(event) => patch({ sourceDocumentId: event.target.value })}
              >
                <option value="">선택</option>
                {catalogs.documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title} · {doc.license_status}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                자료명
                <input value={state.sourceTitle} onChange={(event) => patch({ sourceTitle: event.target.value })} />
              </label>
              <div className="grid-2">
                <label>
                  문서 유형
                  <select value={state.documentType} onChange={(event) => patch({ documentType: event.target.value })}>
                    {DOCUMENT_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  출판사/출처
                  <input value={state.publisher} onChange={(event) => patch({ publisher: event.target.value })} />
                </label>
                <label>
                  연도
                  <input value={state.publicationYear} onChange={(event) => patch({ publicationYear: event.target.value })} />
                </label>
                <label>
                  라이선스
                  <select value={state.licenseStatus} onChange={(event) => patch({ licenseStatus: event.target.value })}>
                    {LICENSE_STATUSES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                사용 범위
                <input value={state.usageScope} onChange={(event) => patch({ usageScope: event.target.value })} />
              </label>
            </>
          )}
          <div className="grid-2">
            <label>
              페이지
              <input value={state.pageNumber} onChange={(event) => patch({ pageNumber: event.target.value })} />
            </label>
            <label>
              원본 문제번호
              <input
                value={state.originalProblemNumber}
                onChange={(event) => patch({ originalProblemNumber: event.target.value })}
              />
            </label>
          </div>
          <label>
            교재 원본 유형명 (source_type_label, 선택)
            <input
              value={state.sourceTypeLabel}
              onChange={(event) => patch({ sourceTypeLabel: event.target.value })}
              placeholder="HYPER 표준 유형과 다릅니다"
            />
          </label>
          <p className="hint">출처가 불명확하면 라이선스를 UNKNOWN으로 두세요. 공개(PUBLIC)로 추정하지 않습니다.</p>
        </section>
      ) : null}

      {section === 'content' ? (
        <section className="card">
          <h2>문제 내용</h2>
          <label>
            지시문
            <input value={state.instruction} onChange={(event) => patch({ instruction: event.target.value })} />
          </label>
          <label>
            문제 본문
            <textarea
              rows={5}
              value={state.problemText}
              onChange={(event) => {
                const problemText = event.target.value
                patch({
                  problemText,
                  normalizedText: state.normalizedManual ? state.normalizedText : problemText,
                })
              }}
              required
            />
          </label>
          <label>
            정규화 본문 (자동 분석 없음. 비우면 본문과 같게 저장)
            <textarea
              rows={3}
              value={state.normalizedText}
              onChange={(event) => patch({ normalizedText: event.target.value, normalizedManual: true })}
            />
          </label>
          <fieldset className="inline-options">
            <legend>문항 형식</legend>
            <label>
              <input
                type="radio"
                checked={state.itemFormat === 'SHORT_ANSWER'}
                onChange={() => patch({ itemFormat: 'SHORT_ANSWER' })}
              />
              주관식
            </label>
            <label>
              <input
                type="radio"
                checked={state.itemFormat === 'MULTIPLE_CHOICE'}
                onChange={() => patch({ itemFormat: 'MULTIPLE_CHOICE' })}
              />
              객관식
            </label>
          </fieldset>
          {state.itemFormat === 'MULTIPLE_CHOICE' ? (
            <div>
              <h3>선택지</h3>
              {state.choices.map((choice, index) => (
                <div className="choice-row" key={choice.label + index}>
                  <input
                    aria-label={`선택지 ${index + 1} 번호`}
                    value={choice.label}
                    onChange={(event) => {
                      const choices = [...state.choices]
                      choices[index] = { ...choice, label: event.target.value }
                      patch({ choices })
                    }}
                  />
                  <input
                    aria-label={`선택지 ${index + 1} 내용`}
                    value={choice.choice_text}
                    onChange={(event) => {
                      const choices = [...state.choices]
                      choices[index] = { ...choice, choice_text: event.target.value }
                      patch({ choices })
                    }}
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => patch({ choices: state.choices.filter((_, i) => i !== index) })}
                  >
                    삭제
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  patch({
                    choices: [
                      ...state.choices,
                      { label: String(state.choices.length + 1), choice_text: '', math_expression: '' },
                    ],
                  })
                }
              >
                선택지 추가
              </button>
            </div>
          ) : null}
          <h3>수식</h3>
          {state.expressions.map((row, index) => (
            <div className="expr-grid" key={index}>
              <label>
                원문 수식
                <input
                  value={row.original_expression}
                  onChange={(event) => {
                    const expressions = [...state.expressions]
                    expressions[index] = { ...row, original_expression: event.target.value }
                    patch({ expressions })
                  }}
                />
              </label>
              <label>
                LaTeX
                <input
                  value={row.latex_expression}
                  onChange={(event) => {
                    const expressions = [...state.expressions]
                    expressions[index] = { ...row, latex_expression: event.target.value }
                    patch({ expressions })
                  }}
                />
              </label>
              <label>
                역할
                <select
                  value={row.expression_role}
                  onChange={(event) => {
                    const expressions = [...state.expressions]
                    expressions[index] = { ...row, expression_role: event.target.value }
                    patch({ expressions })
                  }}
                >
                  {EXPRESSION_ROLES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                skeleton (선택)
                <input
                  value={row.structure_skeleton}
                  onChange={(event) => {
                    const expressions = [...state.expressions]
                    expressions[index] = { ...row, structure_skeleton: event.target.value }
                    patch({ expressions })
                  }}
                />
              </label>
            </div>
          ))}
          <div className="preview-box">
            미리보기: {previewTex ? <KatexText tex={previewTex} /> : '수식을 입력하면 여기에 표시됩니다.'}
          </div>
          <div className="grid-2">
            <label>
              정답 유형
              <select value={state.answerType} onChange={(event) => patch({ answerType: event.target.value })}>
                {ANSWER_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              정답
              <input value={state.answerText} onChange={(event) => patch({ answerText: event.target.value })} />
            </label>
            <label>
              숫자 정답 (해당되면)
              <input value={state.numericValue} onChange={(event) => patch({ numericValue: event.target.value })} />
            </label>
          </div>
          <label>
            강사 해설 (선택)
            <textarea rows={3} value={state.explanation} onChange={(event) => patch({ explanation: event.target.value })} />
          </label>
        </section>
      ) : null}

      {section === 'class' ? (
        <section className="card">
          <h2>분류</h2>
          <label>
            교육과정 노드
            <select value={state.curriculumNodeId} onChange={(event) => patch({ curriculumNodeId: event.target.value })}>
              <option value="">선택</option>
              {catalogs.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {nodePath(catalogs.nodes, node.id)}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">깊이는 고정되어 있지 않습니다. DB 트리를 그대로 사용합니다.</p>
          <h3>개념 (복수 가능)</h3>
          {catalogs.concepts.map((concept) => {
            const picked = state.concepts.find((row) => row.concept_id === concept.id)
            return (
              <div className="check-row" key={concept.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(picked)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        patch({
                          concepts: [...state.concepts, { concept_id: concept.id, is_primary: state.concepts.length === 0 }],
                        })
                      } else {
                        patch({ concepts: state.concepts.filter((row) => row.concept_id !== concept.id) })
                      }
                    }}
                  />
                  {concept.name}
                </label>
                {picked ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.is_primary}
                      onChange={(event) =>
                        patch({
                          concepts: state.concepts.map((row) =>
                            row.concept_id === concept.id ? { ...row, is_primary: event.target.checked } : row,
                          ),
                        })
                      }
                    />
                    PRIMARY
                  </label>
                ) : null}
              </div>
            )
          })}
          <label>
            HYPER 표준 문제유형
            <select value={state.typeId} onChange={(event) => patch({ typeId: event.target.value })}>
              <option value="">선택</option>
              {catalogs.types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">교재 원본 유형명과 HYPER 표준 유형은 다른 항목입니다.</p>
        </section>
      ) : null}

      {section === 'solve' ? (
        <section className="card">
          <h2>풀이 구조</h2>
          <label>
            풀이전략
            <select value={state.strategyId} onChange={(event) => patch({ strategyId: event.target.value })}>
              <option value="">선택</option>
              {catalogs.strategies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {strategySteps.length ? (
            <ol className="steps">
              {strategySteps.map((step) => (
                <li key={step.step_no}>
                  {step.step_no}. {step.label}
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">전략을 선택하면 순서 있는 단계가 표시됩니다.</p>
          )}
          <h3>조건</h3>
          {catalogs.conditions.map((item) => (
            <label key={item.id} className="check-row">
              <input
                type="checkbox"
                checked={state.conditionIds.includes(item.id)}
                onChange={(event) =>
                  patch({
                    conditionIds: event.target.checked
                      ? [...state.conditionIds, item.id]
                      : state.conditionIds.filter((id) => id !== item.id),
                  })
                }
              />
              {item.name}
              {item.approval_status !== 'APPROVED' ? <span className="tag warn">AUTO</span> : null}
            </label>
          ))}
          <h3>목표</h3>
          {catalogs.targets.map((item) => (
            <label key={item.id} className="check-row">
              <input
                type="checkbox"
                checked={state.targetIds.includes(item.id)}
                onChange={(event) =>
                  patch({
                    targetIds: event.target.checked
                      ? [...state.targetIds, item.id]
                      : state.targetIds.filter((id) => id !== item.id),
                  })
                }
              />
              {item.name}
            </label>
          ))}
          <h3>추론</h3>
          {catalogs.reasoning.map((item) => (
            <label key={item.id} className="check-row">
              <input
                type="checkbox"
                checked={state.reasoningIds.includes(item.id)}
                onChange={(event) =>
                  patch({
                    reasoningIds: event.target.checked
                      ? [...state.reasoningIds, item.id]
                      : state.reasoningIds.filter((id) => id !== item.id),
                  })
                }
              />
              {item.name}
            </label>
          ))}
        </section>
      ) : null}

      {section === 'diff' ? (
        <section className="card">
          <h2>6차원 난이도 (HUMAN)</h2>
          {DIFFICULTY_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <span className="scale-help">
                1 = {field.low} · 5 = {field.high}
              </span>
              <select
                value={state.difficulty[field.key]}
                onChange={(event) =>
                  patch({
                    difficulty: {
                      ...state.difficulty,
                      [field.key]: Number(event.target.value),
                    },
                  })
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
          <p className="overall">
            overall (산술평균, 직접 수정 불가): <strong>{overallDifficulty(state.difficulty)}</strong>
          </p>
        </section>
      ) : null}

      {section === 'preview' ? (
        <section className="card">
          <h2>미리보기 · 검수 체크</h2>
          <p>
            <strong>본문</strong> {state.problemText || '미입력'}
          </p>
          <p>
            <strong>수식</strong> {previewTex ? <KatexText tex={previewTex} /> : '없음'}
          </p>
          <p>
            <strong>정답</strong> {state.answerText || state.numericValue || '없음'}
          </p>
          <p>
            <strong>교육과정</strong> {nodePath(catalogs.nodes, state.curriculumNodeId) || '없음'}
          </p>
          <p>
            <strong>라이선스</strong> {state.licenseStatus || selectedDoc?.license_status || 'UNKNOWN'} — 내용 확정과 사용
            가능 여부는 별개입니다.
          </p>
          {issues.length ? (
            <ul className="issue-list">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="banner success">확정(VERIFIED)에 필요한 항목이 채워져 있습니다. 저장 후 검수 화면에서 확정하세요.</p>
          )}
        </section>
      ) : null}

      {error ? <p className="banner error">{error}</p> : null}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? '저장 중…' : submitLabel}
        </button>
        <p className="hint">초안은 바로 VERIFIED가 되지 않습니다. 확정은 검수 권한이 있는 계정만 할 수 있습니다.</p>
      </div>
    </form>
  )
}
