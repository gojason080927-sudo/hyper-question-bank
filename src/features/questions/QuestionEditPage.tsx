import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { getSupabase } from '../../lib/supabase/client'
import { useAuth } from '../../lib/auth/AuthProvider'
import { useCatalogs } from '../../lib/workflow/useCatalogs'
import { emptyForm, buildPayload, type ProblemFormState } from '../../lib/workflow/formState'
import { parseHqBError } from '../../lib/workflow/validation'
import { beginSubmit, releaseSubmit } from '../../lib/workflow/submitLock'
import type { Json } from '../../types/database.types'
import { ProblemForm } from './ProblemForm'
import { loadFormFromVersion } from './loadForm'
import { WysiwygEditor } from './editor/WysiwygEditor'
import { OriginalPane } from './editor/OriginalPane'
import { MetadataPane } from './editor/MetadataPane'
import {
  documentPlainText,
  emptyEditorDocument,
  isEditorDocument,
  stripTransientImageSrc,
  withLatexIndex,
  type ChoiceLayout,
  type EditorDocument,
  type EditorNode,
} from '../../lib/editor/schema'
import { conversionDiff, ocrTextToDocument } from '../../lib/editor/ocrAdapter'
import { collectLatex } from '../../lib/editor/schema'
import { parseConflictMessage, localAutosaveKey, writeLocalAutosave, clearLocalAutosave } from '../../lib/editor/conflict'
import { uploadEditorImage } from '../../lib/editor/uploadAsset'
import type { PasteWarning } from '../../lib/editor/paste'

type VersionRow = { id: string; version_no: number; origin: string; review_status: string; created_at: string }

export function QuestionEditPage() {
  const { problemId } = useParams()
  const [params] = useSearchParams()
  const legacy = params.get('legacy') === '1'
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: catalogs, loading: catalogLoading, error: catalogError } = useCatalogs()
  const [state, setState] = useState<ProblemFormState>(emptyForm())
  const [baseline, setBaseline] = useState('')
  const [versionId, setVersionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<EditorDocument>(emptyEditorDocument())
  const [ocrDiff, setOcrDiff] = useState<{ ocr: string; converted: string; equal: boolean } | null>(null)
  const [warnings, setWarnings] = useState<PasteWarning[]>([])
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [editorRevision, setEditorRevision] = useState(0)
  const [reviewStatus, setReviewStatus] = useState('UNREVIEWED')
  const [mobileTab, setMobileTab] = useState<'original' | 'edit' | 'meta'>('edit')
  const [info, setInfo] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const editorRef = useRef<Editor | null>(null)
  const submitLock = useRef({ current: false })

  const dirty = useMemo(
    () => JSON.stringify({ state, json: doc.tiptap_json }) !== baseline,
    [baseline, doc.tiptap_json, state],
  )

  const load = useCallback(async () => {
    const client = getSupabase()
    if (!client || !problemId) return
    const { data: problem, error: problemError } = await client
      .from('problems')
      .select('id,current_version_id,editor_revision,lifecycle_status')
      .eq('id', problemId)
      .single()
    if (problemError || !problem) {
      setError('문제를 찾을 수 없습니다.')
      setLoading(false)
      return
    }
    if ((problem as { lifecycle_status?: string }).lifecycle_status === 'ARCHIVED') {
      setError('HQB_ARCHIVED')
      setLoading(false)
      return
    }
    setEditorRevision((problem as { editor_revision?: number }).editor_revision ?? 0)
    const { data: versionRows } = await client
      .from('problem_versions')
      .select('id,review_status,version_no,origin,created_at,content_metadata,problem_text,instruction')
      .eq('problem_id', problemId)
      .order('version_no')
    setVersions((versionRows ?? []) as VersionRow[])
    const openDraft = (versionRows ?? []).find(
      (row) => row.review_status !== 'VERIFIED' && row.review_status !== 'REJECTED',
    )
    const current = (versionRows ?? []).find((row) => row.id === problem.current_version_id)
    let targetId = openDraft?.id ?? current?.id ?? null
    if (!openDraft && current?.review_status === 'VERIFIED') {
      const { data: cloned, error: cloneError } = await client.rpc('hqb_clone_problem_version', {
        p_problem_id: problemId,
        p_change_reason: 'UI 수정 — 새 초안 버전',
        p_content_overrides: {},
      })
      if (cloneError) {
        setError(parseHqBError(cloneError.message))
        setLoading(false)
        return
      }
      targetId = (cloned as { version_id?: string })?.version_id ?? null
    }
    if (!targetId) {
      setError('편집할 버전을 만들지 못했습니다.')
      setLoading(false)
      return
    }
    const form = await loadFormFromVersion(client, problemId, targetId)
    const target = (versionRows ?? []).find((row) => row.id === targetId)
    setReviewStatus(target?.review_status ?? 'UNREVIEWED')
    const meta = (target as { content_metadata?: unknown } | undefined)?.content_metadata as
      | { editor_document?: unknown }
      | undefined
    let nextDoc = emptyEditorDocument()
    if (isEditorDocument(meta?.editor_document)) {
      nextDoc = meta.editor_document
      setOcrDiff(null)
    } else {
      nextDoc = ocrTextToDocument(form.problemText, form.instruction)
      const diff = conversionDiff(form.problemText, nextDoc.tiptap_json)
      setOcrDiff({ ocr: diff.ocr, converted: diff.converted, equal: diff.equal })
    }
    setDoc(nextDoc)
    setState(form)
    setBaseline(JSON.stringify({ state: form, json: nextDoc.tiptap_json }))
    setVersionId(targetId)
    setLoading(false)
  }, [problemId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!dirty || !problemId || !profile) return
    const timer = window.setTimeout(() => {
      const payload = JSON.stringify({ doc, state, versionId })
      writeLocalAutosave(window.localStorage, problemId, profile.user_id, payload)
      const client = getSupabase()
      if (!client || !versionId) return
      void client.rpc('hqb_upsert_editor_autosave', {
        payload: {
          problem_id: problemId,
          base_version_id: versionId,
          document: doc,
          client_token: localAutosaveKey(problemId, profile.user_id),
        } as unknown as Json,
      })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [dirty, doc, problemId, profile, state, versionId])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || submitting) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, submitting])

  async function handleSave() {
    const client = getSupabase()
    if (!client || !versionId || !problemId) return
    if (!beginSubmit(submitLock.current)) return
    setSubmitting(true)
    setError(null)
    const plain = documentPlainText(doc.tiptap_json)
    const latex = collectLatex(doc.tiptap_json)
    const editorDocument = withLatexIndex({
      ...doc,
      tiptap_json: stripTransientImageSrc(doc.tiptap_json),
    })
    const nextState: ProblemFormState = {
      ...state,
      problemText: plain || state.problemText,
      normalizedText: state.normalizedManual ? state.normalizedText : plain || state.problemText,
      expressions: latex.length
        ? latex.map((row) => ({
            original_expression: row.latex,
            latex_expression: row.latex,
            normalized_expression: row.latex,
            structure_skeleton: '',
            expression_role: 'TARGET',
          }))
        : state.expressions,
    }
    const payload = {
      ...buildPayload(nextState),
      expected_revision: editorRevision,
      change_reason: '강사 WYSIWYG 저장',
      editor_document: editorDocument,
    }
    const { data, error: saveError } = await client.rpc('hqb_save_editor_document', {
      p_version_id: versionId,
      payload: payload as unknown as Json,
    })
    if (saveError) {
      releaseSubmit(submitLock.current)
      setSubmitting(false)
      setError(parseHqBError(saveError.message))
      if (parseConflictMessage(saveError.message)) {
        setError('다른 강사가 먼저 저장했습니다. 다시 불러온 뒤 병합하세요.')
      }
      return
    }
    const saved = data as { version_id?: string; editor_revision?: number }
    if (profile) clearLocalAutosave(window.localStorage, problemId, profile.user_id)
    releaseSubmit(submitLock.current)
    setSubmitting(false)
    setEditorRevision(saved.editor_revision ?? editorRevision + 1)
    setOcrDiff(null)
    if (saved.version_id) setVersionId(saved.version_id)
    setBaseline(JSON.stringify({ state: nextState, json: editorDocument.tiptap_json }))
    setState(nextState)
    setDoc(editorDocument)
    setInfo(`저장했습니다. 새 버전 ${saved.version_id ? '' : ''}(잠금 #${saved.editor_revision ?? editorRevision + 1}). VERIFIED는 변경되지 않았습니다.`)
    await load()
  }

  async function handleImage(file: File) {
    const client = getSupabase()
    if (!client || !problemId || !versionId) return
    try {
      const uploaded = await uploadEditorImage(client, problemId, versionId, file)
      editorRef.current?.chain().focus().setImage({
        src: uploaded.signedUrl,
        alt: file.name,
      }).run()
      const json = editorRef.current?.getJSON() as EditorNode | undefined
      if (json) {
        setDoc((current) => ({
          ...current,
          tiptap_json: annotateStoragePath(json, uploaded.signedUrl, uploaded.storagePath),
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? parseHqBError(err.message) : '이미지 업로드에 실패했습니다.')
    }
  }

  async function handleRestore(id: string) {
    const client = getSupabase()
    if (!client) return
    const { error: restoreError } = await client.rpc('hqb_restore_problem_version', {
      p_version_id: id,
      p_change_reason: '이력에서 복원',
    })
    if (restoreError) {
      setError(parseHqBError(restoreError.message))
      return
    }
    setLoading(true)
    await load()
  }

  if (loading || catalogLoading) return <main className="page"><p className="muted">편집할 버전을 준비하는 중입니다.</p></main>
  if (catalogError || !catalogs) {
    return <main className="page"><p className="banner error">{catalogError ?? '분류 정보를 불러오지 못했습니다.'}</p></main>
  }
  if (error === 'HQB_ARCHIVED') {
    return (
      <main className="page">
        <p className="banner warn">보관된 문제는 복원한 뒤에 편집할 수 있습니다. 원본은 삭제되지 않습니다.</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const client = getSupabase()
            if (!client || !problemId) return
            void client.rpc('hqb_restore_archived_problem', { p_problem_id: problemId }).then(({ error: restoreError }) => {
              if (restoreError) {
                setError(parseHqBError(restoreError.message))
                return
              }
              setError(null)
              setLoading(true)
              void load()
            })
          }}
        >
          보관 해제하고 편집
        </button>
        <p><Link to="/questions">목록</Link></p>
      </main>
    )
  }

  if (legacy) {
    return (
      <main className="page wide">
        <p className="kicker">편집 (레거시)</p>
        <h1>문제 수정</h1>
        <p><Link to={`/questions/${problemId}/edit`}>WYSIWYG 편집기로</Link></p>
        <ProblemForm
          catalogs={catalogs}
          state={state}
          setState={setState}
          dirty={dirty}
          submitting={submitting}
          error={error}
          submitLabel="초안 저장"
          onSubmit={handleSave}
        />
      </main>
    )
  }

  return (
    <main className="page editor-page">
      <div className="page-head">
        <div>
          <p className="kicker">WYSIWYG 편집</p>
          <h1>문제 수정</h1>
          <p className="hint">저장은 새 TEACHER_EDIT 버전을 만듭니다. OCR 원문과 VERIFIED는 덮어쓰지 않습니다.</p>
        </div>
        <div className="actions">
          <Link className="btn ghost" to={`/questions/${problemId}/edit?legacy=1`}>레거시</Link>
          <Link className="btn" to={`/questions/${problemId}`}>상세</Link>
        </div>
      </div>
      <div className="editor-mobile-tabs">
        {(['original', 'edit', 'meta'] as const).map((id) => (
          <button key={id} type="button" className={mobileTab === id ? 'chip active' : 'chip'} onClick={() => setMobileTab(id)}>
            {id === 'original' ? '원본' : id === 'edit' ? '편집' : '분류'}
          </button>
        ))}
      </div>
      {ocrDiff && !ocrDiff.equal ? (
        <div className="banner warn">
          OCR 원문과 변환 결과가 다릅니다. 첫 저장 전에 확인하세요.
          <pre className="diff-pre">OCR: {ocrDiff.ocr.slice(0, 400)}</pre>
          <pre className="diff-pre">변환: {ocrDiff.converted.slice(0, 400)}</pre>
        </div>
      ) : ocrDiff ? (
        <p className="banner success">OCR 원문과 변환 결과가 일치합니다. 저장하면 새 버전으로만 기록됩니다.</p>
      ) : null}
      {warnings.map((row) => (
        <p className="banner warn" key={row.code}>{row.message}</p>
      ))}
      {info ? <p className="banner success">{info}</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      <div className={`editor-workspace tab-${mobileTab}`}>
        <div className="pane-original">
          {problemId ? <OriginalPane problemId={problemId} /> : null}
        </div>
        <div className="pane-edit">
          <div className="find-replace">
            <input aria-label="찾기" placeholder="찾기" value={find} onChange={(event) => setFind(event.target.value)} />
            <input aria-label="바꾸기" placeholder="바꾸기" value={replace} onChange={(event) => setReplace(event.target.value)} />
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (!find) return
                const html = editorRef.current?.getHTML() ?? ''
                editorRef.current?.commands.setContent(html.replaceAll(find, replace))
              }}
            >
              모두 바꾸기
            </button>
          </div>
          <WysiwygEditor
            content={doc.tiptap_json}
            contentKey={versionId ?? 'new'}
            onChange={(json) => setDoc((current) => ({ ...current, tiptap_json: json }))}
            onSave={() => void handleSave()}
            onPreview={() => setPreview(true)}
            onAddToWorksheet={() => navigate(`/worksheets/new?problemId=${problemId}&versionId=${versionId}`)}
            onImageFile={(file) => void handleImage(file)}
            onPasteWarnings={setWarnings}
            saving={submitting}
            dirty={dirty}
            onEditor={(instance) => {
              editorRef.current = instance
            }}
          />
        </div>
        <div className="pane-meta">
          {problemId ? (
            <MetadataPane
              catalogs={catalogs}
              state={state}
              onChange={setState}
              choiceLayout={doc.choice_layout}
              onChoiceLayout={(layout: ChoiceLayout) => setDoc((current) => ({ ...current, choice_layout: layout }))}
              versions={versions}
              currentVersionId={versionId}
              onRestore={(id) => void handleRestore(id)}
              problemId={problemId}
              editorRevision={editorRevision}
              reviewStatus={reviewStatus}
            />
          ) : null}
        </div>
      </div>
      {preview ? (
        <div className="banner">
          <strong>미리보기</strong>
          <div className="tiptap-surface" dangerouslySetInnerHTML={{ __html: editorRef.current?.getHTML() ?? '' }} />
          <button type="button" className="btn" onClick={() => setPreview(false)}>닫기</button>
        </div>
      ) : null}
    </main>
  )
}

function annotateStoragePath(node: EditorNode, src: string, storagePath: string): EditorNode {
  const next: EditorNode = { ...node }
  if (node.type === 'image' && String(node.attrs?.src ?? '') === src) {
    next.attrs = { ...node.attrs, storagePath }
  }
  if (node.content) next.content = node.content.map((child) => annotateStoragePath(child, src, storagePath))
  return next
}
