-- Additive fix: disambiguate public_code in hqb_create_problem_draft.
-- Does not drop tables or rewrite STEP 3 / previous STEP 4 migrations.

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
  issued_code text;
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
  RETURNING id, public.problems.public_code INTO problem_id, issued_code;

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
    jsonb_build_object('public_code', issued_code, 'version_id', version_id)
  );

  RETURN jsonb_build_object(
    'problem_id', problem_id,
    'version_id', version_id,
    'public_code', issued_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_create_problem_draft(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_create_problem_draft(jsonb) TO authenticated;
