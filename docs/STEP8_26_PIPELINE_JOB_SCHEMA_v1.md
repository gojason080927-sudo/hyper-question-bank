# STEP 8.26 — Pipeline Job Schema and Progress Counters v1

STATUS: **implemented (schema only)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.26**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE: never accessed.

---

## Goal (this STEP only)

Add additive `pipeline_runs` / `pipeline_items` schema and progress counters so later STEPs can record a textbook job without inventing a new status model.

This STEP does **not** run a textbook, does **not** persist problems/figures, and does **not** call paid OCR.

## Scope

| In | Out |
|---|---|
| New migration `20260912120000_hqb_pipeline_job_v1.sql` | Existing migration edits |
| Tables `pipeline_runs`, `pipeline_items` | `ocr_result_cache` (later STEP) |
| Progress JSON counters from STEP 8.25 | Textbook PDF ingest |
| RPCs start / upsert item / test rollback | `hqb_verify_problem_version` |
| Offline verify + unit tests | STEP 8.27 segmentation |
| Carry-over record of STEP 8.24’s 8 BLOCKED ids | Processing those 8 ids |
| Exact-hash check of the known original PDF | Using any other PDF as a substitute |

## Execution conditions

- Base: latest `origin/main` (STEP 8.25 merged).
- `--cache-only` (default): write repo artifacts only. Production schema apply is not attempted.
- `--persist-schema`: apply this additive migration to Question Bank Production only if `SUPABASE_ACCESS_TOKEN` is a real token and the URL is `owpxsmdcxjmsgadkdsci`. Placeholder tokens → write 0.
- `--persist` (problem persist) and `--allow-paid-api` are **rejected**.

## PASS / REVIEW / BLOCKED (this STEP)

| Target | Verdict | Why |
|---|---|---|
| `schema.pipeline_runs` | PASS if SQL additive check passes | New table + RPC, no DROP/TRUNCATE |
| `schema.pipeline_items` | PASS if SQL additive check passes | Frozen 8.25 statuses/stages |
| `progress_counters` | PASS if SQL additive check passes | `hqb_pipeline_progress_from_items` |
| `textbook_run` | BLOCKED | Freeze: no textbook run |
| `paid_ocr` | BLOCKED | Freeze: paid OCR = No; cap 0 / $0 |
| `original_pdf` | BLOCKED | Not required; absent or unused; **never substituted** |
| STEP 8.24 eight ids | BLOCKED | Carry-over; out of scope |

No REVIEW targets in 8.26. Confidence is not relaxed.

## Production write policy

Allowed: **schema only**, and only the new pipeline tables/RPCs.

Forbidden: INSERT/UPDATE/DELETE of `problems`, `problem_versions`, `reviews`, `problem_figure_assets`, `problem_figure_links`, taxonomy.

If schema apply is not authorized, this STEP still completes with `production_*_writes = 0` and the migration file in git.

## OCR policy

- Reuse cache/source only. No new Mathpix or Mistral calls.
- Cap: **0 calls / $0** (STEP 8.25 §J for 8.26). The general 8-call / $1 ceiling is not opened here.
- `FEATURE_FLAGS.paidOcrRoutingEnabled` stays false.

## Frozen counts (unchanged)

265 drafts, 38 type AUTO, 227 remainder, 3 figure assets, 3 figure links, 8 STEP 8.24 BLOCKED candidates.

## Rollback / re-run

- Migration is `CREATE TABLE IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION`.
- `hqb_delete_test_pipeline_job` deletes only `assigned_by = STEP_8_26_ROLLBACK_TEST`.
- Re-running `--cache-only` is idempotent (rewrites artifacts, no DB).

## Next STEP start condition (do not start here)

STEP **8.27** may begin only after this schema is on `main`: cache-only batch segmentation on **one** already-stored textbook. No new problems unless that freeze explicitly scopes them. No paid OCR.

## Artifacts

- `docs/STEP8_26_PIPELINE_JOB_SCHEMA_v1.md` (this file)
- `supabase/migrations/20260912120000_hqb_pipeline_job_v1.sql`
- `src/lib/ingestion/pipelineJob826.ts`
- `src/lib/ingestion/step826Run.ts`
- `scripts/verify-step826.mjs`
- `ocr-tests/taxonomy/step8-26/*`
