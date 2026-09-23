-- Difficulty-only upsert for HYPER CM2 absolute dims.
-- Does not touch problem_text, type assignments, curriculum, or key points.

CREATE OR REPLACE FUNCTION public.hqb_upsert_problem_difficulty_dims(payload jsonb)
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
  v_concept integer;
  v_calc integer;
  v_reason integer;
  v_cond integer;
  v_repr integer;
  v_trap integer;
  v_overall integer;
  difficulty_id uuid;
  v_assigned_by text;
BEGIN
  uid := public.hqb_require_staff_writer();

  v_problem_id := NULLIF(payload->>'problem_id', '')::uuid;
  v_concept := NULLIF(payload->>'concept_difficulty', '')::integer;
  v_calc := NULLIF(payload->>'calculation_complexity', '')::integer;
  v_reason := NULLIF(payload->>'reasoning_depth', '')::integer;
  v_cond := NULLIF(payload->>'condition_complexity', '')::integer;
  v_repr := NULLIF(payload->>'representation_complexity', '')::integer;
  v_trap := NULLIF(payload->>'trap_level', '')::integer;
  v_overall := COALESCE(NULLIF(payload->>'overall_difficulty', '')::integer, NULLIF(payload->>'difficulty_level', '')::integer);
  v_assigned_by := COALESCE(NULLIF(btrim(payload->>'assigned_by'), ''), 'BOOK_CLASSIFY_CM2');

  IF v_problem_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: problem_id가 필요합니다.';
  END IF;
  IF v_concept IS NULL OR v_calc IS NULL OR v_reason IS NULL OR v_cond IS NULL OR v_repr IS NULL OR v_trap IS NULL OR v_overall IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_DIFFICULTY: 6개 차원과 overall이 모두 필요합니다.';
  END IF;
  IF v_concept < 1 OR v_concept > 5 OR v_calc < 1 OR v_calc > 5 OR v_reason < 1 OR v_reason > 5
     OR v_cond < 1 OR v_cond > 5 OR v_repr < 1 OR v_repr > 5 OR v_trap < 1 OR v_trap > 5
     OR v_overall < 1 OR v_overall > 5 THEN
    RAISE EXCEPTION 'HQB_INVALID_DIFFICULTY: difficulty는 1–5만 허용합니다.';
  END IF;
  IF COALESCE((payload->>'difficulty_confidence')::numeric, 0) < 0
     OR COALESCE((payload->>'difficulty_confidence')::numeric, 0) > 1 THEN
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
  IF review_status = 'VERIFIED' THEN
    RAISE EXCEPTION 'HQB_VERIFIED_BLOCKED: VERIFIED 문제는 난이도를 덮어쓰지 않습니다.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.problem_sources ps
    WHERE ps.problem_id = v_problem_id
      AND ps.source_document_id = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
  ) THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN_DOCUMENT: 쎈1 난이도는 이 RPC로 쓰지 않습니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(854203, hashtext(version_id::text));

  INSERT INTO public.problem_difficulty (
    problem_version_id, difficulty_source,
    concept_difficulty, calculation_complexity, reasoning_depth,
    condition_complexity, representation_complexity, trap_level,
    overall_difficulty, created_by
  ) VALUES (
    version_id, 'MODEL',
    v_concept, v_calc, v_reason, v_cond, v_repr, v_trap,
    v_overall, v_assigned_by
  )
  ON CONFLICT (problem_version_id, difficulty_source) DO UPDATE SET
    concept_difficulty = EXCLUDED.concept_difficulty,
    calculation_complexity = EXCLUDED.calculation_complexity,
    reasoning_depth = EXCLUDED.reasoning_depth,
    condition_complexity = EXCLUDED.condition_complexity,
    representation_complexity = EXCLUDED.representation_complexity,
    trap_level = EXCLUDED.trap_level,
    overall_difficulty = EXCLUDED.overall_difficulty,
    created_by = EXCLUDED.created_by
  WHERE public.problem_difficulty.difficulty_source = 'MODEL'
  RETURNING id INTO difficulty_id;

  UPDATE public.problem_classification_meta
  SET
    difficulty_level = v_overall,
    difficulty_confidence = NULLIF(payload->>'difficulty_confidence', '')::numeric
  WHERE problem_version_id = version_id;

  RETURN jsonb_build_object(
    'problem_id', v_problem_id,
    'version_id', version_id,
    'difficulty_id', difficulty_id,
    'overall_difficulty', v_overall,
    'review_status', review_status,
    'writer', uid,
    'types_mutated', false,
    'problem_text_mutated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_upsert_problem_difficulty_dims(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_difficulty_dims(jsonb) TO authenticated;

COMMENT ON FUNCTION public.hqb_upsert_problem_difficulty_dims(jsonb) IS
  'CM2 absolute difficulty dims only. Does not write type, curriculum, key points, or problem_text.';
