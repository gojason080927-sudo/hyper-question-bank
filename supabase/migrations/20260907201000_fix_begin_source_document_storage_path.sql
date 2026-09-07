-- Additive fix: begin-upload RPC had an ambiguous storage_path assignment.

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
  object_path text;
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

  object_path := doc_id::text || '/original.pdf';
  UPDATE public.source_documents
  SET storage_path = object_path
  WHERE id = doc_id;

  PERFORM public.hqb_audit(
    'source_document', doc_id, 'BEGIN_PDF_UPLOAD',
    jsonb_build_object('filename', filename, 'sha256', h, 'file_size', size_bytes)
  );

  RETURN jsonb_build_object(
    'document_id', doc_id,
    'storage_bucket', 'question-bank-sources',
    'storage_path', object_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_begin_source_document(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_begin_source_document(jsonb) TO authenticated;
