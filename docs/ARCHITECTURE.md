# HYPER QUESTION BANK — Architecture

MASTER v1 · STEP 1

이 문서는 구현이 아니라 설계 원칙이다. STEP 1에서는 DB migration, OCR, AI, vector search를 만들지 않는다.

## 1. 프로젝트 목적

HYPER QUESTION BANK는 수학 문제 데이터베이스와 유사문제 분석 시스템이다.

단기 목표:

- PDF / HWP / HWPX / 스캔 시험지를 문제 단위로 분리
- 본문, 수식, 도형을 구조화해 저장
- 단원 / 유형 / 난이도 / 풀이전략 분류
- 유사문제 · 쌍둥이 문제 검색
- HYPER 형식 시험지 생성 및 PDF 출력

장기 목표:

- 학교 시험지 스캔 → 문제 분리 → 필기 제거 → 원형 복원
- 학생 답안/오답 분석
- 오답 유형에 맞는 쌍둥이 문제로 재시험지 생성

## 2. 전체 데이터 흐름

```
PDF / HWP / HWPX / scan
  → source document
  → page
  → problem extraction
  → structured problem
  → classification
  → similarity
  → worksheet
```

사람은 추출·분류·유사도 결과를 review 단계에서 검수한다.

## 3. 원본 추적(lineage) 원칙

문제 레코드는 잘린 이미지가 아니라, 원본에서 온 경로를 항상 추적할 수 있어야 한다.

향후 schema에 포함할 식별자:

- `source_document_id`
- `source_page`
- `source_region`
- `source_problem_number`

보존 단계:

1. 원본 파일
2. 원본 페이지
3. 추출 문제
4. 정제 문제
5. 구조화 데이터

원본을 덮어쓰거나 삭제하는 파이프라인은 허용하지 않는다.

## 4. 문제 구조화 원칙

문제 하나는 단순 image record가 아니다. 향후 저장 대상 예:

- 원본 자료 / 원본 페이지
- 문제 / 문제 본문
- 수식 / 도형 / 그래프 / 표
- 선택지 / 정답 / 해설
- 출처 / 학년 / 교육과정
- 대단원 / 중단원 / 소단원
- 문제 유형 / 핵심 개념 / 풀이 전략
- 난이도 / 문제 형식
- 유사도 특징값 / embedding
- 검수 상태

STEP 1에서는 위 항목을 테이블로 만들지 않는다. STEP 2 설계는 [QUESTION_DB_MASTER_SCHEMA_v1.md](./QUESTION_DB_MASTER_SCHEMA_v1.md)에 있다.

## 5. 분류 체계의 향후 방향

분류는 문제 생성 후에 붙는 메타데이터가 아니라, 검색·재시험지 생성의 입력이다.

예정 축:

- 교육과정 / 학년
- 대단원 · 중단원 · 소단원
- 문제 유형
- 핵심 개념
- 풀이 전략
- 난이도
- 문제 형식

TODO: 교육과정 코드 체계는 STEP 2 schema 설계에서 확정한다. 임의 코드표를 STEP 1에서 만들지 않는다.

## 6. similarity engine의 향후 방향

쌍둥이 문제는 텍스트 일치만으로 판단하지 않는다.

향후 후보 신호:

- 구조화된 본문
- 수식 구조
- 도형/그래프 특징
- 유형 · 개념 · 풀이전략
- embedding (pgvector 또는 동등한 vector search)

TODO: PostgreSQL + pgvector 사용 여부는 STEP 2 이후 성능/운영 조건에 따라 결정한다. STEP 1에서 pgvector를 설정하지 않는다.

## 7. human review 원칙

자동 추출/분류/유사도는 초안이다. 강사 검수 없이 production 문제 DB에 확정하지 않는다.

review 기능은 별도 feature 영역으로 유지한다.

## 8. 저작권/라이선스 메타데이터 원칙

문제마다 출처와 사용 권한을 추적한다. 향후 schema 최소 항목:

- source
- publisher
- document title
- year
- edition
- license / use status
- original page
- original problem number

권한이 불명확한 자료는 검색/외부 배포 파이프라인에 넣지 않는다.

## 9. storage 계획

STEP 1에서는 bucket을 만들지 않는다. 향후 후보 이름(변경 가능):

- `source-documents`
- `source-pages`
- `problem-images`
- `problem-assets`
- `generated-worksheets`

원본과 파생 파일은 분리 저장한다.

## 10. 향후 AI/OCR 연결 지점

연결 예정 지점:

- `features/extraction` — 페이지 분할, 문제 박스, 본문 OCR, 수식 OCR, 도형 인식
- `features/classification` — 단원/유형/난이도/전략 초안
- `features/similarity` — embedding 생성 및 유사도 검색
- `features/exams` — 필기 제거, 원형 복원, 오답 판별

TODO: PDF parser, OCR engine, AI provider는 아직 확정하지 않는다. STEP 1에서 유료 API를 가입하거나 키를 넣지 않는다.

## 11. HYPER STUDENT CARE와 분리

이 프로젝트는 HYPER STUDENT CARE와 별개의 앱이다.

공유하지 않는 것:

- GitHub repository
- Supabase project / database
- Vercel project
- environment variables
- production deployment

기존 Student Care DB에 question bank 테이블을 만들지 않는다.

Frontend 환경변수는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`만 사용한다. `service_role` 키는 frontend에 넣지 않는다. 값이 없어도 랜딩 페이지는 crash하지 않는다.
