# HYPER QUESTION BANK — CORE DATABASE IMPLEMENTATION v1

STATUS: STEP 3 CORE v1  
PROJECT: `hyper-question-bank` (Supabase ref `owpxsmdcxjmsgadkdsci`)  
NOT HYPER STUDENT CARE (`pwuswjauzdxewmtgoitf`)

Conceptual source of truth remains the Design Freeze documents. This file describes what was physically created.

---

## 1. Actual tables created (36)

**Core (problem E2E)**  
`source_documents`, `source_pages`, `problems`, `problem_versions`, `problem_sources`, `curriculum_frameworks`, `curriculum_nodes`, `concepts`, `concept_curriculum_placements`, `problem_curriculum`, `problem_concepts`, `hyper_problem_types`, `problem_type_assignments`, `strategy_templates`, `strategy_template_steps`, `problem_strategy_assignments`, `math_expressions`, `condition_terms`, `problem_conditions`, `target_terms`, `problem_targets`, `reasoning_terms`, `problem_reasoning`, `problem_difficulty`, `problem_choices`, `problem_answers`, `problem_explanations`, `problem_assets`, `reviews`, `audit_events`, `taxonomy_candidates`

**Structure only (no feature implementation)**  
`school_exam_profiles`, `content_fingerprints`, `verified_problem_relations`, `worksheets`, `worksheet_items`

**Deferred**  
`problem_embeddings` — omitted. No `vector` column. `pgvector` extension was not enabled.

---

## 2. Major columns

### problems (identity)
`id` UUID PK, `public_code` TEXT UNIQUE, `current_version_id` UUID NULL, `review_status`, `lifecycle_status`, `use_status`, `created_at`, `updated_at`, `archived_at`

Body text is **not** stored here.

### problem_versions (content)
`id`, `problem_id`, `version_no`, `origin`, `parent_version_id`, `change_reason`, `problem_text`, `normalized_text`, `instruction`, `item_format`, `choice_count`, `content_metadata` JSONB, status fields, `created_by`, `created_at`

### classification / difficulty / expressions
Linked by `problem_version_id`, not only `problem_id`.

### source_documents
Includes `publication_year` (Freeze field name was `year`), license/usage fields, `archived_at`. No file upload in this STEP.

---

## 3. PK / FK

- Core entity PKs: UUID `gen_random_uuid()` (`pgcrypto`).
- `problems.current_version_id` → `problem_versions(id)` added after both tables exist. NULL allowed so insert order is: problem → version → update pointer.
- History-preserving FKs use **RESTRICT** (sources, problems, versions, taxonomy, worksheets, reviews).
- **CASCADE** only for snapshot-internal children of a version (concepts/types/strategy links, expressions, answers, choices, explanations, assets, difficulty) and `strategy_template_steps` / `school_exam_profiles`.

---

## 4. CHECK constraints

TEXT + CHECK (no Postgres ENUMs):

- review / lifecycle / use / origin / item_format / difficulty_source / expression_role / answer_type / license / document_type
- difficulty dimensions: `BETWEEN 1 AND 5`
- `public_code ~ '^HQB-[0-9]{6,}$'`
- condition/target `APPROVED | AUTO_DISCOVERED`

---

## 5. UNIQUE constraints

| table | unique |
|---|---|
| problems | `public_code` |
| problem_versions | `(problem_id, version_no)` |
| source_pages | `(source_document_id, page_number)` |
| problem_difficulty | `(problem_version_id, difficulty_source)` |
| lookup catalogs | `code` |
| link tables | `(problem_version_id, <term_id>)` |
| verified_problem_relations | canonical `(problem_a_id, problem_b_id)` with `a < b` |

---

## 6. Indexes

PK/UNIQUE indexes plus FK btree indexes on: curriculum nodes, problem_versions(problem_id), problem_sources(problem_id, source_document_id), math_expressions(version), reviews, audit_events(entity). No bounding-box GIN. No vector index.

---

## 7. RLS status

RLS **enabled** on all 36 public tables listed above. Not forced on table owner.

---

## 8. Policies

- `qbank_authenticated_select`: `SELECT` for `authenticated` only (`USING true`).
- No INSERT/UPDATE/DELETE policies for `anon` or `authenticated`.
- Table privileges: `anon` has **no** table DML; `authenticated` has SELECT only; `service_role` has ALL.
- `hqb_fetch_problem_bundle(text)` is `SECURITY INVOKER`, not granted to `anon`.

Fake Auth role metadata (ADMIN/TEACHER/REVIEWER/SYSTEM_PROCESS tables) was **not** invented. Those labels remain a future policy mapping.

---

## 9. public_code generation

PostgreSQL sequence `problems_public_code_seq` + BEFORE INSERT trigger `hqb_assign_public_code`.

- Always minted in the database. Clients cannot choose the next number.
- Format `HQB-` + zero-padded at least 6 digits (`hqb_format_public_code`).
- `nextval` is race-safe. Gaps allowed. Deleted numbers are not reused.
- Frontend must not compute `MAX(public_code)+1`.

---

## 10. Versioning

1. Insert `problems` (nullable `current_version_id`).
2. Insert `problem_versions`.
3. Point `current_version_id` at the new version.

After `VERIFIED`, content/classification changes add a new version. Old rows remain. Classification/difficulty stay on the version they were written to.

---

## 11. Difficulty

Six integer columns 1–5 with CHECK. `overall_difficulty NUMERIC(4,2)` filled by trigger `hqb_compute_overall_difficulty` as the arithmetic mean rounded to 2 decimals.

Not a `GENERATED ALWAYS` column, so the formula can change later without a painful rewrite.

`UNIQUE (problem_version_id, difficulty_source)` so HUMAN / MODEL / CALIBRATED coexist and do not overwrite each other.

---

## 12. Seed list (`supabase/seed.sql`)

Minimal STEP 3 taxonomy only — **not** master taxonomy, **not** test problems.

- framework: `KR_2022` 2022 개정교육과정
- nodes: 중학교 → 중1/중3 → 일차방정식 / 이차방정식 units
- concepts: `LINEAR_EQUATION`, `QUADRATIC_EQUATION`, `FACTORING`
- types: `LINEAR_DIRECT_SOLVE`, `QUADRATIC_FACTOR_SOLVE`
- strategies: `LINEAR_EQUATION_SOLVE` (3 steps), `FACTORABLE_QUADRATIC_SOLVE` (5 steps)
- targets: `EQUATION_SOLUTION`, `MAXIMUM`
- conditions: `NATURAL_NUMBER`, `SUM_FIXED`
- reasoning: `DIRECT_RECALL`, `SUBSTITUTION`, `TRANSFORMATION`, `MULTI_STEP`, `MODELING`
- `concept_curriculum_placements` mapping concepts onto those units

---

## 13. Test fixture location

- Spec: `scripts/fixtures/core-v1-test-problems.mjs`
- Runner: `scripts/core-v1-acceptance.mjs` (`npm run test:db:core-v1`)
- Reconstruct query: `scripts/sql/fetch_problem_by_public_code.sql` and RPC `hqb_fetch_problem_bundle`

Original HYPER items (not commercial textbooks):

| key | text | answer | public_code (this run) |
|---|---|---|---|
| A | `3x + 7 = 22` | 5 | HQB-000001 |
| B | `x² - 5x + 6 = 0` | 2, 3 | HQB-000002 |
| C | 두 자연수 합 10, 곱 최대 | 25 | HQB-000003 |

---

## 14. Test results (2026-09-07)

All STEP 3 acceptance tests **PASS**:

taxonomy seed, A/B/C insert, A full bundle fetch, public_code unique, source N:M, version lifecycle, HUMAN/MODEL/CALIBRATED coexistence, difficulty 0/6 rejected, duplicate public_code rejected, duplicate version rejected, orphan FK rejected, invalid review_status rejected, required field rejected, anon INSERT/UPDATE/SELECT denied.

A fetch reconstructed one JSON object via subquery aggregates (no cartesian explosion). Overall HUMAN difficulty for A = `1.00`. MODEL overall on A v2 = `1.17` = round((1+2+1+1+1+1)/6, 2).

---

## 15. Differences from Design Freeze (naming / physical choices)

| Freeze | Implementation | Why |
|---|---|---|
| `problem_concept_links` | `problem_concepts` | STEP 3 CORE table name |
| `problem_type_links` | `problem_type_assignments` | STEP 3 CORE table name |
| `problem_strategies` | `problem_strategy_assignments` | STEP 3 CORE table name; ordered steps stay on templates |
| `year` | `publication_year` | STEP 3 source_documents field |
| CHECK vs ENUM | TEXT + CHECK | STEP 3 final rule |
| `problem_embeddings.vector` | table omitted | no pgvector this STEP |
| sample C DISTINCT → 24 | STEP 3 C allows 5×5 → 25 | followed STEP 3 fixture spec |

Freeze `lifecycle_status` / `use_status` are implemented **in addition to** STEP 3 `review_status`.

---

## 16. Not implemented (intentionally)

OCR / Math OCR / LLM classification / embeddings / vector search / twin scoring / twin threshold / relation cache TTL / Storage buckets / upload UI / search UI / worksheet UI / Auth role metadata / automatic audit triggers on every table / taxonomy auto-expansion / commercial-textbook import.

---

## 17. Known limits

- No local Supabase Docker in this environment. Migration was applied to the **new remote** Question Bank project only. Remote was **not** reset.
- Re-running fixtures inserts additional problems (sequence continues; gaps OK). This run started at HQB-000001 because the project was empty.
- `authenticated` SELECT is broad (minimum teacher read). Fine-grained ADMIN/TEACHER/REVIEWER policies are not mapped yet because Auth app metadata does not exist.
- `hqb_fetch_problem_bundle` returns the **current** version’s classification. Past versions are queryable by `problem_version_id` directly.
- Overall difficulty formula is v1 mean only.
- Test problem C uses STEP 3 wording (answer 25). Freeze validation sample C used DISTINCT (answer 24).
