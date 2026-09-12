# STEP 8.29 — Dual-AI Review Pilot on Cached Artifacts v1

STATUS: **implemented (cache-only dual review of the STEP 8.28 26-item corpus; no Gold Standard verify)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.29**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE: never accessed.

This freeze **explicitly allows dual-AI review on cached artifacts** for the STEP 8.28 / STEP 7 SSEN corpus only. It does **not** start STEP 8.30. It does **not** persist drafts. It does **not** verify Gold Standard. It does **not** authorize paid OCR.

---

## Why this STEP number

`origin/main` contains STEP 8.28 (PR #12 merged). Design Freeze §J next unused row is **8.29**:

> Dual-AI review pilot on cached artifacts | No Gold Standard verify | No unless a separate authorized freeze

STEP 8.28’s start condition: 8.29 may begin only after 8.28 is on `main`. **8.28 is on `main`.** This document is the 8.29 freeze. There is **no** separate freeze authorizing paid OCR, so the 8.29 paid cap is **0 calls / $0**.

---

## Goal (this STEP only)

Run **two independent checkers (A, B)** on the **26 STEP 8.28 cached items** joined to frozen STEP 7 GT:

- identity
- stem / choices structure
- math
- figure ownership

Record, for each item: both scores, agreement, field diffs, and final pipeline status. Checkers **score** cached text. They do **not** invent or rewrite stem, choices, math, or explanation.

## Inputs (cached only)

| Source | Path | Count |
|---|---|---|
| STEP 8.28 structure artifacts | `ocr-tests/taxonomy/step8-28/items.json` | **26** |
| Frozen GT | `workers/ocr/ground-truth.json` | **26**, SHA256 `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb` |
| Textbook | `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` 쎈수학 공통수학1 | locked |

Not used (missing or wrong book; do not OCR to fill):

- `ocr-tests/mistral` layout cache / `stage-b-candidates.json`
- Production `recognition_results` bulk dump
- SECOND book `190fb31b-03f5-43b9-b696-cce7a823a321`
- Page PNGs / original PDF (image compare is STEP 8.30)

## Checkers (no network)

| Checker | Evidence | Independence |
|---|---|---|
| **A** | Declared GT fields only (`problem_number`, `ground_truth_choices`, `ground_truth_math`, `has_figure`) | Metadata path |
| **B** | Existing in-repo parsers on the **same** GT text (`extractScanProblemNumber`, `extractChoices`, `extractMath`) | Parse path |

Parsers are gate helpers. Parsed output never replaces GT. Thresholds stay frozen: `CONFIDENCE_HIGH = 0.78`, `FIGURE_OWNERSHIP_MIN = 0.85`.

Figure ownership cannot be proven from text-only cache (no crop, no 8.23 persist path). If `has_figure`, both checkers score ownership **0.40** (below 0.78). If no figure, ownership is vacuously **1.00**.

## Status mapping (frozen names, not relaxed)

`dualReviewAgrees` from `batchPipeline825.ts` is the agreement predicate. `combineDualReview` returning `AUTO_APPROVED` is **evidence only** (`dual_would_auto`).

8.25 §D AUTO_APPROVED requires dual agreement **and** crop safety **and** original-image compare (STEP 8.30) **and** the rest of the gate. This STEP does not run image compare. **Stored pipeline status is never `AUTO_APPROVED`.**

| Dual / upstream | Pipeline status this STEP | Why |
|---|---|---|
| STEP 8.28 `BLOCKED` (identity unstable) | `BLOCKED` | Upstream blocker; dual recorded but does not clear it |
| Fingerprint ≠ GT | `BLOCKED` | `CONTENT_FINGERPRINT_DRIFT` |
| Dual agrees (all four fields ≥ 0.78 both checkers) | `HUMAN_REVIEW` | `DUAL_AGREE` + `IMAGE_COMPARE_NOT_RUN` + `NO_AUTO_APPROVED_IN_8_29` |
| Dual disagrees or any field &lt; 0.78 | `HUMAN_REVIEW` | `DUAL_DISAGREE` |
| Exception | `FAILED` | Retry from `DUAL_AI_REVIEW` only |
| STEP 8.24 eight ids | `BLOCKED` | Carry-over; not in this 26-sample cache |

Never set `VERIFIED` or `WORKSHEET_ELIGIBLE`. Never persist drafts. `AI_FIXED` is not used (no machine rewrite).

## Production write policy

Forbidden: INSERT/UPDATE/DELETE of `problems`, `problem_versions`, reviews, figures, taxonomy, `pipeline_runs`, `pipeline_items`. No Gold Standard verify. No RPCs that persist.

Read-only Production probes are allowed for count verification. Live DRAFT 757 is later ingest beyond frozen 265. Do not restore.

## OCR / paid API policy

- Cap: **0 calls / $0**
- New Mathpix = 0, new Mistral = 0
- `--allow-paid-api` is rejected
- A present `MISTRAL_API_KEY` does **not** authorize calls. No separate freeze opened the cap.
- Cache miss must not fall through to a network call

## PASS / REVIEW / BLOCKED (this STEP)

| Target | Verdict | Why |
|---|---|---|
| `target.lock` | PASS | SSEN document locked |
| `cache.step828` | PASS if 26 cached items + GT hash match | Required input |
| `execute.dual` | PASS if dry-run PASSes and 26 dual records written once | Local artifacts only |
| `mixed_source` | PASS | SECOND excluded |
| `problem_writes` | PASS | Writes = 0 |
| `draft_persist_denied` | PASS | Drafts not allowed |
| `gold_verify_denied` | PASS | No Gold Standard verify |
| `frozen_counts` | PASS | 265 / 38 / 227 / 3 / 3 unchanged |
| `full_textbook` | BLOCKED | 26 cached samples only |
| `paid_ocr` | BLOCKED | Cap 0 / $0; no separate freeze |
| `original_pdf` | BLOCKED | Not required; never substituted |
| STEP 8.24 eight ids | BLOCKED | Carry-over |

No REVIEW targets. Confidence is not relaxed. Item-level `HUMAN_REVIEW` is pipeline status, not a target REVIEW.

## Frozen counts (must not change)

265 valid DRAFT (freeze), 38 type AUTO, 227 remainder, 3 figure assets, 3 figure links, 8 STEP 8.24 BLOCKED ids.

Live DRAFT 757 / pipeline 0/0 are read-only snapshots.

## Next STEP start condition (do not start here)

STEP **8.30** may begin only after 8.29 is on `main`: original-image compare gate on cached crops. No paid OCR. This PR does not start 8.30. Do not start 8.30.

## Artifacts

- `docs/STEP8_29_DUAL_AI_REVIEW_v1.md` (this file)
- `src/lib/ingestion/dualAiReview829.ts`
- `src/lib/ingestion/step829Run.ts`
- `scripts/verify-step829.mjs`
- `ocr-tests/taxonomy/step8-29/*`
