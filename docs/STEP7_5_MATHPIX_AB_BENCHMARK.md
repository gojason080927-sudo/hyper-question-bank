# STEP 7.5 — Windows OCR vs Mathpix A/B foundation (Phase A)

Question Bank only. HYPER STUDENT CARE was not modified.

Phase A implements the comparison machinery. It does **not** claim Mathpix is more accurate. No Mathpix account was created here, no plan was purchased, and **0 paid API calls** were made.

## Purpose

Compare, later, on an apples-to-apples corpus:

- frozen free winner `windows-media-ocr-ko`
- Mathpix math-aware OCR (`POST /v3/text`)

using the **exact same** 26 crops, bboxes, source PDF, human Ground Truth, scoring rules, and math-critical-error rules from STEP 7.

Do not pick easier samples for Mathpix. Do not change Ground Truth to match OCR. If a provider returns `x2`, normalization must keep `x2`.

## STEP 7 frozen baseline

| Field | Value |
| --- | --- |
| STEP 7 start | `b373e20f0372c4ff4fb0912d1a5a4cd0bf0bfb5f` |
| STEP 7 end | `6ef15f3b5a0d0a94b22b2a10d600c89f529b0f0f` |
| PDF | 쎈수학 공통수학1 / `쎈 공통수학1.pdf` |
| document_id | `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` |
| Pages | 192, SCAN_PDF |
| Crops | 26, pages 8, 12, 20, 36, 60, 96, 132, 156 |
| Ground Truth | `workers/ocr/ground-truth.json` |
| Samples | `workers/ocr/samples.json` |
| Manifest | `workers/ocr/corpus-manifest.json` |
| Scoreboard | `workers/ocr/SCOREBOARD.summary.json` |

Free winner **windows-media-ocr-ko** (WinRT 3.2.1), not recomputed:

| Korean | digits | super / frac / rad | choices ①–⑤ | critical | GREEN | YELLOW | RED | sec/crop |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.917 | 0.91 | 0 / 0 / 0 | 0 | 23 | 8 | 8 | 10 | 0.253 |

Known failures remain: `x²→x2`, `√` lost, fraction structure lost, `≤→<`, `|b+c|→lb+cl`, `+→十`, `x→교`, ①–⑤ lost.

## Official Mathpix API research

Access date: **2026-09-08**. Official current documentation wins over older blog posts and over assumptions in the STEP prompt.

### Official URLs used

| Topic | URL |
| --- | --- |
| Docs home | https://docs.mathpix.com/ |
| Authentication | https://docs.mathpix.com/guides/authentication |
| Image OCR guide | https://docs.mathpix.com/guides/image-ocr |
| `POST /v3/text` reference | https://docs.mathpix.com/reference/post-v3-text |
| Limits and quotas | https://docs.mathpix.com/reference/limits-and-quotas |
| API pricing | https://mathpix.com/pricing/api |
| Billing FAQ | https://mathpix.com/docs/convert/billing |
| Creating an API key | https://mathpix.com/docs/convert/creating-an-api-key |

### What official docs say now

- **Image OCR endpoint:** `POST https://api.mathpix.com/v3/text`
- **Auth:** request headers `app_id` and `app_key` from console.mathpix.com. Not a browser public key.
- **Input:** image URL, `data:image/...;base64,...`, or multipart file plus `options_json`
- **Accepted formats:** common images; JSON body examples use JPEG/PNG-style `src`
- **Size limits:** 5 MB JSON body; 2 MB base64 image; 10 MB URL download / 15 s timeout
- **Output:** `text` = Mathpix Markdown with `\(...\)` / `\[...\]` LaTeX; optional `html`, `data`, `latex_styled` (single-equation images only)
- **LaTeX:** yes, in `text`, `latex_styled`, and `data_options.include_latex`
- **MathML:** yes, via `data_options.include_mathml`
- **Markdown/text:** `text` is Mathpix Markdown
- **Confidence:** `confidence` and `confidence_rate` may be returned. HYPER stores them only in **local raw** benchmark JSON. `recognition_results.payload.confidence` stays `null` (`HQB_FAKE_CONFIDENCE`)
- **Rate limits:** per-app and per-IP per minute vary by plan; monthly `image_monthly_limit` / `page_monthly_limit`; HTTP 429 `http_max_requests`
- **Figures:** `/v3/text` does **not** crop embedded figures to CDN images. HYPER v1 already keeps the original crop/bbox as the figure source of truth
- **Retention:** default 30 days; opt-out deletes within 24 hours; Enterprise custom privacy
- **Deprecated path:** process-equations / `v3/latex` still exists in some billing tables, but current image OCR docs point to `v3/text`. This benchmark uses `v3/text` only

### Official pricing (2026-09-08)

From https://mathpix.com/pricing/api and https://mathpix.com/docs/convert/billing:

| Item | Official amount |
| --- | --- |
| One-time setup (first API key) | **$19.99**, non-refundable |
| Testing credit after setup | **$29** |
| Free trial without paying setup | **No** |
| `v3/text` image | **$0.002** (0–1M / calendar month), **$0.0015** (1M+) |
| Image with **>12 rows** of text | billed at **`v3/pdf` page rate** |
| `v3/pdf` | **$0.005** / page (0–1M), **$0.0035** (1M+) |
| Files API async pages | $0.0015 / $0.001 (not required for 26-crop A/B) |
| Billing | 1st of month for prior-month usage |

### Discrepancies vs this STEP prompt / unofficial snippets

1. Some search snippets showed **$0.00/image** for 0–1M. Official page is **$0.002/image**. Official wins.
2. Prompt implied a later live benchmark might be “just API usage.” Official docs require a **setup fee** before the first key works, then apply a $29 credit.
3. Billing FAQ says there is **no monthly image limit** and a default **500 PDF pages/month**. Limits reference documents configurable `image_monthly_limit` and `page_monthly_limit`. Both are official; treat image monthly caps as plan-specific and verify in console before Phase B.
4. Prompt mentioned MathML “if available.” Official `data_options.include_mathml` exists.

Commercial terms relevant here: pay-as-you-go after setup; images processed to extract text/math; default retention 30 days; do not send secrets to the public browser. Read the live Mathpix terms/privacy pages again before paying.

## Security architecture

Phase A / Phase B benchmark:

```
Local benchmark worker
        | HTTPS
        v
Mathpix POST /v3/text
        |
        v
raw result (local JSON only)
        |
normalizer (no Ground Truth rewrite)
        |
STEP 7 scorer
        |
local report
```

Later production recommendation (not built):

```
Question Bank UI
        |
Supabase / controlled job
        |
OCR worker / server function
        |
Mathpix
        |
recognition_results
        |
Human Review
```

No production queue was added. No Mathpix button can fire a paid request. Dev UI shows `Mathpix: NOT CONFIGURED` from `src/lib/ocr/browserStatus.ts`, which never reads credentials.

Secrets:

- `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` only, never `VITE_*`
- empty placeholders in `.env.example`
- not in git, browser bundle, logs, or public recognition UI
- `src/lib/supabase/env.d.ts` has no Mathpix keys

## Corpus integrity

`workers/ocr/corpus-manifest.json` records `sample_id`, `document_id`, `page_number`, `bbox`, `crop_sha256`, and `ground_truth_version` (SHA-256 of `workers/ocr/ground-truth.json`).

The benchmark CLI **refuses a paid run** if a crop hash differs from STEP 7. If local crops are missing (gitignored), dry-run warns and does not invent hashes.

Crops themselves stay under `workers/ocr/data/` (gitignored).

## Provider adapter

`MathOcrProvider` in `src/lib/ocr/mathOcrTypes.ts`:

- `recognizeCrop`
- `providerName` / `providerVersion` / `processingMode`
- raw record + normalized HYPER result + timing + warnings

Mathpix implementation: `src/lib/ocr/mathpixProvider.ts`. It cannot call the network until both `--allow-paid-api` and `--i-understand-this-costs-money` are present **and** worker credentials exist.

## Normalization

`src/lib/ocr/normalizeMathpix.ts` maps into the existing recognition payload:

`problem_number`, `stem_text`, `math_expressions`, `choices`, `answer_candidate`, `has_figure`, `has_table`, `warnings`, `raw_text`, engine/provider, `processing_mode=SCAN_OCR`.

Rules:

- preserve raw API JSON separately from normalized HYPER fields
- if the API supplied `\frac{1}{x}`, keep that LaTeX; do not flatten to `1/x`
- if the API supplied `x2`, keep `x2`
- never copy Ground Truth into the OCR text
- `confidence` in the HYPER payload is always `null`

## Scoring

Reuse `scoreScanSample` / `detectMathCriticalErrors` in `src/lib/recognition/ocrScore.ts` unchanged.

Metrics remain: Korean, digits, operators, superscript, subscript, fraction, radical, inequality, parentheses/abs, equation structure (via critical rules), choice order, problem number, line-order/CER auxiliary, figure/table cue, time, failure rate.

LaTeX `\sqrt{3}` does **not** automatically count as GT token `√3`. That is intentional honesty, not a Mathpix-friendly rewrite.

GREEN / YELLOW / RED definitions are unchanged:

- GREEN: usable DB draft with quick human comparison
- YELLOW: useful draft, manual correction required
- RED: mathematical meaning changed or substantial re-entry

## Correction burden

Levels: `NONE` / `LIGHT` / `MODERATE` / `HEAVY` / `RETYPE`.

Derived conservatively from verdict + Korean hit + critical-error count. No invented seconds.

Frozen Windows aggregate (no per-sample rows committed): GREEN→LIGHT (8), YELLOW→MODERATE (8), RED→RETYPE (10). Math tokens were 0, so GREEN is not treated as NONE.

## Cost model

Calculator: `src/lib/ocr/costModel.ts`. Snapshot: `src/lib/ocr/official-mathpix-pricing.json`. Pricing date **2026-09-08**.

KRW uses a working assumption **1 USD = 1,390 KRW** and is marked **variable**.

| Scenario | Typical USD (`$0.002`/image) | Conservative USD (`$0.005` if billed as page) |
| --- | --- | --- |
| A. 1,000 crops | 2.00 | 5.00 |
| B. 5,000 crops | 10.00 | 25.00 |
| C. 10,000 crops | 20.00 | 50.00 |
| D. 50,000 crops | 100.00 | 250.00 |
| 200 PDF pages | 1.00 | 1.00 |
| 2,000 PDF pages | 10.00 | 10.00 |
| 10,000 PDF pages | 50.00 | 50.00 |

Add **$19.99** setup if the account does not exist yet. The official **$29** credit would cover the 26-sample run.

26-sample live estimate (Phase B, not charged):

- typical **$0.052** (~KRW 72, exchange variable)
- conservative maximum **$0.13** (~KRW 181, exchange variable)

These are not monthly costs. Monthly spend requires an assumed volume.

## Hybrid option (analysis only)

Possible later routing:

```
SCAN crop → cheap/free OCR → math-complexity hint
  simple Korean-heavy → local OCR
  math-heavy → Mathpix
  figure/graph → keep original crop
→ human review
```

`HYBRID_PRODUCTION_ROUTED` is `false`. No automatic production routing was implemented.

## Dry-run safeguards

```
npm run mathpix:ab
```

Default = dry-run. Prints provider, sample count, estimated requests, estimated typical/maximum cost. Never prints secret values.

Live call requires **all** of:

1. `MATHPIX_APP_ID` and `MATHPIX_APP_KEY` in local worker env
2. `--allow-paid-api`
3. `--i-understand-this-costs-money`

Missing either flag or credentials → STOP. Corpus hash mismatch → refuse paid run.

## Phase A test results

See the commit report. Required suites: `npm test`, `npm run lint`, `npm run build`. STEP 4/4.5/5/6/7 unit tests remain in the same Vitest run.

## Exact instructions for Phase B

Do **not** paste API secrets into ChatGPT or this chat.

1. Create a Mathpix account at https://console.mathpix.com and verify email.
2. Create an OCR API organization (https://mathpix.com/docs/convert/creating-an-api-key).
3. Add a card. Official docs charge a **$19.99** one-time non-refundable setup fee, then apply a **$29** test credit.
4. Copy `app_id` and `app_key` from the Mathpix console.
5. Store them only in local `.env` / `.env.local` as `MATHPIX_APP_ID` and `MATHPIX_APP_KEY`. Never `VITE_`.
6. Re-read current pricing. Expected 26-sample cost is about **$0.052** typical, **$0.13** conservative, plus setup if new.
7. Explicitly authorize the live run in a later STEP, then run:

```
npm run mathpix:ab -- --allow-paid-api --i-understand-this-costs-money
```

8. Keep raw JSON under `workers/ocr/benchmark-runs/` (gitignored). Score with the same STEP 7 functions. Then choose A / B / C / D. Do not force A.

## Limitations

- Phase A has no Mathpix accuracy numbers.
- Official per-minute rate limits are plan-specific and were not observed live.
- Dense crops might bill as PDF pages; the conservative estimate covers that.
- Exchange rate is an assumption.
- `/v3/text` will not redraw figures; original crops remain authoritative.

## Unknowns

- Whether any of the 26 쎈 crops have >12 text rows and trigger page billing
- Console monthly image/page caps on a new pay-as-you-go org
- Actual Mathpix Korean + circled-choice behavior on this textbook

## No accuracy claims

Mathpix was not executed. Do not treat this document as evidence that paid OCR is better.
