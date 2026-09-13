# STEP 8.35 — Instructor WYSIWYG problem / math editor (v1 freeze)

Status: **binding for implementation on branch `cursor/step-8-35-wysiwyg-editor-58e0`.**  
Date: 2026-09-13  
Base: `origin/main` after PR #19 (`STEP 8.34`) merge.

## 1. Goal

Build a real instructor editor, not a mock:

1. Problem content WYSIWYG (text + math + image + table + choices).
2. Metadata / classification panel.
3. A4 worksheet assembly, live preview, print / PDF.

End-to-end must work: load Production DRAFT → edit Hangul/English/math → copy/paste → image/table → save/reopen → version restore → assemble worksheet → A4 print.

## 2. Non-goals / hard bans

- Do not auto-set `review_status = VERIFIED` or `WORKSHEET_ELIGIBLE`.
- Do not overwrite OCR originals. Save creates a **new** `problem_version` (`origin = TEACHER_EDIT`).
- Do not bulk-convert the existing 1,281 DRAFT stems.
- Do not hard-DELETE problems. Archive / restore only.
- Do not open or write `hyper-student-care`.
- Do not use paid Tiptap Pages / TeamPaste / Snapshot.
- Do not store final images as base64 in `problem_text` / editor JSON.

## 3. Surfaces and routes

| Surface | Route |
|---|---|
| Question list + bulk | `/questions` |
| Problem editor (3 pane) | `/questions/:problemId/edit` |
| Legacy textarea editor | `/questions/:problemId/edit?legacy=1` |
| Version history + restore | `/questions/:problemId/versions` |
| Worksheet list | `/worksheets` |
| A4 worksheet builder | `/worksheets/:worksheetId` |

Keep `/questions/:problemId/edit` as the primary edit URL.

## 4. Canonical document

Stored in `problem_versions.content_metadata.editor_document` (jsonb).

```json
{
  "schema_version": 1,
  "tiptap_json": { "type": "doc", "content": [] },
  "latex_index": [],
  "blocks": {
    "stem": true,
    "instruction": true,
    "condition": false,
    "choices": true,
    "figure": false,
    "explanation": true
  },
  "choice_layout": "VERTICAL",
  "converted_from_ocr": false,
  "source_text_sha256": null
}
```

- `problem_versions.problem_text` remains the human-readable / OCR-compatible stem (derived on save).
- `normalized_text` remains search text (LaTeX kept, HTML stripped).
- HTML is derived for print/preview, never the source of truth.
- Existing DRAFTs without `editor_document` convert lazily on first open. The UI shows a **diff vs OCR text** before the first save.

## 5. Math

- Edit: **MathLive**.
- Display / print: **KaTeX** (existing).
- Inline + block nodes. Original LaTeX is a first-class attribute. Round-trip must be identical.
- Toolbar templates + raw LaTeX input + `$...$` / `$$` / `\(`/`\[` detection on paste.
- Unsupported commands are kept as LaTeX source, never dropped.

## 6. Save / version / restore

| Action | Behavior |
|---|---|
| Autosave | Local + `editor_autosaves` row. Does **not** create a version. |
| Save | `hqb_save_editor_document` → new `problem_version`, `origin=TEACHER_EDIT`, lifecycle stays `DRAFT`. |
| Restore | Clone the chosen historical version as a **new** current version. Old rows stay immutable. |
| Conflict | Optimistic `editor_revision` / `updated_at`. Second writer sees a conflict dialog. |
| VERIFIED current | Clone first (existing `hqb_clone_problem_version`), then edit the clone. Never mutate VERIFIED. |

Review submit stays a separate button (`hqb_submit_for_review`). Autosave must not call it.

## 7. Assets

- Bucket: `question-bank-assets` (staff INSERT/SELECT, ADMIN DELETE).
- Metadata in `problem_assets` + figure links in `problem_figure_assets`.
- Clipboard / drag-drop images upload through RPC, then insert a storage URL node.
- MIME allowlist: `image/png`, `image/jpeg`, `image/webp`, `image/gif`. Size cap 8 MiB.

## 8. Worksheets / A4

- `worksheets.layout` jsonb: columns (1\|2), fonts, margins, header (title/school/grade/exam/name), exam_kind (`EXAM` \| `ANSWER_SHEET`).
- `worksheet_items`: order, spacing_mm, points, force_page_break.
- Search existing problems + `hqb_search_similar_problems` suggestions.
- Print via CSS `@page A4` + browser print-to-PDF. Long problems split across pages; figures stay with the item when possible.

## 9. Security

- Staff only (`hqb_is_staff`). Role split:
  - write draft / save / autosave: ADMIN, TEACHER, REVIEWER
  - restore version / archive / restore archive: ADMIN, TEACHER, REVIEWER
  - verify: ADMIN, REVIEWER (existing RPC, not called from this STEP’s save)
- HTML paste sanitized (DOMPurify + allowlist).
- No secrets in client. No student-care keys.

## 10. Production test policy

Create **one labeled STEP 8.35 test problem**, exercise the full path, then **archive** it.  
Do not rewrite the 1,281 existing DRAFT stems as part of the test.

## 11. Tests that must pass (or be explicitly documented)

Hangul IME, inline/block math round-trip, copy math+text, HTML paste sanitize, XSS blocked, image node without base64, table merge model, choices CRUD, constructed-response hides choices, undo/redo, autosave, conflict token, version restore, A4 1/2-col pagination, unauthorized blocked, OCR/fingerprint/embedding counts unchanged.
