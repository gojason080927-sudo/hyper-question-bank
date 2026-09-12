# STEP 8.32 — 쎈수학 공통수학1 원본 PDF 전체 192페이지 대량 등록

User-frozen execution spec. Replaces the 8.25 §J placeholder (“reviewer correction → feature store”) for this STEP only.

## Locked textbook

- Title: 쎈수학 공통수학1
- `source_document_id`: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`
- PDF SHA256: `ae75168a93d320d65181b293b75d6460f538ee47fcedfae663bf3a96cb5ea292`
- Pages: **192**
- Excluded SECOND book: `190fb31b-03f5-43b9-b696-cce7a823a321`
- Question Bank ref: `owpxsmdcxjmsgadkdsci`
- Never open or write `hyper-student-care` (`pwuswjauzdxewmtgoitf`)
- Do not touch PR #11
- Do not auto-merge
- Do not auto-set `VERIFIED`
- Do not DELETE existing Production rows
- Do not rewrite existing `problem_text`

## Pipeline (continuous, all 192 pages)

1. Render every page from the hash-checked original PDF.
2. Exclude cover / TOC / ads / answer keys / explanation-only / blank pages.
3. Segment problem regions and generate crops.
4. OCR number, stem, conditions, choices, math, tables, graphs, figures (cache-first).
5. Stitch problems that continue across a page break.
6. Classify unit / subtype / core concept / strategy / difficulty. Uncertain fields get `NEEDS_REVIEW` reasons.
7. Duplicate-check against existing Production identities (`document|page|canonical`).
8. Persist reviewable new identities as Production **DRAFT**.
9. Ambiguous but reviewable items: DRAFT + `NEEDS_REVIEW` / pipeline `HUMAN_REVIEW`.
10. `BLOCKED` only when the original is missing or a problem region cannot be identified.

Internal batches (20 pages OCR / 25 DB inserts) and checkpoints are allowed. Do **not** stop for user approval every 20–30 items. A single item failure must not abort the book.

## Persist policy (changed from STEP 8.31)

`AUTO_APPROVED` is **not** a prerequisite for DRAFT persist.

Persist `CREATE_DRAFT` when all of the following hold:

- Original source document and page are confirmed
- Problem bbox and crop exist
- Problem content is human-reviewable
- Identity is canonical (`1–4` digit → 4-digit pad) and does not collide with a *different* in-batch candidate
- Duplicate check against Production ran

If OCR characters, math, figures, or classification are partly uncertain, **still persist** and attach `NEEDS_REVIEW` reasons.

Forbidden:

- Auto-transition to `VERIFIED`
- Auto-transition to `WORKSHEET_ELIGIBLE`
- Content rewrite of an existing identity (`RECORD_EXISTING` only)
- Figure writes that would break the frozen 3/3 STEP 8.23 contract
- Paid-service signup or plan change

This STEP may set pipeline status `HUMAN_REVIEW` for every new draft. It must not set `AUTO_APPROVED` unless a later freeze restores §D.

## Paid OCR

- Existing Mistral credentials may be used. Mathpix is optional and currently unused if absent.
- Cache-first. Network calls require `--allow-paid-api` and `--i-understand-this-costs-money`.
- Default routing flag `paidOcrRoutingEnabled` stays **false**. Calls go through `paidGate` only.
- Cap: 250 Mistral page calls / $1.00 USD (Mistral ~$0.004 / page). Record actual calls and estimated USD.
- Never print API key values, prefixes, or lengths. Presence is `PRESENT` / `ABSENT` only.

## Assigned-by / artifacts

- `assigned_by`: `STEP_8_32`
- Stage: `PERSIST_DRAFT`
- Crops / page PNGs / raw OCR JSON: `.ocr-temp/step8-32/` (gitignored)
- Committed artifacts: `ocr-tests/taxonomy/step8-32/*.json` and `*.md` only
- Ground-truth JSON SHA256 must remain `31e46adbab080f12b8d795fce024d352993b86057b9c1853d0cd152862b0c1bb`

## Idempotency

A second `--persist` on the same identities must create **0** extra `problems` rows (RPC `EXISTING_DRAFT` / `RECORD_EXISTING`).

## BLOCKED abort of the whole STEP

Stop the whole STEP as BLOCKED only if:

1. The original PDF is not readable anywhere in this Cloud VM (hash-checked file, `/tmp` copy, or Storage `question-bank-sources/{id}/original.pdf`), or
2. Production credentials for Question Bank are actually missing.

Missing crops or OCR on a subset of pages is a per-item `BLOCKED` / retry, not a book abort.
