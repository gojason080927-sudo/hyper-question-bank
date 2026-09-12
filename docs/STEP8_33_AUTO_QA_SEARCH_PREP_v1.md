# STEP 8.33 — 쎈수학 공통수학1 대량 자동 품질보정 + 검수 최소화 + 검색 준비

User-frozen execution spec. Does **not** re-run STEP 8.32 ingest. Does **not** mint new problems.

## Locked textbook

- Title: 쎈수학 공통수학1
- `source_document_id`: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`
- PDF SHA256: `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`
- Pages: **192** (already ingested in STEP 8.32)
- Excluded SECOND book: `190fb31b-03f5-43b9-b696-cce7a823a321`
- Question Bank ref: `owpxsmdcxjmsgadkdsci`
- Never open or write `hyper-student-care` (`pwuswjauzdxewmtgoitf`)
- Do not touch PR #11
- Do not auto-merge
- Do not auto-set `VERIFIED`
- Do not DELETE existing Production rows
- Do not rewrite existing `problem_text` without original evidence
- Do not modify a different `source_document_id`

## Why this STEP exists

STEP 8.32 persisted 520 new Production DRAFTs and submitted them all to `NEEDS_REVIEW` (25 → 545). Pipeline reasons were dominated by **policy tags** and **over-broad automatic flags**, not by 545 distinct human-judgement failures:

- `QUEUED_HUMAN_REVIEW` / `NO_VERIFIED` on every item
- `SEGMENT_REVIEW` hardcoded for every crop
- `CLASSIFICATION_REVIEW` from high thresholds + `TYPE_UNCLEAR` on expression-only stems
- `MATH_UNCERTAIN` when LaTeX was present but the math extractor returned `[]`
- `OCR_UNCERTAIN` when the stem was shorter than 24 collapsed characters
- `FIGURE_NEEDS_REVIEW` whenever the stem mentioned a figure, even if the figure lives inside the problem crop
- `CHOICES_INCOMPLETE` when OCR counted ①/② noise on constructed-response items

Humans must not review 545 items one by one.

## Scope

1. Census every STEP 8.32 SSEN candidate (1,256 found / 520 newly created DRAFTs).
2. Production writes only for `source_document_id = 9ff369b4-5b16-4cb8-bfc3-a6b180c18703`.
3. Clear `NEEDS_REVIEW` only on those SSEN DRAFTs (the 520 new rows, plus any of the prior 25 that share this source and pass the same safe rules).
4. Other textbooks / other sources: read-only, never updated.
5. Existing `UNREVIEWED` SSEN DRAFTs: fingerprint/search features may be added; review status is unchanged unless it is already `NEEDS_REVIEW`.

## Automatic correction rules

| Pattern | Correction |
|---|---|
| Policy tags (`NO_VERIFIED`, `QUEUED_HUMAN_REVIEW`, `NO_WORKSHEET_ELIGIBLE`, `AUTO_APPROVED_NOT_REQUIRED`, `EXISTING_PRODUCTION_DRAFT`, `NO_CONTENT_REWRITE`) | Not quality defects. Drop from residual HUMAN_REVIEW. |
| `SEGMENT_REVIEW` with crop present + valid bbox + no severe overlap | Clear. Crop is the original region. |
| `OCR_UNCERTAIN` with readable stem (≥8 non-space chars **or** Hangul/math tokens) | Clear. 24-char gate was too strict. |
| `MATH_UNCERTAIN` with `$...$` / `\( \)` / `^` / matrix tokens | Clear. Math is readable. |
| `FIGURE_NEEDS_REVIEW` when the figure is inside the problem crop and overlap with other identities is &lt; 0.25 | Clear. Ownership = this identity's bbox/crop. Do **not** write new figure assets (keep 3/3). |
| `CHOICES_INCOMPLETE` on 서술형 / 구하시오 / 보기 ㄱㄴㄷ | Treat as constructed-response or 보기-set. Clear unless a true 5-choice stem is missing options. |
| `TYPE_UNCLEAR` on polynomial/equation expressions | Infer type from expression structure + section heading. |
| `UNIT_FROM_STEM_ONLY` at ≥ 0.80 with no `UNIT_CONFLICT` | Allowed for QA clear. |
| `SUBUNIT_HEADING_RISK` | Does not block QA clear when unit/type pass. |
| Exact `NORMALIZED_TEXT` fingerprint collision across different identities | Keep `HUMAN_REVIEW` (`DUPLICATE_CANDIDATE`). Do not merge. |
| `CONTENT_THIN` / `EVIDENCE_INSUFFICIENT` / `UNIT_CONFLICT` / answer-key leakage / severe overlap | Remain `HUMAN_REVIEW`. |

## NEEDS_REVIEW auto-clear (all must hold)

- Original source/page/bbox/crop link OK
- Canonical 4-digit identity present
- Stem and key math readable
- Choice structure OK (including constructed-response)
- Figure/table ownership OK when present (in-crop is sufficient)
- No severe crop cut / other-problem intrusion
- No duplicate collision
- Unit confidence ≥ 0.80 without `UNIT_CONFLICT`
- Type confidence ≥ 0.70 and `type_id ≠ TYPE_UNCLEAR`

Then:

- `problems.review_status` / current version → `AUTO_CLASSIFIED`
- `lifecycle_status` stays `DRAFT`
- pipeline item → `AUTO_APPROVED` (Gold Standard mapping: DRAFT + AUTO_CLASSIFIED, **not** VERIFIED)
- Never `VERIFIED`, never `WORKSHEET_ELIGIBLE`

## Feature store / search prep

`content_fingerprints` exists (`NORMALIZED_TEXT`, `STRUCTURE`, `FILE_HASH`).

`problem_embeddings` was **omitted** in CORE v1 (no pgvector). This STEP must not enable pgvector or add a vector column. Search readiness = fingerprint + structure key + duplicate candidates.

Idempotent insert: skip when `(problem_id, fingerprint_type, fingerprint_value)` already exists.

## Safety

- Production snapshot before and after
- Idempotent: a second `--persist` creates 0 extra problems, 0 extra fingerprint rows, 0 extra review-status flips
- No DELETE
- No paid OCR / no new paid signup
- Per-item failure does not abort the book
- Ground-truth JSON SHA256 stays `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb`

## Assigned-by / artifacts

- `assigned_by`: `STEP_8_33`
- Stage: `QUEUE_HUMAN` (re-gate after QA; passing items leave the queue)
- Committed artifacts: `ocr-tests/taxonomy/step8-33/*.json` and `*.md` only

## BLOCKED abort of the whole STEP

Stop the whole STEP as BLOCKED only if Production Question Bank credentials are missing **and** `--persist` was requested. A single item failure is recorded and skipped.
