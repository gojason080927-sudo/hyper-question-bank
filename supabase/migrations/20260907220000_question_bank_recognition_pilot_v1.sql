-- HYPER QUESTION BANK — MATH RECOGNITION PILOT v1
-- Additive only. Recognition never auto-VERIFIES and never overwrites a human draft.

CREATE TABLE IF NOT EXISTS public.recognition_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  source_page_id uuid NOT NULL REFERENCES public.source_pages (id) ON DELETE RESTRICT,
  source_page_region_id uuid NOT NULL REFERENCES public.source_page_regions (id) ON DELETE RESTRICT,
  problem_id uuid REFERENCES public.problems (id) ON DELETE SET NULL,
  problem_version_id uuid REFERENCES public.problem_versions (id) ON DELETE SET NULL,
  engine text NOT NULL,
  engine_version text NOT NULL,
  processing_mode text NOT NULL,
  status text NOT NULL,
  verdict text NOT NULL,
  payload jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  component_status jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  applied_to_version_id uuid REFERENCES public.problem_versions (id) ON DELETE SET NULL,
  CONSTRAINT recognition_results_mode_chk CHECK (
    processing_mode IN ('EMBEDDED_TEXT', 'SCAN_NO_ENGINE', 'MIXED_EMBEDDED')
  ),
  CONSTRAINT recognition_results_status_chk CHECK (
    status IN ('SUCCEEDED', 'REVIEW_REQUIRED', 'FAILED')
  ),
  CONSTRAINT recognition_results_verdict_chk CHECK (
    verdict IN ('GREEN', 'YELLOW', 'RED')
  )
);

COMMENT ON TABLE public.recognition_results IS
  'Machine recognition only. Never the Gold Standard. Apply to a DRAFT only after a human choice.';

CREATE INDEX IF NOT EXISTS recognition_results_region_idx
  ON public.recognition_results (source_page_region_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recognition_results_document_idx
  ON public.recognition_results (source_document_id);

ALTER TABLE public.recognition_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recognition_results FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.recognition_results TO authenticated;
GRANT ALL ON TABLE public.recognition_results TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.recognition_results;
CREATE POLICY qbank_staff_select ON public.recognition_results
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

CREATE OR REPLACE FUNCTION public.hqb_save_recognition_result(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  region public.source_page_regions%ROWTYPE;
  page public.source_pages%ROWTYPE;
  result_id uuid;
  next_payload jsonb;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO region
  FROM public.source_page_regions
  WHERE id = NULLIF(payload->>'source_page_region_id', '')::uuid
    AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_REGION: 문제 영역이 없습니다.';
  END IF;
  SELECT * INTO page FROM public.source_pages WHERE id = region.source_page_id;
  PERFORM public.hqb_assert_region_page(region, region.source_document_id, region.source_page_id);
  IF NULLIF(payload->>'source_document_id', '')::uuid IS NOT NULL
     AND (payload->>'source_document_id')::uuid <> region.source_document_id THEN
    RAISE EXCEPTION 'HQB_REGION_MISMATCH: 자료/페이지/영역 관계가 올바르지 않습니다.';
  END IF;
  IF NULLIF(payload->>'source_page_id', '')::uuid IS NOT NULL
     AND (payload->>'source_page_id')::uuid <> region.source_page_id THEN
    RAISE EXCEPTION 'HQB_REGION_MISMATCH: 자료/페이지/영역 관계가 올바르지 않습니다.';
  END IF;
  next_payload := COALESCE(payload->'payload', '{}'::jsonb);
  IF next_payload ? 'confidence' AND jsonb_typeof(next_payload->'confidence') = 'number' THEN
    RAISE EXCEPTION 'HQB_FAKE_CONFIDENCE: 엔진이 주지 않은 신뢰도 숫자는 저장하지 않습니다.';
  END IF;

  INSERT INTO public.recognition_results (
    source_document_id, source_page_id, source_page_region_id,
    engine, engine_version, processing_mode, status, verdict,
    payload, warnings, component_status, created_by
  ) VALUES (
    region.source_document_id,
    region.source_page_id,
    region.id,
    COALESCE(NULLIF(payload->>'engine', ''), 'hqb-embedded-text-v1'),
    COALESCE(NULLIF(payload->>'engine_version', ''), '0.1.0'),
    COALESCE(NULLIF(payload->>'processing_mode', ''), 'EMBEDDED_TEXT'),
    COALESCE(NULLIF(payload->>'status', ''), 'REVIEW_REQUIRED'),
    COALESCE(NULLIF(payload->>'verdict', ''), 'YELLOW'),
    next_payload,
    COALESCE(payload->'warnings', next_payload->'warnings', '[]'::jsonb),
    COALESCE(payload->'component_status', next_payload->'component_status', '[]'::jsonb),
    uid
  )
  RETURNING id INTO result_id;

  PERFORM public.hqb_audit(
    'recognition_result', result_id, 'SAVE_RECOGNITION',
    jsonb_build_object('region_id', region.id, 'engine', payload->>'engine')
  );
  RETURN jsonb_build_object('result_id', result_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_list_recognition_results(p_region_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: 자료에 접근할 권한이 없습니다.';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
    FROM public.recognition_results r
    WHERE r.source_page_region_id = p_region_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_apply_recognition_to_draft(p_result_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  rec public.recognition_results%ROWTYPE;
  ver public.problem_versions%ROWTYPE;
  stem text;
  item jsonb;
  choice_no int := 0;
  expr_no int := 0;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO rec FROM public.recognition_results WHERE id = p_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_RECOGNITION: 인식 결과가 없습니다.';
  END IF;
  SELECT * INTO ver FROM public.problem_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_VERSION: 현재 버전이 없습니다.';
  END IF;
  IF ver.review_status = 'VERIFIED' THEN
    RAISE EXCEPTION 'HQB_VERIFIED_LOCKED: VERIFIED 버전은 덮어쓸 수 없습니다. 새 버전을 만드세요.';
  END IF;
  IF rec.applied_to_version_id IS NOT NULL AND rec.applied_to_version_id <> p_version_id THEN
    RAISE EXCEPTION 'HQB_RECOGNITION_APPLIED: 이 인식 결과는 이미 다른 초안에 적용되었습니다.';
  END IF;

  stem := COALESCE(NULLIF(btrim(rec.payload->>'stem_text'), ''), NULLIF(btrim(rec.payload->>'raw_text'), ''));
  IF stem IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TEXT: 문제 본문을 입력해 주세요.';
  END IF;

  UPDATE public.problem_versions SET
    problem_text = stem,
    normalized_text = stem,
    item_format = CASE
      WHEN jsonb_array_length(COALESCE(rec.payload->'choices', '[]'::jsonb)) > 0 THEN 'MULTIPLE_CHOICE'
      ELSE item_format
    END,
    choice_count = COALESCE(jsonb_array_length(rec.payload->'choices'), choice_count),
    extraction_status = 'EXTRACTED',
    origin = 'OCR'
  WHERE id = p_version_id
    AND review_status <> 'VERIFIED';

  DELETE FROM public.problem_choices WHERE problem_version_id = p_version_id;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(rec.payload->'choices', '[]'::jsonb))
  LOOP
    choice_no := choice_no + 1;
    INSERT INTO public.problem_choices (problem_version_id, choice_order, label, choice_text)
    VALUES (
      p_version_id,
      COALESCE((item->>'order')::int, choice_no),
      COALESCE(item->>'label', choice_no::text),
      COALESCE(item->>'text', '')
    );
  END LOOP;

  DELETE FROM public.math_expressions WHERE problem_version_id = p_version_id;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(rec.payload->'math_expressions', '[]'::jsonb))
  LOOP
    IF NULLIF(item->>'original', '') IS NULL THEN
      CONTINUE;
    END IF;
    expr_no := expr_no + 1;
    INSERT INTO public.math_expressions (
      problem_version_id, expression_role, original_expression, latex_expression, sort_order
    ) VALUES (
      p_version_id,
      'TARGET',
      item->>'original',
      NULLIF(item->>'latex_candidate', ''),
      expr_no
    );
  END LOOP;

  UPDATE public.recognition_results SET
    applied_at = now(),
    applied_to_version_id = p_version_id,
    problem_id = ver.problem_id,
    problem_version_id = p_version_id
  WHERE id = p_result_id;

  PERFORM public.hqb_audit(
    'problem_version', p_version_id, 'APPLY_RECOGNITION',
    jsonb_build_object('result_id', p_result_id, 'actor', uid)
  );
  RETURN jsonb_build_object('version_id', p_version_id, 'result_id', p_result_id, 'applied', true);
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_save_recognition_result(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_list_recognition_results(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_apply_recognition_to_draft(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_save_recognition_result(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_list_recognition_results(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_apply_recognition_to_draft(uuid, uuid) TO authenticated;
