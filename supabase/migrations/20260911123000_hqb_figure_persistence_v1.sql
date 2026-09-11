-- HYPER QUESTION BANK — STEP 8.23
-- Additive first-class figure assets + ownership links.
-- Implements the STEP 8.22 FIGURE_DB_CONTRACT.
-- Do not apply to HYPER STUDENT CARE.
-- No table/column drops. No rewrite of problem stem/choices/math.

-- ---------------------------------------------------------------------------
-- 1. Source-level figure assets (one crop, many problem links).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_figure_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  figure_id text NOT NULL UNIQUE,
  source_document_id uuid NOT NULL REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  page_number integer NOT NULL,
  bbox jsonb NOT NULL,
  figure_type text NOT NULL,
  original_crop_path text NOT NULL,
  source_hash text NOT NULL,
  detection_confidence numeric(5, 4) NOT NULL,
  review_status text NOT NULL,
  assigned_by text NOT NULL DEFAULT 'STEP_8_23',
  artifact_step text NOT NULL DEFAULT '8.23',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_figure_assets_page_chk CHECK (page_number >= 1),
  CONSTRAINT problem_figure_assets_conf_chk CHECK (
    detection_confidence >= 0 AND detection_confidence <= 1
  ),
  CONSTRAINT problem_figure_assets_review_chk CHECK (review_status = 'AUTO'),
  CONSTRAINT problem_figure_assets_hash_chk CHECK (char_length(source_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS problem_figure_assets_source_hash_uidx
  ON public.problem_figure_assets (source_document_id, page_number, source_hash);

CREATE INDEX IF NOT EXISTS problem_figure_assets_document_page_idx
  ON public.problem_figure_assets (source_document_id, page_number);

COMMENT ON TABLE public.problem_figure_assets IS
  'STEP 8.23 first-class visual figure asset. Pixels are not duplicated per problem. Crop path is local/original-render derived; this row is metadata.';

DROP TRIGGER IF EXISTS problem_figure_assets_set_updated_at ON public.problem_figure_assets;
CREATE TRIGGER problem_figure_assets_set_updated_at
  BEFORE UPDATE ON public.problem_figure_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Problem ownership links. Shared figures reuse the same figure_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_figure_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  figure_id text NOT NULL REFERENCES public.problem_figure_assets (figure_id) ON DELETE RESTRICT,
  ownership_type text NOT NULL,
  ownership_confidence numeric(5, 4) NOT NULL,
  display_order integer NOT NULL DEFAULT 1,
  required boolean NOT NULL DEFAULT true,
  assigned_by text NOT NULL DEFAULT 'STEP_8_23',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_figure_links_owner_chk CHECK (ownership_type IN ('SINGLE', 'SHARED')),
  CONSTRAINT problem_figure_links_conf_chk CHECK (
    ownership_confidence >= 0 AND ownership_confidence <= 1
  ),
  CONSTRAINT problem_figure_links_order_chk CHECK (display_order >= 1),
  CONSTRAINT problem_figure_links_uniq UNIQUE (problem_id, figure_id)
);

CREATE INDEX IF NOT EXISTS problem_figure_links_figure_idx
  ON public.problem_figure_links (figure_id);

COMMENT ON TABLE public.problem_figure_links IS
  'STEP 8.23 figure ownership. One figure_id may link to many problems; do not copy pixels.';

DROP TRIGGER IF EXISTS problem_figure_links_set_updated_at ON public.problem_figure_links;
CREATE TRIGGER problem_figure_links_set_updated_at
  BEFORE UPDATE ON public.problem_figure_links
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS: staff SELECT, RPC-only writes. service_role retains ALL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.problem_figure_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_figure_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.problem_figure_assets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.problem_figure_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.problem_figure_assets TO authenticated;
GRANT SELECT ON TABLE public.problem_figure_links TO authenticated;
GRANT ALL ON TABLE public.problem_figure_assets TO service_role;
GRANT ALL ON TABLE public.problem_figure_links TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_figure_assets;
CREATE POLICY qbank_staff_select ON public.problem_figure_assets
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_figure_links;
CREATE POLICY qbank_staff_select ON public.problem_figure_links
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

-- ---------------------------------------------------------------------------
-- 4. Idempotent AUTO-only upsert. Never writes problems / versions / stem.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_upsert_problem_figure(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_figure_id text;
  v_doc uuid;
  v_page integer;
  v_bbox jsonb;
  v_type text;
  v_path text;
  v_hash text;
  v_conf numeric;
  v_review text;
  v_assigned text;
  v_problem uuid;
  v_expected uuid;
  v_owner text;
  v_owner_conf numeric;
  v_order integer;
  v_required boolean;
  v_canonical text;
  current_version uuid;
  asset_uuid uuid;
  link_uuid uuid;
  created_asset boolean := false;
  created_link boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();

  v_figure_id := btrim(COALESCE(payload->>'figure_id', ''));
  v_doc := NULLIF(payload->>'source_document_id', '')::uuid;
  v_page := NULLIF(payload->>'page_number', '')::integer;
  v_bbox := payload->'bbox';
  v_type := btrim(COALESCE(payload->>'figure_type', ''));
  v_path := btrim(COALESCE(payload->>'original_crop_path', ''));
  v_hash := lower(btrim(COALESCE(payload->>'source_hash', '')));
  v_conf := COALESCE((payload->>'detection_confidence')::numeric, -1);
  v_review := btrim(COALESCE(payload->>'review_status', ''));
  v_assigned := COALESCE(NULLIF(btrim(payload->>'assigned_by'), ''), 'STEP_8_23');
  v_problem := NULLIF(payload->>'problem_id', '')::uuid;
  v_expected := NULLIF(payload->>'expected_version_id', '')::uuid;
  v_owner := btrim(COALESCE(payload->>'ownership_type', ''));
  v_owner_conf := COALESCE((payload->>'ownership_confidence')::numeric, -1);
  v_order := COALESCE((payload->>'display_order')::integer, 1);
  v_required := COALESCE((payload->>'required')::boolean, true);
  v_canonical := public.hqb_canonicalize_problem_number(COALESCE(payload->>'original_problem_number', ''));

  IF v_review <> 'AUTO' THEN
    RAISE EXCEPTION 'HQB_REVIEW_REJECTED: REVIEW/UNSAFE figures are not persisted.';
  END IF;
  IF v_figure_id = '' OR v_doc IS NULL OR v_page IS NULL OR v_page < 1 THEN
    RAISE EXCEPTION 'HQB_INVALID_FIGURE: figure identity is incomplete.';
  END IF;
  IF v_type = '' OR v_path = '' OR char_length(v_hash) <> 64 THEN
    RAISE EXCEPTION 'HQB_INVALID_FIGURE: type/path/hash is incomplete.';
  END IF;
  IF v_conf < 0 OR v_conf > 1 OR v_owner_conf < 0 OR v_owner_conf > 1 THEN
    RAISE EXCEPTION 'HQB_INVALID_CONFIDENCE: confidence는 0–1이어야 합니다.';
  END IF;
  IF v_owner NOT IN ('SINGLE', 'SHARED') THEN
    RAISE EXCEPTION 'HQB_INVALID_OWNERSHIP: ownership_type is invalid.';
  END IF;
  IF v_problem IS NULL OR v_canonical IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: problem_id/number가 필요합니다.';
  END IF;
  IF v_bbox IS NULL OR v_bbox->>'unit' IS DISTINCT FROM 'normalized' THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: normalized bbox가 필요합니다.';
  END IF;

  SELECT p.current_version_id INTO current_version
  FROM public.problems p
  WHERE p.id = v_problem AND p.archived_at IS NULL;
  IF current_version IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PROBLEM: 문제가 없거나 current version이 없습니다.';
  END IF;
  IF v_expected IS NOT NULL AND v_expected IS DISTINCT FROM current_version THEN
    RAISE EXCEPTION 'HQB_VERSION_MISMATCH: current_version이 artifact와 다릅니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.problem_sources ps
    JOIN public.source_pages sp ON sp.id = ps.source_page_id
    WHERE ps.problem_id = v_problem
      AND ps.source_document_id = v_doc
      AND sp.page_number = v_page
      AND public.hqb_canonicalize_problem_number(ps.original_problem_number) = v_canonical
  ) THEN
    RAISE EXCEPTION 'HQB_IDENTITY_MISMATCH: source trace가 문제와 일치하지 않습니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(854203, hashtext(v_doc::text || ':' || v_page::text || ':' || v_hash));

  SELECT id INTO asset_uuid
  FROM public.problem_figure_assets
  WHERE source_document_id = v_doc AND page_number = v_page AND source_hash = v_hash;

  IF asset_uuid IS NULL THEN
    INSERT INTO public.problem_figure_assets (
      figure_id, source_document_id, page_number, bbox, figure_type,
      original_crop_path, source_hash, detection_confidence, review_status, assigned_by
    ) VALUES (
      v_figure_id, v_doc, v_page, v_bbox, v_type,
      v_path, v_hash, v_conf, v_review, v_assigned
    )
    RETURNING id INTO asset_uuid;
    created_asset := true;
  ELSE
    UPDATE public.problem_figure_assets SET
      figure_type = v_type,
      original_crop_path = v_path,
      detection_confidence = v_conf,
      review_status = v_review
    WHERE id = asset_uuid
      AND assigned_by = v_assigned;
    SELECT figure_id INTO v_figure_id FROM public.problem_figure_assets WHERE id = asset_uuid;
  END IF;

  SELECT id INTO link_uuid
  FROM public.problem_figure_links
  WHERE problem_id = v_problem AND figure_id = v_figure_id;

  IF link_uuid IS NULL THEN
    INSERT INTO public.problem_figure_links (
      problem_id, figure_id, ownership_type, ownership_confidence, display_order, required, assigned_by
    ) VALUES (
      v_problem, v_figure_id, v_owner, v_owner_conf, v_order, v_required, v_assigned
    )
    RETURNING id INTO link_uuid;
    created_link := true;
  ELSE
    UPDATE public.problem_figure_links SET
      ownership_type = v_owner,
      ownership_confidence = v_owner_conf,
      display_order = v_order,
      required = v_required
    WHERE id = link_uuid
      AND assigned_by = v_assigned;
  END IF;

  RETURN jsonb_build_object(
    'figure_id', v_figure_id,
    'asset_id', asset_uuid,
    'link_id', link_uuid,
    'problem_id', v_problem,
    'created_asset', created_asset,
    'created_link', created_link,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_delete_test_figure_persistence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  removed_links int := 0;
  removed_assets int := 0;
BEGIN
  uid := public.hqb_require_staff_writer();

  DELETE FROM public.problem_figure_links
  WHERE assigned_by = 'STEP_8_23_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_links = ROW_COUNT;

  DELETE FROM public.problem_figure_assets
  WHERE assigned_by = 'STEP_8_23_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_assets = ROW_COUNT;

  RETURN jsonb_build_object(
    'removed_links', removed_links,
    'removed_assets', removed_assets,
    'writer', uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_upsert_problem_figure(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_delete_test_figure_persistence() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_figure(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_delete_test_figure_persistence() TO authenticated;
