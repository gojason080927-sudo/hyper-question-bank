# STEP 8.27 — Cache-only Batch Segmentation v1

STATUS: **implemented (cache-only dry-run; Production run not started)**  
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

This Cloud Agent environment has placeholder `SUPABASE_ACCESS_TOKEN` / service-role (not JWT-like). Pending migrations cannot be listed safely → isolated apply is **not** allowed → Production run is **not** started.

## OCR policy

- Cap: **0 calls / $0**
- New Mathpix = 0, new Mistral = 0, other paid OCR = 0
- `--allow-paid-api` is rejected
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
