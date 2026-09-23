# 쎈 공통수학 2 OCR QA

- document_id: 7c40102b-b4dc-4ff1-a512-6a2912c27b4e
- provider/model: mistral-ocr / mistral-ocr-latest (not completed)
- pages: 200 (not 192)
- success/fail/cache/new: 0/200/0/0
- substantial text pages: 0
- missing/duplicate: 1–200 / none
- actual usd: 0.0000 (cap 1.00)
- persist problems: false

## blocker

Realtime `POST /v1/ocr` returns 429 with `x-ratelimit-limit-req-minute=0`.
Batch `POST /v1/batch/jobs` returns 402 Payment Required.
No page cache was written. Production `source_pages` and problem tables were not changed.

## next segmentation

Reuse page-kind + 4-digit/유형 anchors + layout blocks from this OCR cache once a billed Mistral key works.
Do not run `ingest:book --mode=complete` or SSEN 192-page persist on this book.
