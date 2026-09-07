# HYPER QUESTION BANK — Design Validation v1

STATUS: DESIGN FREEZE — v1  
DATABASE IMPLEMENTATION: CORE v1 created — see [QUESTION_DB_IMPLEMENTATION_v1.md](./QUESTION_DB_IMPLEMENTATION_v1.md)

이 문서는 STEP 2.5 검증이다. 실제 DB를 만들지 않는다.

---

## 1. 9개 FINAL 결정 검증

| # | 결정 | schema 반영 |
|---|---|---|
| 1 Taxonomy | lookup catalog, 상태는 ENUM/CHECK 후보 | PASS |
| 2 public_code | `HQB-000001`, UUID PK, UNIQUE, 자릿수 확장 | PASS |
| 3 Difficulty | 6×(1–5), 정의 분리 | PASS |
| 4 Version | VERIFIED 이후 새 version, 이전 transient in-place | PASS |
| 5 N:M source | `problem_sources` | PASS |
| 6 Bounding box | JSONB canonical + normalized | PASS |
| 7 Vocabulary | candidate ≠ approved | PASS |
| 8 Vector | embeddings만, pgvector 미확정 | PASS |
| 9 Worksheet | items에 `problem_version_id` | PASS |

---

## 2. 6차원 난이도 sample

공통: 1 매우 낮음 … 5 매우 높음. overall v1 = 산술평균.

### A. `3x + 7 = 22`

| 차원 | 값 | 근거 |
|---|---|---|
| concept_difficulty | 1 | 일차방정식 한 개념 |
| calculation_complexity | 1 | 이항·한 번 나눗셈 |
| reasoning_depth | 1 | 직접 적용, 분기 없음 |
| condition_complexity | 1 | 추가 제약 없음 |
| representation_complexity | 1 | 한 줄 식 |
| trap_level | 1 | 함정 없음 |
| overall | 1.00 | 평균 |

### B. `x² - 5x + 6 = 0`

| 차원 | 값 | 근거 |
|---|---|---|
| concept_difficulty | 2 | 인수분해·영인수 |
| calculation_complexity | 2 | 두 수 찾기·전개 확인 |
| reasoning_depth | 2 | 가능 여부 판단 후 단계 |
| condition_complexity | 1 | 추가 제약 없음 |
| representation_complexity | 1 | 표준형 식 |
| trap_level | 1 | 정수근, 함정 약함 |
| overall | 1.50 | 평균 |

계산·개념이 둘 다 2여도 의미가 다르다: 개념은 무엇을 아는지, 계산은 조작량.

### C. 서로 다른 두 자연수 합 10, 곱 최댓값

| 차원 | 값 | 근거 |
|---|---|---|
| concept_difficulty | 3 | 치환·이산 최댓값 |
| calculation_complexity | 2 | 작은 정수 곱 |
| reasoning_depth | 3 | 조건 해석→모델→비교 |
| condition_complexity | 3 | 자연수·서로 다름·합 고정 |
| representation_complexity | 1 | 문장만 |
| trap_level | 2 | 서로 다름을 놓치면 25 |
| overall | 2.33 | 평균 |

reasoning_depth와 calculation_complexity가 갈라진다. 정의가 동일 문장이 아님 → 차원 유지.

---

## 3. Twin Matrix

자체 제작 6문제. 기준 A.

| ID | 문제 (요약) |
|---|---|
| A | `x²-5x+6=0` 해를 구하시오 |
| B | `y²-7y+12=0` 해를 구하시오 |
| C | `(x-2)(x-3)=0` 에서 해를 구하시오 |
| D | `x²-5x+6=0` 두 근의 합과 곱 |
| E | `y=-x²+4x+5` 최댓값 |
| F | `3x+7=22` |

기준 A 대비:

| pair | level | concept | type | strategy | expression | condition | target | 이유 |
|---|---|---|---|---|---|---|---|---|
| A–B | **T1** | 일치 | 일치 | 0.98 | 0.96 | 일치 | 일치 | 계수·변수만 다름 |
| A–C | **T2** | 강함 | 강함 | 0.82 | 0.78 | 일치 | 일치 | 영인수는 같으나 인수분해 판단이 생략 |
| A–D | **T3** | 유형군 | 부분 | 낮음 | 높음 | 일치 | 불일치 | Vieta. 같은 식, 다른 목표/전략 |
| A–E | **RELATED** | 이차군 | 다름 | 다름 | 약함 | — | 불일치 | 함수 최댓값 |
| A–F | **NOT_RELATED** | 불일치 | 불일치 | 불일치 | 불일치 | — | 약함 | 일차 |

semantic만 보면 A–D가 A–B보다 문장이 비슷할 수 있다. hard gate가 A–D를 T1에서 떨어뜨린다.

---

## 4. T1 / T2 / T3 / RELATED 정의 검증

- T1: 거의 동일 구조. A–B.
- T2: 같은 핵심 전략으로 재연습. A–C.
- T3: 같은 유형군, 전략에 의미 있는 차이. A–D.
- RELATED: 단원/개념군만. A–E.
- NOT_RELATED: 검색에서 제외. A–F. 영구 저장 불필요.

`problems.twin_level` 컬럼 없음. A–B=T1 이면서 A–D=T3 가능.

---

## 5. False positive

Left: `다음 이차방정식 x²-5x+6=0의 해를 구하시오.`  
Right: `다음 이차방정식 x²-5x+6=0의 두 근의 합을 구하시오.`

문장 유사도 높음 가능. target(해 vs 근의 합)과 strategy(인수분해 vs Vieta) 불일치.  
**T1 gate 실패** → T1/T2 금지. T3 후보.

---

## 6. False negative

Left: `x²-5x+6=0의 해를 구하시오.`  
Right: `어떤 수의 제곱에서 그 수의 5배를 빼고 6을 더했더니 0이 되었다. 그 수를 모두 구하시오.`

semantic 낮을 수 있음. skeleton `x^2+px+q=0`, 인수분해 전략, target=근.  
구조 검색으로 **T1 후보**. embedding만 쓰면 놓친다.

---

## 7. Hard gate 원칙

T1 최소: primary concept AND problem type AND strategy AND target compatible.  
T2 최소: primary concept AND strategy compatible.  
semantic 점수가 게이트를 우회하지 않음. 수치 threshold는 데이터 후.

---

## 8. O(N²) 회피

전 pair 테이블 없음.  
흐름: taxonomy/skeleton 필터로 candidate 축소 → top-K 점수 → 필요 cache → 강사 확정 pair만 `verified_problem_relations`.  
canonical `min(id), max(id)`. `algorithm_version` 스냅샷.

---

## 9. Index 후보

MASTER SCHEMA §I. bounding box GIN 없음. 모든 컬럼 index 금지.

---

## 10. STEP 3에서 구현할 사항

Supabase 프로젝트, migration, RLS, lookup seed, public_code 시퀀스, ENUM vs CHECK, 실제 twin 계산기(threshold 미정), pgvector는 보류.

---

## 30개 Design Freeze 체크

| # | 결과 |
|---|---|
| 1 여러 source | PASS `problem_sources` N:M |
| 2 같은 source 여러 위치 | PASS page + problem number + box |
| 3 identity ≠ taxonomy | PASS UUID/code vs lookup links |
| 4 교육과정 ≠ concept | PASS `concept_curriculum_placements` |
| 5 교재유형 ≠ HYPER유형 | PASS |
| 6 전략 순서 | PASS ordered steps |
| 7 수식 구조 분리 | PASS skeleton |
| 8 condition/target 표준화 | PASS lookup + candidate |
| 9 난이도 6차원 독립 | PASS sample A/B/C에서 갈라짐 |
| 10 HUMAN/MODEL/CALIBRATED | PASS 별도 행 |
| 11 VERIFIED 이후 history | PASS 새 version |
| 12 twin은 pair | PASS relation entity |
| 13 component 설명 | PASS 11 scores |
| 14 semantic이 구조를 덮지 않음 | PASS hard gate |
| 15 false positive gate | PASS §5 |
| 16 false negative 구조검색 | PASS skeleton/strategy §6 |
| 17 N² 비저장 | PASS §8 |
| 18 algorithm version | PASS |
| 19 duplicate ≠ twin | PASS 별 클래스 |
| 20 source 삭제 시 문제 보호 | PASS RESTRICT/soft delete |
| 21 worksheet version | PASS `problem_version_id` |
| 22 license 차단 | PASS restriction reasons |
| 23 낮은 confidence → review | PASS |
| 24 embedding 교체 | PASS 분리 테이블 |
| 25 중등→고등 | PASS 가변 tree |
| 26 2015/2022 공존 | PASS framework + placement |
| 27 학교시험 | PASS profile 확장 |
| 28 Student Care 독립 | PASS |
| 29 수십만 필터 | PASS lookup indexes; vector 미정은 보조 |
| 30 실제 DB 없음 | PASS |

29번은 관계형 필터로 후보를 줄일 수 있어 PASS. vector 엔진은 의도적으로 미확정이며 FAIL이 아니다.

억지 PASS 없음. 열린 항목(threshold, ENUM vs CHECK, pgvector)은 구현 디테일이며 freeze 원칙과 모순되지 않는다.
