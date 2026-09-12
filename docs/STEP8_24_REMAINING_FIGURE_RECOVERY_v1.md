# STEP 8.24 — Remaining Figure Recovery and Question Linking v1

STATUS: fixed spec (implemented in this step)

## Goal

Re-verify, against the current Production state, the 8 figure candidates that STEP 8.23
could not persist, recover only the figures that are provably valid, and link them to the
correct existing problems. Do not create duplicate assets, wrong problem/version links, or
orphan assets. Do not modify or delete any existing problem, version, review result, or the
3 figure assets/links already persisted by STEP 8.23.

## Scope (only these 8 candidates)

The `UNRESOLVED_PENDING_IDS` carried over from STEP 8.23
(`src/lib/ingestion/step823VerifiedPending.ts`):

`108|0735`, `108|0736`, `114|0775`, `122|0833`, `134|0924`, `134|0925`, `134|0926`, `189|1300`.

Out of scope (do NOT start): STEP 8.25, multimodal twin, print-edit, and the 14 non-AUTO /
REVIEW / CROP_NOT_SAFE figures already skipped by STEP 8.22/8.23.

## Per-candidate decision rule

For each candidate produce a verdict with recorded evidence:

- **PASS** — the owning problem (page + canonical number) exists in Production with a
  `current_version_id`, the crop/asset projection is valid, and the source trace matches.
  The figure asset + link are persisted via the existing STEP 8.23 RPC.
- **REVIEW** — the asset projects cleanly but the link target is ambiguous (owning problem
  exists but number/page/document/version mismatch, or a committed human-read stem exists so
  the problem could be ingested but that ingest needs human confirmation). Not persisted.
- **BLOCKED** — the owning problem is not ingested AND there is no committed human-read stem
  (in `workers/ocr/ground-truth.json` or existing OCR artifacts). Recovering it requires new
  paid OCR. Not persisted.

## Paid OCR policy

- Candidates that require paid OCR are counted and an estimated call count + maximum expected
  USD cost is computed before any call.
- Paid OCR (Mathpix) may run only if the provider is configured AND calls ≤ 8 AND total step
  cost ≤ USD 1.00.
- If the provider is not configured, the cost cannot be confirmed, or cost could exceed USD 1,
  only the paid-OCR portion is stopped; all free/non-destructive work still completes.
- No paid plan is purchased, upgraded, or changed.

## Persistence rules (reuse STEP 8.23)

- Reuse the STEP 8.23 figure-persistence path and `hqb_upsert_problem_figure` RPC.
- No duplicate asset for the same `(source_document_id, page_number, source_hash)`.
- A figure must never be linked to the wrong problem/version (RPC enforces identity + source
  trace; STEP 8.24 also re-checks before calling).
- Re-running the step must not create additional duplicates (idempotency verified).

## Acceptance criteria (completion)

1. Each of the 8 candidates is judged PASS / REVIEW / BLOCKED with recorded reasons.
2. Candidates confirmable from existing crop + existing OCR/GT are persisted and linked.
3. Paid-OCR candidates have a computed call/cost estimate; paid calls run only within the
   limits above, otherwise only the paid portion is deferred with a precise reason.
4. `orphan asset = 0`, `duplicate link = 0`, `duplicate asset hash = 0`, `content changed = 0`.
5. The 3 STEP 8.23 figure assets/links are preserved unchanged.
6. Idempotency: re-run produces 0 additional assets/links.
7. `verify:step824` script exists and PASSes.
8. STEP 8.24 summary JSON + Markdown record per-candidate verdict, persisted asset/link
   counts, remaining blocked count, and OCR call count + cost.

## Target

- Repository: `hyper-question-bank`
- Production Supabase ref: `owpxsmdcxjmsgadkdsci` (re-verified at runtime; `hyper-student-care`
  ref `pwuswjauzdxewmtgoitf` is never accessed).

## Artifacts

- `ocr-tests/taxonomy/step8-24/summary.json`
- `ocr-tests/taxonomy/step8-24/step8-24-summary.md`
- `ocr-tests/taxonomy/step8-24/candidates.json`
