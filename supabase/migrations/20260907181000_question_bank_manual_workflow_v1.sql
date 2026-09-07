-- HYPER QUESTION BANK — MANUAL WORKFLOW v1
-- Additive only. Do not apply to HYPER STUDENT CARE.
-- No DROP TABLE/SCHEMA/DATABASE, no TRUNCATE, no rewrite of STEP 3 migration.

-- ---------------------------------------------------------------------------
-- Staff profiles (real Auth users, not fake accounts)
-- Role lives here (not invented JWT claims on the client).
-- First user is TEACHER; academy owner claims ADMIN via hqb_bootstrap_admin.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  role text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_role_chk CHECK (role IN ('ADMIN', 'TEACHER', 'REVIEWER'))
);

CREATE INDEX IF NOT EXISTS user_profiles_role_idx ON public.user_profiles (role);

DROP TRIGGER IF EXISTS user_profiles_set_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

CREATE OR REPLACE FUNCTION public.hqb_current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.hqb_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND role IN ('ADMIN', 'TEACHER', 'REVIEWER')
  );
$$;

CREATE OR REPLACE FUNCTION public.hqb_can_write_draft()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.hqb_current_role() IN ('ADMIN', 'TEACHER', 'REVIEWER');
$$;

CREATE OR REPLACE FUNCTION public.hqb_can_review()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.hqb_current_role() IN ('ADMIN', 'REVIEWER');
$$;

CREATE OR REPLACE FUNCTION public.hqb_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, role, display_name)
  VALUES (NEW.id, 'TEACHER', COALESCE(NEW.email, 'staff'))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_handle_new_user();

CREATE OR REPLACE FUNCTION public.hqb_has_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE role = 'ADMIN');
$$;

CREATE OR REPLACE FUNCTION public.hqb_bootstrap_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'HQB_UNAUTHENTICATED: 로그인이 필요합니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE role = 'ADMIN') THEN
    RAISE EXCEPTION 'HQB_ADMIN_EXISTS: 이미 관리자 계정이 있습니다.';
  END IF;
  INSERT INTO public.user_profiles (user_id, role, display_name)
  VALUES (uid, 'ADMIN', uid::text)
  ON CONFLICT (user_id) DO UPDATE
    SET role = 'ADMIN';
  RETURN jsonb_build_object('user_id', uid, 'role', 'ADMIN');
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_my_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p)
  FROM public.user_profiles p
  WHERE p.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.hqb_audit(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_after jsonb DEFAULT NULL,
  p_before jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_events (entity_type, entity_id, action, actor, before_snapshot, after_snapshot)
  VALUES (
    p_entity_type,
    p_entity_id,
    p_action,
    NULLIF(auth.uid()::text, ''),
    p_before,
    p_after
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Version graph writer (draft create/update)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_require_staff_writer()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'HQB_UNAUTHENTICATED: 로그인이 필요합니다.';
  END IF;
  IF NOT public.hqb_can_write_draft() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: 문제 초안을 저장할 권한이 없습니다.';
  END IF;
  RETURN uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_require_reviewer()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'HQB_UNAUTHENTICATED: 로그인이 필요합니다.';
  END IF;
  IF NOT public.hqb_can_review() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: 이 문제는 검수 권한이 있는 계정만 확정할 수 있습니다.';
  END IF;
  RETURN uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_ensure_source(p_source jsonb)
RETURNS TABLE (source_document_id uuid, source_page_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc_id uuid;
  page_id uuid;
  page_no integer;
  new_doc jsonb;
BEGIN
  IF p_source IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_SOURCE: 출처를 지정해 주세요.';
  END IF;
  page_no := COALESCE((p_source->>'page_number')::integer, 1);
  IF page_no < 1 THEN
    RAISE EXCEPTION 'HQB_INVALID_PAGE: 페이지 번호가 올바르지 않습니다.';
  END IF;

  IF p_source ? 'source_document_id' AND NULLIF(p_source->>'source_document_id', '') IS NOT NULL THEN
    doc_id := (p_source->>'source_document_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.source_documents d WHERE d.id = doc_id) THEN
      RAISE EXCEPTION 'HQB_INVALID_SOURCE: 선택한 출처가 없습니다.';
    END IF;
  ELSE
    new_doc := COALESCE(p_source->'new_document', '{}'::jsonb);
    IF NULLIF(new_doc->>'title', '') IS NULL THEN
      RAISE EXCEPTION 'HQB_MISSING_SOURCE: 자료명을 입력해 주세요.';
    END IF;
    INSERT INTO public.source_documents (
      title, publisher, author, publication_year, edition, document_type,
      source_type, license_status, usage_scope, copyright_note, page_count
    ) VALUES (
      new_doc->>'title',
      NULLIF(new_doc->>'publisher', ''),
      NULLIF(new_doc->>'author', ''),
      NULLIF(new_doc->>'publication_year', '')::integer,
      NULLIF(new_doc->>'edition', ''),
      COALESCE(NULLIF(new_doc->>'document_type', ''), 'TEACHER_CREATED'),
      NULLIF(new_doc->>'source_type', ''),
      COALESCE(NULLIF(new_doc->>'license_status', ''), 'UNKNOWN'),
      NULLIF(new_doc->>'usage_scope', ''),
      NULLIF(new_doc->>'copyright_note', ''),
      GREATEST(page_no, 1)
    )
    RETURNING id INTO doc_id;
  END IF;

  SELECT sp.id INTO page_id
  FROM public.source_pages sp
  WHERE sp.source_document_id = doc_id AND sp.page_number = page_no;

  IF page_id IS NULL THEN
    INSERT INTO public.source_pages (
      source_document_id, page_number, extraction_status, review_status
    ) VALUES (doc_id, page_no, 'MANUAL', 'UNREVIEWED')
    RETURNING id INTO page_id;
  END IF;

  source_document_id := doc_id;
  source_page_id := page_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_replace_version_graph(p_version_id uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  dim int;
  choice_id uuid;
  answer jsonb;
  expl jsonb;
  diff jsonb;
BEGIN
  DELETE FROM public.problem_answers WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_choices WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_explanations WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_curriculum WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_concepts WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_type_assignments WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_strategy_assignments WHERE problem_version_id = p_version_id;
  DELETE FROM public.math_expressions WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_conditions WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_targets WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_reasoning WHERE problem_version_id = p_version_id;
  DELETE FROM public.problem_difficulty WHERE problem_version_id = p_version_id AND difficulty_source = 'HUMAN';

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'curriculum_node_ids', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_curriculum (problem_version_id, curriculum_node_id, is_primary)
    VALUES (p_version_id, (item #>> '{}')::uuid, true)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'concepts', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_concepts (
      problem_version_id, concept_id, is_primary, weight, application_role, confidence, assigned_by
    ) VALUES (
      p_version_id,
      (item->>'concept_id')::uuid,
      COALESCE((item->>'is_primary')::boolean, false),
      COALESCE((item->>'weight')::numeric, CASE WHEN COALESCE((item->>'is_primary')::boolean, false) THEN 1 ELSE 0.5 END),
      COALESCE(NULLIF(item->>'application_role', ''), 'SOLVE_WITH'),
      COALESCE((item->>'confidence')::numeric, 1),
      auth.uid()::text
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'type_ids', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_type_assignments (
      problem_version_id, hyper_problem_type_id, is_primary, confidence, assigned_by
    ) VALUES (
      p_version_id, (item #>> '{}')::uuid, true, 1, auth.uid()::text
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'strategy_ids', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_strategy_assignments (
      problem_version_id, strategy_template_id, is_primary, confidence, assigned_by
    ) VALUES (
      p_version_id, (item #>> '{}')::uuid, true, 1, auth.uid()::text
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'expressions', '[]'::jsonb))
  LOOP
    INSERT INTO public.math_expressions (
      problem_version_id, expression_role, original_expression, normalized_expression,
      latex_expression, structure_skeleton, structure_tags, sort_order
    ) VALUES (
      p_version_id,
      COALESCE(NULLIF(item->>'expression_role', ''), 'TARGET'),
      item->>'original_expression',
      NULLIF(item->>'normalized_expression', ''),
      NULLIF(item->>'latex_expression', ''),
      NULLIF(item->>'structure_skeleton', ''),
      COALESCE(item->'structure_tags', '[]'::jsonb),
      COALESCE((item->>'sort_order')::integer, 1)
    );
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'condition_ids', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_conditions (
      problem_version_id, condition_term_id, assignment_status, assigned_by
    ) VALUES (p_version_id, (item #>> '{}')::uuid, 'APPROVED', auth.uid()::text)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'target_ids', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_targets (
      problem_version_id, target_term_id, assignment_status, is_primary, assigned_by
    ) VALUES (p_version_id, (item #>> '{}')::uuid, 'APPROVED', true, auth.uid()::text)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'reasoning_ids', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_reasoning (
      problem_version_id, reasoning_term_id, assigned_by
    ) VALUES (p_version_id, (item #>> '{}')::uuid, auth.uid()::text)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'choices', '[]'::jsonb))
  LOOP
    INSERT INTO public.problem_choices (
      problem_version_id, choice_order, label, choice_text, normalized_text, math_expression
    ) VALUES (
      p_version_id,
      COALESCE((item->>'choice_order')::integer, 1),
      COALESCE(NULLIF(item->>'label', ''), (item->>'choice_order')),
      COALESCE(item->>'choice_text', ''),
      NULLIF(item->>'normalized_text', ''),
      NULLIF(item->>'math_expression', '')
    );
  END LOOP;

  answer := p_payload->'answer';
  IF answer IS NOT NULL AND NULLIF(answer->>'answer_type', '') IS NOT NULL THEN
    SELECT c.id INTO choice_id
    FROM public.problem_choices c
    WHERE c.problem_version_id = p_version_id
      AND c.choice_order = COALESCE((answer->>'choice_order')::integer, -1)
    LIMIT 1;
    INSERT INTO public.problem_answers (
      problem_version_id, answer_type, answer_text, normalized_answer, choice_id, numeric_value, metadata
    ) VALUES (
      p_version_id,
      answer->>'answer_type',
      NULLIF(answer->>'answer_text', ''),
      NULLIF(answer->>'normalized_answer', ''),
      choice_id,
      NULLIF(answer->>'numeric_value', '')::numeric,
      COALESCE(answer->'metadata', '{}'::jsonb)
    );
  END IF;

  expl := p_payload->'explanation';
  IF expl IS NOT NULL AND NULLIF(expl->>'content', '') IS NOT NULL THEN
    INSERT INTO public.problem_explanations (
      problem_version_id, explanation_type, content, created_by
    ) VALUES (
      p_version_id,
      COALESCE(NULLIF(expl->>'explanation_type', ''), 'TEACHER'),
      expl->>'content',
      auth.uid()::text
    );
  END IF;

  diff := p_payload->'difficulty';
  IF diff IS NOT NULL AND diff <> 'null'::jsonb THEN
    FOREACH dim IN ARRAY ARRAY[
      COALESCE((diff->>'concept_difficulty')::int, 0),
      COALESCE((diff->>'calculation_complexity')::int, 0),
      COALESCE((diff->>'reasoning_depth')::int, 0),
      COALESCE((diff->>'condition_complexity')::int, 0),
      COALESCE((diff->>'representation_complexity')::int, 0),
      COALESCE((diff->>'trap_level')::int, 0)
    ]
    LOOP
      IF dim < 1 OR dim > 5 THEN
        RAISE EXCEPTION 'HQB_INVALID_DIFFICULTY: 난이도는 각 차원마다 1부터 5 사이여야 합니다.';
      END IF;
    END LOOP;
    INSERT INTO public.problem_difficulty (
      problem_version_id, difficulty_source,
      concept_difficulty, calculation_complexity, reasoning_depth,
      condition_complexity, representation_complexity, trap_level, created_by
    ) VALUES (
      p_version_id, 'HUMAN',
      (diff->>'concept_difficulty')::int,
      (diff->>'calculation_complexity')::int,
      (diff->>'reasoning_depth')::int,
      (diff->>'condition_complexity')::int,
      (diff->>'representation_complexity')::int,
      (diff->>'trap_level')::int,
      auth.uid()::text
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_assert_verify_gate(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.problem_versions%ROWTYPE;
  src_count int;
  license text;
BEGIN
  SELECT * INTO v FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF NULLIF(btrim(v.problem_text), '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TEXT: 문제 본문을 입력해 주세요.';
  END IF;

  SELECT count(*) INTO src_count
  FROM public.problem_sources s
  WHERE s.problem_id = v.problem_id;
  IF src_count < 1 THEN
    RAISE EXCEPTION 'HQB_MISSING_SOURCE: 출처를 지정해 주세요.';
  END IF;

  SELECT d.license_status INTO license
  FROM public.problem_sources s
  JOIN public.source_documents d ON d.id = s.source_document_id
  WHERE s.problem_id = v.problem_id
  ORDER BY s.is_primary_source DESC
  LIMIT 1;
  IF NULLIF(license, '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_LICENSE: 저작권/라이선스 상태를 지정해 주세요.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.problem_curriculum c WHERE c.problem_version_id = p_version_id) THEN
    RAISE EXCEPTION 'HQB_MISSING_CURRICULUM: 교육과정을 지정해 주세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.problem_concepts c
    WHERE c.problem_version_id = p_version_id AND c.is_primary
  ) THEN
    RAISE EXCEPTION 'HQB_MISSING_PRIMARY_CONCEPT: 핵심 개념을 하나 이상 선택해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problem_type_assignments t WHERE t.problem_version_id = p_version_id) THEN
    RAISE EXCEPTION 'HQB_MISSING_TYPE: HYPER 표준 문제유형을 선택해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problem_strategy_assignments s WHERE s.problem_version_id = p_version_id) THEN
    RAISE EXCEPTION 'HQB_MISSING_STRATEGY: 풀이전략을 선택해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problem_targets t WHERE t.problem_version_id = p_version_id) THEN
    RAISE EXCEPTION 'HQB_MISSING_TARGET: 목표(target)를 하나 이상 선택해 주세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.problem_difficulty d
    WHERE d.problem_version_id = p_version_id AND d.difficulty_source = 'HUMAN'
  ) THEN
    RAISE EXCEPTION 'HQB_MISSING_DIFFICULTY: 6차원 난이도(HUMAN)를 입력해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problem_answers a WHERE a.problem_version_id = p_version_id) THEN
    RAISE EXCEPTION 'HQB_MISSING_ANSWER: 정답을 입력해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.math_expressions e WHERE e.problem_version_id = p_version_id) THEN
    RAISE EXCEPTION 'HQB_MISSING_EXPRESSION: 수식을 하나 이상 입력해 주세요.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_create_problem_draft(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  src record;
  problem_id uuid;
  version_id uuid;
  public_code text;
  item_format text;
  origin text;
  normalized text;
BEGIN
  uid := public.hqb_require_staff_writer();
  IF NULLIF(btrim(COALESCE(payload->'version'->>'problem_text', '')), '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TEXT: 문제 본문을 입력해 주세요.';
  END IF;
  SELECT * INTO src FROM public.hqb_ensure_source(payload->'source') LIMIT 1;
  item_format := COALESCE(NULLIF(payload->'version'->>'item_format', ''), 'SHORT_ANSWER');
  origin := COALESCE(NULLIF(payload->'version'->>'origin', ''), 'TEACHER_EDIT');
  normalized := COALESCE(
    NULLIF(payload->'version'->>'normalized_text', ''),
    payload->'version'->>'problem_text'
  );

  INSERT INTO public.problems (review_status, lifecycle_status, use_status)
  VALUES ('UNREVIEWED', 'DRAFT', 'INTERNAL_ONLY')
  RETURNING id, public_code INTO problem_id, public_code;

  INSERT INTO public.problem_versions (
    problem_id, version_no, origin, problem_text, normalized_text, instruction,
    item_format, choice_count, content_metadata, extraction_status,
    classification_status, review_status, created_by
  ) VALUES (
    problem_id, 1, origin,
    payload->'version'->>'problem_text',
    normalized,
    NULLIF(payload->'version'->>'instruction', ''),
    item_format,
    COALESCE(jsonb_array_length(payload->'choices'), 0),
    jsonb_build_object('workflow', 'MANUAL_V1'),
    'MANUAL', 'DRAFT', 'UNREVIEWED', uid::text
  )
  RETURNING id INTO version_id;

  UPDATE public.problems
  SET current_version_id = version_id
  WHERE id = problem_id;

  INSERT INTO public.problem_sources (
    problem_id, source_document_id, source_page_id, original_problem_number,
    source_type_label, is_primary_source
  ) VALUES (
    problem_id, src.source_document_id, src.source_page_id,
    NULLIF(payload->'source'->>'original_problem_number', ''),
    NULLIF(payload->'source'->>'source_type_label', ''),
    true
  );

  PERFORM public.hqb_replace_version_graph(version_id, payload);
  PERFORM public.hqb_audit(
    'problem', problem_id, 'CREATE_PROBLEM',
    jsonb_build_object('public_code', public_code, 'version_id', version_id)
  );

  RETURN jsonb_build_object(
    'problem_id', problem_id,
    'version_id', version_id,
    'public_code', public_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_update_draft_version(p_version_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v public.problem_versions%ROWTYPE;
  src record;
  normalized text;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO v FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF v.review_status = 'VERIFIED' THEN
    RAISE EXCEPTION 'HQB_VERIFIED_LOCKED: VERIFIED 버전은 덮어쓸 수 없습니다. 새 버전을 만드세요.';
  END IF;
  IF NULLIF(btrim(COALESCE(payload->'version'->>'problem_text', v.problem_text)), '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TEXT: 문제 본문을 입력해 주세요.';
  END IF;
  normalized := COALESCE(
    NULLIF(payload->'version'->>'normalized_text', ''),
    payload->'version'->>'problem_text',
    v.normalized_text
  );
  UPDATE public.problem_versions SET
    problem_text = COALESCE(payload->'version'->>'problem_text', problem_text),
    normalized_text = normalized,
    instruction = COALESCE(NULLIF(payload->'version'->>'instruction', ''), instruction),
    item_format = COALESCE(NULLIF(payload->'version'->>'item_format', ''), item_format),
    choice_count = COALESCE(jsonb_array_length(payload->'choices'), choice_count),
    change_reason = NULLIF(payload->'version'->>'change_reason', ''),
    classification_status = 'DRAFT'
  WHERE id = p_version_id;

  IF payload ? 'source' THEN
    SELECT * INTO src FROM public.hqb_ensure_source(payload->'source') LIMIT 1;
    DELETE FROM public.problem_sources WHERE problem_id = v.problem_id AND is_primary_source;
    INSERT INTO public.problem_sources (
      problem_id, source_document_id, source_page_id, original_problem_number,
      source_type_label, is_primary_source
    ) VALUES (
      v.problem_id, src.source_document_id, src.source_page_id,
      NULLIF(payload->'source'->>'original_problem_number', ''),
      NULLIF(payload->'source'->>'source_type_label', ''),
      true
    );
  END IF;

  PERFORM public.hqb_replace_version_graph(p_version_id, payload);
  PERFORM public.hqb_audit('problem_version', p_version_id, 'UPDATE_DRAFT', jsonb_build_object('problem_id', v.problem_id));
  RETURN jsonb_build_object('problem_id', v.problem_id, 'version_id', p_version_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_clone_problem_version(
  p_problem_id uuid,
  p_change_reason text DEFAULT NULL,
  p_content_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  src public.problem_versions%ROWTYPE;
  new_id uuid;
  next_no int;
  old_choice record;
  new_choice_id uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO src
  FROM public.problem_versions
  WHERE problem_id = p_problem_id
  ORDER BY version_no DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  -- Prefer cloning the current verified snapshot when it exists.
  IF EXISTS (
    SELECT 1 FROM public.problems p
    JOIN public.problem_versions cv ON cv.id = p.current_version_id
    WHERE p.id = p_problem_id AND cv.review_status = 'VERIFIED'
  ) THEN
    SELECT pv.* INTO src
    FROM public.problems p
    JOIN public.problem_versions pv ON pv.id = p.current_version_id
    WHERE p.id = p_problem_id;
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1 INTO next_no
  FROM public.problem_versions WHERE problem_id = p_problem_id;

  INSERT INTO public.problem_versions (
    problem_id, version_no, origin, parent_version_id, change_reason,
    problem_text, normalized_text, instruction, item_format, choice_count,
    content_metadata, extraction_status, classification_status, review_status, created_by
  ) VALUES (
    p_problem_id, next_no, 'TEACHER_EDIT', src.id, p_change_reason,
    COALESCE(p_content_overrides->>'problem_text', src.problem_text),
    COALESCE(p_content_overrides->>'normalized_text', src.normalized_text),
    COALESCE(p_content_overrides->>'instruction', src.instruction),
    src.item_format, src.choice_count, src.content_metadata,
    src.extraction_status, 'DRAFT', 'UNREVIEWED', uid::text
  )
  RETURNING id INTO new_id;

  INSERT INTO public.problem_curriculum (problem_version_id, curriculum_node_id, is_primary)
  SELECT new_id, curriculum_node_id, is_primary FROM public.problem_curriculum WHERE problem_version_id = src.id;
  INSERT INTO public.problem_concepts (
    problem_version_id, concept_id, is_primary, weight, application_role, confidence, assigned_by
  )
  SELECT new_id, concept_id, is_primary, weight, application_role, confidence, assigned_by
  FROM public.problem_concepts WHERE problem_version_id = src.id;
  INSERT INTO public.problem_type_assignments (
    problem_version_id, hyper_problem_type_id, is_primary, confidence, assigned_by
  )
  SELECT new_id, hyper_problem_type_id, is_primary, confidence, assigned_by
  FROM public.problem_type_assignments WHERE problem_version_id = src.id;
  INSERT INTO public.problem_strategy_assignments (
    problem_version_id, strategy_template_id, is_primary, confidence, assigned_by
  )
  SELECT new_id, strategy_template_id, is_primary, confidence, assigned_by
  FROM public.problem_strategy_assignments WHERE problem_version_id = src.id;
  INSERT INTO public.math_expressions (
    problem_version_id, expression_role, original_expression, normalized_expression,
    latex_expression, structure_skeleton, structure_tags, sort_order
  )
  SELECT new_id, expression_role, original_expression, normalized_expression,
         latex_expression, structure_skeleton, structure_tags, sort_order
  FROM public.math_expressions WHERE problem_version_id = src.id;
  INSERT INTO public.problem_conditions (problem_version_id, condition_term_id, assignment_status, assigned_by)
  SELECT new_id, condition_term_id, assignment_status, assigned_by
  FROM public.problem_conditions WHERE problem_version_id = src.id;
  INSERT INTO public.problem_targets (problem_version_id, target_term_id, assignment_status, is_primary, assigned_by)
  SELECT new_id, target_term_id, assignment_status, is_primary, assigned_by
  FROM public.problem_targets WHERE problem_version_id = src.id;
  INSERT INTO public.problem_reasoning (problem_version_id, reasoning_term_id, assigned_by)
  SELECT new_id, reasoning_term_id, assigned_by
  FROM public.problem_reasoning WHERE problem_version_id = src.id;
  INSERT INTO public.problem_difficulty (
    problem_version_id, difficulty_source, concept_difficulty, calculation_complexity,
    reasoning_depth, condition_complexity, representation_complexity, trap_level, created_by
  )
  SELECT new_id, difficulty_source, concept_difficulty, calculation_complexity,
         reasoning_depth, condition_complexity, representation_complexity, trap_level, created_by
  FROM public.problem_difficulty
  WHERE problem_version_id = src.id AND difficulty_source = 'HUMAN';
  INSERT INTO public.problem_explanations (problem_version_id, explanation_type, content, created_by)
  SELECT new_id, explanation_type, content, created_by
  FROM public.problem_explanations WHERE problem_version_id = src.id;
  INSERT INTO public.problem_assets (
    problem_version_id, asset_type, storage_path, url, alt_text, metadata
  )
  SELECT new_id, asset_type, storage_path, url, alt_text, metadata
  FROM public.problem_assets WHERE problem_version_id = src.id;

  FOR old_choice IN
    SELECT * FROM public.problem_choices WHERE problem_version_id = src.id ORDER BY choice_order
  LOOP
    INSERT INTO public.problem_choices (
      problem_version_id, choice_order, label, choice_text, normalized_text, math_expression
    ) VALUES (
      new_id, old_choice.choice_order, old_choice.label, old_choice.choice_text,
      old_choice.normalized_text, old_choice.math_expression
    )
    RETURNING id INTO new_choice_id;
    INSERT INTO public.problem_answers (
      problem_version_id, answer_type, answer_text, normalized_answer, choice_id, numeric_value, metadata
    )
    SELECT new_id, a.answer_type, a.answer_text, a.normalized_answer, new_choice_id, a.numeric_value, a.metadata
    FROM public.problem_answers a
    WHERE a.problem_version_id = src.id AND a.choice_id = old_choice.id;
  END LOOP;

  INSERT INTO public.problem_answers (
    problem_version_id, answer_type, answer_text, normalized_answer, choice_id, numeric_value, metadata
  )
  SELECT new_id, a.answer_type, a.answer_text, a.normalized_answer, NULL, a.numeric_value, a.metadata
  FROM public.problem_answers a
  WHERE a.problem_version_id = src.id AND a.choice_id IS NULL;

  -- current_version_id is intentionally NOT changed here.
  PERFORM public.hqb_audit(
    'problem', p_problem_id, 'CREATE_VERSION',
    jsonb_build_object('new_version_id', new_id, 'parent_version_id', src.id, 'version_no', next_no)
  );
  RETURN jsonb_build_object(
    'problem_id', p_problem_id,
    'version_id', new_id,
    'version_no', next_no,
    'cloned_from', src.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_submit_for_review(p_version_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v public.problem_versions%ROWTYPE;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO v FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF v.review_status = 'VERIFIED' THEN
    RAISE EXCEPTION 'HQB_VERIFIED_LOCKED: 이미 확정된 버전입니다.';
  END IF;
  UPDATE public.problem_versions SET review_status = 'NEEDS_REVIEW' WHERE id = p_version_id;
  IF (
    SELECT current_version_id FROM public.problems WHERE id = v.problem_id
  ) = p_version_id THEN
    UPDATE public.problems SET review_status = 'NEEDS_REVIEW' WHERE id = v.problem_id;
  END IF;
  INSERT INTO public.reviews (problem_id, problem_version_id, status, reviewer, note, reviewed_at)
  VALUES (v.problem_id, p_version_id, 'NEEDS_REVIEW', uid::text, p_note, now());
  PERFORM public.hqb_audit('problem_version', p_version_id, 'SUBMIT_REVIEW', jsonb_build_object('note', p_note));
  RETURN jsonb_build_object('version_id', p_version_id, 'status', 'NEEDS_REVIEW');
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_verify_problem_version(p_version_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v public.problem_versions%ROWTYPE;
BEGIN
  uid := public.hqb_require_reviewer();
  PERFORM public.hqb_assert_verify_gate(p_version_id);
  SELECT * INTO v FROM public.problem_versions WHERE id = p_version_id;
  UPDATE public.problem_versions
  SET review_status = 'VERIFIED', classification_status = 'VERIFIED'
  WHERE id = p_version_id;
  UPDATE public.problems
  SET
    current_version_id = p_version_id,
    review_status = 'VERIFIED',
    lifecycle_status = 'ACTIVE'
  WHERE id = v.problem_id;
  INSERT INTO public.reviews (problem_id, problem_version_id, status, reviewer, note, reviewed_at)
  VALUES (v.problem_id, p_version_id, 'VERIFIED', uid::text, p_note, now());
  PERFORM public.hqb_audit(
    'problem', v.problem_id, 'VERIFY_VERSION',
    jsonb_build_object('version_id', p_version_id)
  );
  RETURN jsonb_build_object(
    'problem_id', v.problem_id,
    'version_id', p_version_id,
    'review_status', 'VERIFIED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_reject_problem_version(p_version_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v public.problem_versions%ROWTYPE;
  cur uuid;
BEGIN
  uid := public.hqb_require_reviewer();
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_NOTE: 반려 사유를 입력해 주세요.';
  END IF;
  SELECT * INTO v FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  SELECT current_version_id INTO cur FROM public.problems WHERE id = v.problem_id;
  UPDATE public.problem_versions SET review_status = 'REJECTED' WHERE id = p_version_id;
  IF cur = p_version_id THEN
    UPDATE public.problems SET review_status = 'REJECTED' WHERE id = v.problem_id;
  END IF;
  INSERT INTO public.reviews (problem_id, problem_version_id, status, reviewer, note, reviewed_at)
  VALUES (v.problem_id, p_version_id, 'REJECTED', uid::text, p_note, now());
  PERFORM public.hqb_audit('problem_version', p_version_id, 'REJECT_VERSION', jsonb_build_object('note', p_note));
  RETURN jsonb_build_object('version_id', p_version_id, 'status', 'REJECTED');
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS: staff SELECT only. Writes remain RPC-only for authenticated.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.user_profiles;
CREATE POLICY qbank_staff_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'curriculum_frameworks', 'curriculum_nodes', 'concepts', 'concept_curriculum_placements',
    'hyper_problem_types', 'strategy_templates', 'strategy_template_steps',
    'condition_terms', 'target_terms', 'reasoning_terms', 'taxonomy_candidates',
    'source_documents', 'source_pages', 'school_exam_profiles',
    'problems', 'problem_versions', 'problem_sources', 'problem_curriculum',
    'problem_concepts', 'problem_type_assignments', 'problem_strategy_assignments',
    'math_expressions', 'problem_conditions', 'problem_targets', 'problem_reasoning',
    'problem_difficulty', 'problem_assets', 'problem_choices', 'problem_answers',
    'problem_explanations', 'reviews', 'audit_events',
    'content_fingerprints', 'verified_problem_relations', 'worksheets', 'worksheet_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS qbank_authenticated_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS qbank_staff_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY qbank_staff_select ON public.%I FOR SELECT TO authenticated USING (public.hqb_is_staff())',
      t
    );
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.hqb_replace_version_graph(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_ensure_source(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_assert_verify_gate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_audit(text, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_require_staff_writer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_require_reviewer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.hqb_current_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_is_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_can_write_draft() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_can_review() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_has_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hqb_bootstrap_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_my_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_create_problem_draft(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_update_draft_version(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_clone_problem_version(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_submit_for_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_verify_problem_version(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_reject_problem_version(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_can_write_draft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_can_review() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_has_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_bootstrap_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_create_problem_draft(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_update_draft_version(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_clone_problem_version(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_submit_for_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_verify_problem_version(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_reject_problem_version(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_fetch_problem_bundle(text) TO authenticated;

COMMENT ON TABLE public.user_profiles IS
  'STEP 4 staff roles. ADMIN/TEACHER/REVIEWER. SYSTEM_PROCESS is not a login role.';
COMMENT ON FUNCTION public.hqb_clone_problem_version(uuid, text, jsonb) IS
  'Copies HUMAN content/classification. Does not copy reviews or MODEL/CALIBRATED difficulty. Does not switch current_version_id.';
COMMENT ON FUNCTION public.hqb_verify_problem_version(uuid, text) IS
  'REVIEWER/ADMIN only. Validation gate + review append + current_version switch in one transaction.';
