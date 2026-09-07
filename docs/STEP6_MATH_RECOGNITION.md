# STEP 6 — Math PDF Recognition Pilot v1

Question Bank only. HYPER STUDENT CARE was not modified.

Recognition never auto-VERIFIES. Machine result → DRAFT → human review → VERIFIED.

## Architecture

```
Web app (pdf.js + structure reconstructor)
  → high-res region render (preview only)
  → embedded-text recognition OR honest SCAN_NO_ENGINE
  → recognition_results (machine only)
  → human Apply / new draft
  → problem_version DRAFT
  → review / VERIFY
```

Production/Vercel does **not** host a Python/ML OCR model.

| Path | Where it runs |
| --- | --- |
| TEXT_PDF / MIXED text region | Browser: pdf.js `getTextContent` + bbox clip + `hqb-embedded-text-v1` |
| SCAN / empty region | Browser: `hqb-scan-unavailable-v1` (no invented text) |
| Heavy OCR worker | Not installed this STEP. Interface reserved for STEP 7 |

## Engines surveyed (not paid)

| Candidate | License | Windows now | Verdict |
| --- | --- | --- | --- |
| pdf.js embedded text + in-repo reconstructor | Apache-2.0 | Yes, already in the app | **Adopted for TEXT_PDF** |
| Tesseract OCR | Apache-2.0 | Not installed | Survey only. Do not install system-wide this STEP |
| PaddleOCR / PP-OCRv4 | Apache-2.0 | Needs Python + models | Too heavy for Vercel; not installed |
| Pix2Text / LaTeX-OCR family | various | Python + GPU preferred | Not installed |
| MixTeX | AGPL-3.0 | — | Not integrated (copyleft risk) |
| Mathpix / cloud OCR / paid AI | paid | — | Forbidden this STEP |

Adopted engines:

- `hqb-embedded-text-v1` `0.1.0` — Apache-2.0 pdf.js text + deterministic parser
- `hqb-scan-unavailable-v1` `0.1.0` — honest failure when the text layer is empty

CPU only. No GPU. No paid OCR/API/embedding.

## Region rendering

Screen canvas is not used for OCR input.

`renderRegionDataUrl` renders the original PDF page off-screen at `RECOGNITION_RENDER_SCALE = 2.5` → **180 DPI** (72×2.5), then crops the normalized bbox.

Chosen after a local trade-off: 1.5× (108 DPI) loses small superscripts; 4× (288 DPI) is heavier than this pilot needs. 180 DPI is enough to *see* exponents/fraction bars in the compare UI. This STEP still reads **embedded text**, not pixels.

## Structured result

```json
{
  "problem_number": "1",
  "stem_text": "...",
  "math_expressions": [{ "original": "x²-5x+6=0", "latex_candidate": "...", "structure_ok": true, "notes": [] }],
  "choices": [{ "order": 1, "label": "①", "text": "2" }],
  "answer_candidate": null,
  "has_figure": false,
  "has_table": false,
  "confidence": null,
  "component_status": ["TEXT_OK", "MATH_OK"],
  "warnings": [],
  "raw_text": "..."
}
```

`confidence` is always `null`. Fake numbers such as `97.3` are rejected (`HQB_FAKE_CONFIDENCE`). Status uses component flags: `TEXT_OK`, `MATH_REVIEW_REQUIRED`, `CHOICES_OK`, `CHOICES_REVIEW_REQUIRED`, `FIGURE_DETECTED`, `TABLE_DETECTED`, `LOW_CONFIDENCE`, `OCR_UNAVAILABLE`.

## Rules

- `x²` and `x2` are not the same. Collapsed exponents are RED + `MATH_REVIEW_REQUIRED`.
- Unknown math is not guessed. ASCII `x^2`, `sqrt()`, `1/2` stay YELLOW.
- Problem numbers: `1.`, `01.`, `[1]`, `문제 2`. `①` is a choice, not a number.
- Choice order is never shuffled. A gap → `CHOICES_REVIEW_REQUIRED`.
- Figures/tables are detected only. They are not redrawn or interpreted.
- Answers are copied only from an explicit `정답:` / `답:` line. The engine does not solve.
- Auto region proposals need a human click before save. Manual bbox remains Gold Standard.
- Re-run inserts a new `recognition_results` row. It does not overwrite a human draft.
- VERIFIED versions cannot be applied to (`HQB_VERIFIED_LOCKED`).

## Benchmark

Synthetic string set: `fixtures/recognition/ground-truth.json` (15–30 regions, types A–M).

Helvetica cannot embed Hangul, so Korean accuracy is measured on strings, not on a Latin-only PDF. Real user PDFs should be logged separately when provided.

Run: `npm test` (includes the benchmark test) or `npm run test:recognition-bench`.

## STEP 7 recommendation

If free embedded text is not enough for scans and stacked fractions, compare a **local** Tesseract + optional math OCR worker. Do not put the model on Vercel. Price any paid math OCR only after this pilot’s RED types are listed.
