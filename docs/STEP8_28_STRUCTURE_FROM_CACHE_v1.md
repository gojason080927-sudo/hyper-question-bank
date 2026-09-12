# STEP 8.28 — Structure From Existing OCR/GT v1

STATUS: **implemented (cache-only structure of the frozen STEP 7 GT corpus; Production drafts not written)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.28**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE: never accessed.

This freeze **explicitly allows structure-from-cache** for the STEP 7 SSEN ground-truth corpus only. It does **not** start STEP 8.29. It does **not** persist drafts.

---

## Why this STEP number

`origin/main` already contains STEP 8.25 (PR #7), STEP 8.26 (PR #8), and STEP 8.27 (PR #9 / #10). The Design Freeze §J next unused row is **8.28**:

> Structure stem/choices/answer/explanation from existing OCR/GT only | Drafts only if a later freeze allows | No

STEP 8.27’s start condition: 8.28 may begin only after 8.27 is on `main` **and** a later freeze explicitly allows structure-from-cache. 8.27 is on `main`. **This document is that later freeze.** It does not reopen 8.27 paid OCR (cap remains 0 / $0). It does not fill layout OCR cache.

---

## Goal (this STEP only)

Project **existing** OCR/GT into pipeline `STRUCTURE` records:

- stem
- choices
- answer (only if an explicit `정답:` / `답:` line exists in the GT text)
- explanation (not invented; STEP 7 GT has none → `null`)

Do **not** persist `problems` / `problem_versions`. Do **not** call paid OCR. Do **not** run the full textbook.

## Documented GT (not a guess)

| Field | Value | Evidence |
|---|---|---|
| Document ID | `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` | STEP 8.8–8.27 SSEN; `workers/ocr/corpus-manifest.json` |
| Title | 쎈수학 공통수학1 | same |
| GT file | `workers/ocr/ground-truth.json` | corpus-manifest `ground_truth_file` |
| Sample count | **26** | corpus-manifest `sample_count` |
| File SHA256 | `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb` | sha256 of the JSON bytes on `main` |
| Excluded book | `190fb31b-03f5-43b9-b696-cce7a823a321` (SECOND) | STEP 8.27 |

The manifest field `ground_truth_version` is a STEP 7 crop-set label, **not** the SHA256 of this JSON. 8.28 freezes the JSON bytes above. Do not rewrite the manifest.

Not used as the 8.28 corpus (would guess a subset or the wrong book):

- 9 SSEN figure-recovery PNGs under `ocr-tests/taxonomy/step8-22/pages/ssen/`
- STEP 8.18 SECOND pages + `_sample-layout-raw.json`
- Missing `ocr-tests/mistral` layout cache / `stage-b-candidates.json` (8.27 BLOCKED inputs)
- Live Production `recognition_results` bulk dump (not a frozen GT set; not executed here)

## Original PDF

Not required. Structure reads GT text already stored in git. The original PDF is **never substituted**. SECOND hash `3b4e789e…` is not this textbook.

## Production write policy

Forbidden: INSERT/UPDATE/DELETE of `problems`, `problem_versions`, answers, explanations, taxonomy, figures, `pipeline_runs`, `pipeline_items`.

STEP 8.25 §J: “Drafts only if a later freeze allows.” **This freeze does not allow drafts.** `mapToGoldStandard('HUMAN_REVIEW').persistDraft` is ignored.

Read-only Production probes are allowed for count verification. Live DRAFT totals that differ from frozen 265 are historical snapshots (STEP 8.17 `FROZEN_DRAFTS = 728` and later ingest). Do not restore or rewrite them.

## OCR policy

- Cap: **0 calls / $0**
- New Mathpix = 0, new Mistral = 0, other paid OCR = 0
- `--allow-paid-api` is rejected
- A present `MISTRAL_API_KEY` does **not** authorize calls. Freeze cap is zero.
- Cache miss must not fall through to a network call

## Status mapping (frozen names, not relaxed)

Pipeline statuses remain: `AUTO_APPROVED` | `AI_FIXED` | `HUMAN_REVIEW` | `BLOCKED` | `FAILED`.

| Structure result | Pipeline status this STEP | Why |
|---|---|---|
| Stable identity + non-empty GT stem | `HUMAN_REVIEW` | Dual review, image compare, and confidence gate are later STEPs. `AUTO_APPROVED` is forbidden here. Draft persist is off. |
| `problem_number` null (sidebar / formula sheet) | `BLOCKED` | `IDENTITY_UNSTABLE` |
| Empty stem | `BLOCKED` | `NO_COMMITTED_STEM` |
| Exception | `FAILED` | Retry from STRUCTURE only. |
| STEP 8.24 eight ids | `BLOCKED` | Carry-over; not in this 26-sample GT |

Never set `VERIFIED` or `WORKSHEET_ELIGIBLE`. Never auto-advance into STEP 8.29.

`AI_FIXED` is not used: GT text is copied, not machine-corrected.

## Content immutability

- GT `ground_truth_text`, `ground_truth_choices`, `ground_truth_math` are copied, not rewritten.
- `recognizeFromOcrText` may be used only as a **gate helper** (warnings / completeness). It must not replace GT stem or shuffle choices.
- Answers are copied only from an explicit `정답:` / `답:` line. The engine does not solve.
- Explanations are not invented.

## Idempotency / resume

- Local upsert keys on `candidate_id` = STEP 7 `sample_id` (`S01`…`S26`).
- `assigned_by = STEP_8_28`.
- Re-run rewrites artifacts only; Production rows stay 0.
- Resume stays at stage `STRUCTURE`. This STEP does not start `DUAL_AI_REVIEW`.

## PASS / REVIEW / BLOCKED (this STEP)

| Target | Verdict | Why |
|---|---|---|
| `target.lock` | PASS | SSEN document locked |
| `cache.gt` | PASS if 26-item GT hash matches | Existing OCR/GT |
| `execute.structure` | PASS if dry-run PASSes and 26 items projected once | Local artifacts only |
| `mixed_source` | PASS | SECOND excluded |
| `problem_writes` | PASS | Writes = 0 |
| `draft_persist_denied` | PASS | Freeze: drafts not allowed |
| `frozen_counts` | PASS | 265 / 38 / 227 / 3 / 3 unchanged |
| `full_textbook` | BLOCKED | Out of scope; 26 GT samples only |
| `paid_ocr` | BLOCKED | Cap 0 / $0 |
| `original_pdf` | BLOCKED | Not required; never substituted |
| STEP 8.24 eight ids | BLOCKED | Carry-over |

No REVIEW targets. Confidence is not relaxed.

## Frozen counts (must not change)

265 valid DRAFT, 38 type AUTO, 227 remainder, 3 figure assets, 3 figure links, 8 STEP 8.24 BLOCKED ids.

Do not invent or restore Production numbers. If live counts differ, investigate; do not mutate.

## Next STEP start condition (do not start here)

STEP **8.29** may begin only after 8.28 is on `main`: dual-AI review pilot on **cached** artifacts. No Gold Standard verify. No paid OCR unless a separate authorized freeze. This PR does not start 8.29. Do not start 8.29.

## Artifacts

- `docs/STEP8_28_STRUCTURE_FROM_CACHE_v1.md` (this file)
- `src/lib/ingestion/structureFromCache828.ts`
- `src/lib/ingestion/step828Run.ts`
- `scripts/verify-step828.mjs`
- `ocr-tests/taxonomy/step8-28/*`
