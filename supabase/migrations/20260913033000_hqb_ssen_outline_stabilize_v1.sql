-- STEP 8.36: source outline, list pagination, fixture visibility, display_state.
-- Additive only. Never DELETE problems. Never auto VERIFIED.

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS is_fixture boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'STAFF_DEFAULT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_documents_visibility_chk'
  ) THEN
    ALTER TABLE public.source_documents
      ADD CONSTRAINT source_documents_visibility_chk
      CHECK (visibility IN ('STAFF_DEFAULT', 'INTERNAL_TEST'));
  END IF;
END $$;

ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS display_state text NOT NULL DEFAULT 'LISTED',
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.problems(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'problems_display_state_chk'
  ) THEN
    ALTER TABLE public.problems
      ADD CONSTRAINT problems_display_state_chk
      CHECK (display_state IN ('LISTED', 'HIDDEN_DUPLICATE', 'SUPERSEDED_SPLIT'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.source_outline_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES public.source_documents(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES public.source_outline_nodes(id) ON DELETE RESTRICT,
  node_level text NOT NULL,
  code text,
  title_original text NOT NULL,
  title_normalized text NOT NULL,
  sort_order integer NOT NULL,
  pdf_page_start integer,
  pdf_page_end integer,
  print_page_start integer,
  print_page_end integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  instructor_editable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_outline_nodes_level_chk CHECK (node_level IN ('BOOK', 'MAJOR_UNIT', 'SECTION', 'TYPE_SEGMENT'))
);

ALTER TABLE public.source_outline_nodes
  ADD COLUMN IF NOT EXISTS parent_key uuid
  GENERATED ALWAYS AS (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

DROP INDEX IF EXISTS source_outline_nodes_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS source_outline_nodes_unique_parent_key_idx
  ON public.source_outline_nodes (source_document_id, node_level, sort_order, parent_key);

CREATE INDEX IF NOT EXISTS source_outline_nodes_parent_idx
  ON public.source_outline_nodes (parent_id);

CREATE TABLE IF NOT EXISTS public.problem_outline_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems(id) ON DELETE RESTRICT,
  outline_node_id uuid NOT NULL REFERENCES public.source_outline_nodes(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT true,
  assigned_by text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_id, outline_node_id)
);

CREATE INDEX IF NOT EXISTS problem_outline_assignments_node_idx
  ON public.problem_outline_assignments (outline_node_id);

ALTER TABLE public.source_outline_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_outline_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS source_outline_nodes_staff_select ON public.source_outline_nodes;
CREATE POLICY source_outline_nodes_staff_select ON public.source_outline_nodes
  FOR SELECT TO authenticated USING (public.hqb_is_staff());

DROP POLICY IF EXISTS problem_outline_assignments_staff_select ON public.problem_outline_assignments;
CREATE POLICY problem_outline_assignments_staff_select ON public.problem_outline_assignments
  FOR SELECT TO authenticated USING (public.hqb_is_staff());

CREATE OR REPLACE FUNCTION public.hqb_upsert_source_outline_node(payload jsonb)
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
  INSERT INTO public.source_outline_nodes (
    id, source_document_id, parent_id, node_level, code,
    title_original, title_normalized, sort_order,
    pdf_page_start, pdf_page_end, print_page_start, print_page_end,
    evidence, confidence, instructor_editable
  ) VALUES (
    COALESCE(NULLIF(payload->>'id', '')::uuid, gen_random_uuid()),
    (payload->>'source_document_id')::uuid,
    NULLIF(payload->>'parent_id', '')::uuid,
    payload->>'node_level',
    NULLIF(payload->>'code', ''),
    payload->>'title_original',
    COALESCE(NULLIF(payload->>'title_normalized', ''), payload->>'title_original'),
    COALESCE((payload->>'sort_order')::int, 0),
    NULLIF(payload->>'pdf_page_start', '')::int,
    NULLIF(payload->>'pdf_page_end', '')::int,
    NULLIF(payload->>'print_page_start', '')::int,
    NULLIF(payload->>'print_page_end', '')::int,
    COALESCE(payload->'evidence', '{}'::jsonb),
    NULLIF(payload->>'confidence', '')::numeric,
    COALESCE((payload->>'instructor_editable')::boolean, true)
  )
  ON CONFLICT (source_document_id, node_level, sort_order, parent_key)
  DO UPDATE SET
    code = COALESCE(EXCLUDED.code, public.source_outline_nodes.code),
    title_original = EXCLUDED.title_original,
    title_normalized = EXCLUDED.title_normalized,
    pdf_page_start = EXCLUDED.pdf_page_start,
    pdf_page_end = EXCLUDED.pdf_page_end,
    print_page_start = EXCLUDED.print_page_start,
    print_page_end = EXCLUDED.print_page_end,
    evidence = EXCLUDED.evidence,
    confidence = EXCLUDED.confidence,
    instructor_editable = EXCLUDED.instructor_editable,
    updated_at = now()
  RETURNING id INTO rid;
  RETURN jsonb_build_object('id', rid);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_assign_problem_outline(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  INSERT INTO public.problem_outline_assignments (problem_id, outline_node_id, is_primary, assigned_by, confidence)
  VALUES (
    (payload->>'problem_id')::uuid,
    (payload->>'outline_node_id')::uuid,
    COALESCE((payload->>'is_primary')::boolean, true),
    COALESCE(NULLIF(payload->>'assigned_by', ''), uid::text),
    NULLIF(payload->>'confidence', '')::numeric
  )
  ON CONFLICT (problem_id, outline_node_id) DO UPDATE SET
    is_primary = EXCLUDED.is_primary,
    assigned_by = EXCLUDED.assigned_by,
    confidence = EXCLUDED.confidence;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_set_source_fixture(p_document_id uuid, p_is_fixture boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.hqb_require_staff_writer();
  UPDATE public.source_documents
  SET is_fixture = p_is_fixture,
      visibility = CASE WHEN p_is_fixture THEN 'INTERNAL_TEST' ELSE 'STAFF_DEFAULT' END
  WHERE id = p_document_id;
  RETURN jsonb_build_object('id', p_document_id, 'is_fixture', p_is_fixture);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_set_problem_display_state(
  p_problem_id uuid,
  p_display_state text,
  p_superseded_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.hqb_require_staff_writer();
  IF p_display_state NOT IN ('LISTED', 'HIDDEN_DUPLICATE', 'SUPERSEDED_SPLIT') THEN
    RAISE EXCEPTION 'HQB_BAD_DISPLAY_STATE';
  END IF;
  UPDATE public.problems
  SET display_state = p_display_state,
      superseded_by = p_superseded_by
  WHERE id = p_problem_id
    AND review_status IS DISTINCT FROM 'VERIFIED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_VERIFIED_LOCKED: VERIFIED 문제는 표시 상태를 바꿀 수 없습니다.';
  END IF;
  RETURN jsonb_build_object('id', p_problem_id, 'display_state', p_display_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_sync_source_pipeline_status(p_document_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.hqb_require_staff_writer();
  UPDATE public.source_documents
  SET ocr_status = COALESCE(NULLIF(payload->>'ocr_status', ''), ocr_status),
      extraction_status = COALESCE(NULLIF(payload->>'extraction_status', ''), extraction_status),
      updated_at = now()
  WHERE id = p_document_id;
  RETURN jsonb_build_object('id', p_document_id, 'ocr_status', payload->>'ocr_status', 'extraction_status', payload->>'extraction_status');
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_source_runtime_stats(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc public.source_documents%ROWTYPE;
  pages int;
  ocr_pages int;
  linked int;
  listed int;
  auto_n int;
  review_n int;
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN';
  END IF;
  SELECT * INTO doc FROM public.source_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_MISSING_SOURCE';
  END IF;
  SELECT count(*) INTO pages FROM public.source_pages WHERE source_document_id = p_document_id;
  SELECT count(*) INTO ocr_pages FROM public.source_pages
    WHERE source_document_id = p_document_id AND ocr_status IN ('SUCCEEDED', 'REVIEW_REQUIRED');
  SELECT count(DISTINCT problem_id) INTO linked FROM public.problem_sources WHERE source_document_id = p_document_id;
  SELECT count(DISTINCT ps.problem_id) INTO listed
  FROM public.problem_sources ps
  JOIN public.problems p ON p.id = ps.problem_id
  WHERE ps.source_document_id = p_document_id
    AND p.lifecycle_status IN ('DRAFT', 'ACTIVE')
    AND p.display_state = 'LISTED';
  SELECT count(*) INTO auto_n
  FROM public.problems p
  JOIN public.problem_sources ps ON ps.problem_id = p.id
  WHERE ps.source_document_id = p_document_id AND p.review_status = 'AUTO_CLASSIFIED';
  SELECT count(*) INTO review_n
  FROM public.problems p
  JOIN public.problem_sources ps ON ps.problem_id = p.id
  WHERE ps.source_document_id = p_document_id AND p.review_status = 'NEEDS_REVIEW'
    AND p.lifecycle_status IN ('DRAFT', 'ACTIVE');
  RETURN jsonb_build_object(
    'source_document_id', p_document_id,
    'title', doc.title,
    'page_count', COALESCE(doc.page_count, pages),
    'stored_pages', pages,
    'ocr_pages', GREATEST(ocr_pages, CASE WHEN linked > 0 THEN pages ELSE 0 END),
    'linked_problems', linked,
    'listed_problems', listed,
    'auto_classified', auto_n,
    'needs_review', review_n,
    'ocr_status', doc.ocr_status,
    'extraction_status', doc.extraction_status,
    'document_status', doc.document_status,
    'updated_at', doc.updated_at,
    'pipeline_status', CASE
      WHEN linked > 0 AND review_n > 0 THEN 'REVIEW_REQUIRED'
      WHEN linked > 0 THEN 'COMPLETED'
      WHEN doc.document_status = 'UPLOADING' THEN 'UPLOADING'
      ELSE COALESCE(doc.ocr_status, 'PENDING')
    END,
    'ocr_complete', linked > 0,
    'extraction_complete', linked > 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_list_review_queue(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src uuid;
  rows jsonb;
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN';
  END IF;
  src := NULLIF(payload->>'source_document_id', '')::uuid;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.page_number, x.original_problem_number), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      p.id AS problem_id,
      p.public_code,
      p.review_status,
      p.lifecycle_status,
      p.current_version_id,
      ps.source_document_id,
      sd.title AS source_title,
      sp.page_number,
      ps.original_problem_number,
      pv.problem_text,
      pv.origin
    FROM public.problems p
    JOIN public.problem_sources ps ON ps.problem_id = p.id AND ps.is_primary_source = true
    JOIN public.source_documents sd ON sd.id = ps.source_document_id
    LEFT JOIN public.source_pages sp ON sp.id = ps.source_page_id
    LEFT JOIN public.problem_versions pv ON pv.id = p.current_version_id
    WHERE p.review_status = 'NEEDS_REVIEW'
      AND p.lifecycle_status IN ('DRAFT', 'ACTIVE')
      AND (src IS NULL OR ps.source_document_id = src)
    LIMIT 200
  ) x;
  RETURN jsonb_build_object('items', rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_list_problems(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_no int;
  page_size int;
  src uuid;
  outline uuid;
  q text;
  status text;
  trash boolean;
  listed_only boolean;
  show_fixtures boolean;
  sort_book boolean;
  format_f text;
  page_from int;
  page_to int;
  orig_no text;
  offset_n int;
  total_n int;
  rows jsonb;
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN';
  END IF;
  page_no := GREATEST(1, COALESCE((payload->>'page')::int, 1));
  page_size := LEAST(100, GREATEST(20, COALESCE((payload->>'page_size')::int, 50)));
  src := NULLIF(payload->>'source_document_id', '')::uuid;
  outline := NULLIF(payload->>'outline_node_id', '')::uuid;
  q := NULLIF(btrim(COALESCE(payload->>'query', '')), '');
  status := NULLIF(payload->>'review_status', '');
  trash := COALESCE((payload->>'trash')::boolean, false);
  listed_only := COALESCE((payload->>'listed_only')::boolean, true);
  show_fixtures := COALESCE((payload->>'show_fixtures')::boolean, false);
  sort_book := COALESCE(payload->>'sort', 'book') = 'book';
  format_f := NULLIF(payload->>'item_format', '');
  page_from := NULLIF(payload->>'page_from', '')::int;
  page_to := NULLIF(payload->>'page_to', '')::int;
  orig_no := NULLIF(btrim(COALESCE(payload->>'original_problem_number', '')), '');
  offset_n := (page_no - 1) * page_size;

  WITH outline_match AS (
    SELECT id FROM public.source_outline_nodes WHERE id = outline
    UNION
    SELECT id FROM public.source_outline_nodes WHERE parent_id = outline
    UNION
    SELECT c.id FROM public.source_outline_nodes c
    JOIN public.source_outline_nodes pnode ON c.parent_id = pnode.id
    WHERE pnode.parent_id = outline
    UNION
    SELECT g.id FROM public.source_outline_nodes g
    JOIN public.source_outline_nodes c ON g.parent_id = c.id
    JOIN public.source_outline_nodes pnode ON c.parent_id = pnode.id
    WHERE pnode.parent_id = outline
  ),
  base AS (
    SELECT
      p.id,
      p.public_code,
      p.review_status,
      p.lifecycle_status,
      p.updated_at,
      p.current_version_id,
      p.display_state,
      pv.problem_text,
      pv.version_no,
      pv.item_format,
      pv.origin AS version_origin,
      sp.page_number,
      ps.original_problem_number,
      ps.bounding_box,
      ps.source_document_id,
      sd.title AS source_title,
      sd.is_fixture,
      poa.outline_node_id,
      sec.title_normalized AS section_title,
      maj.title_normalized AS major_title,
      (SELECT c.name FROM public.problem_concepts pc
        JOIN public.concepts c ON c.id = pc.concept_id
        WHERE pc.problem_version_id = p.current_version_id AND pc.is_primary
        LIMIT 1) AS concept_name,
      (SELECT t.name FROM public.problem_type_assignments pta
        JOIN public.hyper_problem_types t ON t.id = pta.hyper_problem_type_id
        WHERE pta.problem_version_id = p.current_version_id
        LIMIT 1) AS type_name,
      (SELECT cn.name FROM public.problem_curriculum pc2
        JOIN public.curriculum_nodes cn ON cn.id = pc2.curriculum_node_id
        WHERE pc2.problem_version_id = p.current_version_id
        LIMIT 1) AS curriculum_name,
      (SELECT d.overall_difficulty FROM public.problem_difficulty d
        WHERE d.problem_version_id = p.current_version_id
        ORDER BY CASE WHEN d.difficulty_source = 'HUMAN' THEN 0 ELSE 1 END
        LIMIT 1) AS overall_difficulty,
      (SELECT d.difficulty_source FROM public.problem_difficulty d
        WHERE d.problem_version_id = p.current_version_id
        ORDER BY CASE WHEN d.difficulty_source = 'HUMAN' THEN 0 ELSE 1 END
        LIMIT 1) AS difficulty_source
    FROM public.problems p
    LEFT JOIN public.problem_versions pv ON pv.id = p.current_version_id
    LEFT JOIN public.problem_sources ps ON ps.problem_id = p.id AND ps.is_primary_source = true
    LEFT JOIN public.source_pages sp ON sp.id = ps.source_page_id
    LEFT JOIN public.source_documents sd ON sd.id = ps.source_document_id
    LEFT JOIN public.problem_outline_assignments poa ON poa.problem_id = p.id AND poa.is_primary = true
    LEFT JOIN public.source_outline_nodes sec ON sec.id = poa.outline_node_id
    LEFT JOIN public.source_outline_nodes maj ON maj.id = sec.parent_id
    WHERE CASE WHEN trash THEN p.lifecycle_status = 'ARCHIVED' ELSE p.lifecycle_status IN ('DRAFT', 'ACTIVE') END
      AND (NOT listed_only OR p.display_state = 'LISTED' OR trash)
      AND (src IS NULL OR ps.source_document_id = src)
      AND (outline IS NULL OR poa.outline_node_id IN (SELECT id FROM outline_match)
        OR EXISTS (
          SELECT 1 FROM public.problem_outline_assignments any_a
          WHERE any_a.problem_id = p.id AND any_a.outline_node_id IN (SELECT id FROM outline_match)
        ))
      AND (status IS NULL OR p.review_status = status)
      AND (show_fixtures OR sd.is_fixture IS NOT TRUE OR src IS NOT NULL)
      AND (format_f IS NULL OR pv.item_format = format_f)
      AND (page_from IS NULL OR sp.page_number >= page_from)
      AND (page_to IS NULL OR sp.page_number <= page_to)
      AND (orig_no IS NULL OR ps.original_problem_number ILIKE '%' || orig_no || '%')
      AND (q IS NULL OR p.public_code ILIKE '%' || q || '%' OR pv.problem_text ILIKE '%' || q || '%'
        OR ps.original_problem_number ILIKE '%' || q || '%')
  ),
  counted AS (SELECT count(*) AS n FROM base),
  paged AS (
    SELECT * FROM base
    ORDER BY
      CASE WHEN sort_book THEN COALESCE(page_number, 9999) ELSE 0 END,
      CASE WHEN sort_book THEN COALESCE(
        NULLIF(regexp_replace(COALESCE(original_problem_number, ''), '[^0-9]', '', 'g'), '')::int,
        999999
      ) ELSE 0 END,
      CASE WHEN NOT sort_book THEN updated_at END DESC NULLS LAST,
      public_code
    OFFSET offset_n
    LIMIT page_size
  )
  SELECT (SELECT n FROM counted),
         (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM paged x)
  INTO total_n, rows;

  RETURN jsonb_build_object(
    'total', total_n,
    'page', page_no,
    'page_size', page_size,
    'sort', CASE WHEN sort_book THEN 'book' ELSE 'updated' END,
    'items', rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_upsert_source_outline_node(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_assign_problem_outline(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_set_source_fixture(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_set_problem_display_state(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_sync_source_pipeline_status(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_source_runtime_stats(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_list_review_queue(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_list_problems(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_upsert_source_outline_node(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_assign_problem_outline(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_set_source_fixture(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_set_problem_display_state(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_sync_source_pipeline_status(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_source_runtime_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_list_review_queue(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_list_problems(jsonb) TO authenticated;

GRANT SELECT ON public.source_outline_nodes TO authenticated;
GRANT SELECT ON public.problem_outline_assignments TO authenticated;

CREATE OR REPLACE FUNCTION public.hqb_list_source_outline(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb;
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN';
  END IF;
  WITH RECURSIVE tree AS (
    SELECT n.id, n.id AS root
    FROM public.source_outline_nodes n
    WHERE n.source_document_id = p_document_id
    UNION ALL
    SELECT child.id, tree.root
    FROM public.source_outline_nodes child
    JOIN tree ON child.parent_id = tree.id
  ),
  counts AS (
    SELECT tree.root AS node_id, count(DISTINCT poa.problem_id)::int AS listed_count
    FROM tree
    JOIN public.problem_outline_assignments poa ON poa.outline_node_id = tree.id
    JOIN public.problems p ON p.id = poa.problem_id
    WHERE p.display_state = 'LISTED'
      AND p.lifecycle_status IN ('DRAFT', 'ACTIVE')
    GROUP BY tree.root
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      n.id,
      n.parent_id,
      n.node_level,
      n.code,
      n.title_original,
      n.title_normalized,
      n.sort_order,
      n.pdf_page_start,
      n.pdf_page_end,
      n.print_page_start,
      n.print_page_end,
      COALESCE(c.listed_count, 0) AS listed_count
    FROM public.source_outline_nodes n
    LEFT JOIN counts c ON c.node_id = n.id
    WHERE n.source_document_id = p_document_id
  ) x;
  RETURN jsonb_build_object('nodes', rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_apply_auto_clean_text(
  p_problem_id uuid,
  p_cleaned_text text,
  p_change_reason text DEFAULT 'STEP 8.36 OCR auto-clean'
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
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO src
  FROM public.problem_versions
  WHERE id = (SELECT current_version_id FROM public.problems WHERE id = p_problem_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_version');
  END IF;
  IF src.origin = 'TEACHER_EDIT' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'teacher_edit');
  END IF;
  IF EXISTS (SELECT 1 FROM public.problems WHERE id = p_problem_id AND review_status = 'VERIFIED') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'verified');
  END IF;
  IF btrim(COALESCE(p_cleaned_text, '')) = '' OR p_cleaned_text = src.problem_text THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'unchanged');
  END IF;
  SELECT COALESCE(max(version_no), 0) + 1 INTO next_no
  FROM public.problem_versions WHERE problem_id = p_problem_id;
  INSERT INTO public.problem_versions (
    problem_id, version_no, origin, parent_version_id, change_reason,
    problem_text, normalized_text, instruction, item_format, choice_count,
    content_metadata, extraction_status, classification_status, review_status, created_by
  ) VALUES (
    p_problem_id,
    next_no,
    'AUTO_CLEAN',
    src.id,
    p_change_reason,
    p_cleaned_text,
    p_cleaned_text,
    src.instruction,
    src.item_format,
    src.choice_count,
    COALESCE(src.content_metadata, '{}'::jsonb),
    src.extraction_status,
    src.classification_status,
    src.review_status,
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
  INSERT INTO public.problem_difficulty (
    problem_version_id, difficulty_source, concept_difficulty, calculation_complexity,
    reasoning_depth, condition_complexity, representation_complexity, trap_level, created_by
  )
  SELECT new_id, difficulty_source, concept_difficulty, calculation_complexity,
         reasoning_depth, condition_complexity, representation_complexity, trap_level, created_by
  FROM public.problem_difficulty WHERE problem_version_id = src.id;
  INSERT INTO public.problem_choices (
    problem_version_id, choice_order, label, choice_text, normalized_text, math_expression
  )
  SELECT new_id, choice_order, label, choice_text, normalized_text, math_expression
  FROM public.problem_choices WHERE problem_version_id = src.id;
  UPDATE public.problems SET current_version_id = new_id, updated_at = now() WHERE id = p_problem_id;
  RETURN jsonb_build_object('skipped', false, 'version_id', new_id, 'version_no', next_no);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_link_duplicate(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a uuid;
  b uuid;
  keeper uuid;
  extra uuid;
  lo uuid;
  hi uuid;
BEGIN
  PERFORM public.hqb_require_staff_writer();
  a := (payload->>'problem_a_id')::uuid;
  b := (payload->>'problem_b_id')::uuid;
  keeper := (payload->>'keeper_problem_id')::uuid;
  extra := (payload->>'extra_problem_id')::uuid;
  IF a IS NULL OR b IS NULL OR keeper IS NULL OR extra IS NULL THEN
    RAISE EXCEPTION 'HQB_BAD_DUPLICATE_PAYLOAD';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.problems WHERE id IN (a, b) AND review_status = 'VERIFIED'
  ) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'verified');
  END IF;
  lo := LEAST(a, b);
  hi := GREATEST(a, b);
  INSERT INTO public.problem_duplicate_links (
    problem_a_id, problem_b_id, link_kind, status, evidence, keeper_problem_id, assigned_by
  ) VALUES (
    lo, hi,
    COALESCE(NULLIF(payload->>'link_kind', ''), 'EXACT_DUPLICATE'),
    COALESCE(NULLIF(payload->>'status', ''), 'LINKED'),
    COALESCE(payload->'evidence', '[]'::jsonb),
    keeper,
    COALESCE(NULLIF(payload->>'assigned_by', ''), 'STEP_8_36')
  )
  ON CONFLICT (problem_a_id, problem_b_id) DO UPDATE SET
    link_kind = EXCLUDED.link_kind,
    status = EXCLUDED.status,
    evidence = EXCLUDED.evidence,
    keeper_problem_id = EXCLUDED.keeper_problem_id;
  UPDATE public.problems
  SET display_state = 'HIDDEN_DUPLICATE',
      superseded_by = keeper,
      updated_at = now()
  WHERE id = extra
    AND review_status IS DISTINCT FROM 'VERIFIED'
    AND display_state IS DISTINCT FROM 'HIDDEN_DUPLICATE';
  RETURN jsonb_build_object('ok', true, 'keeper', keeper, 'extra', extra);
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_list_source_outline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_apply_auto_clean_text(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_link_duplicate(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_list_source_outline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_apply_auto_clean_text(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_link_duplicate(jsonb) TO authenticated;
