-- HYPER QUESTION BANK — STEP 8.14
-- Additive SOURCE DIFFICULTY schema. Not HYPER difficulty.
-- Do not apply to HYPER STUDENT CARE.
-- No DROP TABLE / DROP COLUMN / TRUNCATE / existing production data rewrite.

-- ---------------------------------------------------------------------------
-- 1. source_difficulty_systems
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_difficulty_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  system_code text NOT NULL,
  system_name text NOT NULL,
  system_kind text NOT NULL,
  level_scope text NOT NULL,
  created_from text[] NOT NULL DEFAULT '{}'::text[],
  confidence numeric(5, 4),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_difficulty_systems_code_key UNIQUE (system_code),
  CONSTRAINT source_difficulty_systems_kind_chk CHECK (
    system_kind IN ('STAGE', 'ITEM_BADGE', 'SECTION', 'STEP', 'STAR', 'MIXED')
  ),
  CONSTRAINT source_difficulty_systems_scope_chk CHECK (
    level_scope IN ('STAGE', 'ITEM', 'SECTION', 'STAR', 'STEP', 'OTHER')
  ),
  CONSTRAINT source_difficulty_systems_confidence_chk CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

COMMENT ON TABLE public.source_difficulty_systems IS
  'Publisher/book SOURCE difficulty system. Not HYPER LOW/MID/HIGH. STAGE and ITEM are separate systems.';

DROP TRIGGER IF EXISTS source_difficulty_systems_set_updated_at ON public.source_difficulty_systems;
CREATE TRIGGER source_difficulty_systems_set_updated_at
  BEFORE UPDATE ON public.source_difficulty_systems
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. source_difficulty_levels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_difficulty_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  difficulty_system_id uuid NOT NULL REFERENCES public.source_difficulty_systems (id) ON DELETE RESTRICT,
  raw_label text NOT NULL,
  normalized_order integer NOT NULL,
  description text,
  visual_marker text,
  section_marker text,
  item_marker text,
  level_scope text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_difficulty_levels_raw_key UNIQUE (difficulty_system_id, raw_label),
  CONSTRAINT source_difficulty_levels_order_key UNIQUE (difficulty_system_id, level_scope, normalized_order),
  CONSTRAINT source_difficulty_levels_scope_chk CHECK (
    level_scope IN ('STAGE', 'ITEM', 'SECTION', 'STAR', 'STEP', 'OTHER')
  ),
  CONSTRAINT source_difficulty_levels_order_chk CHECK (normalized_order >= 0)
);

COMMENT ON TABLE public.source_difficulty_levels IS
  'Ordered SOURCE labels inside one system. raw_label is immutable via ordinary upsert.';

CREATE INDEX IF NOT EXISTS source_difficulty_levels_system_idx
  ON public.source_difficulty_levels (difficulty_system_id);

-- ---------------------------------------------------------------------------
-- 3. problem_source_difficulty
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_source_difficulty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_source_id uuid NOT NULL REFERENCES public.problem_sources (id) ON DELETE RESTRICT,
  difficulty_system_id uuid NOT NULL REFERENCES public.source_difficulty_systems (id) ON DELETE RESTRICT,
  source_stage text,
  source_item_label text,
  source_item_label_raw text,
  source_level_order integer,
  source_level_count integer,
  level_scope text NOT NULL,
  evidence_origin text[] NOT NULL DEFAULT '{}'::text[],
  confidence numeric(5, 4) NOT NULL,
  visual_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_source_difficulty_identity_key UNIQUE (problem_id, difficulty_system_id, level_scope),
  CONSTRAINT problem_source_difficulty_scope_chk CHECK (
    level_scope IN ('STAGE', 'ITEM', 'SECTION', 'STAR', 'STEP', 'OTHER')
  ),
  CONSTRAINT problem_source_difficulty_status_chk CHECK (
    evidence_status IN ('EXPERT_CONFIRMED', 'SOURCE_CONFIRMED', 'REVIEW', 'UNKNOWN')
  ),
  CONSTRAINT problem_source_difficulty_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT problem_source_difficulty_count_chk CHECK (
    source_level_count IS NULL OR source_level_count >= 1
  )
);

COMMENT ON TABLE public.problem_source_difficulty IS
  'Per-problem publisher SOURCE difficulty evidence. Separate from problem_difficulty (HYPER 1-5). Does not create HYPER LOW/MID/HIGH.';

DROP TRIGGER IF EXISTS problem_source_difficulty_set_updated_at ON public.problem_source_difficulty;
CREATE TRIGGER problem_source_difficulty_set_updated_at
  BEFORE UPDATE ON public.problem_source_difficulty
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

CREATE INDEX IF NOT EXISTS problem_source_difficulty_problem_idx
  ON public.problem_source_difficulty (problem_id);
CREATE INDEX IF NOT EXISTS problem_source_difficulty_system_idx
  ON public.problem_source_difficulty (difficulty_system_id);
CREATE INDEX IF NOT EXISTS problem_source_difficulty_status_idx
  ON public.problem_source_difficulty (evidence_status);

-- ---------------------------------------------------------------------------
-- 4. source_difficulty_calibrations (foundation only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_difficulty_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_difficulty_system_id uuid NOT NULL REFERENCES public.source_difficulty_systems (id) ON DELETE RESTRICT,
  calibration_version text NOT NULL,
  reference_system_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  anchor_count integer NOT NULL DEFAULT 0,
  unit_coverage numeric(5, 4),
  type_coverage numeric(5, 4),
  confidence numeric(5, 4),
  scale_relation text,
  known_bias jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'FOUNDATION',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_difficulty_calibrations_version_key UNIQUE (source_difficulty_system_id, calibration_version),
  CONSTRAINT source_difficulty_calibrations_status_chk CHECK (
    status IN ('FOUNDATION', 'DRAFT', 'ACTIVE', 'SUPERSEDED')
  )
);

COMMENT ON TABLE public.source_difficulty_calibrations IS
  'Versioned cross-publisher calibration results. STEP 8.14 creates the table only; no SSEN→HYPER ACTIVE calibration rows.';

CREATE INDEX IF NOT EXISTS source_difficulty_calibrations_system_idx
  ON public.source_difficulty_calibrations (source_difficulty_system_id);

-- ---------------------------------------------------------------------------
-- 5. RLS: staff SELECT, RPC-only writes
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_difficulty_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_difficulty_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_source_difficulty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_difficulty_calibrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.source_difficulty_systems FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.source_difficulty_levels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.problem_source_difficulty FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.source_difficulty_calibrations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.source_difficulty_systems TO authenticated;
GRANT SELECT ON TABLE public.source_difficulty_levels TO authenticated;
GRANT SELECT ON TABLE public.problem_source_difficulty TO authenticated;
GRANT SELECT ON TABLE public.source_difficulty_calibrations TO authenticated;

GRANT ALL ON TABLE public.source_difficulty_systems TO service_role;
GRANT ALL ON TABLE public.source_difficulty_levels TO service_role;
GRANT ALL ON TABLE public.problem_source_difficulty TO service_role;
GRANT ALL ON TABLE public.source_difficulty_calibrations TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.source_difficulty_systems;
CREATE POLICY qbank_staff_select ON public.source_difficulty_systems
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.source_difficulty_levels;
CREATE POLICY qbank_staff_select ON public.source_difficulty_levels
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_source_difficulty;
CREATE POLICY qbank_staff_select ON public.problem_source_difficulty
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.source_difficulty_calibrations;
CREATE POLICY qbank_staff_select ON public.source_difficulty_calibrations
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_origin_allowed(p_origins text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_origins IS NOT NULL
    AND cardinality(p_origins) >= 1
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_origins) AS o(val)
      WHERE o.val NOT IN (
        'PUBLISHER_PRINTED',
        'USER_DEFINED_BOOK_RULE',
        'VISUAL_DETECTED',
        'OCR_DETECTED',
        'INFERRED_FROM_SECTION'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.hqb_upsert_source_difficulty_system(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  rec public.source_difficulty_systems%ROWTYPE;
  v_code text;
  created boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();
  v_code := NULLIF(payload->>'system_code', '');
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SYSTEM: system_code가 필요합니다.';
  END IF;
  IF NULLIF(payload->>'system_name', '') IS NULL
     OR NULLIF(payload->>'system_kind', '') IS NULL
     OR NULLIF(payload->>'level_scope', '') IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SYSTEM: name/kind/scope가 필요합니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(854214, hashtext(v_code));

  SELECT * INTO rec FROM public.source_difficulty_systems WHERE system_code = v_code;
  IF rec.id IS NOT NULL THEN
    IF rec.source_document_id IS DISTINCT FROM NULLIF(payload->>'source_document_id', '')::uuid THEN
      RAISE EXCEPTION 'HQB_SYSTEM_CONFLICT: source_document_id를 바꿀 수 없습니다.';
    END IF;
    IF rec.system_kind IS DISTINCT FROM payload->>'system_kind'
       OR rec.level_scope IS DISTINCT FROM payload->>'level_scope' THEN
      RAISE EXCEPTION 'HQB_SYSTEM_CONFLICT: system_kind/level_scope를 바꿀 수 없습니다.';
    END IF;
    UPDATE public.source_difficulty_systems
    SET system_name = payload->>'system_name',
        created_from = COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(payload->'created_from')),
          created_from
        ),
        confidence = COALESCE(NULLIF(payload->>'confidence', '')::numeric, confidence),
        metadata = COALESCE(payload->'metadata', metadata),
        assigned_by = COALESCE(NULLIF(payload->>'assigned_by', ''), assigned_by)
    WHERE id = rec.id
    RETURNING * INTO rec;
  ELSE
    INSERT INTO public.source_difficulty_systems (
      source_document_id, system_code, system_name, system_kind, level_scope,
      created_from, confidence, metadata, assigned_by
    ) VALUES (
      NULLIF(payload->>'source_document_id', '')::uuid,
      v_code,
      payload->>'system_name',
      payload->>'system_kind',
      payload->>'level_scope',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(payload->'created_from')), '{}'::text[]),
      NULLIF(payload->>'confidence', '')::numeric,
      COALESCE(payload->'metadata', '{}'::jsonb),
      NULLIF(payload->>'assigned_by', '')
    )
    RETURNING * INTO rec;
    created := true;
  END IF;

  RETURN jsonb_build_object(
    'id', rec.id,
    'system_code', rec.system_code,
    'created', created,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_upsert_source_difficulty_level(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  sys_id uuid;
  rec public.source_difficulty_levels%ROWTYPE;
  v_raw text;
  v_order integer;
  created boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();
  v_raw := NULLIF(payload->>'raw_label', '');
  IF NULLIF(payload->>'difficulty_system_id', '') IS NULL AND NULLIF(payload->>'system_code', '') IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_LEVEL: difficulty_system_id가 필요합니다.';
  END IF;
  IF v_raw IS NULL OR NULLIF(payload->>'level_scope', '') IS NULL OR payload->>'normalized_order' IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_LEVEL: raw_label/order/scope가 필요합니다.';
  END IF;
  v_order := (payload->>'normalized_order')::integer;

  IF NULLIF(payload->>'difficulty_system_id', '') IS NOT NULL THEN
    sys_id := (payload->>'difficulty_system_id')::uuid;
  ELSE
    SELECT id INTO sys_id FROM public.source_difficulty_systems WHERE system_code = payload->>'system_code';
  END IF;
  IF sys_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SYSTEM: difficulty system이 없습니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(854214, hashtext(sys_id::text || ':' || v_raw));

  SELECT * INTO rec
  FROM public.source_difficulty_levels
  WHERE difficulty_system_id = sys_id AND raw_label = v_raw;

  IF rec.id IS NOT NULL THEN
    IF rec.normalized_order IS DISTINCT FROM v_order
       OR rec.level_scope IS DISTINCT FROM payload->>'level_scope' THEN
      RAISE EXCEPTION 'HQB_RAW_LABEL_CONFLICT: source level raw_label/order는 조용히 바꿀 수 없습니다.';
    END IF;
  ELSE
    INSERT INTO public.source_difficulty_levels (
      difficulty_system_id, raw_label, normalized_order, description,
      visual_marker, section_marker, item_marker, level_scope, metadata
    ) VALUES (
      sys_id,
      v_raw,
      v_order,
      NULLIF(payload->>'description', ''),
      NULLIF(payload->>'visual_marker', ''),
      NULLIF(payload->>'section_marker', ''),
      NULLIF(payload->>'item_marker', ''),
      payload->>'level_scope',
      COALESCE(payload->'metadata', '{}'::jsonb)
    )
    RETURNING * INTO rec;
    created := true;
  END IF;

  RETURN jsonb_build_object(
    'id', rec.id,
    'difficulty_system_id', rec.difficulty_system_id,
    'raw_label', rec.raw_label,
    'normalized_order', rec.normalized_order,
    'created', created,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_upsert_problem_source_difficulty(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_problem_id uuid;
  v_doc_id uuid;
  sys public.source_difficulty_systems%ROWTYPE;
  lvl public.source_difficulty_levels%ROWTYPE;
  src public.problem_sources%ROWTYPE;
  rec public.problem_source_difficulty%ROWTYPE;
  page_no integer;
  canonical text;
  v_scope text;
  v_raw text;
  v_origins text[];
  v_status text;
  created boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();
  v_problem_id := NULLIF(payload->>'problem_id', '')::uuid;
  v_doc_id := NULLIF(payload->>'source_document_id', '')::uuid;
  v_scope := NULLIF(payload->>'level_scope', '');
  v_status := NULLIF(payload->>'evidence_status', '');
  v_origins := COALESCE(ARRAY(SELECT jsonb_array_elements_text(payload->'evidence_origin')), '{}'::text[]);

  IF v_problem_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: problem_id가 필요합니다.';
  END IF;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SCOPE: level_scope가 필요합니다.';
  END IF;
  IF NOT public.hqb_origin_allowed(v_origins) THEN
    RAISE EXCEPTION 'HQB_INVALID_ORIGIN: evidence_origin이 올바르지 않습니다.';
  END IF;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_STATUS: evidence_status가 필요합니다.';
  END IF;

  IF NULLIF(payload->>'difficulty_system_id', '') IS NOT NULL THEN
    SELECT * INTO sys FROM public.source_difficulty_systems WHERE id = (payload->>'difficulty_system_id')::uuid;
  ELSE
    SELECT * INTO sys FROM public.source_difficulty_systems WHERE system_code = NULLIF(payload->>'system_code', '');
  END IF;
  IF sys.id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SYSTEM: difficulty system이 없습니다.';
  END IF;
  IF sys.level_scope IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'HQB_INVALID_SCOPE: level_scope가 system과 다릅니다.';
  END IF;
  IF v_doc_id IS NULL THEN
    RAISE EXCEPTION 'HQB_WRONG_DOCUMENT: source_document_id가 필요합니다.';
  END IF;
  IF sys.source_document_id IS NOT NULL AND sys.source_document_id IS DISTINCT FROM v_doc_id THEN
    RAISE EXCEPTION 'HQB_WRONG_DOCUMENT: difficulty system의 source document와 다릅니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_documents d WHERE d.id = v_doc_id AND d.archived_at IS NULL) THEN
    RAISE EXCEPTION 'HQB_WRONG_DOCUMENT: source document가 없습니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.problems p
    WHERE p.id = v_problem_id AND p.archived_at IS NULL AND p.current_version_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: 문제가 없거나 current version이 없습니다.';
  END IF;

  page_no := NULLIF(payload->>'page_number', '')::integer;
  canonical := public.hqb_canonicalize_problem_number(COALESCE(payload->>'original_problem_number', ''));
  IF page_no IS NULL OR canonical IS NULL THEN
    RAISE EXCEPTION 'HQB_IDENTITY_MISMATCH: page/number가 올바르지 않습니다.';
  END IF;

  SELECT ps.* INTO src
  FROM public.problem_sources ps
  JOIN public.source_pages sp ON sp.id = ps.source_page_id
  WHERE ps.problem_id = v_problem_id
    AND ps.source_document_id = v_doc_id
    AND sp.page_number = page_no
    AND public.hqb_canonicalize_problem_number(ps.original_problem_number) = canonical
  LIMIT 1;
  IF src.id IS NULL THEN
    RAISE EXCEPTION 'HQB_IDENTITY_MISMATCH: source trace가 문제와 일치하지 않습니다.';
  END IF;

  IF v_scope = 'ITEM' THEN
    v_raw := NULLIF(payload->>'source_item_label_raw', '');
  ELSE
    v_raw := COALESCE(NULLIF(payload->>'source_stage', ''), NULLIF(payload->>'source_item_label_raw', ''));
  END IF;
  IF v_raw IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_LABEL: source raw label이 필요합니다.';
  END IF;

  SELECT * INTO lvl
  FROM public.source_difficulty_levels
  WHERE difficulty_system_id = sys.id AND raw_label = v_raw AND level_scope = v_scope;
  IF lvl.id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_LABEL: raw_label이 이 system에 없습니다.';
  END IF;
  IF payload->>'source_level_order' IS NOT NULL
     AND (payload->>'source_level_order')::integer IS DISTINCT FROM lvl.normalized_order THEN
    RAISE EXCEPTION 'HQB_INVALID_LABEL: normalized_order가 level 정의와 다릅니다.';
  END IF;

  IF v_status = 'EXPERT_CONFIRMED' THEN
    IF NOT ('PUBLISHER_PRINTED' = ANY (v_origins) AND 'VISUAL_DETECTED' = ANY (v_origins)) THEN
      RAISE EXCEPTION 'HQB_INVALID_ORIGIN: EXPERT_CONFIRMED는 PUBLISHER_PRINTED+VISUAL_DETECTED가 필요합니다.';
    END IF;
    IF payload->'visual_evidence' IS NULL OR payload->'visual_evidence' = '{}'::jsonb THEN
      RAISE EXCEPTION 'HQB_MISSING_VISUAL: EXPERT_CONFIRMED는 visual evidence가 필요합니다.';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(854214, hashtext(v_problem_id::text || ':' || sys.id::text || ':' || v_scope));

  SELECT * INTO rec
  FROM public.problem_source_difficulty
  WHERE problem_id = v_problem_id
    AND difficulty_system_id = sys.id
    AND level_scope = v_scope;

  IF rec.id IS NOT NULL THEN
    IF rec.source_item_label_raw IS DISTINCT FROM v_raw
       AND v_scope = 'ITEM' THEN
      RAISE EXCEPTION 'HQB_RAW_LABEL_CONFLICT: source raw_label을 조용히 덮어쓸 수 없습니다.';
    END IF;
    IF rec.source_stage IS DISTINCT FROM NULLIF(payload->>'source_stage', '')
       AND v_scope = 'STAGE' THEN
      RAISE EXCEPTION 'HQB_RAW_LABEL_CONFLICT: source stage raw_label을 조용히 덮어쓸 수 없습니다.';
    END IF;
  ELSE
    INSERT INTO public.problem_source_difficulty (
      problem_id, problem_source_id, difficulty_system_id,
      source_stage, source_item_label, source_item_label_raw,
      source_level_order, source_level_count, level_scope,
      evidence_origin, confidence, visual_evidence, evidence_status,
      metadata, assigned_by
    ) VALUES (
      v_problem_id,
      src.id,
      sys.id,
      NULLIF(payload->>'source_stage', ''),
      CASE WHEN v_scope = 'ITEM' THEN v_raw ELSE NULL END,
      CASE WHEN v_scope = 'ITEM' THEN v_raw ELSE NULL END,
      lvl.normalized_order,
      NULLIF(payload->>'source_level_count', '')::integer,
      v_scope,
      v_origins,
      (payload->>'confidence')::numeric,
      COALESCE(payload->'visual_evidence', '{}'::jsonb),
      v_status,
      COALESCE(payload->'metadata', '{}'::jsonb),
      NULLIF(payload->>'assigned_by', '')
    )
    RETURNING * INTO rec;
    created := true;
  END IF;

  RETURN jsonb_build_object(
    'id', rec.id,
    'problem_id', rec.problem_id,
    'difficulty_system_id', rec.difficulty_system_id,
    'level_scope', rec.level_scope,
    'source_item_label_raw', rec.source_item_label_raw,
    'source_stage', rec.source_stage,
    'created', created,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_delete_test_source_difficulty(p_marker text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  removed_psd int := 0;
  removed_cal int := 0;
  removed_lvl int := 0;
  removed_sys int := 0;
BEGIN
  uid := public.hqb_require_staff_writer();
  IF p_marker IS DISTINCT FROM 'STEP_8_14_ROLLBACK_TEST' THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: test cleanup marker가 올바르지 않습니다.';
  END IF;

  DELETE FROM public.problem_source_difficulty
  WHERE assigned_by = p_marker OR metadata->>'test_run' = p_marker;
  GET DIAGNOSTICS removed_psd = ROW_COUNT;

  DELETE FROM public.source_difficulty_calibrations
  WHERE assigned_by = p_marker OR metadata->>'test_run' = p_marker;
  GET DIAGNOSTICS removed_cal = ROW_COUNT;

  DELETE FROM public.source_difficulty_levels lvl
  USING public.source_difficulty_systems sys
  WHERE lvl.difficulty_system_id = sys.id
    AND (sys.assigned_by = p_marker OR sys.metadata->>'test_run' = p_marker);
  GET DIAGNOSTICS removed_lvl = ROW_COUNT;

  DELETE FROM public.source_difficulty_systems
  WHERE assigned_by = p_marker OR metadata->>'test_run' = p_marker;
  GET DIAGNOSTICS removed_sys = ROW_COUNT;

  RETURN jsonb_build_object(
    'removed_problem_source_difficulty', removed_psd,
    'removed_calibrations', removed_cal,
    'removed_levels', removed_lvl,
    'removed_systems', removed_sys,
    'writer', uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_origin_allowed(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_source_difficulty_system(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_source_difficulty_level(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_problem_source_difficulty(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_delete_test_source_difficulty(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_origin_allowed(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_source_difficulty_system(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_source_difficulty_level(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_source_difficulty(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hqb_delete_test_source_difficulty(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
