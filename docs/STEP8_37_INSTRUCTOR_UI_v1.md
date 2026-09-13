# STEP 8.37 — Instructor Production UI: mobile + math + heading cleanup

Status: **binding on branch `cursor/step-8-37-instructor-ui-58e0`.**  
Date: 2026-09-13  
Base: latest `origin/main` after **PR #21 MERGED** (`368cc70`, 2026-09-13).

Repo: `gojason080927-sudo/hyper-question-bank` only. Never open `hyper-student-care`.

## 1. Start-state gate (verified before code)

| Item | Result |
|---|---|
| PR #21 | MERGED into `main` |
| Start commit | `368cc70ed0775e054977e927d41becba7267761d` |
| Branch | `cursor/step-8-37-instructor-ui-58e0` from `origin/main` |
| STEP 8.32–8.36 re-run | **Not executed** |
| Production data rewrite | **None** (UI-only) |

STEP 8.36 Production features that must remain (read, do not reprocess):

- 교재 → 쎈수학 공통수학1 (`9ff369b4-5b16-4cb8-bfc3-a6b180c18703`)
- 대단원 → 소단원 → 유형 탐색 (`/sources/:id/browse`)
- 페이지 → 문제번호 순서 목록
- 문제 미리보기 / 편집 / 문제지 추가
- A4 문제지 편집 및 미리보기

Frozen live counts (do not change in 8.37):

- SSEN listed **1,242** (11 exact dups hidden as `HIDDEN_DUPLICATE`)
- SSEN linked ~1,253; DRAFT ~1,281
- Outline listed sums I 252 + II 462 + III 253 + IV 160 + V 115 = **1,242**
- Sort remains page → `original_problem_number`
- No OCR, no embeddings/fingerprints, no stem UPDATE, no DELETE

## 2. Observed Production UI defects (before this STEP)

- PC table shrunk onto phones; Hangul broke one character per line
- Textbook / page / number / unit columns too narrow; stem clipped
- LaTeX (`$$A$$`, `\begin{pmatrix}`, `\frac`, `\times`) shown as raw text in browse list/preview
- Duplicate outline prefixes from display concatenation: `I I 다항식`, `01 01 …`, `유형 01 유형 01 …`
- Preview / 편집 / 문제지 추가 hard to tap
- Home “HYPER 문제지 생성” still “준비 중” while `/worksheets` works
- Worksheet A4 210mm overflowed phones; tools could be pushed off-screen

## 3. Non-goals

- Do not re-run STEP 8.32–8.36 persist
- Do not UPDATE problem stems / OCR / crop / bbox / classification
- Do not DELETE problems
- Do not add a migration unless a later report proves it is required. This STEP adds **no migration**.
- Do not implement twin-search or school-exam analysis
- Do not split the 63 merged `[n~m]` stems (STEP 8.38)

## 4. Display-layer rules

- Common view model `toProblemListViewModels` feeds **both** the desktop table and mobile cards (same order, same labels)
- `formatOutlineTitle` / `collapseDuplicateHeading` are display-only; DB titles stay as stored
- Math uses existing KaTeX (`katex` already in package.json). No MathJax. Unwrapped `\begin{...}` / `\frac` are split only at render time
- Broken LaTeX → original-string fallback, never a blank page
- Breakpoint: **1100px** (existing outline split). Cards + drawers below; dense table at 1101px+
- Verify 360 / 390 / 412 and desktop

## 5. Surfaces

| Surface | Change |
|---|---|
| `/` | Worksheets card links to `/worksheets`. Similarity + exams stay 준비 중 |
| `/sources` | Mobile source cards |
| `/sources/:id/browse` | Mobile cards, collapsible TOC/filters, math preview sheet, heading cleanup |
| `/questions` | Same view model + mobile cards |
| `/worksheets/:id` | Sticky tools, A4 fit/zoom/full view, points/reorder, MixedKatex |
| `/questions/:id` and review | MixedKatex stem (display only) |

## 6. Safety

- Problem DELETE 0
- Problem text UPDATE 0
- OCR 0 / paid OCR 0
- embeddings/fingerprints 0
- No `supabase/migrations` file in this STEP
- E2E worksheets must be named with `TEST`; do not auto-delete; report IDs
