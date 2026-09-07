# STEP 5 — PDF Ingestion Foundation v1

Question Bank only. HYPER STUDENT CARE was not modified.

## Architecture

```
SOURCE DOCUMENT (original PDF, private Storage)
    → SOURCE PAGE (1-based page_number + geometry + optional embedded text)
    → SOURCE PAGE REGION (normalized bbox, pre-problem)
    → PROBLEM SOURCE (N:M copy of document/page/bbox/region id)
    → PROBLEM / PROBLEM VERSION
    → REVIEW / VERIFIED
```

Existing STEP 3 tables are reused: `source_documents`, `source_pages`, `problem_sources`.
The only new table is `source_page_regions`, because `problem_sources.problem_id` is required and regions must exist before a problem is created.

Problem creation still goes through `hqb_create_problem_draft`. `hqb_create_problem_draft_from_region` calls that function in the same transaction, then copies bbox + region id onto `problem_sources`.

## Storage

- Bucket: `question-bank-sources`
- Public: **false**
- Object path: `{document_id}/original.pdf`
- File size limit: 50 MiB
- Allowed MIME: `application/pdf`
- Original bytes are never upserted (no Storage UPDATE policy)
- Access is signed URL only, TTL 300 seconds
- Frontend uses the anon key + user JWT. No `service_role` in the app

Upload path: browser → Supabase Storage (not through Vercel serverless). This avoids the ~4.5 MB Vercel request-body limit.

## Security

| Actor | PDF list / original / pages / regions |
| --- | --- |
| anon | denied |
| PENDING | denied (`hqb_is_staff()` is false) |
| TEACHER | upload, view, draw regions, create drafts |
| REVIEWER | same write policy as existing Gold Standard drafts + review |
| ADMIN | all of the above + Storage object delete |

Table writes stay RPC-only. Table SELECT uses the existing staff RLS policy.

## Page numbering

- `source_pages.page_number` is **1-based**. It matches what a person sees and `pdf.getPage(n)`.
- `pdf_index = page_number - 1` is only a loop index. It is never stored.

## BBox convention

Canonical JSON:

```json
{
  "x": 0.10,
  "y": 0.22,
  "width": 0.78,
  "height": 0.16,
  "unit": "normalized",
  "origin": "top-left",
  "pageWidth": 612,
  "pageHeight": 792
}
```

Screen pixels are converted using the current viewport size, so zoom changes do not move the saved rectangle. Overlay CSS uses percentages of the rendered page.

Validation (`hqb_validate_bbox` and `src/lib/pdf/bbox.ts`):

- `x >= 0`, `y >= 0`, `width > 0`, `height > 0`
- `x + width <= 1`, `y + height <= 1`
- `unit = normalized`, `origin = top-left`

## PDF type heuristic

Embedded text is counted after stripping to letters, digits, and Hangul. A page is `TEXT_PDF` only if that count is **≥ 40**. A single glyph is treated as a scan candidate.

| Pages | Document `pdf_type` | Default `ocr_status` |
| --- | --- | --- |
| all text | `TEXT_PDF` | `NOT_NEEDED` |
| all scan-like | `SCAN_PDF` | `PENDING` (hook only) |
| mix | `MIXED` | `PENDING` (hook only) |
| none / inspect failed | `UNKNOWN` | `REVIEW_REQUIRED` |

The value is an estimate. Staff can see it on the document page.

## Text extraction policy

- TEXT_PDF: pdf.js `getTextContent()` only. Free, local, no API.
- Extracted text is a **preview / DRAFT helper**.
- It is never auto-saved as a VERIFIED problem body.
- Formulas are not reconstructed. The original PDF page is the source of truth.

## OCR deferred policy

Columns exist: `NOT_NEEDED | PENDING | PROCESSING | SUCCEEDED | FAILED | REVIEW_REQUIRED`.

STEP 5 does **not** call Mathpix, Google, Azure, AWS, or any other OCR/AI provider. No provider is selected.

## Source lineage

`problem_sources` remains N:M. A problem can point at more than one document. Creating a draft from a region copies:

- `source_document_id`
- `source_page_id`
- `source_page_region_id`
- `bounding_box`

Problem detail shows document title, 1-based page, bbox, and a link back to the original page.

Verified-linked regions cannot be deleted (`HQB_REGION_LOCKED`). Unused / unverified DRAFT regions can be removed.

## Copyright / license

Existing `source_documents.license_status` values are reused:

`OWNED | LICENSED | PUBLIC | PERMISSION_GRANTED | RESTRICTED | UNKNOWN`

UNKNOWN / RESTRICTED documents stay internal. They are not treated as worksheet-eligible just because a PDF was uploaded. Originals remain private.

## Viewer library / license

- `pdfjs-dist` (Mozilla PDF.js)
- License: Apache License 2.0
- Used for page render + embedded text. Not a PDF editor.

## Production E2E result

Production UI (`https://hyper-question-bank.vercel.app/`), ADMIN session:

1. `/sources/new` — synthetic `hyper-step5-prod-e2e.pdf` uploaded (OWNED, TEACHER_CREATED)
2. Document `35257d38-ffe5-4ace-946b-179746e7f5b8` — `TEXT_PDF`, 2 pages, `EMBEDDED_TEXT`, `ocr_status=NOT_NEEDED`
3. PAGE 1 displayed; region drawn and saved (`x≈0.079 y≈0.120 w≈0.801 h≈0.200`, unit `normalized`, origin `top-left`)
4. “문제 초안 만들기” → Gold Standard edit → detail `HQB-000024`
5. Lineage: document + page 1 + `PDF_REGION` + bbox. “원본 페이지 보기” returns to the same page
6. Review redirect: `/questions/32cce8ed-0c4d-428e-b115-9a1f9358c9fa/versions/39a59d60-2550-4d63-a843-796ea572c1f0/review`

VERIFY was not applied: this is a STEP 5 synthetic draft without the full Gold Standard gate.

## Storage usage / cost

Supabase Storage is used only for original PDFs.

- v1 object: one immutable PDF per document
- No page-image crops, no OCR artifacts, no embeddings
- 50 MiB cap per file; typical synthetic/internal PDFs are tens of KB to a few MB

Do not treat the following as a price quote. Confirm on the current Supabase pricing page before assuming a bill:

- https://supabase.com/pricing
- Free-tier Storage quotas change; check the project’s current Storage usage in the Supabase Dashboard → Storage.
- A future paid invoice would start only after the project exceeds the then-current free Storage / egress quota, or after the project is moved to a paid plan.

## Known limitations

- No automatic problem splitting across a page
- Region text clip is best-effort; math layout is not reconstructed
- SCAN_PDF pages are visible but have no OCR
- Korean in synthetic fixtures uses Latin/math because built-in PDF fonts are not Hangul
- Storage UPDATE is denied, so a failed upload cannot overwrite `original.pdf`; a new document row is required
- REVIEWER write access matches the existing draft policy (not a new, stricter region-only role)

## STEP 6 candidates

1. Optional free/local OCR for SCAN/MIXED pages, still no paid API unless explicitly approved
2. Tighter region-only text clip and problem-number helpers
3. Batch region review
4. Keep Gold Standard / embeddings / twin search out until lineage is trusted in daily use
