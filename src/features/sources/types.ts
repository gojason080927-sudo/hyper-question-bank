import type { NormalizedBBox } from '../../lib/pdf/bbox'

export type SourceDocument = {
  id: string
  title: string
  publisher: string | null
  document_type: string
  original_filename: string | null
  file_hash: string | null
  file_size: number | null
  mime_type: string | null
  storage_bucket: string | null
  storage_path: string | null
  page_count: number | null
  license_status: string
  usage_scope: string | null
  copyright_note: string | null
  document_status: string
  extraction_status: string
  pdf_type: string
  ocr_status: string
  uploaded_at: string | null
  created_at: string
}

export type SourcePage = {
  id: string
  source_document_id: string
  page_number: number
  page_width: number | null
  page_height: number | null
  extracted_text: string | null
  text_char_count: number | null
  extraction_status: string
  pdf_type_hint: string | null
  ocr_status: string
}

export type SourceRegion = {
  id: string
  source_document_id: string
  source_page_id: string
  bbox: NormalizedBBox
  status: 'DRAFT' | 'UNUSED' | 'LINKED'
  original_problem_number: string | null
  extracted_text_preview: string | null
  created_at: string
}

export type SourceBundle = {
  document: SourceDocument
  pages: SourcePage[]
  regions: SourceRegion[]
}
