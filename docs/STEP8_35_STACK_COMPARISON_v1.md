# STEP 8.35 — WYSIWYG / math editor stack comparison (v1)

Decision date: 2026-09-13  
Binding: this file plus `docs/STEP8_35_WYSIWYG_EDITOR_v1.md`.

## Product constraints

- Instructor-only Question Bank (`ADMIN` / `TEACHER` / `REVIEWER`).
- Hangul + English + middle-school math (inline + block).
- Copy/paste from Word, Google Docs, web, and as much HWP as the clipboard actually exposes.
- Images/tables, versions, A4 worksheet print/PDF.
- Stay on the existing React + TypeScript + Vite app. Do not replace the framework.
- OSS-first. No paid Tiptap Pages / TeamPaste / Snapshot. No new paid SaaS.

## Candidates

| Candidate | License | Math | A4 pages | Verdict |
|---|---|---|---|---|
| Tiptap 3 + ProseMirror + React | MIT | Custom MathLive node | Custom CSS paged media | **Chosen** |
| TipTap Mathematics extension | MIT | KaTeX only | n/a | Reject as sole math path (original LaTeX can be lost) |
| CKEditor 5 | GPL / commercial | MathType paid extras | Commercial | Reject (license + cost) |
| TinyMCE | GPL / commercial | Limited | Commercial | Reject |
| Lexical | MIT | Custom | Custom | Reject (weaker table/paste ecosystem for this STEP) |
| Quill | BSD-3 | Poor math | Poor pagination | Reject |
| Slate | MIT | Custom | Custom | Reject (more work for tables/paste) |
| Toast UI Editor | MIT | Limited | Poor | Reject |
| OnlyOffice | AGPL | Heavy | Heavy | Reject (too large, license) |
| MathType / Wiris | Commercial | Strong | n/a | Reject (paid) |
| MathLive | MIT | Strong edit | n/a | **Chosen as math editor** |
| KaTeX | MIT | Strong display | n/a | **Keep for render** |
| MathJax | Apache-2.0 | Display | n/a | Keep as optional fallback later; not default |

## Chosen stack

1. **Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`, table/image/text-style/color/highlight/underline/text-align/placeholder/dropcursor/gapcursor)** — MIT.
2. **MathLive** — MIT, edit surface for inline + block math. Original LaTeX stored on the node.
3. **KaTeX** — already in the app; display of math nodes and print preview.
4. **DOMPurify** — sanitizer for HTML paste.
5. **A4 pagination** — CSS `@page` + custom column/page-break logic. **Not** Tiptap Pages.

## Rejected paid paths

- Tiptap Pages, TeamPaste, Snapshot, Cloud.
- MathType / Wiris.
- Any new paid PDF SaaS. Browser print-to-PDF is the STEP 8.35 default.

## Risk notes

- HWP paste is OS/clipboard dependent. If the clipboard only yields an image or stripped text, the editor must keep that payload and warn — never silently drop it.
- Tiptap 3 FontSize is OSS via `@tiptap/extension-text-style` (`FontSize` export). Do not pull a paid FontSize extension.
- Existing 1,281 DRAFT `problem_text` values stay as OCR source. Conversion to editor JSON is lazy on first open.
