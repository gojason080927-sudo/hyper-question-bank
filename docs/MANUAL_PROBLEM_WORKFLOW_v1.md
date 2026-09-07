# HYPER QUESTION BANK — Manual Problem Review Workflow v1

STATUS: STEP 4  
Supabase: `hyper-question-bank` (`owpxsmdcxjmsgadkdsci`)  
Not HYPER STUDENT CARE.

This is the Gold Standard path. OCR/AI in later steps must land in the same RPCs and validation gates.

---

## 1. Workflow

1. 로그인 (실제 Supabase Auth)
2. `/questions/new`에서 출처 · 본문 · 수식 · 정답 · 분류 · 난이도 입력
3. `hqb_create_problem_draft`로 초안 저장 (`UNREVIEWED`, `public_code` DB 발급)
4. 상세/검수 화면에서 누락 항목 확인
5. REVIEWER/ADMIN만 `hqb_verify_problem_version` → `VERIFIED`
6. VERIFIED 수정 시 `hqb_clone_problem_version` (현재 확정본 유지)
7. 새 초안 편집 → 재검수 → VERIFY 시 `current_version_id` 전환
8. `/questions/:id/versions`에서 과거 버전 읽기 전용 조회

공식 샘플 C: “두 자연수의 합이 10일 때 두 수의 곱의 최댓값”, 정답 25.  
STEP 2.5의 DISTINCT→24는 설계 검증용 historical example.

---

## 2. 권한 모델

실계정 + `user_profiles.role`. 가짜 로그인 테이블을 만들지 않았다.

| 역할 | 초안 생성/수정/clone | VERIFY/REJECT | 설명 |
|---|---|---|---|
| TEACHER | 가능 | 불가 | 학원 강사 |
| REVIEWER | 가능 | 가능 | 검수자 |
| ADMIN | 가능 | 가능 | 학원 운영 책임자 |
| SYSTEM_PROCESS | 로그인 역할 아님 | 서버 배치 예정 | |

신규 Auth 사용자는 trigger로 `TEACHER`. 관리자가 아직 없으면 `hqb_bootstrap_admin()`으로 최초 로그인 사용자가 ADMIN이 된다.

학원이 1인 운영이면 그 계정을 ADMIN으로 두면 TEACHER/REVIEWER를 나누지 않아도 된다.

역할 저장 위치: `public.user_profiles` (`auth.users.id` FK). JWT `app_metadata`는 아직 쓰지 않는다. DB에서 권한을 검사하는 편이 RLS/RPC와 일치하기 때문이다.

---

## 3. 신규 등록 transaction

`hqb_create_problem_draft(payload jsonb)`  
SECURITY DEFINER, `search_path = public`, authenticated만 EXECUTE.

한 트랜잭션에서: 권한 확인 → source ensure → problem → version v1 → current 연결 → source link → classification/answer/difficulty → audit `CREATE_PROBLEM`.  
실패 시 전체 rollback.

---

## 4. VERIFIED gate

`hqb_assert_verify_gate` (SQL이 진실). UI는 같은 규칙을 미리 보여 준다.

필수: 본문, source, license_status, current version, curriculum, PRIMARY concept ≥1, HYPER type ≥1, strategy ≥1, target ≥1, HUMAN difficulty 1–5, answer, expression.

정답 없는 상태는 VERIFY 불가. 해설은 선택.

---

## 5. Version clone

`hqb_clone_problem_version(problem_id, change_reason, content_overrides)`

복사: version 본문, curriculum, concepts, types, strategies, expressions, conditions, targets, reasoning, **HUMAN** difficulty, choices, answers, explanations, assets metadata.

복사하지 않음: reviews, MODEL/CALIBRATED difficulty, audit history.

정책: 새 버전 분석은 다시 해야 하므로 MODEL/CALIBRATED는 자동 복사하지 않는다.

---

## 6. current_version 전환 정책

- 신규 문제: v1이 유일한 버전이므로 current = v1 (초안).
- 이미 VERIFIED인 문제: clone해도 current는 기존 VERIFIED 유지.
- 새 버전이 VERIFY되면 그때 current를 새 버전으로 바꾼다.
- `problem_versions.review_status`로 draft/verified를 표현. 별도 `version_status` 컬럼은 추가하지 않았다 (`problems.review_status`와 중복을 피함).

---

## 7. RLS

모든 core table RLS ON.  
authenticated SELECT는 `hqb_is_staff()`일 때만.  
INSERT/UPDATE/DELETE는 authenticated에 없음. 쓰기는 RPC만.  
anon은 table/RPC write 불가 (`hqb_has_admin` 등 조회성 최소 함수 외).

STEP 3의 넓은 `USING (true)` SELECT policy는 staff policy로 교체했다. RLS를 끄지 않았다.

---

## 8. UI routes

| path | 화면 |
|---|---|
| `/login` | 로그인/가입 |
| `/` | 대시보드 |
| `/questions` | 목록 |
| `/questions/new` | 신규 등록 |
| `/questions/:problemId` | 상세 |
| `/questions/:problemId/edit` | 편집 (VERIFIED면 clone 후 초안) |
| `/questions/:problemId/review` | 검수/확정 |
| `/questions/:problemId/versions` | 버전 이력 |

---

## 9. 테스트 결과

- `npm test` (difficulty/validation unit) PASS
- `npm run test:db:core-v1` PASS (STEP 3 regression; 새 fixture 행이 추가로 생길 수 있음)
- `npm run test:db:workflow-v1` PASS  
  Test D public_code: **HQB-000007**  
  teacher VERIFY 거부, ADMIN VERIFY, clone 시 current 유지, 재VERIFY 후 current 전환, difficulty 0 rollback, anon RPC 거부, 직접 table UPDATE 거부, audit 기록

---

## 10. 알려진 한계

- 공개 회원가입이 열려 있으면 최초 사용자가 ADMIN이 될 수 있다. 학원 내부 도구 전제.
- Email confirm이 켜져 있으면 UI 가입 후 세션이 바로 안 생길 수 있다. 테스트 사용자는 admin API로 confirm했다.
- HQB-000001은 STEP 3 lifecycle 때문에 current가 초안 v2일 수 있다. 데이터는 삭제하지 않았다.
- KaTeX 추가로 프론트 번들이 커졌다 (MIT, 유료 아님).
- Taxonomy 관리 UI / PDF / OCR / twin은 없음.
- Production 배포 후 실제 사람 계정으로 한 번 더 확인하는 것이 좋다.

---

## 11. STEP 5 OCR 연결 지점

OCR/추출 파이프라인은 이 화면을 우회하지 말고:

1. 추출 결과를 `hqb_create_problem_draft` payload로 넣는다 (origin=`OCR` 또는 `AUTO_CLEAN`).
2. 강사는 같은 상세/검수 UI에서 고친다.
3. 확정은 여전히 `hqb_verify_problem_version`만 사용한다.
4. embedding/pgvector/twin은 이 경로 밖에 둔다.

---

## Migrations

| file | why |
|---|---|
| `20260907181000_question_bank_manual_workflow_v1.sql` | profiles, RLS staff SELECT, RPCs |
| `20260907182500_fix_create_problem_draft_public_code.sql` | `public_code` 변수/컬럼 모호성 수정 |

Destructive SQL 없음. STEP 3 migration 미수정.
