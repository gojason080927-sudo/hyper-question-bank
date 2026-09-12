# STEP 8.27 — Cache-only Batch Segmentation v1

STATUS: **implemented (cache-only dry-run; SSEN original verified; layout OCR cache blocked on missing `MISTRAL_API_KEY`; Production pipeline run not started)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.27**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE: never accessed.

---

## Goal (this STEP only)

Cache-only batch segmentation on **one already-stored textbook**. Record item status and progress counters. Do **not** persist problems, versions, answers, explanations, or classifications. Do **not** call paid OCR.

## Documented target (not a guess)

STEP 8.25 §J says “one already-stored textbook” and does **not** reprint a UUID on that row. The lock below uses the only Production source used by STEP 8.8–8.24 and the frozen 265 drafts:

| Field | Value | Evidence |
|---|---|---|
| Document ID / source | `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` | `STEP88_DOCUMENT`, `STEP817_DOCUMENT`, `STEP812_DOCUMENT` |
| Title | 쎈수학 공통수학1 | `workers/ocr/corpus-manifest.json` (`document_id` match) |
| Excluded book | `190fb31b-03f5-43b9-b696-cce7a823a321` (SECOND) | `step823Run.ts` `SECOND_DOCUMENT` |
| Excluded PDF | `second-common-math1.pdf` SHA256 `3b4e789e…` | STEP 8.21/8.26 hash; **wrong book**, never a substitute |

Cache locations required by existing segmentation I/O (`src/lib/classification/step88Io.ts`):

- Candidates: `ocr-tests/book-pipeline/step8-7/stage-b-candidates.json`
- Page PNGs: `ocr-tests/original/page-NNN.png` or `ocr-tests/book-pipeline/pages/page-NNN.png`
- Layout OCR: `ocr-tests/mistral/{mistral}-{sha16}-{profile}.json` with profile `ocr-latest+blocks+tables+images`

Inventoried **but not used as the textbook**:

- 9 SSEN figure-recovery PNGs under `ocr-tests/taxonomy/step8-22/pages/ssen/` — using them would guess a subset.
- STEP 8.18 SECOND pages + `_sample-layout-raw.json` — wrong book.

## Original PDF

`layoutSegment.ts` needs OCR layout blocks (`LayoutPageInput`), not PDF bytes. Cache-only segmentation therefore **does not require** the original PDF **if** the layout cache exists.

If the cache is missing, the original is still **not substituted**. Filling the miss would be a new paid OCR call, which this STEP forbids → BLOCKED.

## Production write policy

Allowed, and only if dry-run PASSes **and** the STEP 8.26 schema is confirmed on Production: `pipeline_runs` / `pipeline_items` / progress RPCs.

Forbidden: INSERT/UPDATE/DELETE of `problems`, `problem_versions`, answers, explanations, taxonomy, `problem_figure_assets`, `problem_figure_links`.

STEP 8.25 §J: “No new problems unless explicitly scoped.” This STEP does **not** scope new problems.

If the 8.26 schema is not confirmed on Production, **do not start** a Production 8.27 run.

## Production STEP 8.26 schema apply

- Confirm via migration history **and** table/RPC existence.
- If already applied: do not re-apply.
- If not applied: apply **only** `20260912120000_hqb_pipeline_job_v1` when pending migrations are exactly that one version.
- If pending list is unknown or mixed: **do not** `db push` everything. Stop Production apply and report.
- No DROP / TRUNCATE / destructive SQL. No secret in docs or git.

This Cloud Agent environment previously skipped Production because access tokens were not JWT-shaped. That check was wrong: Supabase CLI/Management tokens are `sbp_…`, not Auth user JWTs.

## Production schema (applied this follow-up, still STEP 8.27)

`supabase projects list` (CLI 2.117.0) authenticated and listed `hyper-question-bank` ref `owpxsmdcxjmsgadkdsci`. Pending remote migration was **only** `20260912120000`. Dry-run `supabase db push --project-ref owpxsmdcxjmsgadkdsci --linked=false --dry-run` named that one file. It was then applied once. Re-query: tables `pipeline_runs` / `pipeline_items` exist with RLS; RPCs exist; pending = 0; pipeline row counts = 0.

## Original PDF hashes (do not mix)

| Book | source id | `file_hash` | pages |
|---|---|---|---|
| 쎈수학 공통수학1 | `9ff369b4-…` | `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292` | 192 |
| 개념원리 공통수학1 (SECOND, excluded) | `190fb31b-…` | `3b4e789ea8165f0473975d70de8d40658a391b65d21607997b77b468f124a5e9` | 312 |

The hash `3b4e789e…` is SECOND, not SSEN. Matching it does **not** authorize using that PDF as the 8.27 textbook.

SSEN original exists in Production Storage `question-bank-sources/9ff369b4-…/original.pdf`. Layout OCR cache still does not. Cache-only segmentation does not download or substitute that PDF.

## Cache hunt

Required `ocr-tests/mistral`, `ocr-tests/book-pipeline`, and `stage-b-candidates.json` are absent from git history, LFS, GitHub Actions artifacts, and Production Storage. Recognition payloads are stem/choices, not page layout blocks. Do not start 8.28.

## Layout OCR cache generation (still STEP 8.27)

The cache-only segmentation runner (`npm run pipeline:8.27`) still forbids paid OCR and problem writes.

Filling the missing SSEN layout cache is also STEP **8.27**, not 8.28. Runner: `npm run cache:8.27`.

| Field | Value |
|---|---|
| Provider | Mistral only (`mistral-ocr` / `mistral-ocr-latest`) |
| Profile | `ocr-latest+blocks+tables+images` |
| Official list price (2026-09-12) | OCR 4.1 **$4 / 1000 processed pages** = **$0.004/page** |
| Sources | https://mistral.ai/pricing/api/ , https://docs.mistral.ai/models/ocr-4-1 |
| Pilot 5 pages | $0.02 |
| Full 192 pages | $0.768 |
| Hard cap | **$1**. Stop before any call that would exceed it. |
| Mathpix | never in this STEP |
Durable path (planned, additive, does not touch `original.pdf`):

`question-bank-sources/ocr-cache/<source-id>/<pdf-sha256>/v1/`

The current `question-bank-sources` bucket rejects `application/json` (`InvalidMimeType` 415). Do not loosen that bucket to store cache JSON on top of originals. When cache bytes exist, add a **new private** bucket or an allowed mime list only on the `ocr-cache/` prefix — never public URLs, never move/delete `original.pdf`.

Pilot pages (1-based, not cover/TOC/answers): **8 BODY_FORMULA**, **28 MCQ**, **12 TABLE_BOX**, **20 FIGURE_GRAPH**, **108 MULTI_COLUMN_COMPLEX**.

If `MISTRAL_API_KEY` is missing, do **not** invent cache, do **not** switch providers, do **not** ask the user to upload cache. One action: add worker-only `MISTRAL_API_KEY` (never `VITE_`).

Resume: local/Storage manifest records successful pages so they are not billed again.

## OCR policy (segmentation execute)

- Cap for `pipeline:8.27`: **0 calls / $0**
- After a valid cache exists, dry-run/execute must not make new OCR network calls
- `--allow-paid-api` is rejected on the segmentation runner
- Cache miss must not fall through to a network call

## Status mapping (frozen names, not relaxed)

Pipeline statuses remain: `AUTO_APPROVED` | `AI_FIXED` | `HUMAN_REVIEW` | `BLOCKED` | `FAILED`.

| Segmentation engine | Pipeline status this STEP | Why |
|---|---|---|
| `AUTO_OK` | `HUMAN_REVIEW` | Dual review, image compare, and confidence gate are later STEPs. `AUTO_APPROVED` is forbidden here. |
| `REVIEW` | `HUMAN_REVIEW` | Ambiguous split. |
| cache miss / would call OCR | `BLOCKED` | `LAYOUT_OCR_CACHE_MISSING`, `CACHE_MISS_WOULD_CALL_PAID_OCR` |
| exception | `FAILED` | Retry from SEGMENT only. |

Never set `VERIFIED` or `WORKSHEET_ELIGIBLE`. Never auto-advance into STEP 8.28.

## Idempotency / resume

- Unique `(pipeline_run_id, candidate_id)` (STEP 8.26 schema).
- Local upsert keys on `candidate_id`.
- `assigned_by = STEP_8_27`.
- Re-run of a BLOCKED dry-run rewrites artifacts only; Production rows stay 0.
- Resume would restart from stage `SEGMENT` after the last successful stage; this STEP does not start STRUCTURE.

## Dry-run BLOCKED → no execute

Do not run live segmentation or Production writes if any of:

- textbook cannot be locked from evidence
- required cache missing
- cache miss would call paid OCR
- another textbook mixed in
- problem persist enabled
- existing problems/figures would change
- STEP 8.26 Production schema missing/unconfirmed
- original PDF required and absent (not the case for cache-only layout; still no substitute)

## Frozen counts (must not change)

265 valid DRAFT, 38 type AUTO, 227 remainder, 3 figure assets, 3 figure links, 8 STEP 8.24 BLOCKED ids.

Do not invent or restore Production numbers. If live counts differ, investigate; do not mutate.

## Next STEP start condition (do not start here)

STEP **8.28** may begin only after 8.27 is on `main` **and** a later freeze explicitly allows structure-from-cache. This PR does not start 8.28. Do not start 8.28.

## Artifacts

- `docs/STEP8_27_CACHE_ONLY_SEGMENTATION_v1.md` (this file)
- `src/lib/ingestion/cacheSegment827.ts`
- `src/lib/ingestion/step827Run.ts`
- `scripts/verify-step827.mjs`
- `ocr-tests/taxonomy/step8-27/*`
