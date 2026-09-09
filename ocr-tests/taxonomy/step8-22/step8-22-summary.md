# STEP 8.22 VISUAL FIGURE DETECTION v1

STEP 8.22 RESULT: PARTIAL
VERDICT: PARTIAL
READINESS: FIGURE_PIPELINE_NOT_READY

## BASELINE
SSEN DRAFT 728 → 728
second DRAFT 10 → 10
total DRAFT 756 → 756
TYPE AUTO 38 → 38
difficulty 96 → 96
ITEM/STAGE 155/155 → 155/155

## VALIDATION CORPUS
- SSEN figure cases: 15
- second-book figure cases: 10
- total figure cases: 25 (all confidently identifiable cases; below 60 target)
- negative cases: 41

## VISUAL FIGURE DETECTOR
- detected: 14
- precision: 0.583
- recall: 0.560
- false positives (negatives): 10
- missed: 11

## FIGURE TYPES
["GEOMETRY_DIAGRAM","GRAPHICAL_FIGURE"]

## FIGURE OWNERSHIP
- high-confidence correct: 14/14
- ambiguous: 0
- wrong owner: 0

## FIGURE CROP SAFETY
SAFE 7 / REVIEW 0 / UNSAFE 7

## AUTO_FIGURE_SAFE
- SSEN: 7
- second workbook: 0
- total: 7
- percentage: 28.0% of 25 eligible

## FALSE_FIGURE_SAFE
0

## TEXT-PROBLEM REGRESSION
SSEN newly false-figure 3; second-book previous AUTO_SAFE 60, still 60, newly false-figure 0

## FAILURE ANALYSIS
{"FIGURE_CUT_RISK":6,"FIGURE_BBOX_UNCERTAIN":1,"FIGURE_NOT_DETECTED":11}

## DB / STORAGE IMMUTABILITY
db ok true; original PDFs unchanged true; migration 0; paid OCR 0

## READINESS
FIGURE_PIPELINE_NOT_READY

Do not persist figure problems. Do not start STEP 8.23.

## 쉽게 설명하면
원본 페이지 그림에서 도형/표/그래프를 찾기 시작했다. 쎈에서 일부 그림은 사람 없이 붙여도 될 만큼 안전했지만, 개념원리의 얇은 선 그림은 아직 자주 놓친다. 잘못 붙이고도 정상이라고 한 경우는 0건이다. 그래서 지금은 production 그림 입고를 하면 안 된다.
