# STEP 8.25 — Integrated Textbook Batch Registration Pipeline Design Freeze v1

STATUS: **DESIGN FREEZE** (not a runtime ingest). Implemented this step: frozen spec + typed state model + offline verification only.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production Supabase ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE ref `pwuswjauzdxewmtgoitf` is **never** accessed.

---

## Why this is the next step

There is **no** `docs/STEP8_25_*.md` (or later) on `main` after STEP 8.24.

Evidence that 8.25 was reserved, not started:

- `docs/STEP8_24_REMAINING_FIGURE_RECOVERY_v1.md` — out of scope: “Do NOT start: STEP 8.25, multimodal twin, print-edit”.
- `ocr-tests/taxonomy/step8-24/step8-24-summary.md` — “Do not start STEP 8.25.”
- Numbering on `main` is sequential (`8.22` → `8.23` → `8.24`). The next unused number is **8.25**.

STEP 8.24 result is **PARTIAL**: 8 remaining figures are `BLOCKED` (`NEEDS_PAID_OCR` + owning problems not ingested). Completing those 8 requires new problem ingest and authorized paid OCR — both out of scope here.

The long-term goal after 8.24 is a single textbook **batch registration** path (upload → split → structure → figure link → dual review → confidence gate → human queue). Pieces exist as separate STEPs (5, 6, 7, 8.8–8.24) but are not one frozen pipeline. This step **freezes that design**. It does not run a textbook and does not write Production.

---

## Goal (this STEP only)

Freeze the integrated batch pipeline:

1. Data flow and stage order.
2. Item status model: `AUTO_APPROVED` / `AI_FIXED` / `HUMAN_REVIEW` / `BLOCKED` / `FAILED`.
3. Approval criteria (what may auto-land as a DRAFT, what must go to humans).
4. Failure recovery and idempotency.
5. Duplicate prevention.
6. Cost control (selective OCR, cache, hard caps).
7. Audit trail.
8. How this connects to existing `problems` / `problem_versions` / figures / OCR / classification.
9. Later implementation split into small, testable STEPs (8.26+). **Do not start 8.26 in this PR.**

---

## Out of scope (forbidden this STEP)

- Production INSERT/UPDATE/DELETE of problems, versions, reviews, figures, drafts, taxonomy.
- Bulk PDF execution or new Storage uploads.
- Paid OCR / Mathpix / Mistral network calls. `FEATURE_FLAGS.paidOcrRoutingEnabled` stays `false`.
- Enabling production paid routing.
- Implementing multimodal twin (`ocr-tests/taxonomy/step8-22/multimodal-twin-contract.json`, `implement: false`).
- Implementing print-edit (`ocr-tests/taxonomy/step8-22/print-edit-contract.json`, `implement: false`).
- New DB migrations (even additive). Tables below are **design only**.
- Changing frozen taxonomy counts, STEP 8.23 figure rows, or STEP 8.24 BLOCKED verdicts.
- Accessing `hyper-student-care`.

If a later STEP needs paid OCR, it must first report: purpose, why free/cache is insufficient, estimated calls, and max USD — then stop unless a human authorizes that STEP.

---

## Frozen facts this STEP must not mutate

| Fact | Source | Value |
|---|---|---|
| STEP 8.12 expected drafts | `src/lib/taxonomy/classificationPersistence.ts` `STEP812_EXPECTED_DRAFTS` | **265** |
| Frozen type AUTO | `src/lib/ingestion/step817Run.ts` `FROZEN_TYPE_AUTO` | **38** |
| Implied non-type-AUTO remainder | 265 − 38 | **227** |
| STEP 8.23 persisted figures | `ocr-tests/taxonomy/step8-23/production-completion.json` | **3 assets / 3 links** |
| STEP 8.24 remaining | `ocr-tests/taxonomy/step8-24/summary.json` | **8 BLOCKED**, 0 PASS, 0 REVIEW, 0 new persist, 0 paid calls |
| Paid routing flag | `src/lib/ingestion/adaptiveRouter.ts` | `paidOcrRoutingEnabled: false` |

Live Production counts from later book ingest (for example STEP 8.17 `FROZEN_DRAFTS = 728`) are **historical snapshots**. This freeze does not re-measure or rewrite them. Service-role in this Cloud Agent environment is a placeholder, so this STEP does not query Production.

---

## A. Data flow (frozen)

```
TEXTBOOK PDF (one or many files)
  → SOURCE_REGISTER     sha256 dedup, begin/finalize source_documents (STEP 5 RPCs)
  → PAGE_RENDER         immutable page images + geometry (source_pages)
  → SEGMENT             problem boxes (layoutSegment / segmentationV3 / problemAnchorV2)
  → STRUCTURE           stem, math, choices, answer, explanation drafts (STEP 6 recognition)
  → FIGURE_DETECT_LINK  visual figures + ownership (8.22 detect, 8.23/8.24 persist contract)
  → SELECTIVE_OCR       cache-first; paid only on low-confidence / math-dense / no-stem crops
  → DUAL_AI_REVIEW      two independent checkers; disagreement → HUMAN_REVIEW
  → IMAGE_COMPARE       crop vs original page region
  → CONFIDENCE_GATE     map to AUTO_APPROVED | HUMAN_REVIEW | BLOCKED | FAILED
  → PERSIST_DRAFT       existing RPCs only; never auto-VERIFIED
  → QUEUE_HUMAN         NEEDS_REVIEW items + BLOCKED reasons
  → LEARN_CORRECTIONS   (later STEP) reviewer edits feed thresholds — not this STEP
```

Free / local / cached work always runs. Paid OCR is a **branch**, never the trunk. Original PDFs and page renders are never overwritten.

Existing UI is **single PDF** (`src/features/sources/SourceNewPage.tsx`). Batch upload UI is a later STEP. This freeze defines the job model those screens must call.

---

## B. Stage contracts (reuse, do not fork)

| Stage | Existing implementation to reuse | Persist target |
|---|---|---|
| SOURCE_REGISTER | `hqb_find_source_by_sha256`, `hqb_begin_source_document`, `hqb_finalize_source_document` | `source_documents`, `source_pages`, Storage `question-bank-sources` (immutable original) |
| SEGMENT | `layoutSegment.ts` (`AUTO_OK` / `REVIEW`), `segmentationV3.ts`, `problemAnchorV2.ts`, crop gates | regions / bbox JSON; no Gold Standard verify |
| STRUCTURE | `problemPipeline.ts`, `bookPipeline.ts`, `hqb_save_recognition_result`, `hqb_upsert_problem_draft_from_identity` | `recognition_results` then DRAFT `problem_versions` |
| FIGURE | `visualFigureV1.ts`, `figurePersistence.ts`, `hqb_upsert_problem_figure` | `problem_figure_assets` / `problem_figure_links` (AUTO only today) |
| OCR | `paidGate.ts`, `hybridRouting.ts`, `adaptiveRouter.ts` (shadow only) | cached OCR artifacts; `recognition_results` |
| CLASSIFY | `hqb_upsert_problem_classification`, frozen 8.11 thresholds | classification on versions; AUTO_DISCOVERED ≠ APPROVED |
| REVIEW | `hqb_submit_for_review`, `hqb_verify_problem_version` | `reviews`; **human only** for `VERIFIED` |
| AUDIT | `audit_events` | every persist / reject / retry |

New tables (design only, **no migration in 8.25**):

- `pipeline_runs` — textbook job: source_document_id, status, progress JSON, estimated/actual cost, actor.
- `pipeline_items` — one row per candidate problem: stage, pipeline status, reasons, fingerprint keys, dual-review scores, cache keys.
- `ocr_result_cache` — provider + image/page hash → raw/normalized text; TTL optional; never a Gold Standard stem by itself.

When a later STEP adds them, migrations must be **additive-only** (no DROP/TRUNCATE, no rewrite of existing migrations).

---

## C. Status model (frozen)

Pipeline item status is **not** `problems.review_status`. Two layers stay distinct.

### C.1 Pipeline item status

| Status | Meaning | Terminal? |
|---|---|---|
| `AUTO_APPROVED` | Dual review + image compare + confidence gate passed. May persist as **DRAFT**. | Yes (for the pipeline) |
| `AI_FIXED` | A machine correction was applied (segmentation recovery, crop recovery, cached OCR refine). **Must re-enter the gate.** Cannot be a published Gold Standard status. | No (intermediate) |
| `HUMAN_REVIEW` | Ambiguous or disagreed. Draft may exist; item is in the review queue. | Yes until a human acts |
| `BLOCKED` | Safe persist is impossible until a named blocker is cleared (missing ingest, unpaid OCR, identity unstable, crop unsafe). | Yes until blocker cleared |
| `FAILED` | Pipeline exception / OCR engine failure / RPC error. Retry from last successful stage. No partial Gold Standard write. | Retryable |

`AI_FIXED` after re-gate becomes exactly one of: `AUTO_APPROVED` | `HUMAN_REVIEW` | `BLOCKED` | `FAILED`. It cannot remain `AI_FIXED` as the stored pipeline result.

### C.2 Mapping onto existing DB statuses

| Pipeline status | `problems.lifecycle_status` | `problems.review_status` / version | `use_status` | Figure `review_status` |
|---|---|---|---|---|
| `AUTO_APPROVED` | `DRAFT` | `AUTO_CLASSIFIED` or `UNREVIEWED` | `INTERNAL_ONLY` or `REVIEW_ONLY` | `AUTO` only if STEP 8.23 contract still holds |
| `AI_FIXED` (intermediate) | unchanged until re-gate | unchanged until re-gate | unchanged | unchanged |
| `HUMAN_REVIEW` | `DRAFT` if a draft exists | `NEEDS_REVIEW` | `REVIEW_ONLY` | not persisted unless AUTO-safe |
| `BLOCKED` | no new problem | no new review row required | n/a | no new asset/link |
| `FAILED` | no new problem | no new review row | n/a | no new asset/link |

**Hard rule:** the pipeline **never** sets `VERIFIED`, **never** sets `WORKSHEET_ELIGIBLE`, **never** calls `hqb_verify_problem_version`. That matches `docs/ARCHITECTURE.md` §7 and `docs/MANUAL_PROBLEM_WORKFLOW_v1.md`.

Shadow router `HUMAN_REVIEW` / `CURRENT_ONLY.would_auto_safe` are **inputs** to this mapping, not replacements for it.

---

## D. Approval criteria (AUTO_APPROVED)

All of the following are required. Missing any one → not `AUTO_APPROVED`.

1. Stable identity: source document + 1-based page + canonical problem number.
2. Crop/boundary safe (`FIGURE_CROP_SAFE` / not `CROP_UNSAFE`); neighbor body intrusion not blocking.
3. Stem completeness and structure confidence ≥ frozen router HIGH **0.78** (same band as `adaptiveRouter.ts` and STEP 8.11 type threshold).
4. If figures exist: ownership confidence ≥ **0.85** and persist path would pass `preflightFigure` (AUTO + crop-safe + owner).
5. Dual independent AI checkers **agree** on identity, stem/math/choices structure, and figure ownership. Scores both ≥ 0.78.
6. Original-image compare passes (crop still matches the source page region; no silent detach).
7. License/source on the document is not `UNKNOWN` when the item would leave `INTERNAL_ONLY` — v1 AUTO_APPROVED stays `INTERNAL_ONLY` even if license is known.
8. Idempotent persist keys are computable (see §F).
9. Paid OCR was **not** required, or was authorized in a **later** STEP within that STEP’s caps and the result is cached.

Disagreement, math conflict, figure ownership unresolved, or identity &lt; 0.5 → `HUMAN_REVIEW` (or `BLOCKED` if persist would be unsafe).

`AUTO_APPROVED` means “pipeline accepts a DRAFT”. It does **not** mean classroom-ready.

---

## E. Failure recovery

1. Every stage is **restartable** from the last successful `pipeline_items.stage` (design). Re-run must not create duplicate sources, drafts, or figures.
2. Reuse existing idempotent RPCs: `hqb_find_source_by_sha256`, `hqb_upsert_problem_draft_from_identity`, `hqb_upsert_problem_figure`.
3. `FAILED` retries the failed stage only. After N retries (v1: 3) the item stays `FAILED` with the error recorded; it does not become `AUTO_APPROVED`.
4. `BLOCKED` is not retried until the blocker changes (credentials, stem, human ingest). STEP 8.24’s 8 items stay BLOCKED here.
5. No DROP/TRUNCATE/bulk DELETE. No in-place overwrite of VERIFIED versions (`hqb_clone_problem_version` remains the edit path).
6. Original Storage objects are never updated (STEP 5 rule).

---

## F. Duplicate prevention

| Key | Existing hook | Rule |
|---|---|---|
| Source file | `hqb_find_source_by_sha256` | Same PDF bytes → reuse `source_documents.id`; do not begin a second original. |
| Problem identity | page + canonical number + `source_document_id` (`draftUpsert` / `hqb_upsert_problem_draft_from_identity`) | Same identity → upsert the DRAFT version, do not mint a new `problems.id`. |
| Figure pixels | `(source_document_id, page_number, source_hash)` unique index | Same crop hash → reuse `figure_id`; link, do not copy pixels. |
| Content | `content_fingerprints` (`NORMALIZED_TEXT`, `STRUCTURE`, `FILE_HASH`) | Exact/near duplicate → `HUMAN_REVIEW` with `duplicate_links` candidate; do not auto-merge. |
| Twin | `verified_problem_relations` | T1–RELATED only after **human** verify. Multimodal twin remains unimplemented. |

---

## G. Cost control

1. **Never** send all pages to paid OCR.
2. Paid candidates are only: `MATH_UNCERTAIN` with non-low math density, missing committed stem, or `HYBRID_SELECTIVE` / `MATHPIX_MATH` / `MISTRAL_STRUCTURE` from `routeShadow` — and only when cache miss.
3. Cache key = provider + crop/page sha256 + profile. Hit → 0 calls.
4. Before any network call: estimate calls + USD using `MATHPIX_OFFICIAL_PRICING` (`src/lib/ocr/costModel.ts`, $0.002/image typical, $0.005/page conservative). If estimate exceeds the STEP cap, **skip paid only**; free stages still finish.
5. Live calls still require `paidGate.ts`: not `--cache-only`, plus `--allow-paid-api` and `--i-understand-this-costs-money`, plus credentials.
6. This STEP cap is **0 calls / $0**. `PAID_OCR_ROUTING_ENABLED` remains false.
7. STEP 8.24 leftover estimate (not executed here): 5 unique pages ≈ 5 Mathpix calls ≈ **$0.025**, budget leftover from 8.24 was $1 / 8 calls. Still **not run**.

---

## H. Audit

Every persist, skip, blocker, retry, and human correction must append `audit_events` (`entity_type`, `entity_id`, `action`, `actor`, before/after JSON).

Pipeline-specific actions (design names): `PIPELINE_RUN_START`, `PIPELINE_STAGE_OK`, `PIPELINE_AUTO_APPROVED`, `PIPELINE_QUEUED_REVIEW`, `PIPELINE_BLOCKED`, `PIPELINE_FAILED`, `PIPELINE_OCR_CACHE_HIT`, `PIPELINE_OCR_SKIPPED_COST`, `PIPELINE_RETRY`.

Human edits in review (later STEP) are stored as new versions plus audit rows so they can train future gates. **8.25 does not implement learning.**

---

## I. Carry-over inputs (recorded, not processed)

STEP 8.24 BLOCKED candidates (`src/lib/ingestion/step823VerifiedPending.ts` `UNRESOLVED_PENDING_IDS`):

`108|0735`, `108|0736`, `114|0775`, `122|0833`, `134|0924`, `134|0925`, `134|0926`, `189|1300`.

Reasons (unchanged): `PROBLEM_NOT_INGESTED`, `NO_COMMITTED_STEM`, `NEEDS_PAID_OCR`.  
Figures already in Production (3/3) stay untouched.

A **later** STEP may ingest those problems and/or run paid OCR after an explicit cost report. Not 8.25.

---

## J. Later execution order (frozen plan — do not implement here)

| STEP | Scope | Writes Production? | Paid OCR? |
|---|---|---|---|
| **8.25** (this) | Design freeze + types + offline verify | No | No |
| **8.26** | `pipeline_runs` / `pipeline_items` additive schema + progress counters (no textbook run) | Schema only | No |
| **8.27** | Cache-only batch segmentation on **one** already-stored textbook | No new problems unless explicitly scoped | No |
| **8.28** | Structure stem/choices/answer/explanation from existing OCR/GT only | Drafts only if a later freeze allows | No |
| **8.29** | Dual-AI review pilot on cached artifacts | No Gold Standard verify | No unless a separate authorized freeze |
| **8.30** | Original-image compare gate | No | No |
| **8.31** | Confidence gate persist **DRAFT** + queue `HUMAN_REVIEW` | Drafts only, never VERIFIED | No by default |
| **8.32** | Full 192-page 쎈수학 공통수학1 ingest (user-redefined). Persist reviewable identities as DRAFT without requiring `AUTO_APPROVED`. Queue `NEEDS_REVIEW` / `HUMAN_REVIEW`. Never `VERIFIED`. See `docs/STEP8_32_FULL_SSEN_INGEST_v1.md`. | Drafts only, never VERIFIED | Cache-first Mistral via `paidGate`; no new paid signup |
| **8.33** | Auto QA + common-error correction + NEEDS_REVIEW clear + fingerprint/search prep on the STEP 8.32 SSEN drafts. Never `VERIFIED`. See `docs/STEP8_33_AUTO_QA_SEARCH_PREP_v1.md`. | Drafts only; may clear `NEEDS_REVIEW` → `AUTO_CLASSIFIED`; never VERIFIED | No paid OCR |
| *(unnumbered until frozen)* | Remaining 8 figures after ingest | Figure RPC only | Report-then-stop |
| *(unnumbered until frozen)* | Multimodal twin / print-edit | No | No |

Each later STEP gets its own spec, like 8.24, and must keep this freeze’s status mapping and cost rules.

---

## K. Acceptance criteria (STEP 8.25 complete when)

1. This document is on the branch and describes flow, statuses, approval, recovery, dedup, cost, audit, and 8.26+ order.
2. Typed module `src/lib/ingestion/batchPipeline825.ts` encodes the status model, Gold Standard mapping, paid-OCR deny rules, dual-review combine, and frozen counts — **no Production client, no network.**
3. Unit tests prove: five statuses are distinct; `AUTO_APPROVED` never maps to `VERIFIED` or `WORKSHEET_ELIGIBLE`; `AI_FIXED` is re-gated; paid OCR is unauthorized; the 8 STEP 8.24 IDs remain BLOCKED carry-over; 265 / 38 / 227 frozen counts are unchanged.
4. `npm run verify:step825` PASSes offline.
5. `npm run typecheck`, `npm test` (no new failures introduced), `npm run lint`, `npm run build` PASS.
6. Production writes = 0, paid API calls = 0, student-care access = false.

---

## Target

- Repository: `hyper-question-bank`
- Production ref: `owpxsmdcxjmsgadkdsci` (not queried this STEP)
- Student Care: never

## Artifacts

- `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` (this file)
- `src/lib/ingestion/batchPipeline825.ts`
- `src/lib/ingestion/batchPipeline825.test.ts`
- `scripts/verify-step825.mjs`
- `scripts/step-8.25.mjs`
- `ocr-tests/taxonomy/step8-25/summary.json`
- `ocr-tests/taxonomy/step8-25/step8-25-summary.md`
