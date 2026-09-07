-- HYPER QUESTION BANK — STEP 7 SCAN_OCR
-- Additive only. Widens recognition_results.processing_mode. No DROP/TRUNCATE.

ALTER TABLE public.recognition_results
  DROP CONSTRAINT recognition_results_mode_chk;

ALTER TABLE public.recognition_results
  ADD CONSTRAINT recognition_results_mode_chk CHECK (
    processing_mode IN ('EMBEDDED_TEXT', 'SCAN_NO_ENGINE', 'MIXED_EMBEDDED', 'SCAN_OCR')
  );

COMMENT ON TABLE public.recognition_results IS
  'Machine recognition only. SCAN_OCR is a draft/review input. Never the Gold Standard. Never auto-VERIFIED.';
