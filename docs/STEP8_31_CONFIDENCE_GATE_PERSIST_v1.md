# STEP 8.31 — Confidence Gate + DRAFT Persist + HUMAN_REVIEW Queue v1

STATUS: **implemented (confidence gate on the STEP 8.28–8.30 26-item SSEN corpus; recovered crops from a hash-checked original + declared bbox may queue HUMAN_REVIEW; AUTO_APPROVED DRAFT persist only if 8.25 §D all hold; paid OCR stays 0 / $0)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.31**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production Supabase ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE: never accessed.

This freeze **explicitly allows** the confidence gate, idempotent `pipeline_items` HUMAN_REVIEW queue, and DRAFT persist **only** for true `AUTO_APPROVED`. It does **not** start STEP 8.32. It does **not** set `VERIFIED` or `WORKSHEET_ELIGIBLE`. It does **not** auto-merge. It does **not** authorize paid OCR.

---

## Why this STEP number

`origin/main` contains STEP 8.30 (PR #14 merged). Design Freeze §J next unused row is **8.31**:

> Confidence gate persist **DRAFT** + queue `HUMAN_REVIEW` | Drafts only, never VERIFIED | No by default

STEP 8.30’s start condition: 8.31 may begin only after 8.30 is on `main`. **8.30 is on `main`.** This document is the 8.31 freeze. Paid OCR stays **0 calls / $0**.

---

## Goal (this STEP only)

Run the frozen confidence gate on **all 26** STEP 8.28 / 8.29 / 8.30 candidates (`S01`–`S26`) in one batch. Classify each item as exactly one of:

- `AUTO_APPROVED`
- `HUMAN_REVIEW`
- `BLOCKED`

Then:

1. Persist a **DRAFT** only when the item is `AUTO_APPROVED` and every 8.25 §D clause holds.
2. Register `HUMAN_REVIEW` items on `pipeline_items` (idempotent). Record an existing Production identity when one already matches. Do **not** mint a new `problems.id` for HUMAN_REVIEW.
3. Leave `BLOCKED` items unpersisted as problems.

Never set `VERIFIED`. Never rewrite existing Gold Standard content. Never process the full 192-page textbook.

## Why STEP 8.30 was 26 BLOCKED

STEP 8.30 required gitignored STEP 7 crops at `workers/ocr/data/crops/S01.png`–`S26.png`. Those files are **absent** (`CROP_CACHE_MISSING`). Page PNGs and figure crops must not be substituted.

This freeze may **regenerate** problem-region crops only when **all** of the following are evidenced:

1. Original SSEN PDF bytes exist and SHA256 is `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`.
2. Declared bbox for that sample exists in `workers/ocr/samples.json` / `workers/ocr/corpus-manifest.json`.
3. Coordinate system is frozen: `unit=normalized`, `origin=top-left`.
4. Output is written under gitignored `.ocr-temp/step8-31/` (never into `workers/ocr/data/crops/`).

Recovered crop SHA256 is recorded separately. It is **not** allowed to overwrite `corpus-manifest.json` `crop_sha256`. A recovered crop that does **not** match the frozen STEP 7 hash is evidence for HUMAN_REVIEW, **never** for `AUTO_APPROVED`. Full-page PNGs are never used as a problem crop.

If the original PDF is missing or the hash mismatches, crops stay missing and those items stay `BLOCKED`.

## Inputs (cached first)

| Source | Path | Count |
|---|---|---|
| STEP 8.28 structure | `ocr-tests/taxonomy/step8-28/items.json` | **26** |
| STEP 8.29 dual-AI | `ocr-tests/taxonomy/step8-29/reviews.json` | **26** |
| STEP 8.30 compare | `ocr-tests/taxonomy/step8-30/compares.json` | **26** (all `image_compare_pass=false`) |
| Frozen GT | `workers/ocr/ground-truth.json` | **26**, SHA256 `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb` |
| Manifest bbox + frozen crop hashes | `workers/ocr/corpus-manifest.json` | **26** |
| Sample bbox | `workers/ocr/samples.json` | **26** |
| Optional recovered crops | `.ocr-temp/step8-31/crops/Sxx.png` | 0–26, gitignored |
| Optional cached OCR | `.ocr-temp/step8-31/mistral/*.json` | cache-hit only; miss ≠ network |

Textbook locked: 쎈수학 공통수학1, `source_document_id` `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`, 192 pages.

Excluded: SECOND book `190fb31b-03f5-43b9-b696-cce7a823a321`. STEP 8.22 figure crops and SSEN page PNGs are **not** S01–S26 substitutes. STEP 8.24 eight ids stay carry-over BLOCKED and are not in this 26.

## Confidence gate (not relaxed)

8.25 §D `AUTO_APPROVED` requires **all** of:

1. Stable identity: source + 1-based page + canonical 4-digit problem number.
2. Crop/boundary safe; neighbor intrusion not blocking.
3. Stem/structure confidence ≥ **0.78**.
4. If figures exist: ownership ≥ **0.85** and AUTO-safe persist path.
5. Dual independent checkers agree; all four fields ≥ 0.78 both sides.
6. Original-image compare **pass** (frozen STEP 7 crop hash match **and** visual checks PASS).
7. v1 AUTO stays `INTERNAL_ONLY`.
8. Idempotent persist keys computable.
9. Paid OCR was not required, or was authorized in a later STEP (this freeze: **not authorized**).

Missing any one → not `AUTO_APPROVED`.

STEP 8.30 failed original-image compare for every sample (`CROP_CACHE_MISSING`, `image_compare_pass=false`). **Do not AUTO_APPROVE those items on confidence score alone.** Recovered-crop hash mismatch is `CROP_HASH_MISMATCH` relative to the frozen STEP 7 bytes.

| Evidence | Pipeline status | Persist |
|---|---|---|
| Identity unstable / null number (S02, S03, S16, S24) | `BLOCKED` | `SKIP_BLOCKED` |
| Crop still missing and original PDF not hash-verified | `BLOCKED` | `SKIP_BLOCKED` |
| Page PNG / figure crop offered as `Sxx` | `BLOCKED` | `SKIP_BLOCKED` |
| Recovered crop from hash-checked original + bbox; identity present; §D incomplete | `HUMAN_REVIEW` | `RECORD_EXISTING` if a DRAFT already matches; else `QUEUE_ONLY` or `SKIP_IDENTITY` (non-canonical) |
| Non-canonical number (`01-1`, `08-4`, `08-5`) with reviewable crop | `HUMAN_REVIEW` | `SKIP_IDENTITY` |
| Cached OCR miss (no paid call) | stays `HUMAN_REVIEW` or `BLOCKED` as above | never AUTO |
| Every §D clause including frozen crop hash + image compare PASS | `AUTO_APPROVED` | idempotent DRAFT upsert |

`AI_FIXED` is not stored. Machine rewrite of stem/choices/math/GT is forbidden.

`mapToGoldStandard('HUMAN_REVIEW').persistDraft` is **stricter here**: HUMAN_REVIEW does **not** create a new problem row. It may attach an already-existing identity onto `pipeline_items`.

## Production write policy

Read-only preflight (counts + existing identity lookup) is required before writes. A snapshot is stored under `ocr-tests/taxonomy/step8-31/production-before.json`.

Allowed:

- `AUTO_APPROVED` → `hqb_upsert_problem_draft_from_identity` as **DRAFT** only (idempotent). Never `VERIFIED`.
- `HUMAN_REVIEW` / `BLOCKED` → `hqb_start_pipeline_run` + `hqb_upsert_pipeline_item` (`assigned_by=STEP_8_31`). Idempotent on `(run, candidate_id)`.

Forbidden:

- `hqb_verify_problem_version`
- `WORKSHEET_ELIGIBLE`
- DELETE / TRUNCATE
- Content rewrite of existing drafts
- Unrelated edits to the historical 757/761 DRAFT set or the frozen 38 type AUTO rows
- Duplicate INSERT of the same identity
- Student Care
- Schema-destructive migrations
- Copying recovered PNGs into git or into `workers/ocr/data/crops/`

Expected this freeze given current evidence (recovered hashes ≠ frozen STEP 7 hashes, 8.30 compare fail, dual not unanimous, some identity unstable):

- `AUTO_APPROVED` = **0**
- Production **problem** writes = **0**
- HUMAN_REVIEW queue rows = **22** when 26 recovered crops exist
- BLOCKED = **4** (`S02`, `S03`, `S16`, `S24`)

Live Production counts are read-only snapshots. Frozen historical counts stay 265 / 38 / 227 / 3 / 3 / 8. Do not restore live DRAFT counts.

## OCR / paid API policy

- Cap: **0 calls / $0**
- New Mathpix = 0, new Mistral = 0
- `--allow-paid-api` is rejected
- Cache hit of a previous run may be **read** for HUMAN_REVIEW diagnostics. Cache miss must not fall through to a network call.
- A present `MISTRAL_API_KEY` is recorded as `PRESENT` / `ABSENT` only. Never log the key, a substring, length, or prefix.

## PASS / REVIEW / BLOCKED (this STEP targets)

Item-level `HUMAN_REVIEW` is pipeline status, not a target REVIEW.

| Target | Verdict | Why |
|---|---|---|
| `target.lock` | PASS | SSEN document locked |
| `cache.step828` | PASS if 26 cached items | Required input |
| `cache.step829` | PASS if 26 dual reviews | Required input |
| `cache.step830` | PASS if 26 compares | Required input |
| `execute.gate` | PASS if dry-run PASSes and 26 gate records written | Local artifacts |
| `mixed_source` | PASS | SECOND excluded; no crop substitute |
| `gold_verify_denied` | PASS | No Gold Standard verify |
| `frozen_counts` | PASS | 265 / 38 / 227 / 3 / 3 unchanged |
| `auto_gate` | PASS | 0 AUTO unless §D all hold |
| `draft_policy` | PASS | Problem writes only for AUTO_APPROVED |
| `original_pdf` | PASS if frozen hash matches; else BLOCKED | Required to regen crops |
| `recovered_crops` | PASS if 26 recovered from PDF+bbox; else BLOCKED | Never invent |
| `full_textbook` | BLOCKED | 26 cached samples only |
| `paid_ocr` | BLOCKED | Cap 0 / $0 |
| STEP 8.24 eight ids | BLOCKED | Carry-over |

No target REVIEW. Confidence is not relaxed.

## Frozen counts (must not change)

265 valid DRAFT (freeze), 38 type AUTO, 227 remainder, 3 figure assets, 3 figure links, 8 STEP 8.24 BLOCKED ids.

GT JSON SHA256 `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb` must not mutate. Manifest crop hashes must not be rewritten to recovered hashes.

## Next STEP start condition (do not start here)

STEP **8.32** (reviewer correction → feature store) may begin only after 8.31 is on `main`. This PR does not start 8.32. Do not start 8.32.

## Artifacts

- `docs/STEP8_31_CONFIDENCE_GATE_PERSIST_v1.md` (this file)
- `src/lib/ingestion/confidenceGate831.ts`
- `src/lib/ingestion/step831Run.ts`
- `scripts/generate-step831-crops.py` (regen from verified PDF + bbox only)
- `scripts/verify-step831.mjs`
- `ocr-tests/taxonomy/step8-31/*` (JSON/MD only; no PDF, no PNG, no raw OCR blobs)
