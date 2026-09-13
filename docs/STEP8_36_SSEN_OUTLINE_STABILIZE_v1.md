# STEP 8.36 — Production instructor stabilization + 쎈 교재 순서 탐색

Status: **binding on branch `cursor/step-8-36-ssen-outline-stabilize-58e0`.**  
Date: 2026-09-13  
Base: `origin/main` after PR #20 (`STEP 8.35`) merge `2408560`.

## 1. Goal

Make Production usable for instructors: paginated lists, real 쎈 목차 order, live review queue, hide test PDFs, connect classification already stored, evidence-only repairs. Never VERIFIED. Never DELETE.

## 2. SSEN identity

- `source_document_id`: `9ff369b4-5b16-4cb8-bfc3-a6b180c18703`
- Title printed/stored: 쎈수학 공통수학1
- 192 PDF pages, print page number = PDF page number (footer evidence p.8 / p.24 / p.46)

## 3. Printed TOC (PDF page 6, heading 차례)

Evidence: scan of physical TOC, not a generic curriculum dump.

| 대단원 | 소단원 | 인쇄/PDF 시작 |
|---|---|---|
| I 다항식 | 01 다항식의 연산 | 8 |
| I 다항식 | 02 나머지 정리와 인수분해 | 24 |
| II 방정식 | 03 복소수 | 46 |
| II 방정식 | 04 이차방정식 | 62 |
| II 방정식 | 05 이차방정식과 이차함수 | 82 |
| II 방정식 | 06 여러 가지 방정식 | 98 |
| III 부등식 | 07 일차부등식 | 116 |
| III 부등식 | 08 이차부등식 | 130 |
| IV 순열과 조합 | 09 순열과 조합 | 150 |
| V 행렬 | 10 행렬과 그 연산 | 174 |

End page = next start − 1 (last section ends 192).

Type titles come from unit index pages (PDF 7, 45, 115, 149, 173). Problems sort by page, original number, bbox y. Do not invent generic 공통수학 TOC.

## 4. Non-goals

- Do not re-run STEP 8.32–8.35 ingest from scratch.
- Do not open hyper-student-care.
- Do not auto VERIFIED / WORKSHEET_ELIGIBLE.
- Do not DELETE problems or sources.
- Do not overwrite `origin = TEACHER_EDIT` current versions.
- Do not invent classification when evidence is weak.

## 5. Surfaces

| Surface | Route |
|---|---|
| Paginated problem list | `/questions` |
| 쎈 목차 탐색 | `/sources/:documentId/browse` |
| PDF 원본 | `/sources/:documentId` |
| Live 검수 큐 | `/pipeline-review` |
| 문제지 | `/worksheets` |

## 6. Production policy

Snapshot counts before writes. Additive migration only. Fixtures get `is_fixture` / hidden from default 교재 목록. SSEN OCR/extraction labels sync from actual ingest counts, not hardcoded.
