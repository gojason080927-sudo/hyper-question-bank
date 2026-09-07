# HYPER QUESTION BANK

MASTER v1

수학 문제 데이터베이스 · 유사문제 분석 시스템

HYPER STUDENT CARE와 분리된 독립 프로젝트다.

## 목적

PDF / HWP / HWPX / 스캔 시험지를 문제 단위로 구조화하고, 분류·유사검색·HYPER 시험지 생성까지 확장하기 위한 기반을 만든다.

## 기술 스택

- React
- TypeScript
- Vite
- Supabase (연결 구조만, STEP 1에서 DB 생성 없음)
- Vercel
- Git / GitHub

## 실행 방법

```bash
npm install
cp .env.example .env.local
npm run dev
```

Supabase 값이 없어도 랜딩 페이지는 표시된다. `.env.local`에 실제 secret을 넣되 Git에 커밋하지 않는다.

## build 방법

```bash
npm run build
npm run lint
```

## 환경변수

`.env.example` 참고.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`SUPABASE_SERVICE_ROLE_KEY`는 frontend에 넣지 않는다.

## 폴더 구조

```
src/
  app/
  components/common/
  features/
    dashboard/
    sources/
    extraction/
    questions/
    classification/
    similarity/
    worksheets/
    exams/
    review/
  lib/supabase/
  types/
  utils/
  styles/
docs/ARCHITECTURE.md
```

## 현재 구현 범위 (STEP 1)

- 독립 Vite + React + TypeScript 앱
- 개발/Production 환경변수 구조
- 확장 가능한 feature 폴더
- Supabase client stub (값 없으면 null, 앱은 유지)
- 최소 랜딩 화면
- architecture 문서

포함하지 않음:

- DB 테이블 / migration
- OCR / AI / embedding
- vector search
- 문제지 생성
- 유료 API 가입

## 다음 STEP

STEP 2.5 DESIGN FREEZE: [docs/QUESTION_DB_MASTER_SCHEMA_v1.md](./docs/QUESTION_DB_MASTER_SCHEMA_v1.md)

STEP 3  
검토 확정 후 실제 Supabase DB MASTER SCHEMA 적용 (아직 실행하지 않음)
