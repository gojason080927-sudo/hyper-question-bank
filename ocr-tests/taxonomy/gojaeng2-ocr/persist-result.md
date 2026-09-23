# 고쟁이 공통수학 2 AUTO_SAFE persist

- engine: `hqb_upsert_problem_draft_from_identity`
- document_id: `9eee97e2-4252-4348-a842-4d60eb8590f0`
- Production `problem_sources` before → after: 0 → 558
- AUTO_SAFE created: 558
- NEEDS_REVIEW / BLOCKED held: 79
- failed: 0
- rerun: created 0 / existing 558 / count still 558
- 쎈1 / 쎈2 / 개념원리 / RPM counts unchanged: 1253 / 1152 / 529 / 1033
- samples present: p3 #0041, p8 #0001/#0002/#0004
- 단원·유형·난이도·출제포인트: Production 미저장 (`problem_curriculum` / `problem_type_assignments` / `problem_difficulty` empty, `classification_status=DRAFT`). `item_format`만 저장됨.
