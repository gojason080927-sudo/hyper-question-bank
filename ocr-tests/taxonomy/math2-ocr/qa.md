# 쎈 공통수학 2 OCR QA

- document_id: `7c40102b-b4dc-4ff1-a512-6a2912c27b4e`
- provider/model: mistral-ocr / `mistral-ocr-latest` **Batch**
- pages: 200 (not 192)
- success/fail/cache/new: **200 / 0 / 2 / 198**
- substantial text pages: 197
- missing/duplicate: none / none
- batch job: `0faafde8-04fc-4ce9-9a97-8c760ff9f0cb` (25/25 SUCCESS)
- billed pages: 200 (probe p1 realtime + probe p2 realtime + batch 198)
- actual usd: **$0.404** (probes $0.008 + batch $0.396; runner log $0.396 is batch-only)
- cap: $1.00 — under cap
- persist problems: **false**
- Production `problem_sources` for this document: **0**
- 쎈1 / hyper-student-care: not touched

## kinds (classifyBookPageV2, first pass)

- PROBLEM: 139
- THEORY: 22
- MIXED: 18
- UNKNOWN: 18
- ANSWER: 2
- TOC: 1

Cover p1 was labeled PROBLEM because the motto text contains `1500` / `1000`. Ad “마음 갤러리” pages 21, 41 and MEMO p200 are thin on purpose, not OCR failures.

## sample checks

| Check | Result | Pages |
|---|---|---|
| 한글 본문 | 197/200 pages have Korean body | cover, TOC, stems |
| 수학 수식 | 156 pages with `$…$` / environments | p9, p101, p159 |
| 분수 | `\frac` in display math | p9 무게중심, p159 역함수 |
| 지수 | `x^2`, `A^c`, `f^{-1}` | p101, p159 |
| 근호 | `\sqrt` and unicode `√` | p192, p26 |
| 문제번호 | 4-digit sequence starts `0001` on p9; 166 pages have ≥3 anchors | 0001–1282+ |
| 객관식 | 165 pages with ①–⑤ | p75, p159, p189 |
| 표 | no HTML `<table>`; proofs use `\begin{array}` | p101, p181 |
| 그래프/도형 | image blocks, not vectorized | p75 (15 imgs), p142–143 |
| 페이지 순서 | 1–200, no gap/dup | cache 200 files |
| 4자리/유형 앵커 | `0001`… and `유형 01` common; rare `부설` misread of `유형` | p7, p26 vs p75 |
| 문항 분리 가능 | yes: 4-digit + `[0001~0003]` ranges + ①–⑤ + `01-1` / `유형` | next dry-run |

## known OCR noise (do not re-run the whole book)

Localized, not a provider swap:

- `유형` → `부설` on a few pages (p75, p91, p107, p123)
- `대표 문제` → `대로 문제` sometimes
- `정답 및 풀이` → `성답 및 풀이` sometimes
- `서술형` → `시술형` / `[인식] 서포터`
- line-broken Korean (`대칭이` / `동한`)
- figures/graphs are `![img-n.jpeg]` placeholders — expected

## next segmentation

- recommended: dry-run page-kind + 4-digit/유형 anchors + `layoutSegment` on this OCR cache only. Persist problems only after a separate apply review.
- reuse: Mistral markdown + blocks cache; `classifyBookPageV2`; `countAnchorsFromText` / `extractWorkbookProblemAnchor`; `layoutSegment.segmentPageFromLayout`; generic outline after TOC
- do not reuse: `ingest:book --mode=complete`; `ssenToc` / `SSEN_LAST_PAGE=192`; step832 SSEN persist; FullQaReviewPanel 1,242·192 copy
