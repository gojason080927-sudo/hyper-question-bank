# STEP 8.38 — 쎈수학 범위형 합침 오류 복원 + OCR 경계 정리

Status: **binding on branch `cursor/step-8-38-range-stem-restore-58e0`.**  
Date: 2026-09-13  
Base: latest `origin/main` after **PR #22 MERGED** (`795a205`, 2026-09-13T12:41:37Z).

Repo: `gojason080927-sudo/hyper-question-bank` only. Never open `hyper-student-care`.
SSEN source: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` (쎈수학 공통수학1).

## 1. Start-state gate

| Item | Result |
|---|---|
| PR #22 | MERGED into `main` |
| Start commit | `795a2050db1b67634358c2225f20613dd34fa668` |
| Branch | `cursor/step-8-38-range-stem-restore-58e0` from `origin/main` |
| STEP 8.32–8.37 persist | **Not re-executed** |
| Paid OCR | **0** (report-then-stop if existing evidence is insufficient) |

STEP 8.37 UI that must remain on main: mobile cards, KaTeX (`MixedKatexText`), duplicate heading cleanup, worksheet A4, home → `/worksheets`.

Frozen Production counts (read-only baseline):

- SSEN listed **1,242**
- DRAFT **1,281**
- embeddings **1,244**
- content_fingerprints **3,543**
- majors listed I 252 / II 462 / III 253 / IV 160 / V 115
- 쎈수학 NEEDS_REVIEW queue **9**

## 2. What this error is (and is not)

Do **not** split one record into many problems. The leaked `[n~m]` prompt on the previous item is a **shared stem** for records that already exist.

Example:

- `0002` currently ends with `[0003~0004] 다항식 … 정리하시오.`
- `0003` and `0004` already exist as separate rows
- Strip the leaked prompt from `0002`
- Attach that shared prompt to `0003` and `0004` so a worksheet with only one of them is still solvable
- Keep listed total **1,242**

## 3. Candidate count vs the earlier “63”

STEP 8.36 `merged_flagged: 63` counted **every SSEN-linked current stem** (listed + hidden) matching `\[[0-9]{3,4}~…]`.

This STEP recounts from Production:

- All SSEN-linked current stems with a range token: **63**
- Listed: **58**
- `HIDDEN_DUPLICATE`: **5** (`0314`, `0320`, `0324`, `0328`, `1055`)
- Later-range leaks (previous item holds the next group prompt): **50** listed
- Own-range headers (stem starts with `[n~m]` where n is the current number, often still containing sibling bodies): **8** listed

Do not pad listed work to 63. Hidden duplicates are **BLOCKED** (no write).

## 4. Data policy

- raw OCR / `source_pages.extracted_text`: never UPDATE/DELETE
- problems: never DELETE, never INSERT for this STEP
- versions: insert new `origin=AUTO_CLEAN` via existing `hqb_apply_auto_clean_text` (parent_version_id set, current_version_id switched)
- TEACHER_EDIT current origin: skip
- problem `review_status=VERIFIED`: skip
- embeddings / fingerprints: no writes
- problem numbers / units / types / difficulty: no bulk change
- idempotent: second persist with the same cleaned text is `skipped: unchanged`
- **No new migration.** Shared prompt lives in `problem_text` (browse/A4 already render `problem_text` only). `instruction` is not wired through A4, so it is not used as the sole store.

## 5. AUTO_SAFE / REVIEW_REQUIRED / BLOCKED

AUTO_SAFE (all must hold):

- `[start~end]` parses; start > current; end-start ≤ 20
- every integer in the range has **exactly one LISTED** record
- same source, same section, same or adjacent page (Δ ≤ 2)
- keep (donor body) non-empty; shared text looks like a problem prompt
- shared text does not contain sibling problem numbers or ambiguous figures
- donor/targets are not TEACHER_EDIT / VERIFIED
- evidence: current OCR/AUTO_CLEAN version and/or STEP 8.32 `items.json` stem_preview + outline + neighbor records

REVIEW_REQUIRED: unclear boundary, missing listed target, section/page jump, mixed sibling bodies, TEACHER_EDIT/VERIFIED, figure ownership unclear, own-range merged header.

BLOCKED: hidden duplicate, page/outline contradiction, no OCR/version evidence.

Uncertain items stay in the live 검수 UI **range tab** without flipping `review_status` in bulk (existing 쎈수학 NEEDS_REVIEW **9** is preserved).

## 6. UI

- `ProblemStemDisplay` splits a leading `[n~m]` line as a shared-prompt kicker so A4 `n.` plus the range label is not a second problem number
- Cards, PC table, preview, review, worksheet A4 1/2-col use it
- `/pipeline-review?source=range838` reuses the existing queue page

## 7. Non-goals

- No paid OCR
- No bbox/crop regen
- No 8.32–8.37 persist replay
- No auto-delete of STEP 8.37 test worksheets
- No auto-merge of the PR

## 8. Production persist (this run)

- DRY RUN safety: **ok**
- AUTO_SAFE candidates applied: **40**
- New AUTO_CLEAN versions / current_version switches: **144**
- REVIEW_REQUIRED left unchanged: **18**
- BLOCKED (hidden dups): **5**
- Re-run applies: **0**
- listed **1,242** unchanged; embeddings **1,244**; fingerprints **3,543**; majors 252/462/253/160/115
- Paid OCR: **0**
- Test worksheets: confirmed, not deleted

Artifacts: `ocr-tests/taxonomy/step8-38/` and `public/step8-38-range-audit.json`.

- No paid OCR
- No bbox/crop regen
- No 8.32–8.37 persist replay
- No auto-delete of STEP 8.37 test worksheets
- No auto-merge of the PR
