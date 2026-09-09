# Figure detection v2 — next development plan

STATUS: PLAN ONLY. Do not implement in the Cloud bootstrap PR.  
CURRENT READINESS: **FIGURE_PIPELINE_NOT_READY** (STEP 8.22)  
HARD CONSTRAINT: `FALSE_FIGURE_SAFE` must remain **0** on trusted regression evidence.

## Why v1 is not production-ready

STEP 8.22 (`visualFigureV1.ts`, `figureGtFreeze.ts`, `step822Run.ts`, `scripts/visual-figure-detect.py`):

| Signal | Freeze evidence |
| --- | --- |
| Verdict | PARTIAL |
| Recall | 0.560 (14 / 25) |
| Precision | 0.583 (10 false positives on negatives) |
| AUTO_FIGURE_SAFE | 7 / 25 (28%), all SSEN, **0 on second book** |
| FALSE_FIGURE_SAFE | **0** |
| Missed required figures | 11 (`FIGURE_NOT_DETECTED`) |
| Material crop cuts | 6 (`FIGURE_CUT_RISK` / MAJOR_CUT) |
| Ownership on detected hits | 14/14 high-confidence correct |
| Production writes / paid OCR | 0 |

User-visible bottleneck: **thin-line / sparse diagrams** and **safe crop coverage**, especially cross-book. Code that builds is not figure-ingestion-ready.

## Current detector (v1) — what evidence supports

`visual-figure-detect.py` is a local PIL pipeline: downsample → ink threshold → optional text downweight (not erase) → dilate → connected components → merge → area/size gates → decoration skip → coarse type from H/V run-length hits and fill.

That is enough for some dense SSEN tables/diagrams. It under-detects sparse geometry because:

- Thin strokes fall below ink / min-area after downsample (`max_w` 420, `min_area_frac` 0.0032).
- Dilation 2 either merges into text or still leaves broken components too small to keep.
- Merge gap cannot reconstruct a diagram whose parts are widely separated relative to stroke width.
- Crop pad 0.012 is too tight when the bbox already clips labels (MAJOR_CUT 6).
- Cross-book pages (second workbook) produced **zero** AUTO_FIGURE_SAFE; recall failure is not an SSEN-only quirk to hack around.

No publisher / book-title branches exist in v1 (`generalization-audit.json` pass). Keep that.

## Goal for v2

Improve **thin-line / sparse diagram recall** and **safe crop coverage** without increasing the false-safe rate.

Success is not “more AUTO”. Success is:

1. `FALSE_FIGURE_SAFE = 0` on the frozen 25+41 cases (and any added freeze cases).
2. Higher recall on required figures, especially SECOND book, without relaxing AUTO gates.
3. Fewer MAJOR_CUT on figures that are already detected (conservative expansion, not aggressive).
4. Precision on negatives stays high enough that leftover FPs go to REVIEW, never AUTO.

Do not persist figure rows. Do not start STEP 8.23. Do not call paid vision APIs.

## Directions (only if freeze evidence still supports them)

Implement as **ablations on the frozen GT**, one signal at a time, with FALSE_FIGURE_SAFE checked after each:

1. **Line-segment geometry** — extract longer Hough-like or run-length segments before CC merge so a triangle/circle made of thin strokes still forms one candidate.
2. **Sparse CC grouping** — cluster small components by proximity + similar stroke width, not only `merge_gap` on bounding boxes.
3. **Projection profiles** — page-column ink projections to find diagram bands that sit beside/below stems (reuse `pageRegionV2` / `problemAnchorV2` membership; do not use nearest-problem as a hard owner rule — v1 already forbids that).
4. **Hough-style evidence** — circle/axis/grid votes as type evidence, never as a publisher switch.
5. **Diagram isolation** — keep text-mask as downweight only (`text-visual-mask-model.json`). Do not permanently erase ink that might be a labeled figure.
6. **Whitespace enclosure** — closed white regions around sparse ink often mark figure wells; use as a candidate seed, then require stroke evidence inside.
7. **Anchor-relative ownership** — keep geometry-first ownership (`scoreFigureOwnershipV3`); text “그림과 같이” remains supporting only.
8. **Conservative crop expansion** — expand toward whitespace / away from neighbor bodies until labels are covered or a neighbor gate trips → REVIEW, not AUTO. `expandBBox` already exists.
9. **Multi-signal fusion** — require ≥2 independent signals (stroke geometry, enclosure, ownership, low text-overlap) before AUTO. A single weak CC must not become FIGURE_CROP_SAFE.

Rejected unless a later human overrides:

- Book-title, publisher, or page-number special cases
- Production figure ingestion
- Paid OCR / cloud vision to “find figures”
- Lowering `auto_detection_min` / ownership high-water marks just to raise AUTO count
- Treating missing local workbook PDFs as a reason to skip the FALSE_FIGURE_SAFE gate

## Suggested first Cloud task after bootstrap

Cloud-safe unit + fixture test of a **sparse-stroke grouping** prototype against `FIGURE_VALIDATION_FREEZE` / `FIGURE_NEGATIVE_FREEZE` using the already-tracked STEP 8.22 page/crop PNGs only. Do not add new copyrighted page dumps. Do not download SSEN PDFs. Stop if FALSE_FIGURE_SAFE would become non-zero.
