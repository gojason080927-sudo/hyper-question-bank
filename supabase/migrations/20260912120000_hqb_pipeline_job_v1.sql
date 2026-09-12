-- HYPER QUESTION BANK — STEP 8.26
-- Additive pipeline job tables + progress counters.
-- Implements docs/STEP8_25_BATCH_REGISTRATION_PIPELINE_v1.md §J STEP 8.26.
-- Do not apply to HYPER STUDENT CARE.
-- No table/column drops. No textbook ingest. No problem/version/figure writes.
-- Do not start STEP 8.27.

-- ---------------------------------------------------------------------------
-- 1. pipeline_runs — one textbook job (source may be null until a later STEP).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  status text NOT NULL,
  progress jsonb NOT NULL,
  estimated_paid_calls integer NOT NULL DEFAULT 0,
  estimated_usd numeric(12, 4) NOT NULL DEFAULT 0,
  actual_paid_calls integer NOT NULL DEFAULT 0,
  actual_usd numeric(12, 4) NOT NULL DEFAULT 0,
  actor text,
  assigned_by text NOT NULL DEFAULT 'STEP_8_26',
  artifact_step text NOT NULL DEFAULT '8.26',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_runs_status_chk CHECK (
    status IN ('PLANNED', 'RUNNING', 'COMPLETED', 'ABORTED')
  ),
  CONSTRAINT pipeline_runs_calls_chk CHECK (
    estimated_paid_calls >= 0 AND actual_paid_calls >= 0
  ),
  CONSTRAINT pipeline_runs_usd_chk CHECK (
    estimated_usd >= 0 AND actual_usd >= 0
  )
);

CREATE INDEX IF NOT EXISTS pipeline_runs_document_idx
  ON public.pipeline_runs (source_document_id);

CREATE INDEX IF NOT EXISTS pipeline_runs_assigned_idx
  ON public.pipeline_runs (assigned_by, status);

COMMENT ON TABLE public.pipeline_runs IS
  'STEP 8.26 textbook batch job. Progress counters only. Does not ingest problems.';

DROP TRIGGER IF EXISTS pipeline_runs_set_updated_at ON public.pipeline_runs;
CREATE TRIGGER pipeline_runs_set_updated_at
  BEFORE UPDATE ON public.pipeline_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. pipeline_items — one candidate per run. Statuses frozen in STEP 8.25.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES public.pipeline_runs (id) ON DELETE RESTRICT,
  candidate_id text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  fingerprint jsonb,
  dual_review jsonb,
  cache_keys jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  assigned_by text NOT NULL DEFAULT 'STEP_8_26',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_items_candidate_chk CHECK (char_length(btrim(candidate_id)) > 0),
  CONSTRAINT pipeline_items_stage_chk CHECK (
    stage IN (
      'SOURCE_REGISTER',
      'PAGE_RENDER',
      'SEGMENT',
      'STRUCTURE',
      'FIGURE_DETECT_LINK',
      'SELECTIVE_OCR',
      'DUAL_AI_REVIEW',
      'IMAGE_COMPARE',
      'CONFIDENCE_GATE',
      'PERSIST_DRAFT',
      'QUEUE_HUMAN',
      'LEARN_CORRECTIONS'
    )
  ),
  CONSTRAINT pipeline_items_status_chk CHECK (
    status IN ('AUTO_APPROVED', 'AI_FIXED', 'HUMAN_REVIEW', 'BLOCKED', 'FAILED')
  ),
  CONSTRAINT pipeline_items_retry_chk CHECK (retry_count >= 0 AND retry_count <= 3),
  CONSTRAINT pipeline_items_run_candidate_key UNIQUE (pipeline_run_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS pipeline_items_run_status_idx
  ON public.pipeline_items (pipeline_run_id, status);

COMMENT ON TABLE public.pipeline_items IS
  'STEP 8.26 pipeline candidate row. Gold Standard VERIFIED is never set from this table.';

DROP TRIGGER IF EXISTS pipeline_items_set_updated_at ON public.pipeline_items;
CREATE TRIGGER pipeline_items_set_updated_at
  BEFORE UPDATE ON public.pipeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS: staff SELECT, RPC-only writes. service_role retains ALL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pipeline_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pipeline_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pipeline_runs TO authenticated;
GRANT SELECT ON TABLE public.pipeline_items TO authenticated;
GRANT ALL ON TABLE public.pipeline_runs TO service_role;
GRANT ALL ON TABLE public.pipeline_items TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.pipeline_runs;
CREATE POLICY qbank_staff_select ON public.pipeline_runs
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.pipeline_items;
CREATE POLICY qbank_staff_select ON public.pipeline_items
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

-- ---------------------------------------------------------------------------
-- 4. Progress helper — frozen STEP 8.25 counter keys. Paid totals stay 0 in 8.26.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_pipeline_empty_progress()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'total', 0,
    'auto_approved', 0,
    'ai_fixed', 0,
    'human_review', 0,
    'blocked', 0,
    'failed', 0,
    'unresolved', 0,
    'estimated_paid_calls', 0,
    'estimated_usd', 0,
    'actual_paid_calls', 0,
    'actual_usd', 0
  );
$$;

CREATE OR REPLACE FUNCTION public.hqb_pipeline_progress_from_items(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_auto int := 0;
  v_fixed int := 0;
  v_human int := 0;
  v_blocked int := 0;
  v_failed int := 0;
BEGIN
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE status = 'AUTO_APPROVED')::int,
    COUNT(*) FILTER (WHERE status = 'AI_FIXED')::int,
    COUNT(*) FILTER (WHERE status = 'HUMAN_REVIEW')::int,
    COUNT(*) FILTER (WHERE status = 'BLOCKED')::int,
    COUNT(*) FILTER (WHERE status = 'FAILED')::int
  INTO v_total, v_auto, v_fixed, v_human, v_blocked, v_failed
  FROM public.pipeline_items
  WHERE pipeline_run_id = p_run;

  RETURN jsonb_build_object(
    'total', v_total,
    'auto_approved', v_auto,
    'ai_fixed', v_fixed,
    'human_review', v_human,
    'blocked', v_blocked,
    'failed', v_failed,
    'unresolved', v_human + v_blocked + v_failed + v_fixed,
    'estimated_paid_calls', 0,
    'estimated_usd', 0,
    'actual_paid_calls', 0,
    'actual_usd', 0
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Idempotent start. Never writes problems / versions / figures.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_start_pipeline_run(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_doc uuid;
  v_actor text;
  v_assigned text;
  v_run uuid;
  v_created boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();
  v_doc := NULLIF(payload->>'source_document_id', '')::uuid;
  v_actor := NULLIF(btrim(COALESCE(payload->>'actor', '')), '');
  v_assigned := COALESCE(NULLIF(btrim(payload->>'assigned_by'), ''), 'STEP_8_26');

  IF v_doc IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.source_documents d WHERE d.id = v_doc
  ) THEN
    RAISE EXCEPTION 'HQB_INVALID_SOURCE: source_document_id does not exist.';
  END IF;

  PERFORM pg_advisory_xact_lock(854226, hashtext(COALESCE(v_doc::text, 'null') || ':' || v_assigned));

  SELECT r.id INTO v_run
  FROM public.pipeline_runs r
  WHERE r.assigned_by = v_assigned
    AND r.status IN ('PLANNED', 'RUNNING')
    AND r.source_document_id IS NOT DISTINCT FROM v_doc
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF v_run IS NULL THEN
    INSERT INTO public.pipeline_runs (
      source_document_id, status, progress, actor, assigned_by, artifact_step
    ) VALUES (
      v_doc, 'PLANNED', public.hqb_pipeline_empty_progress(), v_actor, v_assigned, '8.26'
    )
    RETURNING id INTO v_run;
    v_created := true;
  END IF;

  INSERT INTO public.audit_events (entity_type, entity_id, action, actor, after_snapshot)
  VALUES (
    'pipeline_run',
    v_run,
    'PIPELINE_RUN_START',
    COALESCE(v_actor, uid::text),
    jsonb_build_object('created', v_created, 'assigned_by', v_assigned)
  );

  RETURN jsonb_build_object(
    'run_id', v_run,
    'created', v_created,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_upsert_pipeline_item(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_run uuid;
  v_candidate text;
  v_stage text;
  v_status text;
  v_reasons jsonb;
  v_assigned text;
  v_item uuid;
  v_created boolean := false;
  v_progress jsonb;
BEGIN
  uid := public.hqb_require_staff_writer();
  v_run := NULLIF(payload->>'pipeline_run_id', '')::uuid;
  v_candidate := btrim(COALESCE(payload->>'candidate_id', ''));
  v_stage := btrim(COALESCE(payload->>'stage', ''));
  v_status := btrim(COALESCE(payload->>'status', ''));
  v_reasons := COALESCE(payload->'reasons', '[]'::jsonb);
  v_assigned := COALESCE(NULLIF(btrim(payload->>'assigned_by'), ''), 'STEP_8_26');

  IF v_run IS NULL OR v_candidate = '' THEN
    RAISE EXCEPTION 'HQB_INVALID_PIPELINE_ITEM: run/candidate is incomplete.';
  END IF;
  IF v_status IN ('VERIFIED', 'WORKSHEET_ELIGIBLE') THEN
    RAISE EXCEPTION 'HQB_GOLD_STANDARD_FORBIDDEN: pipeline must never set VERIFIED/WORKSHEET_ELIGIBLE.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_runs r WHERE r.id = v_run) THEN
    RAISE EXCEPTION 'HQB_INVALID_PIPELINE_RUN: run does not exist.';
  END IF;

  PERFORM pg_advisory_xact_lock(854227, hashtext(v_run::text || ':' || v_candidate));

  SELECT i.id INTO v_item
  FROM public.pipeline_items i
  WHERE i.pipeline_run_id = v_run AND i.candidate_id = v_candidate;

  IF v_item IS NULL THEN
    INSERT INTO public.pipeline_items (
      pipeline_run_id, candidate_id, stage, status, reasons,
      fingerprint, dual_review, cache_keys, assigned_by
    ) VALUES (
      v_run, v_candidate, v_stage, v_status, v_reasons,
      payload->'fingerprint', payload->'dual_review', payload->'cache_keys', v_assigned
    )
    RETURNING id INTO v_item;
    v_created := true;
  ELSE
    UPDATE public.pipeline_items SET
      stage = v_stage,
      status = v_status,
      reasons = v_reasons,
      fingerprint = COALESCE(payload->'fingerprint', fingerprint),
      dual_review = COALESCE(payload->'dual_review', dual_review),
      cache_keys = COALESCE(payload->'cache_keys', cache_keys)
    WHERE id = v_item
      AND assigned_by = v_assigned;
  END IF;

  v_progress := public.hqb_pipeline_progress_from_items(v_run);
  UPDATE public.pipeline_runs
  SET progress = v_progress,
      status = CASE WHEN status = 'PLANNED' THEN 'RUNNING' ELSE status END
  WHERE id = v_run;

  INSERT INTO public.audit_events (entity_type, entity_id, action, actor, after_snapshot)
  VALUES (
    'pipeline_item',
    v_item,
    CASE
      WHEN v_status = 'AUTO_APPROVED' THEN 'PIPELINE_AUTO_APPROVED'
      WHEN v_status = 'HUMAN_REVIEW' THEN 'PIPELINE_QUEUED_REVIEW'
      WHEN v_status = 'BLOCKED' THEN 'PIPELINE_BLOCKED'
      WHEN v_status = 'FAILED' THEN 'PIPELINE_FAILED'
      ELSE 'PIPELINE_STAGE_OK'
    END,
    uid::text,
    jsonb_build_object('candidate_id', v_candidate, 'status', v_status, 'created', v_created)
  );

  RETURN jsonb_build_object(
    'item_id', v_item,
    'run_id', v_run,
    'created', v_created,
    'progress', v_progress,
    'writer', uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_delete_test_pipeline_job()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  removed_items int := 0;
  removed_runs int := 0;
  removed_audit int := 0;
BEGIN
  uid := public.hqb_require_staff_writer();

  DELETE FROM public.pipeline_items
  WHERE assigned_by = 'STEP_8_26_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_items = ROW_COUNT;

  DELETE FROM public.pipeline_runs
  WHERE assigned_by = 'STEP_8_26_ROLLBACK_TEST';
  GET DIAGNOSTICS removed_runs = ROW_COUNT;

  DELETE FROM public.audit_events
  WHERE actor = 'STEP_8_26_ROLLBACK_TEST'
     OR (
       entity_type IN ('pipeline_run', 'pipeline_item')
       AND after_snapshot->>'assigned_by' = 'STEP_8_26_ROLLBACK_TEST'
     );
  GET DIAGNOSTICS removed_audit = ROW_COUNT;

  RETURN jsonb_build_object(
    'removed_items', removed_items,
    'removed_runs', removed_runs,
    'removed_audit', removed_audit,
    'writer', uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_pipeline_empty_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_pipeline_progress_from_items(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_start_pipeline_run(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_pipeline_item(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_delete_test_pipeline_job() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_pipeline_empty_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_pipeline_progress_from_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_start_pipeline_run(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_pipeline_item(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_delete_test_pipeline_job() TO authenticated;
