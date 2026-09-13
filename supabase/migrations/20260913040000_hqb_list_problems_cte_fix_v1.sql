-- STEP 8.36 follow-up: hqb_list_problems must keep CTEs in one statement.
-- Additive REPLACE only. Never DELETE. Never VERIFIED.

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

REVOKE ALL ON FUNCTION public.hqb_list_problems(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_list_problems(jsonb) TO authenticated;
