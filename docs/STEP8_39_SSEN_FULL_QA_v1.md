# STEP 8.39 — 쎈수학 공통수학1 전체 192페이지·1,242문항 종합 품질검수

Status: **binding on branch `cursor/step-8-39-ssen-full-qa-58e0`.**  
Date: 2026-09-13  
Base: latest `origin/main` after **PR #23 MERGED** (`0b9e7e3`, 2026-09-13T14:54:14Z).

Repo: `gojason080927-sudo/hyper-question-bank` only. Never open `hyper-student-care`.  
SSEN source: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`.  
PDF SHA-256 (frozen 8.32): `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`.

## 1. Goal

Do **not** re-OCR all 1,242 items. Inspect everything with existing DB/OCR/PDF, extract suspects, merge signals, restore **AUTO_SAFE only**, queue the rest, and **stop before paid OCR** with an exact page/call/cost plan.

Success is a **provable census**: every page 1–192 and every listed item has a result.

## 2. Start gate

| Item | Result |
|---|---|
| PR #23 | MERGED into `main` at `0b9e7e3` |
| Branch | `cursor/step-8-39-ssen-full-qa-58e0` from `origin/main` |
| STEP 8.32–8.38 persist | **Not re-executed** |
| Paid OCR | **0** until a later user approval |

Frozen Production counts:

- SSEN listed **1,242**
- linked **1,253** / HIDDEN_DUPLICATE **11**
- DRAFT **1,281**
- embeddings **1,244**
- content_fingerprints **3,543**
- majors I 252 / II 462 / III 253 / IV 160 / V 115
- STEP 8.38 AUTO_SAFE 40 / REVIEW_REQUIRED 18 / BLOCKED 5
- live NEEDS_REVIEW is measured at run time (do not add 18+9)

## 3. Cache

Key = `inspector 8.39.3 | rules r1 | pdf sha | page sha | current_version_id | stem hash`.

Same key → skip recompute. PDF unchanged → reuse page PNGs in `.ocr-temp/step8-39`. Existing Mathpix/Mistral JSON is counted, never re-called.

## 4. Gates (all free)

1. DB integrity (codes, pages, versions, choices, hidden twins)
2. OCR stem structure (range leak, next-number leak, packaging, latex/env, too short)
3. Page/number continuity vs frozen TOC
4. KaTeX census: `safeRenderKatex` + estimated overflow px vs 360 / A4 2-col 321 / A4 1-col 680
5. Figure links vs “그림/그래프/도형” hints — never invent images
6. Original PDF page render (hash-checked) for suspect pages; no arbitrary full-page crop

Normal math (`$`, `$$`, `\frac`, `\times`, `pmatrix`) is not OCR junk.

## 5. Verdicts

- **PASS** — required gates clean, or only display/number-prefix cosmetics
- **AUTO_SAFE** — packaging / book title / trailing outline / next-number leak whose suffix equals the next listed stem. No math coefficient guesses. Not TEACHER_EDIT/VERIFIED.
- **REVIEW_REQUIRED** — human can judge from current stem + neighbors (includes leftover 8.38 range headers)
- **PAID_OCR_CANDIDATE** — existing text/page evidence is not enough (empty stem, missing figure without crop, unreadable latex)
- **BLOCKED** — hidden duplicates; writes forbidden

8.39 does **not** auto-replay 8.38 range restores.

## 6. Writes

Reuse `hqb_apply_auto_clean_text`. No new migration. Skip if current_version changed. Idempotent. Listed stays **1,242**. embeddings/fingerprints unchanged.

## 7. UI

`/pipeline-review?source=qa839` — 전체검수 STEP 8.39 tab. Summary, filters, original/current/candidate compare (stack on mobile, row on PC).

## 8. Paid OCR plan (no calls)

Official prices used in code (do not invent):

- Mathpix image `POST v3/text`: **$0.002/image** (0–1M). Images with >12 text rows may bill at PDF page rate **$0.005/page**. Source: https://mathpix.com/pricing/api
- Mistral OCR 4: **$4 / 1000 pages = $0.004/page** (USD list). Source: https://mistral.ai/pricing/api/ and https://docs.mistral.ai/inference/pricing (€3.5/1000 pages EUR list)

Recommend page-bundled calls after user approval. **This STEP: 0 calls, $0.**

## 9. Census (inspector 8.39.3, 2026-09-13T15:31:29Z)

| Metric | Value |
|---|---|
| Pages / listed | 192/192 · 1242/1242 |
| PASS / AUTO_SAFE / REVIEW / PAID_OCR / BLOCKED | 1091 / 23 / 128 / 0 / 11 |
| P0–P4 | 0 / 9 / 108 / 258 / 40 |
| Unique listed non-PASS | 151 |
| GATE fail listed | G1 3 · G2 372 · G3 0 · G4 48 · G5 0 · G6 0 |
| Persist written / rerun | 23 / 0 |
| Cache after persist | hits 1253 / misses 0 |
| Paid OCR calls | 0 ($0). Recommend: no call |
| 8.38 REVIEW 18 ∩ live NEEDS_REVIEW 9 | empty (`both: []`) |
| Listed / embeddings / fingerprints after | 1242 / 1244 / 3543 |

Dashboard: `/pipeline-review?source=qa839`. Artifacts: `ocr-tests/taxonomy/step8-39/` and `public/step8-39-full-qa.json`.

## 10. Non-goals

- No problem DELETE
- No raw OCR mutation
- No HYPER type/concept/difficulty fill
- No auto-delete of the 7 test worksheets
- No auto-merge
