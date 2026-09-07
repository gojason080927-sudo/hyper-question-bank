# STEP 7 — Real math scan OCR engine bake-off

Question Bank only. HYPER STUDENT CARE was not modified.

Original PDF `쎈 공통수학1.pdf` was not modified. Existing VERIFIED rows were not modified. No paid OCR was purchased.

## Purpose

STEP 6 can read TEXT/MIXED PDFs via pdf.js embedded text. The Production scan `쎈수학 공통수학1` (192 pages, SCAN_PDF, OCR PENDING) has an empty text layer. This STEP installed and ran free OCR candidates on the **same 26 human-bbox crops**, scored them against human ground truth, and chose a production architecture.

## Test machine

| Item | Value |
| --- | --- |
| OS | Windows 10/11 (win32 10.0.26200) |
| CPU | Intel Celeron N5095A @ 2.00GHz, 4 cores / 4 threads (Jasper Lake / Tremont, Family 6 Model 156) |
| AVX | No. Official Paddle / onnxruntime Windows CPU wheels failed to load |
| RAM | ~8 GB |
| GPU | Intel UHD only. No CUDA. CPU benchmark only |
| Python | Embeddable CPython 3.12.10 in `workers/ocr/python/` (not system Python) |
| Node | v26.5.0 |
| Visual C++ | 14.32 present |

No admin system-wide install, no PATH change, no GPU driver change, no Docker Desktop.

## Real PDF

| Field | Value |
| --- | --- |
| Title | 쎈수학 공통수학1 |
| File | 쎈 공통수학1.pdf |
| document_id | `9ff369b4-5b16-4cb8-bfc3-a6b180c18703` |
| Pages | 192 |
| Size | 11,365,061 bytes |
| Kind | SCAN_PDF |
| OCR status at start | PENDING / not run |
| Full-PDF OCR | Not run |

Local copy used for crops only: `workers/ocr/data/` (gitignored). Original Storage object was not overwritten.

## Sample selection

26 crops. Pages 8, 12, 20, 36, 60, 96, 132, 156. Early polynomials, mid complex/functions, inequalities, later counting/graphs. Not only easy pages.

Same `samples.json` bbox for every engine. Render 2.5× → 180 DPI. Ground truth is human-read from those crops. Clipped edges were transcribed as visible text only.

Categories covered: A Korean, B digits, C linear/custom op, D quadratic, E exponents, F radicals, G fractions, H inequalities, I functions/subscripts/piecewise, J graphs, K ①–⑤, L multiline, M parentheses/abs, N table, O figures.

Ground truth file: `workers/ocr/ground-truth.json`.

## Candidates

| Candidate | Version tried | License | Korean | Math | Windows CPU | Vercel | Local worker | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PaddleOCR / PaddlePaddle | 3.7.0 / 3.3.1 | Apache-2.0 | Yes | Text OCR, not structure | Wheel needs AVX | No | Yes | **Installed. Runtime DLL init failed** |
| Native Tesseract | 5.5.3 installer | Apache-2.0 | kor+eng | Weak math | Yes | No | Yes | **Installer downloaded. Admin elevation required. Not installed** |
| Tesseract.js | 6.0.1 | Apache-2.0 | kor+eng | Weak math | Yes (WASM) | Single-crop only | Yes | **Ran on all 26 crops** |
| Windows.Media.Ocr | WinRT 3.2.1 | Windows component | ko pack present | Weak math | Yes | No | Yes | **Ran on all 26 crops** |
| RapidOCR + onnxruntime | pip latest | Apache-2.0 | Chinese-first | Weak math | Wheel needs AVX | No | Yes | **Installed. Runtime DLL init failed** |
| Pix2Text / LaTeX-OCR | — | MIT typical | via EasyOCR | Formula-aware | ONNX/torch | No | Yes | **Not installed after two AVX/DLL failures** |
| MixTeX | — | **AGPL-3.0** + TOS limits commercial derivatives | — | Formula GUI | — | No | Risky | **Not installed. Do not ship** |
| Mathpix / paid | — | paid | Yes | Strong | API | Possible | Possible | **Not paid. No API key** |

AGPL/GPL: MixTeX is AGPL-3.0. It was not copied into the web app.

## What actually ran

### Pipeline A — PaddleOCR only

Installed into `workers/ocr/site-packages`. `from paddleocr import PaddleOCR` constructed the class, then `import paddle` failed:

`DLL load failed while importing libpaddle` → `NameError: libpaddle is not defined`.

Not scored. Not guessed.

### Pipeline B — Tesseract Korean + preprocess

Native `tesseract.exe` was not available without admin install.

**Tesseract.js 6.0.1 kor+eng** ran on the same 26 PNGs.

Windows OCR preprocess variants (raw / gray / contrast / 2× / denoise) ran on S02, S04, S09, S16, S22.

Preprocess did **not** restore superscripts, fraction bars, or radicals. Contrast sometimes dropped a radical-like mark. Denoise hurt S09/S16. Do not stack filters by default.

### Pipeline C — general OCR + math OCR hybrid

Paddle + Pix2Text was not executable on this CPU. The hybrid that **did** run is:

raw crop → Tesseract.js or Windows OCR → `recognizeFromOcrText` (deterministic structure, no LLM restore).

That hybrid still collapses `x²` → `x2` and loses `√`, `≤`, `| |`.

### Pipeline D

No additional free math engine ran.

## Benchmark (human GT, same bbox)

Scoring is token-hit + MATH CRITICAL errors. CER is auxiliary. Engines were not judged against each other.

| Engine | Korean | digits | math super/sub/frac/rad | choices ①–⑤ | critical | GREEN | YELLOW | RED | sec/crop |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| windows-media-ocr-ko | 0.917 | 0.91 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | 23 | 8 | 8 | 10 | 0.253 |
| tesseractjs-kor-eng | 0.881 | 0.921 | 0.0 / 0.0 / 0.0 / 0.0 | 0.0 | 18 | 5 | 11 | 10 | 2.761 |

Problem numbers were usually kept (WinOCR 0.955, Tesseract.js 1.0). Figure/table word cues 0.714. Circled choices ①–⑤ were almost never read as those glyphs.

### Biggest failures (both engines)

- `x²` / `a³` / `z⁴` flattened to `x2` / `a3` / `z4` — MATH CRITICAL
- `√` missing or read as `V`
- stacked `1/x`, `1/y` lost
- `≤` / `≥` flattened to `<` / `>`
- `|b+c|` read as `lb+cl`
- `+` sometimes became CJK `十`
- choice order / ①–⑤ lost
- italic math letters read as Hangul (`x` → `교`)

GREEN rows were Korean-heavy theory/counting stems where the required math tokens were few. Math-heavy MCQ pages are RED: the draft is not a substitute for retyping formulas.

## Winner

**Local worker winner:** `windows-media-ocr-ko` (WinRT 3.2.1)

Why:

- Actually ran on this machine
- Fastest (0.25 s/crop vs 2.8 s)
- Highest Korean hit rate
- No extra model download, no AVX wheel
- License is the OS component; not shipped as a copyleft library

**Browser / Vercel single-crop winner:** `tesseract.js@6.0.1` (`hqb-tesseractjs-v1`)

Why: only free engine that can run one region inside the app without admin, Python, or AVX. Same Apache-2.0 family as native Tesseract. Quality is not better at math.

Rejected:

- PaddleOCR — installed, cannot load on no-AVX Windows CPU
- Native Tesseract — admin installer
- RapidOCR — installed, onnxruntime cannot load
- Pix2Text — not installed after the two DLL failures
- MixTeX — AGPL / commercial-derivative restriction
- Paid APIs — not purchased

## Free OCR verdict

**C — 조건부 충분**

Usable as a **DRAFT/REVIEW** helper for Korean stems and printed problem numbers. Not usable as Gold Standard math. Human must re-enter formulas while looking at the original crop.

Not A/B: no free engine recovered exponents, radicals, fractions, or abs bars.

Not D: Korean pages and problem numbers are good enough that a reviewer is faster than typing the whole stem from scratch.

Paid OCR required this STEP: **NO**. Monthly cost added: **0원**.

If a later STEP wants printed-math accuracy, compare a paid math OCR only against these measured failures (superscript, radical, fraction, abs, ≤/≥). Do not pay until that comparison is approved.

## Production architecture

```
Browser / Vercel app
    |  TEXT/MIXED: pdf.js embedded text (STEP 6)
    |  SCAN test: tesseract.js one region (STEP 7)
    v
Supabase recognition_results (SCAN_OCR | EMBEDDED_TEXT | SCAN_NO_ENGINE)
    |
Local OCR worker (recommended): Windows.Media.Ocr
    |
Human review  →  problem draft  →  VERIFY
```

Do not put Paddle/Pix2Text inside Vercel. Do not OCR all 192 pages automatically. Re-run inserts a new `recognition_results` row. Apply never touches VERIFIED.

Additive schema: `processing_mode` now also allows `SCAN_OCR`.

UI: source region panel keeps left = original 180 DPI crop, right = structured result. New **[OCR 테스트]** runs one region only.

## Limitations

- This bake-off CPU cannot load AVX wheels. A different staff PC with AVX should re-run PaddleOCR / RapidOCR / Pix2Text on the **same** `samples.json` crops before claiming those engines are unusable everywhere.
- Windows OCR needs the Korean OCR language pack. This machine had it.
- Ground truth follows visible crop text, including clipped lines.
- No LLM “pretty restore”.
- Figure/table: presence + original crop only.

## Files

- `workers/ocr/samples.json` — shared bboxes
- `workers/ocr/ground-truth.json` — human GT
- `workers/ocr/engines/*` — isolated runners
- `workers/ocr/SCOREBOARD.summary.json` — committed score summary
- `src/lib/recognition/ocrScore.ts` — scoring + MATH CRITICAL
- `src/lib/recognition/scanOcr.ts` — browser tesseract.js
- `src/lib/recognition/structure.ts` — `recognizeFromOcrText`
- `supabase/migrations/20260908010000_question_bank_scan_ocr_v1.sql`
