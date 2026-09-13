-- STEP 8.35 — Instructor WYSIWYG / math editor + A4 worksheets (additive)
-- Project: hyper-question-bank ONLY (owpxsmdcxjmsgadkdsci)
-- Never writes VERIFIED. Never hard-deletes problems. Never touches student-care.

-- ---------------------------------------------------------------------------
-- 1. Optimistic lock + worksheet layout (additive columns)
-- ---------------------------------------------------------------------------

ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS editor_revision integer NOT NULL DEFAULT 0;

ALTER TABLE public.worksheets
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exam_kind text NOT NULL DEFAULT 'EXAM';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'worksheets_exam_kind_chk'
  ) THEN
    ALTER TABLE public.worksheets
      ADD CONSTRAINT worksheets_exam_kind_chk
      CHECK (exam_kind IN ('EXAM', 'ANSWER_SHEET'));
  END IF;
END $$;

ALTER TABLE public.worksheet_items
  ADD COLUMN IF NOT EXISTS spacing_mm numeric,
  ADD COLUMN IF NOT EXISTS points numeric,
  ADD COLUMN IF NOT EXISTS force_page_break boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_style jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.problems.editor_revision IS
  'Optimistic lock for the instructor editor. Bumped on explicit Save / restore, never on autosave.';

-- ---------------------------------------------------------------------------
-- 2. Local+server autosave (does not create versions, never VERIFIED)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.editor_autosaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  base_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE RESTRICT,
  staff_user_id uuid NOT NULL,
  document jsonb NOT NULL,
  client_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editor_autosaves_staff_problem_key UNIQUE (problem_id, staff_user_id)
);

CREATE INDEX IF NOT EXISTS editor_autosaves_problem_idx
  ON public.editor_autosaves (problem_id);

ALTER TABLE public.editor_autosaves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.editor_autosaves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.editor_autosaves TO authenticated;
GRANT ALL ON TABLE public.editor_autosaves TO service_role;

DROP POLICY IF EXISTS editor_autosaves_staff_select ON public.editor_autosaves;
CREATE POLICY editor_autosaves_staff_select ON public.editor_autosaves
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff() AND staff_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Image bucket for editor assets (not PDF originals)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'question-bank-assets',
  'question-bank-assets',
  false,
  8388608,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS qbank_assets_select ON storage.objects;
DROP POLICY IF EXISTS qbank_assets_insert ON storage.objects;
DROP POLICY IF EXISTS qbank_assets_update ON storage.objects;
DROP POLICY IF EXISTS qbank_assets_delete ON storage.objects;

CREATE POLICY qbank_assets_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'question-bank-assets' AND public.hqb_is_staff());

CREATE POLICY qbank_assets_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-bank-assets' AND public.hqb_is_staff());

CREATE POLICY qbank_assets_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'question-bank-assets' AND public.hqb_current_role() = 'ADMIN');

-- ---------------------------------------------------------------------------
-- 4. Fork any version as a new TEACHER_EDIT row (does not mutate source,
--    does not set VERIFIED, does not change current_version_id by itself)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_fork_problem_version(
  p_version_id uuid,
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
  meta jsonb;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO src FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.problems p
    WHERE p.id = src.problem_id AND p.lifecycle_status = 'ARCHIVED'
  ) THEN
    RAISE EXCEPTION 'HQB_ARCHIVED: 보관된 문제는 복원한 뒤에 편집할 수 있습니다.';
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1 INTO next_no
  FROM public.problem_versions WHERE problem_id = src.problem_id;

  meta := COALESCE(src.content_metadata, '{}'::jsonb);
  IF p_content_overrides ? 'content_metadata' THEN
    meta := meta || COALESCE(p_content_overrides->'content_metadata', '{}'::jsonb);
  END IF;
  IF p_content_overrides ? 'editor_document' THEN
    meta := meta || jsonb_build_object(
      'editor_document', p_content_overrides->'editor_document',
      'editor_schema_version', 1
    );
  END IF;

  INSERT INTO public.problem_versions (
    problem_id, version_no, origin, parent_version_id, change_reason,
    problem_text, normalized_text, instruction, item_format, choice_count,
    content_metadata, extraction_status, classification_status, review_status, created_by
  ) VALUES (
    src.problem_id,
    next_no,
    'TEACHER_EDIT',
    src.id,
    p_change_reason,
    COALESCE(p_content_overrides->>'problem_text', src.problem_text),
    COALESCE(p_content_overrides->>'normalized_text', src.normalized_text),
    COALESCE(p_content_overrides->>'instruction', src.instruction),
    COALESCE(NULLIF(p_content_overrides->>'item_format', ''), src.item_format),
    src.choice_count,
    meta,
    src.extraction_status,
    'DRAFT',
    'UNREVIEWED',
    uid::text
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

  PERFORM public.hqb_audit(
    'problem', src.problem_id, 'FORK_VERSION',
    jsonb_build_object(
      'new_version_id', new_id,
      'parent_version_id', src.id,
      'version_no', next_no,
      'review_status', 'UNREVIEWED'
    )
  );

  RETURN jsonb_build_object(
    'problem_id', src.problem_id,
    'version_id', new_id,
    'parent_version_id', src.id,
    'version_no', next_no
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Explicit Save: always a new TEACHER_EDIT version + optimistic lock
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_save_editor_document(p_version_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  src public.problem_versions%ROWTYPE;
  forked jsonb;
  new_id uuid;
  expected int;
  locked int;
  item_format text;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO src FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF src.review_status = 'VERIFIED' THEN
    RAISE EXCEPTION 'HQB_VERIFIED_LOCKED: VERIFIED 버전은 덮어쓸 수 없습니다. 새 버전을 만드세요.';
  END IF;
  IF NULLIF(btrim(COALESCE(payload->'version'->>'problem_text', src.problem_text)), '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TEXT: 문제 본문을 입력해 주세요.';
  END IF;
  IF COALESCE(payload->>'review_status', '') IN ('VERIFIED', 'WORKSHEET_ELIGIBLE')
     OR COALESCE(payload->'version'->>'review_status', '') = 'VERIFIED' THEN
    RAISE EXCEPTION 'HQB_NO_VERIFY: 편집 저장은 VERIFIED를 설정하지 않습니다.';
  END IF;

  expected := COALESCE((payload->>'expected_revision')::int, 0);
  UPDATE public.problems
  SET editor_revision = editor_revision + 1,
      review_status = CASE WHEN review_status = 'VERIFIED' THEN review_status ELSE 'UNREVIEWED' END
  WHERE id = src.problem_id
    AND editor_revision = expected
    AND lifecycle_status <> 'ARCHIVED'
  RETURNING editor_revision INTO locked;
  IF locked IS NULL THEN
    RAISE EXCEPTION 'HQB_EDIT_CONFLICT: 다른 강사가 먼저 저장했습니다. 다시 불러온 뒤 병합하세요.';
  END IF;

  item_format := COALESCE(NULLIF(payload->'version'->>'item_format', ''), src.item_format);
  forked := public.hqb_fork_problem_version(
    p_version_id,
    COALESCE(NULLIF(payload->>'change_reason', ''), '강사 편집 저장'),
    jsonb_build_object(
      'problem_text', COALESCE(payload->'version'->>'problem_text', src.problem_text),
      'normalized_text', COALESCE(
        NULLIF(payload->'version'->>'normalized_text', ''),
        payload->'version'->>'problem_text',
        src.normalized_text
      ),
      'instruction', COALESCE(payload->'version'->>'instruction', src.instruction),
      'item_format', item_format,
      'editor_document', payload->'editor_document'
    )
  );
  new_id := (forked->>'version_id')::uuid;

  UPDATE public.problem_versions
  SET choice_count = COALESCE(jsonb_array_length(payload->'choices'), choice_count),
      classification_status = 'DRAFT',
      review_status = 'UNREVIEWED'
  WHERE id = new_id;

  PERFORM public.hqb_replace_version_graph(new_id, payload);

  UPDATE public.problems
  SET current_version_id = new_id
  WHERE id = src.problem_id;

  DELETE FROM public.editor_autosaves
  WHERE problem_id = src.problem_id AND staff_user_id = uid;

  PERFORM public.hqb_audit(
    'problem_version', new_id, 'SAVE_EDITOR',
    jsonb_build_object(
      'problem_id', src.problem_id,
      'parent_version_id', src.id,
      'editor_revision', locked,
      'origin', 'TEACHER_EDIT'
    )
  );

  RETURN jsonb_build_object(
    'problem_id', src.problem_id,
    'version_id', new_id,
    'parent_version_id', src.id,
    'editor_revision', locked,
    'review_status', 'UNREVIEWED'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Autosave / restore / archive / duplicate / assets / worksheets
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_upsert_editor_autosave(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  pid uuid;
  vid uuid;
  rid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  pid := (payload->>'problem_id')::uuid;
  vid := (payload->>'base_version_id')::uuid;
  IF pid IS NULL OR vid IS NULL OR jsonb_typeof(payload->'document') <> 'object' THEN
    RAISE EXCEPTION 'HQB_AUTOSAVE_PAYLOAD: problem_id, base_version_id, document required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problem_versions WHERE id = vid AND problem_id = pid) THEN
    RAISE EXCEPTION 'HQB_VERSION_MISMATCH: 요청한 버전이 이 문제에 속하지 않습니다.';
  END IF;
  INSERT INTO public.editor_autosaves (problem_id, base_version_id, staff_user_id, document, client_token)
  VALUES (pid, vid, uid, payload->'document', NULLIF(payload->>'client_token', ''))
  ON CONFLICT (problem_id, staff_user_id) DO UPDATE
  SET document = EXCLUDED.document,
      base_version_id = EXCLUDED.base_version_id,
      client_token = EXCLUDED.client_token,
      updated_at = now()
  RETURNING id INTO rid;
  RETURN jsonb_build_object('autosave_id', rid, 'problem_id', pid, 'version_id', vid);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_restore_problem_version(
  p_version_id uuid,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  src public.problem_versions%ROWTYPE;
  forked jsonb;
  new_id uuid;
  locked int;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO src FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.problems p
    WHERE p.id = src.problem_id AND p.lifecycle_status = 'ARCHIVED'
  ) THEN
    RAISE EXCEPTION 'HQB_ARCHIVED: 보관된 문제는 복원한 뒤에 편집할 수 있습니다.';
  END IF;

  UPDATE public.problems
  SET editor_revision = editor_revision + 1
  WHERE id = src.problem_id AND lifecycle_status <> 'ARCHIVED'
  RETURNING editor_revision INTO locked;
  IF locked IS NULL THEN
    RAISE EXCEPTION 'HQB_ARCHIVED: 보관된 문제는 복원한 뒤에 편집할 수 있습니다.';
  END IF;

  forked := public.hqb_fork_problem_version(
    p_version_id,
    COALESCE(NULLIF(p_change_reason, ''), '이전 버전 복원 (새 버전)'),
    '{}'::jsonb
  );
  new_id := (forked->>'version_id')::uuid;
  UPDATE public.problems SET current_version_id = new_id WHERE id = src.problem_id;
  PERFORM public.hqb_audit(
    'problem', src.problem_id, 'RESTORE_VERSION',
    jsonb_build_object('restored_from', src.id, 'new_version_id', new_id, 'editor_revision', locked)
  );
  RETURN jsonb_build_object(
    'problem_id', src.problem_id,
    'version_id', new_id,
    'restored_from', src.id,
    'editor_revision', locked,
    'review_status', 'UNREVIEWED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_archive_problem(p_problem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  UPDATE public.problems
  SET lifecycle_status = 'ARCHIVED', archived_at = now()
  WHERE id = p_problem_id AND lifecycle_status <> 'ARCHIVED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_PROBLEM: 문제를 찾을 수 없습니다.';
  END IF;
  PERFORM public.hqb_audit('problem', p_problem_id, 'ARCHIVE', jsonb_build_object('user_id', uid));
  RETURN jsonb_build_object('problem_id', p_problem_id, 'lifecycle_status', 'ARCHIVED');
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_restore_archived_problem(p_problem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  UPDATE public.problems
  SET lifecycle_status = 'DRAFT', archived_at = NULL
  WHERE id = p_problem_id AND lifecycle_status = 'ARCHIVED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_PROBLEM: 보관된 문제를 찾을 수 없습니다.';
  END IF;
  PERFORM public.hqb_audit('problem', p_problem_id, 'RESTORE_ARCHIVE', jsonb_build_object('user_id', uid));
  RETURN jsonb_build_object('problem_id', p_problem_id, 'lifecycle_status', 'DRAFT');
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_duplicate_problem(p_problem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  src_problem public.problems%ROWTYPE;
  src_version uuid;
  new_problem uuid;
  public_code text;
  new_version uuid;
  old_choice record;
  new_choice_id uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO src_problem FROM public.problems WHERE id = p_problem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_PROBLEM: 문제를 찾을 수 없습니다.';
  END IF;
  src_version := src_problem.current_version_id;
  IF src_version IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;

  INSERT INTO public.problems (review_status, lifecycle_status, use_status)
  VALUES ('UNREVIEWED', 'DRAFT', 'INTERNAL_ONLY')
  RETURNING id, public_code INTO new_problem, public_code;

  INSERT INTO public.problem_versions (
    problem_id, version_no, origin, parent_version_id, change_reason,
    problem_text, normalized_text, instruction, item_format, choice_count,
    content_metadata, extraction_status, classification_status, review_status, created_by
  )
  SELECT
    new_problem, 1, 'TEACHER_EDIT', NULL, '문제 복제',
    pv.problem_text, pv.normalized_text, pv.instruction, pv.item_format, pv.choice_count,
    COALESCE(pv.content_metadata, '{}'::jsonb) || jsonb_build_object('duplicated_from', p_problem_id),
    pv.extraction_status, 'DRAFT', 'UNREVIEWED', uid::text
  FROM public.problem_versions pv
  WHERE pv.id = src_version
  RETURNING id INTO new_version;

  UPDATE public.problems SET current_version_id = new_version WHERE id = new_problem;

  INSERT INTO public.problem_sources (
    problem_id, source_document_id, source_page_id, original_problem_number,
    source_type_label, is_primary_source
  )
  SELECT new_problem, source_document_id, source_page_id, original_problem_number, source_type_label, is_primary_source
  FROM public.problem_sources WHERE problem_id = p_problem_id AND is_primary_source;

  INSERT INTO public.problem_curriculum (problem_version_id, curriculum_node_id, is_primary)
  SELECT new_version, curriculum_node_id, is_primary FROM public.problem_curriculum WHERE problem_version_id = src_version;
  INSERT INTO public.problem_concepts (
    problem_version_id, concept_id, is_primary, weight, application_role, confidence, assigned_by
  )
  SELECT new_version, concept_id, is_primary, weight, application_role, confidence, assigned_by
  FROM public.problem_concepts WHERE problem_version_id = src_version;
  INSERT INTO public.problem_type_assignments (
    problem_version_id, hyper_problem_type_id, is_primary, confidence, assigned_by
  )
  SELECT new_version, hyper_problem_type_id, is_primary, confidence, assigned_by
  FROM public.problem_type_assignments WHERE problem_version_id = src_version;
  INSERT INTO public.problem_strategy_assignments (
    problem_version_id, strategy_template_id, is_primary, confidence, assigned_by
  )
  SELECT new_version, strategy_template_id, is_primary, confidence, assigned_by
  FROM public.problem_strategy_assignments WHERE problem_version_id = src_version;
  INSERT INTO public.math_expressions (
    problem_version_id, expression_role, original_expression, normalized_expression,
    latex_expression, structure_skeleton, structure_tags, sort_order
  )
  SELECT new_version, expression_role, original_expression, normalized_expression,
         latex_expression, structure_skeleton, structure_tags, sort_order
  FROM public.math_expressions WHERE problem_version_id = src_version;
  INSERT INTO public.problem_conditions (problem_version_id, condition_term_id, assignment_status, assigned_by)
  SELECT new_version, condition_term_id, assignment_status, assigned_by
  FROM public.problem_conditions WHERE problem_version_id = src_version;
  INSERT INTO public.problem_targets (problem_version_id, target_term_id, assignment_status, is_primary, assigned_by)
  SELECT new_version, target_term_id, assignment_status, is_primary, assigned_by
  FROM public.problem_targets WHERE problem_version_id = src_version;
  INSERT INTO public.problem_reasoning (problem_version_id, reasoning_term_id, assigned_by)
  SELECT new_version, reasoning_term_id, assigned_by
  FROM public.problem_reasoning WHERE problem_version_id = src_version;
  INSERT INTO public.problem_difficulty (
    problem_version_id, difficulty_source, concept_difficulty, calculation_complexity,
    reasoning_depth, condition_complexity, representation_complexity, trap_level, created_by
  )
  SELECT new_version, difficulty_source, concept_difficulty, calculation_complexity,
         reasoning_depth, condition_complexity, representation_complexity, trap_level, created_by
  FROM public.problem_difficulty
  WHERE problem_version_id = src_version AND difficulty_source = 'HUMAN';
  INSERT INTO public.problem_explanations (problem_version_id, explanation_type, content, created_by)
  SELECT new_version, explanation_type, content, created_by
  FROM public.problem_explanations WHERE problem_version_id = src_version;
  INSERT INTO public.problem_assets (
    problem_version_id, asset_type, storage_path, url, alt_text, metadata
  )
  SELECT new_version, asset_type, storage_path, url, alt_text, metadata
  FROM public.problem_assets WHERE problem_version_id = src_version;

  FOR old_choice IN
    SELECT * FROM public.problem_choices WHERE problem_version_id = src_version ORDER BY choice_order
  LOOP
    INSERT INTO public.problem_choices (
      problem_version_id, choice_order, label, choice_text, normalized_text, math_expression
    ) VALUES (
      new_version, old_choice.choice_order, old_choice.label, old_choice.choice_text,
      old_choice.normalized_text, old_choice.math_expression
    )
    RETURNING id INTO new_choice_id;
    INSERT INTO public.problem_answers (
      problem_version_id, answer_type, answer_text, normalized_answer, choice_id, numeric_value, metadata
    )
    SELECT new_version, a.answer_type, a.answer_text, a.normalized_answer, new_choice_id, a.numeric_value, a.metadata
    FROM public.problem_answers a
    WHERE a.problem_version_id = src_version AND a.choice_id = old_choice.id;
  END LOOP;
  INSERT INTO public.problem_answers (
    problem_version_id, answer_type, answer_text, normalized_answer, choice_id, numeric_value, metadata
  )
  SELECT new_version, a.answer_type, a.answer_text, a.normalized_answer, NULL, a.numeric_value, a.metadata
  FROM public.problem_answers a
  WHERE a.problem_version_id = src_version AND a.choice_id IS NULL;

  PERFORM public.hqb_audit(
    'problem', new_problem, 'DUPLICATE_PROBLEM',
    jsonb_build_object('from_problem_id', p_problem_id, 'public_code', public_code)
  );
  RETURN jsonb_build_object(
    'problem_id', new_problem,
    'public_code', public_code,
    'version_id', new_version,
    'duplicated_from', p_problem_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_register_editor_asset(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  vid uuid;
  v_path text;
  v_type text;
  v_mime text;
  rid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  vid := (payload->>'problem_version_id')::uuid;
  v_path := NULLIF(payload->>'storage_path', '');
  v_type := COALESCE(NULLIF(payload->>'asset_type', ''), 'IMAGE');
  v_mime := COALESCE(NULLIF(payload->>'mime', ''), '');
  IF vid IS NULL OR v_path IS NULL THEN
    RAISE EXCEPTION 'HQB_ASSET_PAYLOAD: problem_version_id, storage_path required';
  END IF;
  IF v_type NOT IN ('IMAGE', 'GRAPH', 'TABLE', 'GEOMETRY', 'DIAGRAM') THEN
    RAISE EXCEPTION 'HQB_ASSET_TYPE: unsupported asset_type';
  END IF;
  IF v_mime NOT IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', '') THEN
    RAISE EXCEPTION 'HQB_ASSET_MIME: PNG/JPEG/WebP/GIF only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problem_versions WHERE id = vid) THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.problem_versions pv
    WHERE pv.id = vid AND pv.review_status = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'HQB_VERIFIED_LOCKED: VERIFIED 버전은 덮어쓸 수 없습니다. 새 버전을 만드세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'question-bank-assets' AND o.name = v_path
  ) THEN
    RAISE EXCEPTION 'HQB_ASSET_MISSING: 업로드된 이미지를 찾지 못했습니다.';
  END IF;
  INSERT INTO public.problem_assets (
    problem_version_id, asset_type, storage_path, alt_text, metadata
  ) VALUES (
    vid, v_type, v_path, NULLIF(payload->>'alt_text', ''),
    jsonb_build_object(
      'bucket', 'question-bank-assets',
      'mime', v_mime,
      'byte_size', NULLIF(payload->>'byte_size', '')
    )
  )
  RETURNING id INTO rid;
  PERFORM public.hqb_audit('problem_asset', rid, 'REGISTER_ASSET', jsonb_build_object('version_id', vid, 'path', v_path));
  RETURN jsonb_build_object(
    'asset_id', rid,
    'storage_path', v_path,
    'bucket', 'question-bank-assets'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_create_worksheet(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  rid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  IF NULLIF(btrim(COALESCE(payload->>'title', '')), '') IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TITLE: 문제지 제목을 입력해 주세요.';
  END IF;
  INSERT INTO public.worksheets (title, purpose, created_by, layout, exam_kind)
  VALUES (
    payload->>'title',
    NULLIF(payload->>'purpose', ''),
    uid::text,
    COALESCE(payload->'layout', '{}'::jsonb),
    COALESCE(NULLIF(payload->>'exam_kind', ''), 'EXAM')
  )
  RETURNING id INTO rid;
  PERFORM public.hqb_audit('worksheet', rid, 'CREATE_WORKSHEET', payload);
  RETURN jsonb_build_object('worksheet_id', rid);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_update_worksheet(p_worksheet_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  UPDATE public.worksheets
  SET title = COALESCE(NULLIF(payload->>'title', ''), title),
      purpose = COALESCE(payload->>'purpose', purpose),
      layout = COALESCE(payload->'layout', layout),
      exam_kind = COALESCE(NULLIF(payload->>'exam_kind', ''), exam_kind)
  WHERE id = p_worksheet_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_WORKSHEET: 문제지를 찾을 수 없습니다.';
  END IF;
  PERFORM public.hqb_audit('worksheet', p_worksheet_id, 'UPDATE_WORKSHEET', payload);
  RETURN jsonb_build_object('worksheet_id', p_worksheet_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_replace_worksheet_items(p_worksheet_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  item jsonb;
  ord int := 0;
BEGIN
  uid := public.hqb_require_staff_writer();
  IF NOT EXISTS (SELECT 1 FROM public.worksheets WHERE id = p_worksheet_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'HQB_MISSING_WORKSHEET: 문제지를 찾을 수 없습니다.';
  END IF;
  DELETE FROM public.worksheet_items WHERE worksheet_id = p_worksheet_id;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    ord := ord + 1;
    INSERT INTO public.worksheet_items (
      worksheet_id, problem_id, problem_version_id, order_no, spacing_mm, points, force_page_break, item_style
    ) VALUES (
      p_worksheet_id,
      (item->>'problem_id')::uuid,
      (item->>'problem_version_id')::uuid,
      COALESCE((item->>'order_no')::int, ord),
      NULLIF(item->>'spacing_mm', '')::numeric,
      NULLIF(item->>'points', '')::numeric,
      COALESCE((item->>'force_page_break')::boolean, false),
      COALESCE(item->'item_style', '{}'::jsonb)
    );
  END LOOP;
  PERFORM public.hqb_audit(
    'worksheet', p_worksheet_id, 'REPLACE_ITEMS',
    jsonb_build_object('count', ord)
  );
  RETURN jsonb_build_object('worksheet_id', p_worksheet_id, 'item_count', ord);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_archive_worksheet(p_worksheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  UPDATE public.worksheets SET archived_at = now() WHERE id = p_worksheet_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_WORKSHEET: 문제지를 찾을 수 없습니다.';
  END IF;
  PERFORM public.hqb_audit('worksheet', p_worksheet_id, 'ARCHIVE_WORKSHEET', jsonb_build_object('user_id', uid));
  RETURN jsonb_build_object('worksheet_id', p_worksheet_id, 'archived', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.hqb_fork_problem_version(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_save_editor_document(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_editor_autosave(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_restore_problem_version(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_archive_problem(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_restore_archived_problem(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_duplicate_problem(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_register_editor_asset(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_create_worksheet(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_update_worksheet(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_replace_worksheet_items(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_archive_worksheet(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_fork_problem_version(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_save_editor_document(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_editor_autosave(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_restore_problem_version(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_archive_problem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_restore_archived_problem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_duplicate_problem(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_register_editor_asset(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_create_worksheet(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_update_worksheet(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_replace_worksheet_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_archive_worksheet(uuid) TO authenticated;

COMMENT ON FUNCTION public.hqb_save_editor_document(uuid, jsonb) IS
  'STEP 8.35: create a new TEACHER_EDIT version from the open draft. Never VERIFIED. Optimistic editor_revision.';
COMMENT ON FUNCTION public.hqb_restore_problem_version(uuid, text) IS
  'STEP 8.35: restore clones a historical version as a new current TEACHER_EDIT row. Old rows stay immutable.';
