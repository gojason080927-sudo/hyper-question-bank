# STEP 8.31 — End-to-end 26-sample pilot completion

STATUS: **implemented (recover SSEN original → crop S01–S26 → OCR/structure compare → HUMAN_REVIEW queue → optional idempotent DRAFT persist)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.31**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE (`pwuswjauzdxewmtgoitf`): **never** accessed.

**Never VERIFIED. Never auto-publish. Never restore live DRAFT 757 to frozen 265. Never delete or rewrite existing Production content/versions.**

---

## Why this STEP

`origin/main` contains STEP 8.30 (PR #14 merged). Design Freeze §J next unused row is **8.31**:

> Confidence gate persist **DRAFT** + queue `HUMAN_REVIEW` | Drafts only, never VERIFIED | No by default

This freeze **starts 8.31** as one unified completion milestone: the existing 26 STEP 7 samples must reach the instructor review UI when the original is actually reachable. It is **not** another cache-only BLOCKED document PR.

## Locked textbook

- source_document_id `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`
- 쎈수학 공통수학1
- original Storage object `question-bank-sources/9ff369b4-5b16-4cb8-bfc3-a6b180c18703/original.pdf`
- frozen SHA256 `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`
- 192 pages; `%PDF-1.7`
- Excluded SECOND book `190fb31b-03f5-43b9-b696-cce7a823a321`

Original PDF and recovered crops stay **gitignored** (`.ocr-temp/`, `public/review-crops/`). Do not commit copyrighted binaries.

## PR #11 reuse policy

Open PR #11 is **not merged**. Reuse only the Storage path / frozen PDF hash / local locate pattern. Do not import 192-page OCR, Production writes, or paid full-book calls from that PR.

## Pipeline

1. Download the frozen original (hash-checked) if missing locally.
2. Render needed pages (8, 12, 20, 36, 60, 96, 132, 156) and crop declared STEP 7 bboxes to `.ocr-temp/step8-31/crops/Sxx.png`. Page PNGs are **not** crop substitutes.
3. Prefer cached Mistral OCR under `.ocr-temp/step8-31/mistral/`. Call Mistral only on cache miss.
4. Compare crop + OCR to frozen GT: identity, stem, choices, math, figure/table, neighbor boundary.
5. Map conservatively: **0 AUTO_APPROVED**. Numbered samples → `HUMAN_REVIEW`. Unstable identity (`S02`, `S03`, `S16`, `S24`) stays **BLOCKED**. Non-canonical numbers (`01-1`, `08-4`, `08-5`) → HUMAN_REVIEW + `SKIP_IDENTITY` (no upsert).
6. Dry-run persist. Abort on duplicate / orphan / create-collision / AUTO_APPROVED / VERIFIED mapping.
7. Persist only with `--persist`: idempotent `hqb_upsert_problem_draft_from_identity` for **new** identities; record existing Production IDs without rewriting content/versions; `hqb_submit_for_review` to `NEEDS_REVIEW`; 26 `pipeline_items` with `assigned_by=STEP_8_31`.
8. Instructor UI: `/pipeline-review` lists crop, stem, choices, math, figure, reasons, Production IDs and links to existing `/questions/:id/review` approve/reject flow.

## Paid OCR cap (this milestone)

| Limit | Value |
|---|---|
| Max new Mistral calls | **30** |
| Max USD | **$2** |
| Price used | **$0.004 / image** |
| 26 crops | **$0.104** |
| Mathpix | **0** if credentials absent; do not stop the milestone |

`--cache-only` forbids new calls. `--allow-paid-api` + `--i-understand-this-costs-money` required otherwise. Stop **before** a call that would exceed the cap (max 30 calls / $2). Never log `MISTRAL_API_KEY` or any key substring.

## Status mapping

| Sample class | Status | Persist |
|---|---|---|
| Unstable / null number (S02, S03, S16, S24) | BLOCKED | SKIP_BLOCKED |
| Non-canonical (`01-1`, `08-4`, `08-5`) | HUMAN_REVIEW | SKIP_IDENTITY |
| Canonical 4-digit, already in Production | HUMAN_REVIEW | RECORD_EXISTING |
| Canonical 4-digit, missing | HUMAN_REVIEW | CREATE_DRAFT |
| Any AUTO_APPROVED | forbidden | abort |

Existing STEP 8.24 eight carry-over IDs are **not** in this 26-sample set and stay BLOCKED elsewhere.

## Production rules

- Create DRAFT / UNREVIEWED then submit `NEEDS_REVIEW`. Never `VERIFIED`, never `WORKSHEET_ELIGIBLE`.
- If identity exists: record `problem_id` / `public_code`; do not create a second problem; do not rewrite `problem_text` or versions.
- Abort writes if dry-run predicts any duplicate, orphan, or create collision.
- Do not upload crops to Storage (`image/png` is rejected on `question-bank-sources`). Local `/review-crops/Sxx.png` is gitignored.
- Live DRAFT 757 is the pre-persist snapshot. Expected new drafts = CREATE count only (up to 4: S13/S21/S25/S26 when still missing).

## GT / corpus hash isolation

- `workers/ocr/ground-truth.json` SHA256 `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb` is frozen. **Do not mutate GT content.**
- `corpus-manifest.json` `ground_truth_version` `bfd93931…` is the STEP 7 **crop-set label** (`STEP7_GROUND_TRUTH_VERSION`), not the JSON file hash.
- Recovered crop SHA256 may differ from frozen STEP 7 crop hashes (encoder/pad). Record recovered hashes separately. Do not copy recovered files into `workers/ocr/data/crops/` (that would turn missing-crop warnings into hash mismatches).

## Artifacts (git)

- `docs/STEP8_31_E2E_PILOT_COMPLETION_v1.md`
- `src/lib/ingestion/e2ePilot831.ts`, `step831Run.ts`, `step831Cli.ts`
- `scripts/generate-step831-crops.py`, `scripts/step-8.31.mjs`, `scripts/verify-step831.mjs`
- `src/features/review/PipelineReviewPage.tsx`
- `ocr-tests/taxonomy/step8-31/*` (summaries, queue, previews — no PDF/crops/raw OCR JSON)
- `public/review-queue.json` (metadata only)

Not git: original PDF, page PNGs, crop PNGs, raw Mistral JSON, anon/service keys.

## Acceptance

1. 26 crops generated from the real original bbox (not page-PNG substitutes).
2. 26 compared; AUTO_APPROVED = 0; BLOCKED = 4; HUMAN_REVIEW = 22.
3. Mistral new calls ≤ 30 and USD ≤ 2. Mathpix = 0 unless separately configured.
4. Persist dry-run PASSes; creates do not collide; existing IDs recorded; content rewrites = 0.
5. `/pipeline-review` shows crop/stem/choices/math/reasons and links to existing review actions.
6. `npm test`, `typecheck`, `lint`, `build`, `verify:step825`–`verify:step831` PASS.
7. Student-care never accessed.
