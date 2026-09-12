# STEP 8.30 — Original-Image Compare Gate on Cached Crops v1

STATUS: **implemented (cache-only original-image compare gate on the STEP 8.28 / 8.29 26-item corpus; missing STEP 7 crops are BLOCKED, never PASS)**  
Implements: `docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md` §J row **8.30**.

Repository: `gojason080927-sudo/hyper-question-bank`  
Production ref: `owpxsmdcxjmsgadkdsci`  
HYPER STUDENT CARE: never accessed.

This freeze **explicitly allows original-image compare on cached crops** for the STEP 8.28 / STEP 7 SSEN corpus only. It does **not** start STEP 8.31. It does **not** persist drafts. It does **not** verify Gold Standard. It does **not** authorize paid OCR. It does **not** guess, generate, or substitute missing originals or crops.

---

## Why this STEP number

`origin/main` contains STEP 8.29 (PR #13 merged). Design Freeze §J next unused row is **8.30**:

> Original-image compare gate | No | No

STEP 8.29’s start condition: 8.30 may begin only after 8.29 is on `main`. **8.29 is on `main`.** This document is the 8.30 freeze. Paid OCR stays **0 calls / $0**.

---

## Goal (this STEP only)

Compare **structured pipeline results** (STEP 8.28 items + STEP 8.29 dual review) against **git or existing-cache original images / STEP 7 crops** for the same 26 `S01`–`S26` samples.

Per sample, record:

- problem boundary and number
- stem missing / added / order
- choice count / content / order
- math / symbols / exponents / fractions / signs
- table / graph / figure presence and ownership
- crop neighbor intrusion or cut content

Do **not** rewrite stem, choices, math, explanation, GT, or original pixels. Checkers **score existence and compare status**. Missing original or crop → **BLOCKED**, never PASS, never `AUTO_APPROVED`.

## Inputs (cached only)

| Source | Path | Count |
|---|---|---|
| STEP 8.28 structure artifacts | `ocr-tests/taxonomy/step8-28/items.json` | **26** |
| STEP 8.29 dual-AI reviews | `ocr-tests/taxonomy/step8-29/reviews.json` | **26** |
| Frozen GT | `workers/ocr/ground-truth.json` | **26**, SHA256 `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb` |
| Crop inventory (hashes only in git) | `workers/ocr/corpus-manifest.json` `crop_file` / `crop_sha256` | **26** expected at `workers/ocr/data/crops/Sxx.png` |
| Textbook | `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` 쎈수학 공통수학1 | locked |

Required STEP 7 crops are gitignored (`workers/ocr/data/`). This freeze inventories them. It does **not** recreate them.

Not used as a S01–S26 crop substitute (wrong id, wrong book, or guessed subset):

- 9 SSEN figure-recovery page PNGs under `ocr-tests/taxonomy/step8-22/pages/ssen/` — may be recorded as **page PNG presence** for pages 12 and 20 only; never cropped, never hashed as `Sxx.png`
- STEP 8.22 figure crops under `ocr-tests/taxonomy/step8-22/crops/` (ids such as `12-0045`, `108-0735`) — different candidate ids, including STEP 8.24 carry-over; never mapped onto `S01`–`S26`
- STEP 8.18 SECOND pages — book `190fb31b-03f5-43b9-b696-cce7a823a321`
- Missing `ocr-tests/original` and `ocr-tests/book-pipeline/pages`
- Production Storage original PDF download
- Paid OCR / vision to fill a miss

## Compare rules (no network, no pixel invention)

| Check | PASS only if | This freeze when crop is absent |
|---|---|---|
| Identity / number | Crop pixels readable and match canonical number | `NOT_COMPARED` |
| Stem completeness / order | Crop pixels readable; no silent add/drop | `NOT_COMPARED` |
| Choices count / content / order | Crop pixels readable; count and order match structure | `NOT_COMPARED` |
| Math / exponents / fractions / signs | Crop pixels readable; GT math not rewritten | `NOT_COMPARED` |
| Figure / table / graph ownership | Crop pixels readable; figure belongs to this item | `NOT_COMPARED` |
| Boundary / neighbor / cut content | Crop + page region; no intrusion; bbox still attached | `NOT_COMPARED` |
| Crop sha256 | File present and matches `corpus-manifest.json` | fail closed → `CROP_CACHE_MISSING` |

`image_compare_pass` is **true** only when every visual check above is PASS **and** crop sha256 matches **and** the page original exists for detach detection.

STEP 8.25 paid cap for 8.30 is **No**. This freeze does **not** call Mistral, Mathpix, or any vision OCR to read pixels. Therefore visual checks cannot PASS even if a crop file later appears, unless a **later** freeze authorizes pixel reading. Crop-hash match alone is **not** original-image compare PASS.

Declared bboxes in the manifest may be checked geometrically (overlap / empty). That metadata check is **not** a pixel compare and does **not** clear `CROP_CACHE_MISSING`.

## Status mapping (frozen names, not relaxed)

8.25 §D AUTO_APPROVED requires stable identity, crop/boundary safe, stem/structure ≥ 0.78, figure ownership ≥ 0.85 if figures, dual AI agree ≥ 0.78, **original-image compare pass**, license rule, idempotent keys, and paid OCR not required. Missing any one → not `AUTO_APPROVED`.

| Evidence | Pipeline status this STEP | Why |
|---|---|---|
| Crop file missing | `BLOCKED` | `CROP_CACHE_MISSING` — cannot PASS |
| Page original missing (additional) | stays `BLOCKED` | `ORIGINAL_PAGE_MISSING` recorded; not a substitute crop |
| Page PNG present but not the STEP 7 crop | stays `BLOCKED` if crop missing | `PAGE_PNG_NOT_USED_AS_CROP` |
| Figure crop / SECOND page offered as `Sxx` | `BLOCKED` | `NO_SUBSTITUTE` |
| Crop present, sha256 mismatch | `BLOCKED` | `CROP_HASH_MISMATCH` |
| Crop present, hash OK, pixels unread (no OCR) | `HUMAN_REVIEW` | `IMAGE_COMPARE_PIXELS_UNREADABLE_WITHOUT_OCR` — not AUTO |
| STEP 8.28 / 8.29 `BLOCKED` (identity unstable) | `BLOCKED` | `UPSTREAM_BLOCKED` plus crop reasons |
| Fingerprint ≠ GT | `BLOCKED` | `CONTENT_FINGERPRINT_DRIFT` |
| Dual would-auto and image compare PASS and all §D | `AUTO_APPROVED` | Allowed by 8.25 **only** if every §D clause holds |
| STEP 8.24 eight ids | `BLOCKED` | Carry-over; not in this 26-sample cache |

This corpus currently has **0** STEP 7 crop files on disk. Stored pipeline status is therefore **26 `BLOCKED`**, **0 `AUTO_APPROVED`**, **0 `HUMAN_REVIEW`**. Dual `dual_would_auto` from 8.29 remains evidence only.

Never set `VERIFIED` or `WORKSHEET_ELIGIBLE`. Never persist drafts. `AI_FIXED` is not used (no machine rewrite).

## Production write policy

Forbidden: INSERT/UPDATE/DELETE of `problems`, `problem_versions`, reviews, figures, taxonomy, `pipeline_runs`, `pipeline_items`. No persist RPCs. No Gold Standard verify.

Read-only Production probes are allowed for count verification. Live DRAFT 757 is later ingest beyond frozen 265. Do not restore.

Expected live snapshot (read-only): DRAFT **757**, type AUTO **38**, figure assets/links **3/3**, STEP 8.24 BLOCKED **8**, `pipeline_runs` / `pipeline_items` **0/0**.

## OCR / paid API policy

- Cap: **0 calls / $0**
- New Mathpix = 0, new Mistral = 0
- `--allow-paid-api` is rejected
- A present `MISTRAL_API_KEY` is recorded as presence `PRESENT`/`ABSENT` only. Never log the key, a substring, length, or prefix.
- Presence does **not** authorize calls. No separate freeze opened the cap.
- Cache miss must not fall through to a network call

## PASS / REVIEW / BLOCKED (this STEP)

| Target | Verdict | Why |
|---|---|---|
| `target.lock` | PASS | SSEN document locked |
| `cache.step828` | PASS if 26 cached items | Required input |
| `cache.step829` | PASS if 26 dual reviews | Required input |
| `execute.compare` | PASS if dry-run PASSes and 26 compare records written once | Local artifacts only; item BLOCKED is not a target REVIEW |
| `mixed_source` | PASS | SECOND excluded; 8.22 figure crops not substituted |
| `problem_writes` | PASS | Writes = 0 |
| `draft_persist_denied` | PASS | Drafts not allowed (8.31) |
| `gold_verify_denied` | PASS | No Gold Standard verify |
| `frozen_counts` | PASS | 265 / 38 / 227 / 3 / 3 unchanged |
| `full_textbook` | BLOCKED | 26 cached samples only |
| `paid_ocr` | BLOCKED | Cap 0 / $0 |
| `original_pdf` | BLOCKED | Not downloaded; never substituted |
| `step7_crops` | BLOCKED | `CROP_CACHE_MISSING` / `NO_SUBSTITUTE` |
| STEP 8.24 eight ids | BLOCKED | Carry-over |

No REVIEW targets. Confidence is not relaxed. Item-level `HUMAN_REVIEW` would be pipeline status, not a target REVIEW. This run stores item `BLOCKED` because crops are missing.

Target tally lock: **PASS 9 / REVIEW 0 / BLOCKED 12**.

## Frozen counts (must not change)

265 valid DRAFT (freeze), 38 type AUTO, 227 remainder, 3 figure assets, 3 figure links, 8 STEP 8.24 BLOCKED ids.

Live DRAFT 757 / pipeline 0/0 are read-only snapshots.

## Next STEP start condition (do not start here)

STEP **8.31** may begin only after 8.30 is on `main`: confidence gate persist **DRAFT** + queue `HUMAN_REVIEW`. Drafts only, never VERIFIED. Paid OCR remains off by default. This PR does not start 8.31. Do not start 8.31.

Restoring STEP 7 crops into `workers/ocr/data/crops/` (gitignored) is a human/cache operation, not 8.31. Do not generate crops here.

## Artifacts

- `docs/STEP8_30_ORIGINAL_IMAGE_COMPARE_v1.md` (this file)
- `src/lib/ingestion/imageCompare830.ts`
- `src/lib/ingestion/step830Run.ts`
- `scripts/verify-step830.mjs`
- `ocr-tests/taxonomy/step8-30/*`
