-- HYPER QUESTION BANK — STEP 8.5A
-- Additive only. Atomic draft upsert with transaction-scoped advisory lock.
-- Does not DROP/TRUNCATE or rewrite previous migrations.

CREATE OR REPLACE FUNCTION public.hqb_canonicalize_problem_number(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  v := btrim(COALESCE(p_raw, ''));
  v := regexp_replace(v, '\s+', '', 'g');
  v := regexp_replace(v, '\.$', '');
  IF v ~ '^\d{1,4}$' THEN
    RETURN lpad(v, 4, '0');
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.hqb_canonicalize_problem_number(text) IS
  'Identity-only workbook number. 4-digit 쎈 numbers pad 1–4 digits. 05-3 / SIDEBAR stay NULL and must not use upsert.';

CREATE OR REPLACE FUNCTION public.hqb_upsert_problem_draft_from_identity(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  doc_id uuid;
  page_id uuid;
  page_no integer;
  raw_number text;
  canonical text;
  identity text;
  region_id uuid;
  bbox jsonb;
  problem_text text;
  existing record;
  created jsonb;
  linked_region uuid;
BEGIN
  uid := public.hqb_require_staff_writer();

  doc_id := NULLIF(payload->>'source_document_id', '')::uuid;
  page_id := NULLIF(payload->>'source_page_id', '')::uuid;
  page_no := NULLIF(payload->>'page_number', '')::integer;
  raw_number := btrim(COALESCE(payload->>'original_problem_number', payload->'source'->>'original_problem_number', ''));
  region_id := NULLIF(payload->>'source_page_region_id', '')::uuid;
  problem_text := NULLIF(btrim(COALESCE(payload->'version'->>'problem_text', '')), '');

  IF doc_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SOURCE: 선택한 출처가 없습니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.source_documents d WHERE d.id = doc_id) THEN
    RAISE EXCEPTION 'HQB_INVALID_SOURCE: 선택한 출처가 없습니다.';
  END IF;
  IF page_id IS NULL AND page_no IS NOT NULL THEN
    SELECT sp.id, sp.page_number INTO page_id, page_no
    FROM public.source_pages sp
    WHERE sp.source_document_id = doc_id AND sp.page_number = page_no;
  ELSIF page_id IS NOT NULL THEN
    SELECT sp.id, sp.page_number INTO page_id, page_no
    FROM public.source_pages sp
    WHERE sp.id = page_id AND sp.source_document_id = doc_id;
  END IF;
  IF page_id IS NULL OR page_no IS NULL OR page_no < 1 THEN
    RAISE EXCEPTION 'HQB_INVALID_PAGE: 페이지 번호가 올바르지 않습니다.';
  END IF;

  canonical := public.hqb_canonicalize_problem_number(raw_number);
  IF canonical IS NULL THEN
    RAISE EXCEPTION 'HQB_IDENTITY_UNSTABLE: 자동 초안 식별에 쓸 수 없는 문제번호입니다.';
  END IF;
  IF problem_text IS NULL THEN
    RAISE EXCEPTION 'HQB_MISSING_TEXT: 문제 본문을 입력해 주세요.';
  END IF;

  identity := doc_id::text || '|' || page_no::text || '|' || canonical;
  -- Namespace 854201 keeps this lock off other app advisory locks. Lookup uses real columns, not the hash.
  PERFORM pg_advisory_xact_lock(854201, hashtext(identity));

  SELECT
    p.id AS problem_id,
    p.current_version_id AS version_id,
    p.public_code,
    p.review_status,
    p.lifecycle_status,
    ps.id AS source_id,
    ps.source_page_region_id AS region_id,
    ps.bounding_box
  INTO existing
  FROM public.problem_sources ps
  JOIN public.problems p ON p.id = ps.problem_id
  JOIN public.source_pages sp ON sp.id = ps.source_page_id
  WHERE ps.source_document_id = doc_id
    AND sp.page_number = page_no
    AND public.hqb_canonicalize_problem_number(ps.original_problem_number) = canonical
    AND p.archived_at IS NULL
  ORDER BY
    CASE WHEN p.review_status = 'VERIFIED' THEN 0 ELSE 1 END,
    ps.is_primary_source DESC,
    ps.created_at ASC
  LIMIT 1;

  IF existing.problem_id IS NOT NULL THEN
    IF existing.review_status = 'VERIFIED' THEN
      RETURN jsonb_build_object(
        'problem_id', existing.problem_id,
        'version_id', existing.version_id,
        'public_code', existing.public_code,
        'created', false,
        'status', 'EXISTING_VERIFIED',
        'identity', identity,
        'source_document_id', doc_id,
        'source_page_id', page_id,
        'source_page_region_id', existing.region_id
      );
    END IF;

    IF payload ? 'bbox' THEN
      bbox := public.hqb_validate_bbox(payload->'bbox');
      linked_region := existing.region_id;
      IF linked_region IS NOT NULL AND NOT public.hqb_region_has_verified_problem(linked_region) THEN
        UPDATE public.source_page_regions
        SET bbox = bbox
        WHERE id = linked_region AND archived_at IS NULL;
      END IF;
      UPDATE public.problem_sources
      SET bounding_box = bbox
      WHERE id = existing.source_id;
    END IF;

    RETURN jsonb_build_object(
      'problem_id', existing.problem_id,
      'version_id', existing.version_id,
      'public_code', existing.public_code,
      'created', false,
      'status', 'EXISTING_DRAFT',
      'identity', identity,
      'source_document_id', doc_id,
      'source_page_id', page_id,
      'source_page_region_id', existing.region_id
    );
  END IF;

  IF region_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.source_page_regions r
      WHERE r.id = region_id
        AND r.archived_at IS NULL
        AND r.source_document_id = doc_id
        AND r.source_page_id = page_id
    ) THEN
      RAISE EXCEPTION 'HQB_REGION_MISMATCH: 자료/페이지/영역 관계가 올바르지 않습니다.';
    END IF;
  ELSE
    IF NOT (payload ? 'bbox') THEN
      RAISE EXCEPTION 'HQB_INVALID_REGION: 문제 영역이 없습니다.';
    END IF;
    created := public.hqb_create_source_page_region(jsonb_build_object(
      'source_document_id', doc_id,
      'source_page_id', page_id,
      'page_number', page_no,
      'bbox', payload->'bbox',
      'original_problem_number', COALESCE(NULLIF(raw_number, ''), canonical),
      'extracted_text_preview', left(problem_text, 180)
    ));
    region_id := (created->>'region_id')::uuid;
  END IF;

  UPDATE public.source_page_regions
  SET original_problem_number = COALESCE(original_problem_number, COALESCE(NULLIF(raw_number, ''), canonical))
  WHERE id = region_id;

  created := public.hqb_create_problem_draft_from_region(
    region_id,
    jsonb_build_object(
      'source', jsonb_build_object(
        'original_problem_number', COALESCE(NULLIF(raw_number, ''), canonical),
        'source_type_label', 'PDF_REGION'
      ),
      'version', jsonb_build_object(
        'problem_text', problem_text,
        'normalized_text', COALESCE(payload->'version'->>'normalized_text', problem_text),
        'item_format', COALESCE(payload->'version'->>'item_format', 'SHORT_ANSWER'),
        'origin', COALESCE(payload->'version'->>'origin', 'OCR')
      )
    )
  );

  PERFORM public.hqb_audit(
    'problem', (created->>'problem_id')::uuid, 'UPSERT_PROBLEM_FROM_IDENTITY',
    jsonb_build_object('identity', identity, 'created', true, 'actor', uid)
  );

  RETURN created || jsonb_build_object(
    'created', true,
    'status', 'CREATED',
    'identity', identity
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_canonicalize_problem_number(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_problem_draft_from_identity(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_canonicalize_problem_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_draft_from_identity(jsonb) TO authenticated;

COMMENT ON FUNCTION public.hqb_upsert_problem_draft_from_identity(jsonb) IS
  'Lock document|page|canonical-number, then lookup or create one DRAFT. Never downgrades VERIFIED. bbox is not part of identity.';
