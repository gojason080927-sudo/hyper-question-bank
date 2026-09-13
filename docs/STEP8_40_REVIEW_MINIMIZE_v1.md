# STEP 8.40 — 쎈수학 검수 후보 128문항 원본 일괄 대조

Status: **binding on branch `cursor/step-8-40-review-minimize-58e0`.**  
Date: 2026-09-13  
Base: latest `origin/main` after **PR #24 MERGED** (`d0fa5d2fcbba1728f22c92176016fff1e5865f5a`, 2026-09-13T16:58:43Z).

Repo: `gojason080927-sudo/hyper-question-bank` only. Never open `hyper-student-care`.  
SSEN source: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`.  
PDF SHA-256 (frozen 8.32): `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`.

## 1. Goal

Do **not** send instructors through 128 one-off reviews. Group the STEP 8.39 `REVIEW_REQUIRED` leftovers by original page, contrast existing OCR/PDF/PNG/neighbors, and freeze a new verdict for every id.

Success is **not** forcing 128 → 0. Success is a proven census: every leftover has PASS_FALSE_POSITIVE, AUTO_SAFE, REVIEW_REQUIRED, BLOCKED, or PAID_OCR_CANDIDATE (plan only).

## 2. Start gate

| Item | Result |
|---|---|
| PR #24 | MERGED into `main` at `d0fa5d2fcbba1728f22c92176016fff1e5865f5a` |
| Branch | `cursor/step-8-40-review-minimize-58e0` from `origin/main` |
| STEP 8.32–8.39 persist | **Not re-executed** |
| Paid OCR | **0** |

Frozen Production counts (re-read at run time):

- SSEN listed **1,242**
- PASS 1,091 / STEP 8.39 AUTO_SAFE 23 / REVIEW_REQUIRED **128**
- P0 0 / P1 9 / P2 108
- hidden duplicate **11**
- embeddings **1,244** / fingerprints **3,543**
- majors I 252 / II 462 / III 253 / IV 160 / V 115

128 unique `problem_id`s from `public/step8-39-full-qa.json`. Unique pages: **61**.

ID overlap:

- STEP 8.38 REVIEW_REQUIRED 18 → **all 18 inside the 128**
- live NEEDS_REVIEW 9 → **4 inside the 128**, 5 are not. Do not add 18+9.

## 3. Vercel (do not guess)

Cloud environment `repos` is only `github.com/gojason080927-sudo/hyper-question-bank`.

| Field | Value |
|---|---|
| Git repository | `gojason080927-sudo/hyper-question-bank` |
| Vercel project name | `hyper-question-bank` |
| Vercel projectId | `prj_q7khSRjjjAmwWcfs1FRsEobT1hXC` |
| Team / org slug | `hyper-student-care` (Vercel **team** slug, not the Student Care Git repo) |
| Production domain | `https://hyper-question-bank.vercel.app` |

Preview hostnames ending in `hyper-student-care.vercel.app` are the team slug. **If projectId or Git repo were Student Care, stop writes.** They are not. Never open the Student Care repository (`pwuswjauzdxewmtgoitf`).

## 4. Page groups

Key = `source_id | source_page | 대단원 | 소단원`. Same original page is rendered/analyzed once. Each group carries page PNG, PDF page, listed numbers, candidates, ±2 neighbors, current stem, OCR, AUTO_CLEAN, range header, choices, figure/crop, 8.39 signals, TEACHER_EDIT/VERIFIED.

Contact sheets: left original page, center current DB, right proposed. No fake crop boxes without character coordinates.

## 5. Verdicts

- **PASS_FALSE_POSITIVE** — 8.39 signal fired but original is normal. QA verdict only. No new version.
- **AUTO_SAFE** — original boundary is mechanical (trailing section title `08 이차부등식`, type/page trailer, leak whose suffix already equals the next listed stem). New `AUTO_CLEAN` version. No math coefficient guesses.
- **REVIEW_REQUIRED** — human can judge from the page; auto-edit is unsafe (glued missing numbers, unique range copy, 대표문제 stubs with missing choices).
- **BLOCKED** — original region cannot be identified.
- **PAID_OCR_CANDIDATE** — plan only; **0 calls**.

OWN_RANGE_HEADER whose only extra number is the `[n~m]` token end is a systematic 8.39 false positive → PASS_FALSE_POSITIVE.

TOO_SHORT math atoms on drill pages are normal sub-items → PASS_FALSE_POSITIVE. Do not invent the shared prompt digits.

DUPLICATE_BODY `대표 문제 다음 중 옳은 것은?` stubs have real choices on the page PNG → REVIEW_REQUIRED. Do not invent choices.

Never DELETE. Never raw OCR UPDATE. Never overwrite TEACHER_EDIT/VERIFIED.

## 6. Writes

Reuse `hqb_apply_auto_clean_text`. AUTO_SAFE only. Skip if `current_version_id` / stem hash changed. Idempotent rerun writes 0. Listed stays **1,242**. embeddings/fingerprints unchanged.

## 7. UI

`/pipeline-review?source=qa840` — 시작 128, 오탐 해제, 자동 복원, 사람 잔여, BLOCKED, 고유 페이지, P1, 유료 OCR 0. Filters: P1–P4, error type, page, 대단원, verdicts, 공통 발문, 수식, 도형. Cards: original / current / proposed / neighbors. Mobile stacks; PC is 3 columns.

## 8. Paid OCR plan (no calls)

Official prices (same as 8.39): Mathpix $0.002/image or $0.005/PDF page; Mistral OCR 4 $0.004/page. **This STEP: 0 calls, $0.**

## 9. Non-goals

- No problem DELETE
- No raw OCR mutation
- No 8.32–8.39 persist replay
- No auto-merge
- No auto-delete of test worksheets
