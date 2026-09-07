-- HYPER QUESTION BANK — PDF INGESTION FOUNDATION v1
-- Additive only. Do not apply to HYPER STUDENT CARE.
-- No DROP TABLE/SCHEMA/DATABASE, no TRUNCATE, no rewrite of earlier migrations.

-- ---------------------------------------------------------------------------
-- source_documents: original PDF metadata (reuse existing row, add columns)
-- file_hash stores lowercase SHA-256 hex. Original bytes are never overwritten.
-- ---------------------------------------------------------------------------

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS pdf_type text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS ocr_status text NOT NULL DEFAULT 'NOT_NEEDED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_documents_file_size_chk'
  ) THEN
    ALTER TABLE public.source_documents
      ADD CONSTRAINT source_documents_file_size_chk
      CHECK (file_size IS NULL OR file_size > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_documents_document_status_chk'
  ) THEN
    ALTER TABLE public.source_documents
      ADD CONSTRAINT source_documents_document_status_chk
      CHECK (document_status IN ('UPLOADING', 'READY', 'FAILED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_documents_extraction_status_chk'
  ) THEN
    ALTER TABLE public.source_documents
      ADD CONSTRAINT source_documents_extraction_status_chk
      CHECK (extraction_status IN ('PENDING', 'EMBEDDED_TEXT', 'MANUAL', 'FAILED', 'NOT_NEEDED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_documents_pdf_type_chk'
  ) THEN
    ALTER TABLE public.source_documents
      ADD CONSTRAINT source_documents_pdf_type_chk
      CHECK (pdf_type IN ('TEXT_PDF', 'SCAN_PDF', 'MIXED', 'UNKNOWN'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_documents_ocr_status_chk'
  ) THEN
    ALTER TABLE public.source_documents
      ADD CONSTRAINT source_documents_ocr_status_chk
      CHECK (ocr_status IN ('NOT_NEEDED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVIEW_REQUIRED'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS source_documents_file_hash_key
  ON public.source_documents (file_hash)
  WHERE file_hash IS NOT NULL;

COMMENT ON COLUMN public.source_documents.file_hash IS
  'Lowercase SHA-256 hex of the immutable original PDF bytes.';
COMMENT ON COLUMN public.source_documents.ocr_status IS
  'Future OCR hook only. STEP 5 does not call an OCR provider.';
COMMENT ON COLUMN public.source_documents.storage_path IS
  'Private Storage object path. Never a public URL. Original is never upserted.';

-- ---------------------------------------------------------------------------
-- source_pages: page geometry + optional embedded text
-- page_number is 1-based (human / PDF.js getPage). pdf_index = page_number - 1.
-- ---------------------------------------------------------------------------

ALTER TABLE public.source_pages
  ADD COLUMN IF NOT EXISTS page_width numeric,
  ADD COLUMN IF NOT EXISTS page_height numeric,
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS text_char_count integer,
  ADD COLUMN IF NOT EXISTS pdf_type_hint text,
  ADD COLUMN IF NOT EXISTS ocr_status text NOT NULL DEFAULT 'NOT_NEEDED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_pages_dims_chk'
  ) THEN
    ALTER TABLE public.source_pages
      ADD CONSTRAINT source_pages_dims_chk
      CHECK (
        (page_width IS NULL AND page_height IS NULL)
        OR (page_width > 0 AND page_height > 0)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_pages_pdf_type_hint_chk'
  ) THEN
    ALTER TABLE public.source_pages
      ADD CONSTRAINT source_pages_pdf_type_hint_chk
      CHECK (pdf_type_hint IS NULL OR pdf_type_hint IN ('TEXT_PDF', 'SCAN_PDF', 'UNKNOWN'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_pages_ocr_status_chk'
  ) THEN
    ALTER TABLE public.source_pages
      ADD CONSTRAINT source_pages_ocr_status_chk
      CHECK (ocr_status IN ('NOT_NEEDED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVIEW_REQUIRED'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- source_page_regions: pre-problem rectangles. Not a second source table.
-- problem_sources remains the N:M problem↔document link and copies bbox.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.source_page_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  source_page_id uuid NOT NULL REFERENCES public.source_pages (id) ON DELETE RESTRICT,
  bbox jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  original_problem_number text,
  extracted_text_preview text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT source_page_regions_status_chk CHECK (status IN ('DRAFT', 'UNUSED', 'LINKED'))
);

COMMENT ON TABLE public.source_page_regions IS
  'Page rectangles saved before a problem exists. problem_sources copies bbox and may reference this row.';

DROP TRIGGER IF EXISTS source_page_regions_set_updated_at ON public.source_page_regions;
CREATE TRIGGER source_page_regions_set_updated_at
  BEFORE UPDATE ON public.source_page_regions
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

CREATE INDEX IF NOT EXISTS source_page_regions_page_idx
  ON public.source_page_regions (source_page_id);
CREATE INDEX IF NOT EXISTS source_page_regions_document_idx
  ON public.source_page_regions (source_document_id);

ALTER TABLE public.problem_sources
  ADD COLUMN IF NOT EXISTS source_page_region_id uuid REFERENCES public.source_page_regions (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS problem_sources_region_idx
  ON public.problem_sources (source_page_region_id);

-- ---------------------------------------------------------------------------
-- RLS for the new table (staff SELECT, RPC-only writes)
-- ---------------------------------------------------------------------------

ALTER TABLE public.source_page_regions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.source_page_regions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_page_regions TO authenticated;
GRANT ALL ON TABLE public.source_page_regions TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.source_page_regions;
CREATE POLICY qbank_staff_select ON public.source_page_regions
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

-- ---------------------------------------------------------------------------
-- Private Storage bucket + RLS
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'question-bank-sources',
  'question-bank-sources',
  false,
  52428800,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS qbank_sources_select ON storage.objects;
DROP POLICY IF EXISTS qbank_sources_insert ON storage.objects;
DROP POLICY IF EXISTS qbank_sources_update ON storage.objects;
DROP POLICY IF EXISTS qbank_sources_delete ON storage.objects;

CREATE POLICY qbank_sources_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'question-bank-sources' AND public.hqb_is_staff());

CREATE POLICY qbank_sources_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-bank-sources' AND public.hqb_is_staff());

-- No UPDATE policy: original PDFs must not be overwritten.
CREATE POLICY qbank_sources_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'question-bank-sources' AND public.hqb_current_role() = 'ADMIN');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_validate_bbox(p_bbox jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  x numeric;
  y numeric;
  w numeric;
  h numeric;
  unit text;
  origin text;
  page_w numeric;
  page_h numeric;
BEGIN
  IF p_bbox IS NULL OR jsonb_typeof(p_bbox) <> 'object' THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: 영역 좌표가 올바르지 않습니다.';
  END IF;
  BEGIN
    x := (p_bbox->>'x')::numeric;
    y := (p_bbox->>'y')::numeric;
    w := (p_bbox->>'width')::numeric;
    h := (p_bbox->>'height')::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: 영역 좌표가 올바르지 않습니다.';
  END;
  unit := COALESCE(NULLIF(p_bbox->>'unit', ''), 'normalized');
  origin := COALESCE(NULLIF(p_bbox->>'origin', ''), 'top-left');
  IF unit <> 'normalized' THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: 좌표 단위는 normalized 여야 합니다.';
  END IF;
  IF origin <> 'top-left' THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: 좌표 원점은 top-left 여야 합니다.';
  END IF;
  IF x IS NULL OR y IS NULL OR w IS NULL OR h IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: 영역 좌표가 올바르지 않습니다.';
  END IF;
  IF x < 0 OR y < 0 OR w <= 0 OR h <= 0 OR (x + w) > 1 OR (y + h) > 1 THEN
    RAISE EXCEPTION 'HQB_INVALID_BBOX: 영역 좌표가 페이지 범위를 벗어났습니다.';
  END IF;
  BEGIN
    page_w := NULLIF(p_bbox->>'pageWidth', '')::numeric;
    page_h := NULLIF(p_bbox->>'pageHeight', '')::numeric;
  EXCEPTION WHEN others THEN
    page_w := NULL;
    page_h := NULL;
  END;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'x', x,
    'y', y,
    'width', w,
    'height', h,
    'unit', 'normalized',
    'origin', 'top-left',
    'pageWidth', page_w,
    'pageHeight', page_h
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_normalize_sha256(p_hash text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h text := lower(btrim(COALESCE(p_hash, '')));
BEGIN
  IF h !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'HQB_INVALID_HASH: SHA-256 값이 올바르지 않습니다.';
  END IF;
  RETURN h;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_region_has_verified_problem(p_region_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.problem_sources ps
    JOIN public.problems p ON p.id = ps.problem_id
    WHERE ps.source_page_region_id = p_region_id
      AND (
        p.review_status = 'VERIFIED'
        OR EXISTS (
          SELECT 1
          FROM public.problem_versions pv
          WHERE pv.problem_id = p.id
            AND pv.review_status = 'VERIFIED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.hqb_assert_region_page(
  p_region public.source_page_regions,
  p_document_id uuid,
  p_page_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  page_doc uuid;
BEGIN
  IF p_region.source_document_id <> p_document_id THEN
    RAISE EXCEPTION 'HQB_REGION_MISMATCH: 영역이 이 자료에 속하지 않습니다.';
  END IF;
  IF p_region.source_page_id <> p_page_id THEN
    RAISE EXCEPTION 'HQB_REGION_MISMATCH: 영역이 이 페이지에 속하지 않습니다.';
  END IF;
  SELECT source_document_id INTO page_doc
  FROM public.source_pages
  WHERE id = p_page_id;
  IF page_doc IS NULL OR page_doc <> p_document_id OR page_doc <> p_region.source_document_id THEN
    RAISE EXCEPTION 'HQB_REGION_MISMATCH: 자료/페이지/영역 관계가 올바르지 않습니다.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Upload + document RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_find_source_by_sha256(p_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text;
  doc public.source_documents%ROWTYPE;
BEGIN
  PERFORM public.hqb_require_staff_writer();
  h := public.hqb_normalize_sha256(p_sha256);
  SELECT * INTO doc FROM public.source_documents WHERE file_hash = h;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', doc.id,
    'title', doc.title,
    'original_filename', doc.original_filename,
    'document_status', doc.document_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_begin_source_document(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  h text;
  filename text;
  mime text;
  size_bytes bigint;
  title text;
  existing public.source_documents%ROWTYPE;
  doc_id uuid;
  storage_path text;
BEGIN
  uid := public.hqb_require_staff_writer();
  filename := btrim(COALESCE(payload->>'original_filename', ''));
  mime := lower(btrim(COALESCE(payload->>'mime_type', '')));
  title := btrim(COALESCE(payload->>'title', ''));
  size_bytes := NULLIF(payload->>'file_size', '')::bigint;
  IF title = '' THEN
    RAISE EXCEPTION 'HQB_MISSING_SOURCE: 자료명을 입력해 주세요.';
  END IF;
  IF filename = '' OR filename !~* '\.pdf$' THEN
    RAISE EXCEPTION 'HQB_NOT_PDF: PDF 파일만 업로드할 수 있습니다.';
  END IF;
  IF mime NOT IN ('application/pdf', 'application/x-pdf') THEN
    RAISE EXCEPTION 'HQB_NOT_PDF: PDF 파일만 업로드할 수 있습니다.';
  END IF;
  IF size_bytes IS NULL OR size_bytes <= 0 THEN
    RAISE EXCEPTION 'HQB_FILE_TOO_LARGE: 파일 크기가 올바르지 않습니다.';
  END IF;
  IF size_bytes > 52428800 THEN
    RAISE EXCEPTION 'HQB_FILE_TOO_LARGE: PDF는 50MB 이하여야 합니다.';
  END IF;
  h := public.hqb_normalize_sha256(payload->>'sha256');

  SELECT * INTO existing FROM public.source_documents WHERE file_hash = h;
  IF FOUND THEN
    RAISE EXCEPTION 'HQB_DUPLICATE_PDF: 같은 PDF가 이미 등록되어 있습니다.';
  END IF;

  INSERT INTO public.source_documents (
    title, publisher, author, publication_year, edition, document_type,
    source_type, original_filename, file_hash, license_status, usage_scope,
    copyright_note, storage_bucket, mime_type, file_size, uploaded_by,
    uploaded_at, document_status, extraction_status, pdf_type, ocr_status
  ) VALUES (
    title,
    NULLIF(payload->>'publisher', ''),
    NULLIF(payload->>'author', ''),
    NULLIF(payload->>'publication_year', '')::integer,
    NULLIF(payload->>'edition', ''),
    COALESCE(NULLIF(payload->>'document_type', ''), 'TEACHER_CREATED'),
    NULLIF(payload->>'source_type', ''),
    filename,
    h,
    COALESCE(NULLIF(payload->>'license_status', ''), 'UNKNOWN'),
    NULLIF(payload->>'usage_scope', ''),
    NULLIF(payload->>'copyright_note', ''),
    'question-bank-sources',
    'application/pdf',
    size_bytes,
    uid,
    now(),
    'UPLOADING',
    'PENDING',
    'UNKNOWN',
    'NOT_NEEDED'
  )
  RETURNING id INTO doc_id;

  storage_path := doc_id::text || '/original.pdf';
  UPDATE public.source_documents
  SET storage_path = storage_path
  WHERE id = doc_id;

  PERFORM public.hqb_audit(
    'source_document', doc_id, 'BEGIN_PDF_UPLOAD',
    jsonb_build_object('filename', filename, 'sha256', h, 'file_size', size_bytes)
  );

  RETURN jsonb_build_object(
    'document_id', doc_id,
    'storage_bucket', 'question-bank-sources',
    'storage_path', storage_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_finalize_source_document(p_document_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  doc public.source_documents%ROWTYPE;
  page_count integer;
  pdf_type text;
  ocr_status text;
  extraction_status text;
  page jsonb;
  page_no integer;
  seen int[] := ARRAY[]::int[];
  object_ok boolean;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO doc FROM public.source_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_SOURCE: 선택한 출처가 없습니다.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'question-bank-sources'
      AND o.name = doc.storage_path
  ) INTO object_ok;
  IF NOT object_ok THEN
    UPDATE public.source_documents SET document_status = 'FAILED' WHERE id = p_document_id;
    RAISE EXCEPTION 'HQB_UPLOAD_MISSING: PDF 원본 업로드를 확인하지 못했습니다.';
  END IF;

  page_count := COALESCE(NULLIF(payload->>'page_count', '')::integer, 0);
  IF page_count < 1 THEN
    RAISE EXCEPTION 'HQB_PAGE_COUNT: 페이지 수를 확인하지 못했습니다.';
  END IF;
  pdf_type := COALESCE(NULLIF(payload->>'pdf_type', ''), 'UNKNOWN');
  IF pdf_type NOT IN ('TEXT_PDF', 'SCAN_PDF', 'MIXED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'HQB_INVALID_PDF_TYPE: PDF 유형이 올바르지 않습니다.';
  END IF;
  ocr_status := COALESCE(NULLIF(payload->>'ocr_status', ''),
    CASE WHEN pdf_type IN ('SCAN_PDF', 'MIXED') THEN 'PENDING' ELSE 'NOT_NEEDED' END);
  IF ocr_status NOT IN ('NOT_NEEDED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVIEW_REQUIRED') THEN
    RAISE EXCEPTION 'HQB_INVALID_OCR_STATUS: OCR 상태가 올바르지 않습니다.';
  END IF;
  extraction_status := COALESCE(
    NULLIF(payload->>'extraction_status', ''),
    CASE WHEN pdf_type = 'TEXT_PDF' THEN 'EMBEDDED_TEXT' WHEN pdf_type = 'UNKNOWN' THEN 'FAILED' ELSE 'MANUAL' END
  );

  FOR page IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'pages', '[]'::jsonb))
  LOOP
    page_no := (page->>'page_number')::integer;
    IF page_no IS NULL OR page_no < 1 OR page_no > page_count THEN
      RAISE EXCEPTION 'HQB_INVALID_PAGE: 페이지 번호가 올바르지 않습니다.';
    END IF;
    IF page_no = ANY (seen) THEN
      RAISE EXCEPTION 'HQB_INVALID_PAGE: 페이지 번호가 중복되었습니다.';
    END IF;
    seen := seen || page_no;

    INSERT INTO public.source_pages (
      source_document_id, page_number, extraction_status, review_status,
      page_width, page_height, extracted_text, text_char_count, pdf_type_hint, ocr_status
    ) VALUES (
      p_document_id,
      page_no,
      COALESCE(NULLIF(page->>'extraction_status', ''), 'PENDING'),
      'UNREVIEWED',
      NULLIF(page->>'page_width', '')::numeric,
      NULLIF(page->>'page_height', '')::numeric,
      NULLIF(page->>'extracted_text', ''),
      COALESCE(NULLIF(page->>'text_char_count', '')::integer, 0),
      NULLIF(page->>'pdf_type_hint', ''),
      COALESCE(NULLIF(page->>'ocr_status', ''),
        CASE WHEN COALESCE(page->>'pdf_type_hint', '') = 'SCAN_PDF' THEN 'PENDING' ELSE 'NOT_NEEDED' END)
    )
    ON CONFLICT (source_document_id, page_number) DO UPDATE SET
      extraction_status = EXCLUDED.extraction_status,
      page_width = EXCLUDED.page_width,
      page_height = EXCLUDED.page_height,
      extracted_text = EXCLUDED.extracted_text,
      text_char_count = EXCLUDED.text_char_count,
      pdf_type_hint = EXCLUDED.pdf_type_hint,
      ocr_status = EXCLUDED.ocr_status,
      updated_at = now();
  END LOOP;

  IF COALESCE(array_length(seen, 1), 0) <> page_count THEN
    RAISE EXCEPTION 'HQB_PAGE_COUNT: 페이지 메타데이터가 페이지 수와 맞지 않습니다.';
  END IF;

  UPDATE public.source_documents SET
    page_count = page_count,
    pdf_type = pdf_type,
    ocr_status = ocr_status,
    extraction_status = extraction_status,
    document_status = 'READY'
  WHERE id = p_document_id;

  PERFORM public.hqb_audit(
    'source_document', p_document_id, 'FINALIZE_PDF_UPLOAD',
    jsonb_build_object('page_count', page_count, 'pdf_type', pdf_type, 'actor', uid)
  );

  RETURN jsonb_build_object('document_id', p_document_id, 'page_count', page_count, 'pdf_type', pdf_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_fetch_source_document(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc public.source_documents%ROWTYPE;
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: 자료에 접근할 권한이 없습니다.';
  END IF;
  SELECT * INTO doc FROM public.source_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_SOURCE: 선택한 출처가 없습니다.';
  END IF;
  RETURN jsonb_build_object(
    'document', to_jsonb(doc),
    'pages', (
      SELECT coalesce(jsonb_agg(to_jsonb(sp) ORDER BY sp.page_number), '[]'::jsonb)
      FROM public.source_pages sp
      WHERE sp.source_document_id = doc.id
    ),
    'regions', (
      SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at), '[]'::jsonb)
      FROM public.source_page_regions r
      WHERE r.source_document_id = doc.id
        AND r.archived_at IS NULL
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Region CRUD
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_create_source_page_region(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  doc_id uuid;
  page_id uuid;
  page_doc uuid;
  page_no integer;
  bbox jsonb;
  region_id uuid;
BEGIN
  uid := public.hqb_require_staff_writer();
  doc_id := NULLIF(payload->>'source_document_id', '')::uuid;
  page_id := NULLIF(payload->>'source_page_id', '')::uuid;
  page_no := NULLIF(payload->>'page_number', '')::integer;
  IF doc_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_SOURCE: 선택한 출처가 없습니다.';
  END IF;
  IF page_id IS NULL AND page_no IS NOT NULL THEN
    SELECT id INTO page_id
    FROM public.source_pages
    WHERE source_document_id = doc_id AND page_number = page_no;
  END IF;
  IF page_id IS NULL THEN
    RAISE EXCEPTION 'HQB_INVALID_PAGE: 페이지 번호가 올바르지 않습니다.';
  END IF;
  SELECT source_document_id INTO page_doc FROM public.source_pages WHERE id = page_id;
  IF page_doc IS NULL OR page_doc <> doc_id THEN
    RAISE EXCEPTION 'HQB_REGION_MISMATCH: 자료/페이지/영역 관계가 올바르지 않습니다.';
  END IF;
  bbox := public.hqb_validate_bbox(payload->'bbox');

  INSERT INTO public.source_page_regions (
    source_document_id, source_page_id, bbox, status,
    original_problem_number, extracted_text_preview, created_by
  ) VALUES (
    doc_id, page_id, bbox, 'DRAFT',
    NULLIF(payload->>'original_problem_number', ''),
    NULLIF(payload->>'extracted_text_preview', ''),
    uid
  )
  RETURNING id INTO region_id;

  PERFORM public.hqb_audit('source_page_region', region_id, 'CREATE_REGION', jsonb_build_object('page_id', page_id));
  RETURN jsonb_build_object('region_id', region_id, 'bbox', bbox, 'status', 'DRAFT');
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_update_source_page_region(p_region_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  region public.source_page_regions%ROWTYPE;
  bbox jsonb;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO region FROM public.source_page_regions WHERE id = p_region_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_REGION: 문제 영역이 없습니다.';
  END IF;
  IF public.hqb_region_has_verified_problem(p_region_id) THEN
    RAISE EXCEPTION 'HQB_REGION_LOCKED: 확정된 문제에 연결된 영역은 수정할 수 없습니다.';
  END IF;
  bbox := CASE
    WHEN payload ? 'bbox' THEN public.hqb_validate_bbox(payload->'bbox')
    ELSE region.bbox
  END;
  UPDATE public.source_page_regions SET
    bbox = bbox,
    original_problem_number = COALESCE(NULLIF(payload->>'original_problem_number', ''), original_problem_number),
    extracted_text_preview = COALESCE(payload->>'extracted_text_preview', extracted_text_preview),
    status = CASE WHEN status = 'UNUSED' THEN 'DRAFT' ELSE status END
  WHERE id = p_region_id;
  PERFORM public.hqb_audit('source_page_region', p_region_id, 'UPDATE_REGION', jsonb_build_object('actor', uid));
  RETURN jsonb_build_object('region_id', p_region_id, 'bbox', bbox);
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_delete_source_page_region(p_region_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  region public.source_page_regions%ROWTYPE;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO region FROM public.source_page_regions WHERE id = p_region_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_REGION: 문제 영역이 없습니다.';
  END IF;
  IF public.hqb_region_has_verified_problem(p_region_id) THEN
    RAISE EXCEPTION 'HQB_REGION_LOCKED: 확정된 문제에 연결된 영역은 삭제할 수 없습니다.';
  END IF;
  UPDATE public.source_page_regions SET archived_at = now(), status = 'UNUSED' WHERE id = p_region_id;
  UPDATE public.problem_sources SET source_page_region_id = NULL WHERE source_page_region_id = p_region_id;
  PERFORM public.hqb_audit('source_page_region', p_region_id, 'DELETE_REGION', jsonb_build_object('actor', uid));
  RETURN jsonb_build_object('region_id', p_region_id, 'deleted', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- region → existing Gold Standard draft (reuses hqb_create_problem_draft)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_create_problem_draft_from_region(p_region_id uuid, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  region public.source_page_regions%ROWTYPE;
  page public.source_pages%ROWTYPE;
  created jsonb;
  new_problem_id uuid;
  draft_payload jsonb;
  problem_text text;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO region FROM public.source_page_regions WHERE id = p_region_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_REGION: 문제 영역이 없습니다.';
  END IF;
  SELECT * INTO page FROM public.source_pages WHERE id = region.source_page_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_PAGE: 페이지 번호가 올바르지 않습니다.';
  END IF;
  PERFORM public.hqb_assert_region_page(region, region.source_document_id, region.source_page_id);

  problem_text := COALESCE(
    NULLIF(btrim(COALESCE(payload->'version'->>'problem_text', '')), ''),
    NULLIF(btrim(COALESCE(region.extracted_text_preview, '')), ''),
    '[PDF 원본을 보고 입력하세요]'
  );

  draft_payload := COALESCE(payload, '{}'::jsonb);
  draft_payload := jsonb_set(draft_payload, '{source}', jsonb_build_object(
    'source_document_id', region.source_document_id,
    'page_number', page.page_number,
    'original_problem_number', COALESCE(
      NULLIF(payload->'source'->>'original_problem_number', ''),
      region.original_problem_number
    ),
    'source_type_label', COALESCE(NULLIF(payload->'source'->>'source_type_label', ''), 'PDF_REGION')
  ), true);
  draft_payload := jsonb_set(draft_payload, '{version,problem_text}', to_jsonb(problem_text), true);
  IF draft_payload#>>'{version,normalized_text}' IS NULL THEN
    draft_payload := jsonb_set(draft_payload, '{version,normalized_text}', to_jsonb(problem_text), true);
  END IF;
  IF draft_payload#>>'{version,origin}' IS NULL THEN
    draft_payload := jsonb_set(draft_payload, '{version,origin}', to_jsonb('TEACHER_EDIT'::text), true);
  END IF;
  IF draft_payload#>>'{version,item_format}' IS NULL THEN
    draft_payload := jsonb_set(draft_payload, '{version,item_format}', to_jsonb('SHORT_ANSWER'::text), true);
  END IF;

  created := public.hqb_create_problem_draft(draft_payload);
  new_problem_id := (created->>'problem_id')::uuid;

  UPDATE public.problem_sources
  SET
    bounding_box = region.bbox,
    source_page_id = region.source_page_id,
    source_page_region_id = region.id,
    is_primary_source = true
  WHERE problem_sources.problem_id = new_problem_id
    AND problem_sources.source_document_id = region.source_document_id
    AND problem_sources.is_primary_source;

  UPDATE public.source_page_regions SET status = 'LINKED' WHERE id = region.id;

  PERFORM public.hqb_audit(
    'problem', new_problem_id, 'CREATE_PROBLEM_FROM_REGION',
    jsonb_build_object('region_id', region.id, 'public_code', created->>'public_code', 'actor', uid)
  );

  RETURN created || jsonb_build_object(
    'source_document_id', region.source_document_id,
    'source_page_id', region.source_page_id,
    'source_page_region_id', region.id,
    'bounding_box', region.bbox
  );
END;
$$;

-- Privileges: staff-authenticated only. Never grant to anon.
REVOKE ALL ON FUNCTION public.hqb_validate_bbox(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_normalize_sha256(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_region_has_verified_problem(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_assert_region_page(public.source_page_regions, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hqb_find_source_by_sha256(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_begin_source_document(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_finalize_source_document(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_fetch_source_document(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_create_source_page_region(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_update_source_page_region(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_delete_source_page_region(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_create_problem_draft_from_region(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_validate_bbox(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_normalize_sha256(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_find_source_by_sha256(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_begin_source_document(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_finalize_source_document(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_fetch_source_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_create_source_page_region(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_update_source_page_region(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_delete_source_page_region(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_create_problem_draft_from_region(uuid, jsonb) TO authenticated;
