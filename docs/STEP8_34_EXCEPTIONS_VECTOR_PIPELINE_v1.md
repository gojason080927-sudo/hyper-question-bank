# STEP 8.34 — 잔여 예외 자동정리 + pgvector 유사문제 검색 + 재사용 권별 파이프라인

User-frozen execution spec. Does **not** re-run STEP 8.32 ingest. Does **not** re-run STEP 8.33 from scratch.

## Locked textbook (SSEN only)

- Title: 쎈수학 공통수학1
- `source_document_id`: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`
- PDF SHA256: `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`
- Pages: **192** (already ingested in STEP 8.32; QA-cleared in STEP 8.33)
- Excluded SECOND book: `190fb31b-03f5-43b9-b696-cce7a823a321`
- Question Bank ref: `owpxsmdcxjmsgadkdsci`
- Never open or write `hyper-student-care` (`pwuswjauzdxewmtgoitf`)
- Do not touch PR #11
- Do not auto-merge
- Do not auto-set `VERIFIED`
- Do not DELETE existing Production rows
- Do not rewrite existing `problem_text` without storing the original alongside any split/recovery
- Do not modify a different `source_document_id`
- Additive migrations only. Do not edit existing SQL files.

## Starting point (after PR #18 merge)

- `main` includes STEP 8.33
- Production Production 공통수학1 전체 문제: 1,256
- Production DRAFT: 1,281
- SSEN `NEEDS_REVIEW`: 58
- Other-source `NEEDS_REVIEW`: 6 (read-only)
- `AUTO_CLASSIFIED` from 8.33: 481
- Fingerprints: 3,543
- Automatic `VERIFIED`: 0
- Duplicate / orphan / wrong-source / content rewrite: 0
- `problem_embeddings` omitted in CORE v1; pgvector was not enabled

## Why this STEP exists

The remaining 58 SSEN `NEEDS_REVIEW` rows are concentrated exceptions (bbox intrusion, duplicate candidates, answer-key leak, thin stems, OCR garbage, unit/type conflict). Humans must not review them one by one.

Search still has fingerprints only. Similar-problem retrieval needs pgvector + a locked embedding model.

The next textbook must not require rewriting STEP 8.32 / 8.33. One reusable per-book command takes a PDF + metadata.

## Scope

1. Auto-analyze all remaining SSEN `NEEDS_REVIEW` identities with original page, bbox, crop, neighbors, OCR, and fingerprints.
2. Correct bbox intrusion, classify duplicates, split leaked answer/explanation, recover limited OCR garbage, re-judge unit/type from page context.
3. Clear `NEEDS_REVIEW` → `AUTO_CLASSIFIED` only when evidence is sufficient. Lifecycle stays `DRAFT`. Never `VERIFIED`.
4. Additive pgvector + `problem_embeddings` + cosine top-k RPC with fingerprint dedup and staff RLS.
5. Embed QA-passed DRAFTs with the locked Mistral model if the live key works and estimated cost ≤ $5.
6. Generalize 8.32 + 8.33 into a reusable book pipeline. Dry-run + idempotency on SSEN only. Do **not** ingest a new textbook.

## Goal A — remaining exception auto-cleanup

Known overlapping reasons on the 58 (61 identities in 8.33 residual census):

| Reason | Count |
|---|---|
| `BBOX_INTRUSION` | 40 |
| `DUPLICATE_CANDIDATE` | 32 |
| `ANSWER_KEY_LEAK` | 10 |
| `EVIDENCE_INSUFFICIENT` | 3 |
| `TYPE_UNCLEAR` | 2 |
| `UNIT_UNCLEAR` | 2 |
| `OCR_GARBAGE` | 2 |
| `UNIT_CONFLICT` | 1 |

### Bbox intrusion

- Analyze every problem bbox on the same page together.
- Boundaries: problem number order, paragraph gap, choice block end, next problem-number start.
- Shrink or resplit overlapping regions. Do not cut math, choices, or in-crop figures when the shrink would be severe — those stay `HUMAN_REVIEW`.
- Record original and corrected coordinates, plus before/after crop (or coordinate) hashes and a visual compare artifact.
- Uncertain boundaries stay `HUMAN_REVIEW`. No bbox write.

### Duplicate candidates

Combine: source/page/number, normalized text fingerprint, structure fingerprint, math/choice structure, bbox overlap, existing problem/version links.

| Class | Action |
|---|---|
| Exact duplicate | Link to keeper. Do not mint a new problem. Extra identity `use_status = BLOCKED`, lifecycle stays `DRAFT`. No DELETE. |
| Same problem, new version | Only if a safe `problem_version` link already exists or texts differ only by OCR noise **and** identity (page+number) matches. Otherwise `HUMAN_REVIEW`. |
| Distinct similar | Keep both as separate problems. Clear the duplicate residual. |
| Uncertain | Keep `HUMAN_REVIEW`. |

Never auto-merge content. Never lose original text.

### Other corrections

- Answer-key leak: split stem vs 정답/풀이 into sidecar regions. Keep original `problem_text` unchanged.
- Short formula stems: compare with original OCR; clear if math/identity is valid.
- OCR garbage: re-OCR from original crop only when cache or the existing Mistral key allows it. Store recovery beside the original. Do not silent-rewrite.
- Unit/type conflict: re-judge from page neighbors, expressions, and existing taxonomy. Weak evidence → `HUMAN_REVIEW`.

## Goal B — pgvector similar search

Read-only inventory first. If missing, additive migration:

- `CREATE EXTENSION vector`
- `problem_embeddings` matching master-schema columns (implementation column `embedding` = design `vector`)
- Cosine similarity top-k RPC `hqb_search_similar_problems`
- Filters: source, curriculum node, problem type, difficulty
- Exclude the query problem and exact `NORMALIZED_TEXT` fingerprint twins
- Exclude `use_status = BLOCKED`
- RLS: staff SELECT (`ADMIN` / `TEACHER` / `REVIEWER` via `hqb_is_staff`)
- Writes: staff RPC (`hqb_require_staff_writer`)
- HNSW cosine index (IVFFlat fallback)

### Locked embedding model

See `docs/STEP8_34_EMBEDDING_MODEL_LOCK_v1.md`.

- Provider: existing Mistral API (`MISTRAL_API_KEY`)
- Model id: `mistral-embed`
- Dimensions: **1024** (official default; do not truncate)
- Endpoint: `https://api.mistral.ai/v1/embeddings`
- List price used for the cap: **$0.10 / 1M input tokens**
- Cost cap: if estimate **> $5**, skip paid calls only; schema/search/tests still complete
- Dedup identical normalized text → one embedding
- Batch + on-disk cache
- Retry failures only
- Never log API key value, length, or prefix (PRESENT/ABSENT only)
- No new paid signup / plan change
- Do not mint fake embeddings

Embed QA-passed DRAFTs (`AUTO_CLASSIFIED` and passing `UNREVIEWED` SSEN drafts). Residual `HUMAN_REVIEW` is not embedded until it clears.

## Goal C — reusable per-book pipeline

Minimum inputs: PDF path, `source_document_id`, title, subject/curriculum, page range, OCR provider policy.

One command (`npm run pipeline:book`) runs:

PDF check → page render → segment → OCR → structure → classify → crop/figure link → duplicate check → DRAFT persist → auto QA → fingerprint → embedding → exception queue

Required: `--dry-run` (default), explicit `--persist`, checkpoint/resume, idempotency, retry failed page/item only, progress + cost, per-source manifest, before/after Production snapshot, cross-book duplicate check, continue on per-item failure, no per-page human RUN approval.

This STEP tests the pipeline on SSEN dry-run + persist idempotency only. Do not ingest a new book.

## Safety

- Production snapshots before and after writes
- Other sources: read-only
- No DELETE
- No automatic `VERIFIED` / `WORKSHEET_ELIGIBLE`
- No lowering gates to force PASS
- Student Care never accessed

## Acceptance

1. All remaining SSEN `NEEDS_REVIEW` identities processed; counts reported.
2. Bbox before/after integrity for applied corrections.
3. Duplicate classification counts; no content loss.
4. pgvector + embeddings table/RPC present (or exact blocker reported).
5. Embedding model/dimension locked and documented.
6. Top-k search: self and exact-dup excluded; filters work.
7. Reusable pipeline dry-run on SSEN; persist re-run extra problem writes = 0.
8. duplicates / orphans / wrong-source / content damage = 0
9. `verify:step834`, typecheck, lint, build, tests (pre-existing 8.31 pypdfium2 failures are not 8.34 regressions)
10. Dedicated PR vs `main`. No auto-merge.
