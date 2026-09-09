-- HYPER QUESTION BANK — STEP 8.12
-- Additive taxonomy schema + high-confidence classification persistence RPC.
-- Do not apply to HYPER STUDENT CARE.
-- No table/column drops. No mass rewrite of problem content.

-- ---------------------------------------------------------------------------
-- 1. SUBUNIT: expand node_type CHECK only after existing values are compatible.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.curriculum_nodes
    WHERE node_type NOT IN ('SCHOOL_LEVEL', 'GRADE', 'SEMESTER', 'SUBJECT', 'UNIT', 'SUBUNIT')
  ) THEN
    RAISE EXCEPTION 'HQB_SUBUNIT_CHECK_INCOMPATIBLE: existing node_type values are not a subset of the expanded CHECK.';
  END IF;
END $$;

ALTER TABLE public.curriculum_nodes DROP CONSTRAINT IF EXISTS curriculum_nodes_type_chk;
ALTER TABLE public.curriculum_nodes
  ADD CONSTRAINT curriculum_nodes_type_chk CHECK (
    node_type IN ('SCHOOL_LEVEL', 'GRADE', 'SEMESTER', 'SUBJECT', 'UNIT', 'SUBUNIT')
  );

CREATE UNIQUE INDEX IF NOT EXISTS curriculum_nodes_framework_code_uidx
  ON public.curriculum_nodes (framework_id, code)
  WHERE code IS NOT NULL;

COMMENT ON COLUMN public.curriculum_nodes.node_type IS
  'SCHOOL_LEVEL/GRADE/SEMESTER/SUBJECT/UNIT/SUBUNIT. SUBUNIT added STEP 8.12; existing UNIT rows keep their meaning.';

-- ---------------------------------------------------------------------------
-- 2. Type-level profile (not a duplicate of concepts / strategy_templates).
--    concepts = atomic math concepts. strategy_templates = reusable step lists.
--    hyper_type_profiles = canonical TYPE dictionary metadata.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hyper_type_profiles (
  hyper_problem_type_id uuid PRIMARY KEY REFERENCES public.hyper_problem_types (id) ON DELETE RESTRICT,
  canonical_name_ko text NOT NULL,
  unit_code text,
  subunit_code text,
  core_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  solution_strategies jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_test_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  prerequisite_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  dictionary_status text NOT NULL DEFAULT 'CANDIDATE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hyper_type_profiles_status_chk CHECK (
    dictionary_status IN ('CANDIDATE', 'VALIDATED', 'REVIEW', 'DEPRECATED')
  )
);

COMMENT ON TABLE public.hyper_type_profiles IS
  'HYPER TYPE dictionary v1 profile. dictionary_status is independent of problem assignment confidence. Aliases are source evidence, not canonical codes.';

DROP TRIGGER IF EXISTS hyper_type_profiles_set_updated_at ON public.hyper_type_profiles;
CREATE TRIGGER hyper_type_profiles_set_updated_at
  BEFORE UPDATE ON public.hyper_type_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Problem-level classification extras (key points / strategy / subunit pointer).
--    Type FK still lives on problem_type_assignments. Difficulty on problem_difficulty.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_classification_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL UNIQUE REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  unit_node_id uuid REFERENCES public.curriculum_nodes (id) ON DELETE RESTRICT,
  subunit_node_id uuid REFERENCES public.curriculum_nodes (id) ON DELETE RESTRICT,
  hyper_problem_type_id uuid NOT NULL REFERENCES public.hyper_problem_types (id) ON DELETE RESTRICT,
  subtype_type_id uuid REFERENCES public.hyper_problem_types (id) ON DELETE RESTRICT,
  difficulty_level integer,
  key_test_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  solution_strategies jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit_confidence numeric(5, 4),
  type_confidence numeric(5, 4),
  difficulty_confidence numeric(5, 4),
  classification_status text NOT NULL,
  source_heading text,
  heading_distance integer,
  assigned_by text,
  artifact_step text NOT NULL DEFAULT '8.12',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_classification_meta_status_chk CHECK (classification_status = 'AUTO'),
  CONSTRAINT problem_classification_meta_diff_chk CHECK (
    difficulty_level IS NULL OR difficulty_level BETWEEN 1 AND 5
  ),
  CONSTRAINT problem_classification_meta_conf_chk CHECK (
    (unit_confidence IS NULL OR (unit_confidence >= 0 AND unit_confidence <= 1))
    AND (type_confidence IS NULL OR (type_confidence >= 0 AND type_confidence <= 1))
    AND (difficulty_confidence IS NULL OR (difficulty_confidence >= 0 AND difficulty_confidence <= 1))
  )
);

CREATE INDEX IF NOT EXISTS problem_classification_meta_type_idx
  ON public.problem_classification_meta (hyper_problem_type_id);
CREATE INDEX IF NOT EXISTS problem_classification_meta_assigned_idx
  ON public.problem_classification_meta (assigned_by);

COMMENT ON TABLE public.problem_classification_meta IS
  'AUTO classification sidecar. REVIEW assignments are rejected by RPC. Does not store problem stem/choices/math.';

DROP TRIGGER IF EXISTS problem_classification_meta_set_updated_at ON public.problem_classification_meta;
CREATE TRIGGER problem_classification_meta_set_updated_at
  BEFORE UPDATE ON public.problem_classification_meta
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS: staff SELECT, RPC-only writes. anon/student have no write grant.
-- ---------------------------------------------------------------------------
ALTER TABLE public.hyper_type_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_classification_meta ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hyper_type_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.problem_classification_meta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hyper_type_profiles TO authenticated;
GRANT SELECT ON TABLE public.problem_classification_meta TO authenticated;
GRANT ALL ON TABLE public.hyper_type_profiles TO service_role;
GRANT ALL ON TABLE public.problem_classification_meta TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.hyper_type_profiles;
CREATE POLICY qbank_staff_select ON public.hyper_type_profiles
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_classification_meta;
CREATE POLICY qbank_staff_select ON public.problem_classification_meta
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

-- ---------------------------------------------------------------------------
-- 5. Ensure HYPER 공통수학1 curriculum tree (additive nodes only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_ensure_cm1_curriculum()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  fw uuid;
  high_id uuid;
  grade_id uuid;
  subject_id uuid;
  unit_id uuid;
  rec record;
BEGIN
  uid := public.hqb_require_staff_writer();
  PERFORM pg_advisory_xact_lock(854202, hashtext('cm1-curriculum'));

  SELECT id INTO fw FROM public.curriculum_frameworks WHERE code = 'KR_2022';
  IF fw IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_FRAMEWORK: KR_2022 교육과정이 없습니다.';
  END IF;

  SELECT n.id INTO high_id FROM public.curriculum_nodes n
  WHERE n.framework_id = fw AND n.code = 'HIGH' AND n.node_type = 'SCHOOL_LEVEL';
  IF high_id IS NULL THEN
    INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
    VALUES (fw, NULL, 'SCHOOL_LEVEL', 'HIGH', '고등학교', 2, true)
    RETURNING id INTO high_id;
  END IF;

  SELECT n.id INTO grade_id FROM public.curriculum_nodes n
  WHERE n.framework_id = fw AND n.code = 'CM1_G10' AND n.parent_id = high_id;
  IF grade_id IS NULL THEN
    INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
    VALUES (fw, high_id, 'GRADE', 'CM1_G10', '고1', 1, true)
    RETURNING id INTO grade_id;
  END IF;

  SELECT n.id INTO subject_id FROM public.curriculum_nodes n
  WHERE n.framework_id = fw AND n.code = 'CM1_SUBJECT' AND n.parent_id = grade_id;
  IF subject_id IS NULL THEN
    INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
    VALUES (fw, grade_id, 'SUBJECT', 'CM1_SUBJECT', '공통수학1', 1, true)
    RETURNING id INTO subject_id;
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      ('CM1_UNIT_POLY', '다항식', 1),
      ('CM1_UNIT_EQ', '방정식', 2),
      ('CM1_UNIT_INEQ', '부등식', 3),
      ('CM1_UNIT_COUNT', '순열과 조합', 4),
      ('CM1_UNIT_MATRIX', '행렬', 5)
    ) AS u(code, name, sort_order)
  LOOP
    SELECT n.id INTO unit_id FROM public.curriculum_nodes n
    WHERE n.framework_id = fw AND n.code = rec.code AND n.parent_id = subject_id;
    IF unit_id IS NULL THEN
      INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
      VALUES (fw, subject_id, 'UNIT', rec.code, rec.name, rec.sort_order, true)
      RETURNING id INTO unit_id;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT * FROM (VALUES
      ('CM1_SUB_POLY_OPS', '다항식의 연산', 'CM1_UNIT_POLY', 1),
      ('CM1_SUB_POLY_REMAINDER', '나머지 정리와 인수분해', 'CM1_UNIT_POLY', 2),
      ('CM1_SUB_COMPLEX', '복소수', 'CM1_UNIT_EQ', 1),
      ('CM1_SUB_QUAD', '이차방정식', 'CM1_UNIT_EQ', 2),
      ('CM1_SUB_QUAD_FN', '이차방정식과 이차함수', 'CM1_UNIT_EQ', 3),
      ('CM1_SUB_VARIOUS_EQ', '여러 가지 방정식', 'CM1_UNIT_EQ', 4),
      ('CM1_SUB_LIN_INEQ', '일차부등식', 'CM1_UNIT_INEQ', 1),
      ('CM1_SUB_QUAD_INEQ', '이차부등식', 'CM1_UNIT_INEQ', 2),
      ('CM1_SUB_PERMCOMB', '순열과 조합', 'CM1_UNIT_COUNT', 1),
      ('CM1_SUB_MATRIX', '행렬과 그 연산', 'CM1_UNIT_MATRIX', 1)
    ) AS s(code, name, unit_code, sort_order)
  LOOP
    SELECT n.id INTO unit_id FROM public.curriculum_nodes n
    WHERE n.framework_id = fw AND n.code = rec.unit_code AND n.node_type = 'UNIT';
    IF unit_id IS NULL THEN
      RAISE EXCEPTION 'HQB_MISSING_UNIT: %', rec.unit_code;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.curriculum_nodes n
      WHERE n.framework_id = fw AND n.code = rec.code AND n.parent_id = unit_id
    ) THEN
      INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
      VALUES (fw, unit_id, 'SUBUNIT', rec.code, rec.name, rec.sort_order, true);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'framework_id', fw, 'subject_id', subject_id, 'writer', uid);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Upsert one dictionary type + profile. Never promotes VALIDATED unless asked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_upsert_hyper_type_dictionary_entry(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  type_code text;
  type_name text;
  type_desc text;
  parent_code text;
  v_parent_id uuid;
  type_id uuid;
  dict_status text;
  created boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();
  type_code := btrim(COALESCE(payload->>'code', ''));
  type_name := btrim(COALESCE(payload->>'name', ''));
  type_desc := NULLIF(btrim(COALESCE(payload->>'description', '')), '');
  parent_code := NULLIF(btrim(COALESCE(payload->>'parent_code', '')), '');
  dict_status := COALESCE(NULLIF(btrim(payload->>'dictionary_status'), ''), 'CANDIDATE');

  IF type_code = '' OR type_name = '' THEN
    RAISE EXCEPTION 'HQB_INVALID_TYPE: type code/name이 필요합니다.';
  END IF;
  IF type_code IN ('LINEAR_DIRECT_SOLVE', 'QUADRATIC_FACTOR_SOLVE') THEN
    RAISE EXCEPTION 'HQB_SEED_TYPE_PROTECTED: 기존 seed type은 이 RPC로 덮어쓰지 않습니다.';
  END IF;
  IF dict_status NOT IN ('CANDIDATE', 'VALIDATED', 'REVIEW', 'DEPRECATED') THEN
    RAISE EXCEPTION 'HQB_INVALID_TYPE_STATUS: dictionary_status가 올바르지 않습니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(854202, hashtext('type:' || type_code));

  IF parent_code IS NOT NULL THEN
    SELECT t.id INTO v_parent_id FROM public.hyper_problem_types t WHERE t.code = parent_code;
    IF v_parent_id IS NULL THEN
      RAISE EXCEPTION 'HQB_INVALID_PARENT_TYPE: parent type이 없습니다.';
    END IF;
  END IF;

  SELECT t.id INTO type_id FROM public.hyper_problem_types t WHERE t.code = type_code;
  IF type_id IS NULL THEN
    INSERT INTO public.hyper_problem_types (parent_id, code, name, description, active)
    VALUES (v_parent_id, type_code, type_name, type_desc, true)
    RETURNING id INTO type_id;
    created := true;
  ELSE
    UPDATE public.hyper_problem_types
    SET name = type_name,
        description = COALESCE(type_desc, description),
        parent_id = COALESCE(v_parent_id, parent_id)
    WHERE id = type_id;
  END IF;

  INSERT INTO public.hyper_type_profiles (
    hyper_problem_type_id, canonical_name_ko, unit_code, subunit_code,
    core_concepts, solution_strategies, key_test_points, common_mistakes,
    prerequisite_types, source_aliases, dictionary_status
  ) VALUES (
    type_id,
    COALESCE(NULLIF(btrim(payload->>'canonical_name_ko'), ''), type_name),
    NULLIF(btrim(COALESCE(payload->>'unit_code', '')), ''),
    NULLIF(btrim(COALESCE(payload->>'subunit_code', '')), ''),
    COALESCE(payload->'core_concepts', '[]'::jsonb),
    COALESCE(payload->'solution_strategies', '[]'::jsonb),
    COALESCE(payload->'key_test_points', '[]'::jsonb),
    COALESCE(payload->'common_mistakes', '[]'::jsonb),
    COALESCE(payload->'prerequisite_types', '[]'::jsonb),
    COALESCE(payload->'source_aliases', '[]'::jsonb),
    dict_status
  )
  ON CONFLICT (hyper_problem_type_id) DO UPDATE SET
    canonical_name_ko = EXCLUDED.canonical_name_ko,
    unit_code = EXCLUDED.unit_code,
    subunit_code = EXCLUDED.subunit_code,
    core_concepts = EXCLUDED.core_concepts,
    solution_strategies = EXCLUDED.solution_strategies,
    key_test_points = EXCLUDED.key_test_points,
    common_mistakes = EXCLUDED.common_mistakes,
    prerequisite_types = EXCLUDED.prerequisite_types,
    source_aliases = EXCLUDED.source_aliases,
    dictionary_status = EXCLUDED.dictionary_status;

  RETURN jsonb_build_object(
    'type_id', type_id,
    'code', type_code,
    'created', created,
    'dictionary_status', dict_status,
    'writer', uid
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Persist one AUTO classification. REVIEW rejected. Content tables untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_upsert_problem_classification(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_problem_id uuid;
  version_id uuid;
  current_version uuid;
  review_status text;
  v_doc_id uuid;
  page_no integer;
  canonical text;
  status text;
  type_code text;
  unit_code text;
  subunit_code text;
  subtype_code text;
  type_id uuid;
  subtype_id uuid;
  unit_node uuid;
  subunit_node uuid;
  unit_parent uuid;
  persist_difficulty boolean;
  diff_level integer;
  existing_type uuid;
  type_assignment_id uuid;
  meta_id uuid;
  difficulty_id uuid;
  created boolean := false;
  v_assigned_by text;
BEGIN
  uid := public.hqb_require_staff_writer();

  v_problem_id := NULLIF(payload->>'problem_id', '')::uuid;
  status := btrim(COALESCE(payload->>'classification_status', ''));
  type_code := btrim(COALESCE(payload->>'type_code', ''));
  unit_code := btrim(COALESCE(payload->>'unit_code', ''));
  subunit_code := NULLIF(btrim(COALESCE(payload->>'subunit_code', '')), '');
  subtype_code := NULLIF(btrim(COALESCE(payload->>'subtype_code', '')), '');
  v_doc_id := NULLIF(payload->>'source_document_id', '')::uuid;
  page_no := NULLIF(payload->>'page_number', '')::integer;
  canonical := public.hqb_canonicalize_problem_number(COALESCE(payload->>'original_problem_number', ''));
  persist_difficulty := COALESCE((payload->>'persist_difficulty')::boolean, false);
  diff_level := NULLIF(payload->>'difficulty_level', '')::integer;
  v_assigned_by := COALESCE(NULLIF(btrim(payload->>'assigned_by'), ''), 'STEP_8_12');

  IF v_problem_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: problem_id가 필요합니다.';
  END IF;
  IF status <> 'AUTO' THEN
    RAISE EXCEPTION 'HQB_REVIEW_REJECTED: REVIEW classification은 저장하지 않습니다.';
  END IF;
  IF type_code = '' OR unit_code = '' THEN
    RAISE EXCEPTION 'HQB_INVALID_CLASSIFICATION: type/unit code가 필요합니다.';
  END IF;
  IF persist_difficulty AND (diff_level IS NULL OR diff_level < 1 OR diff_level > 5) THEN
    RAISE EXCEPTION 'HQB_INVALID_DIFFICULTY: difficulty는 1–5만 허용합니다.';
  END IF;
  IF COALESCE((payload->>'unit_confidence')::numeric, 0) < 0 OR COALESCE((payload->>'unit_confidence')::numeric, 0) > 1
     OR COALESCE((payload->>'type_confidence')::numeric, 0) < 0 OR COALESCE((payload->>'type_confidence')::numeric, 0) > 1 THEN
    RAISE EXCEPTION 'HQB_INVALID_CONFIDENCE: confidence는 0–1이어야 합니다.';
  END IF;

  SELECT p.current_version_id, p.review_status INTO current_version, review_status
  FROM public.problems p WHERE p.id = v_problem_id AND p.archived_at IS NULL;
  IF current_version IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: 문제가 없거나 current version이 없습니다.';
  END IF;
  version_id := current_version;
  IF NULLIF(payload->>'expected_version_id', '') IS NOT NULL AND (payload->>'expected_version_id')::uuid <> version_id THEN
    RAISE EXCEPTION 'HQB_VERSION_MISMATCH: current_version이 artifact와 다릅니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(854202, hashtext(version_id::text));

  IF v_doc_id IS NOT NULL THEN
    IF canonical IS NULL OR page_no IS NULL THEN
      RAISE EXCEPTION 'HQB_IDENTITY_MISMATCH: source page/number가 올바르지 않습니다.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.problem_sources ps
      JOIN public.source_pages sp ON sp.id = ps.source_page_id
      WHERE ps.problem_id = v_problem_id
        AND ps.source_document_id = v_doc_id
        AND sp.page_number = page_no
        AND public.hqb_canonicalize_problem_number(ps.original_problem_number) = canonical
    ) THEN
      RAISE EXCEPTION 'HQB_IDENTITY_MISMATCH: source trace가 문제와 일치하지 않습니다.';
    END IF;
  END IF;

  SELECT t.id INTO type_id FROM public.hyper_problem_types t WHERE t.code = type_code AND t.active;
  IF type_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_TYPE: type_id가 없습니다.';
  END IF;
  IF subtype_code IS NOT NULL THEN
    SELECT t.id INTO subtype_id FROM public.hyper_problem_types t WHERE t.code = subtype_code AND t.active;
    IF subtype_id IS NULL THEN
      RAISE EXCEPTION 'HQB_INVALID_SUBTYPE: subtype이 없습니다.';
    END IF;
  END IF;

  SELECT n.id INTO unit_node FROM public.curriculum_nodes n WHERE n.code = unit_code AND n.node_type = 'UNIT' AND n.active;
  IF unit_node IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_UNIT: unit node가 없습니다.';
  END IF;
  IF subunit_code IS NOT NULL THEN
    SELECT n.id, n.parent_id INTO subunit_node, unit_parent
    FROM public.curriculum_nodes n
    WHERE n.code = subunit_code AND n.node_type = 'SUBUNIT' AND n.active;
    IF subunit_node IS NULL THEN
      RAISE EXCEPTION 'HQB_INVALID_SUBUNIT: subunit node가 없습니다.';
    END IF;
    IF unit_parent IS DISTINCT FROM unit_node THEN
      RAISE EXCEPTION 'HQB_UNIT_SUBUNIT_MISMATCH: subunit가 unit 아래가 아닙니다.';
    END IF;
  END IF;

  SELECT pta.hyper_problem_type_id INTO existing_type
  FROM public.problem_type_assignments pta
  WHERE pta.problem_version_id = version_id AND pta.assigned_by = v_assigned_by
  ORDER BY pta.created_at ASC
  LIMIT 1;

  IF existing_type IS NOT NULL AND existing_type IS DISTINCT FROM type_id THEN
    DELETE FROM public.problem_type_assignments
    WHERE problem_version_id = version_id AND assigned_by = v_assigned_by;
  END IF;

  INSERT INTO public.problem_type_assignments (
    problem_version_id, hyper_problem_type_id, is_primary, confidence, assigned_by
  ) VALUES (
    version_id, type_id, true, NULLIF(payload->>'type_confidence', '')::numeric, v_assigned_by
  )
  ON CONFLICT (problem_version_id, hyper_problem_type_id) DO UPDATE SET
    is_primary = true,
    confidence = EXCLUDED.confidence,
    assigned_by = EXCLUDED.assigned_by
  RETURNING id INTO type_assignment_id;

  IF v_assigned_by <> 'STEP_8_12_ROLLBACK_TEST' THEN
    INSERT INTO public.problem_curriculum (problem_version_id, curriculum_node_id, is_primary)
    VALUES (version_id, unit_node, true)
    ON CONFLICT (problem_version_id, curriculum_node_id) DO UPDATE SET is_primary = true;

    IF subunit_node IS NOT NULL THEN
      INSERT INTO public.problem_curriculum (problem_version_id, curriculum_node_id, is_primary)
      VALUES (version_id, subunit_node, false)
      ON CONFLICT (problem_version_id, curriculum_node_id) DO UPDATE SET is_primary = false;
    END IF;
  END IF;

  IF persist_difficulty THEN
    INSERT INTO public.problem_difficulty (
      problem_version_id, difficulty_source,
      concept_difficulty, calculation_complexity, reasoning_depth,
      condition_complexity, representation_complexity, trap_level,
      overall_difficulty, created_by
    ) VALUES (
      version_id, 'MODEL',
      diff_level, diff_level, diff_level, diff_level, diff_level, diff_level,
      diff_level, v_assigned_by
    )
    ON CONFLICT (problem_version_id, difficulty_source) DO UPDATE SET
      concept_difficulty = EXCLUDED.concept_difficulty,
      calculation_complexity = EXCLUDED.calculation_complexity,
      reasoning_depth = EXCLUDED.reasoning_depth,
      condition_complexity = EXCLUDED.condition_complexity,
      representation_complexity = EXCLUDED.representation_complexity,
      trap_level = EXCLUDED.trap_level,
      created_by = EXCLUDED.created_by
    WHERE public.problem_difficulty.difficulty_source = 'MODEL'
    RETURNING id INTO difficulty_id;
  END IF;

  INSERT INTO public.problem_classification_meta (
    problem_version_id, unit_node_id, subunit_node_id, hyper_problem_type_id, subtype_type_id,
    difficulty_level, key_test_points, solution_strategies,
    unit_confidence, type_confidence, difficulty_confidence,
    classification_status, source_heading, heading_distance, assigned_by, artifact_step
  ) VALUES (
    version_id, unit_node, subunit_node, type_id, subtype_id,
    CASE WHEN persist_difficulty THEN diff_level ELSE NULL END,
    COALESCE(payload->'key_test_points', '[]'::jsonb),
    COALESCE(payload->'solution_strategies', '[]'::jsonb),
    NULLIF(payload->>'unit_confidence', '')::numeric,
    NULLIF(payload->>'type_confidence', '')::numeric,
    NULLIF(payload->>'difficulty_confidence', '')::numeric,
    'AUTO',
    NULLIF(payload->>'source_heading', ''),
    NULLIF(payload->>'heading_distance', '')::integer,
    v_assigned_by,
    COALESCE(NULLIF(payload->>'artifact_step', ''), '8.12')
  )
  ON CONFLICT (problem_version_id) DO UPDATE SET
    unit_node_id = EXCLUDED.unit_node_id,
    subunit_node_id = EXCLUDED.subunit_node_id,
    hyper_problem_type_id = EXCLUDED.hyper_problem_type_id,
    subtype_type_id = EXCLUDED.subtype_type_id,
    difficulty_level = EXCLUDED.difficulty_level,
    key_test_points = EXCLUDED.key_test_points,
    solution_strategies = EXCLUDED.solution_strategies,
    unit_confidence = EXCLUDED.unit_confidence,
    type_confidence = EXCLUDED.type_confidence,
    difficulty_confidence = EXCLUDED.difficulty_confidence,
    classification_status = 'AUTO',
    source_heading = EXCLUDED.source_heading,
    heading_distance = EXCLUDED.heading_distance,
    assigned_by = EXCLUDED.assigned_by,
    artifact_step = EXCLUDED.artifact_step
  RETURNING id INTO meta_id;
  created := existing_type IS NULL;

  RETURN jsonb_build_object(
    'problem_id', v_problem_id,
    'version_id', version_id,
    'type_assignment_id', type_assignment_id,
    'meta_id', meta_id,
    'difficulty_id', difficulty_id,
    'type_code', type_code,
    'unit_code', unit_code,
    'subunit_code', subunit_code,
    'created', created,
    'review_status', review_status,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_delete_test_classification(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  removed_meta int := 0;
  removed_type int := 0;
  removed_diff int := 0;
BEGIN
  uid := public.hqb_require_staff_writer();
  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_VERSION: version_id가 필요합니다.';
  END IF;

  DELETE FROM public.problem_classification_meta
  WHERE problem_version_id = p_version_id AND assigned_by = 'STEP_8_12_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_meta = ROW_COUNT;

  DELETE FROM public.problem_type_assignments
  WHERE problem_version_id = p_version_id AND assigned_by = 'STEP_8_12_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_type = ROW_COUNT;

  DELETE FROM public.problem_difficulty
  WHERE problem_version_id = p_version_id
    AND difficulty_source = 'MODEL'
    AND created_by = 'STEP_8_12_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_diff = ROW_COUNT;

  RETURN jsonb_build_object(
    'version_id', p_version_id,
    'removed_meta', removed_meta,
    'removed_type', removed_type,
    'removed_difficulty', removed_diff,
    'writer', uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_ensure_cm1_curriculum() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_hyper_type_dictionary_entry(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_problem_classification(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_delete_test_classification(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_ensure_cm1_curriculum() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_hyper_type_dictionary_entry(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_classification(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_delete_test_classification(uuid) TO authenticated;
