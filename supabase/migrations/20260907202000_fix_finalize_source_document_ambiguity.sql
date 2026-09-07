-- Additive fix: finalize/update RPCs used variable names that matched columns.

CREATE OR REPLACE FUNCTION public.hqb_finalize_source_document(p_document_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  doc public.source_documents%ROWTYPE;
  next_page_count integer;
  next_pdf_type text;
  next_ocr_status text;
  next_extraction_status text;
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

  next_page_count := COALESCE(NULLIF(payload->>'page_count', '')::integer, 0);
  IF next_page_count < 1 THEN
    RAISE EXCEPTION 'HQB_PAGE_COUNT: 페이지 수를 확인하지 못했습니다.';
  END IF;
  next_pdf_type := COALESCE(NULLIF(payload->>'pdf_type', ''), 'UNKNOWN');
  IF next_pdf_type NOT IN ('TEXT_PDF', 'SCAN_PDF', 'MIXED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'HQB_INVALID_PDF_TYPE: PDF 유형이 올바르지 않습니다.';
  END IF;
  next_ocr_status := COALESCE(NULLIF(payload->>'ocr_status', ''),
    CASE WHEN next_pdf_type IN ('SCAN_PDF', 'MIXED') THEN 'PENDING' ELSE 'NOT_NEEDED' END);
  IF next_ocr_status NOT IN ('NOT_NEEDED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVIEW_REQUIRED') THEN
    RAISE EXCEPTION 'HQB_INVALID_OCR_STATUS: OCR 상태가 올바르지 않습니다.';
  END IF;
  next_extraction_status := COALESCE(
    NULLIF(payload->>'extraction_status', ''),
    CASE WHEN next_pdf_type = 'TEXT_PDF' THEN 'EMBEDDED_TEXT' WHEN next_pdf_type = 'UNKNOWN' THEN 'FAILED' ELSE 'MANUAL' END
  );

  FOR page IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'pages', '[]'::jsonb))
  LOOP
    page_no := (page->>'page_number')::integer;
    IF page_no IS NULL OR page_no < 1 OR page_no > next_page_count THEN
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

  IF COALESCE(array_length(seen, 1), 0) <> next_page_count THEN
    RAISE EXCEPTION 'HQB_PAGE_COUNT: 페이지 메타데이터가 페이지 수와 맞지 않습니다.';
  END IF;

  UPDATE public.source_documents SET
    page_count = next_page_count,
    pdf_type = next_pdf_type,
    ocr_status = next_ocr_status,
    extraction_status = next_extraction_status,
    document_status = 'READY'
  WHERE id = p_document_id;

  PERFORM public.hqb_audit(
    'source_document', p_document_id, 'FINALIZE_PDF_UPLOAD',
    jsonb_build_object('page_count', next_page_count, 'pdf_type', next_pdf_type, 'actor', uid)
  );

  RETURN jsonb_build_object('document_id', p_document_id, 'page_count', next_page_count, 'pdf_type', next_pdf_type);
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
  next_bbox jsonb;
BEGIN
  uid := public.hqb_require_staff_writer();
  SELECT * INTO region FROM public.source_page_regions WHERE id = p_region_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HQB_INVALID_REGION: 문제 영역이 없습니다.';
  END IF;
  IF public.hqb_region_has_verified_problem(p_region_id) THEN
    RAISE EXCEPTION 'HQB_REGION_LOCKED: 확정된 문제에 연결된 영역은 수정할 수 없습니다.';
  END IF;
  next_bbox := CASE
    WHEN payload ? 'bbox' THEN public.hqb_validate_bbox(payload->'bbox')
    ELSE region.bbox
  END;
  UPDATE public.source_page_regions SET
    bbox = next_bbox,
    original_problem_number = COALESCE(NULLIF(payload->>'original_problem_number', ''), original_problem_number),
    extracted_text_preview = COALESCE(payload->>'extracted_text_preview', extracted_text_preview),
    status = CASE WHEN status = 'UNUSED' THEN 'DRAFT' ELSE status END
  WHERE id = p_region_id;
  PERFORM public.hqb_audit('source_page_region', p_region_id, 'UPDATE_REGION', jsonb_build_object('actor', uid));
  RETURN jsonb_build_object('region_id', p_region_id, 'bbox', next_bbox);
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_finalize_source_document(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_update_source_page_region(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_finalize_source_document(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_update_source_page_region(uuid, jsonb) TO authenticated;
