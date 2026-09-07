# HYPER QUESTION BANK — Production Security v1

STATUS: STEP 4.5  
Project: `hyper-question-bank` (`owpxsmdcxjmsgadkdsci`)  
Not HYPER STUDENT CARE.

## Signup

운영 기본값: 학원 내부 도구이므로 **공개 가입을 쓰지 않는다**.

- 로그인 UI에서 계정 만들기 버튼을 제거했다.
- `supabase/config.toml` `[auth]` / `[auth.email]` `enable_signup = false`.
- Cloud Dashboard의 “Allow new users to sign up”도 꺼 두는 것이 맞다. CLI로 원격 Auth 설정을 바꾸지 못했다면 Dashboard에서 사용자가 확인한다.
- 계정 발급: Supabase Dashboard Authentication 또는 Admin API (`email_confirm` 후 `user_profiles.role` 지정).

## Bootstrap admin

`hqb_bootstrap_admin()`은 운영 경로에서 폐쇄했다.

- 함수는 항상 `HQB_BOOTSTRAP_DISABLED`를 낸다.
- `anon` / `authenticated` EXECUTE 회수.
- 기존 ADMIN 행은 수정하지 않는다.

## Default role

신규 `auth.users` → `user_profiles.role = PENDING`.  
PENDING은 `hqb_is_staff()`가 false이므로 core SELECT/쓰기 RPC를 못 한다.  
ADMIN이 `TEACHER` / `REVIEWER` / `ADMIN`으로 올린 뒤에만 업무가 가능하다.

이유: 공개 signup을 막더라도 Auth API가 잠시 열려 있으면 자동 TEACHER가 더 위험하다. PENDING이 더 단순한 방어선이다. 별도 복잡한 ownership RLS는 추가하지 않았다.

## Staff SELECT

학원 공동 문제은행 v1: staff(ADMIN/TEACHER/REVIEWER)는 모든 문제를 읽을 수 있다. 작성자별 isolation은 없다.

## Frontend secrets

`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`만. `service_role` 금지.

## Acceptance fixtures

`npm run test:db:core-v1` / `workflow-v1` / `review-v1`는 live DB에 테스트 행을 남길 수 있다. public_code를 되돌리거나 재사용하지 않는다. Production에서 반복 실행하지 말 것. 향후 local/test project 또는 TEST source 태그. DELETE cleanup은 이번 STEP에 없음.
