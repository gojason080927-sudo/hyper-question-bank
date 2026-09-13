-- HYPER QUESTION BANK — STEP 8.34
-- Additive pgvector + problem_embeddings + similar-search RPC.
-- Implements docs/STEP8_34_EXCEPTIONS_VECTOR_PIPELINE_v1.md Goal B.
-- Do not apply to HYPER STUDENT CARE.
-- No table/column drops. No edits to prior migration files.
-- Never writes VERIFIED. Never DELETE of problems.

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- 2. problem_embeddings (design: vector column; SQL name embedding)
--    Locked model: mistral-embed, 1024 dimensions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE CASCADE,
  embedding_type text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
  embedding vector(1024) NOT NULL,
  text_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_embeddings_type_chk CHECK (
    embedding_type IN ('PROBLEM_TEXT', 'NORMALIZED_TEXT', 'STRUCTURE_HINT')
  ),
  CONSTRAINT problem_embeddings_uniq UNIQUE (problem_id, embedding_type, model, model_version)
);

COMMENT ON TABLE public.problem_embeddings IS
  'STEP 8.34 embedding store. Design name vector maps to column embedding (vector(1024)). Model locked to mistral-embed.';

COMMENT ON COLUMN public.problem_embeddings.embedding IS
  'Design field "vector". Cosine similarity via pgvector. Dimension 1024 = mistral-embed default.';

CREATE INDEX IF NOT EXISTS problem_embeddings_problem_idx
  ON public.problem_embeddings (problem_id);

CREATE INDEX IF NOT EXISTS problem_embeddings_hash_idx
  ON public.problem_embeddings (text_hash, model, embedding_type);

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS problem_embeddings_hnsw_cosine_idx
    ON public.problem_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION
  WHEN undefined_object OR feature_not_supported OR invalid_parameter_value THEN
    CREATE INDEX IF NOT EXISTS problem_embeddings_ivfflat_cosine_idx
      ON public.problem_embeddings
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Duplicate candidate links (not verified_problem_relations)
--    Auto STEP links. No DELETE. Extra identity may be BLOCKED.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_duplicate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_a_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_b_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  link_kind text NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  keeper_problem_id uuid REFERENCES public.problems (id) ON DELETE RESTRICT,
  assigned_by text NOT NULL DEFAULT 'STEP_8_34',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_duplicate_links_pair_chk CHECK (problem_a_id < problem_b_id),
  CONSTRAINT problem_duplicate_links_kind_chk CHECK (
    link_kind IN ('EXACT_DUPLICATE', 'VERSION_CANDIDATE', 'SIMILAR_DISTINCT', 'UNCERTAIN')
  ),
  CONSTRAINT problem_duplicate_links_status_chk CHECK (
    status IN ('LINKED', 'KEPT_DISTINCT', 'HUMAN_REVIEW')
  ),
  CONSTRAINT problem_duplicate_links_pair_key UNIQUE (problem_a_id, problem_b_id)
);

COMMENT ON TABLE public.problem_duplicate_links IS
  'STEP 8.34 automatic duplicate classification. Distinct from human-verified_problem_relations. No deletes.';

CREATE INDEX IF NOT EXISTS problem_duplicate_links_keeper_idx
  ON public.problem_duplicate_links (keeper_problem_id);

-- ---------------------------------------------------------------------------
-- 4. Bbox correction history (original + corrected; no silent overwrite without audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_source_bbox_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_source_id uuid NOT NULL REFERENCES public.problem_sources (id) ON DELETE RESTRICT,
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  original_bbox jsonb NOT NULL,
  corrected_bbox jsonb NOT NULL,
  original_hash text NOT NULL,
  corrected_hash text NOT NULL,
  method text NOT NULL,
  confidence text NOT NULL,
  overlap_before numeric(8, 6),
  overlap_after numeric(8, 6),
  assigned_by text NOT NULL DEFAULT 'STEP_8_34',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_source_bbox_corrections_conf_chk CHECK (
    confidence IN ('HIGH', 'MEDIUM', 'UNCERTAIN')
  )
);

CREATE INDEX IF NOT EXISTS problem_source_bbox_corrections_problem_idx
  ON public.problem_source_bbox_corrections (problem_id);

-- ---------------------------------------------------------------------------
-- 5. Content region sidecar (answer leak / OCR recovery). Original problem_text stays.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.problem_content_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_version_id uuid REFERENCES public.problem_versions (id) ON DELETE RESTRICT,
  region_kind text NOT NULL,
  original_text text NOT NULL,
  extracted_text text NOT NULL,
  assigned_by text NOT NULL DEFAULT 'STEP_8_34',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_content_regions_kind_chk CHECK (
    region_kind IN ('STEM', 'ANSWER', 'EXPLANATION', 'OCR_RECOVERY')
  )
);

CREATE INDEX IF NOT EXISTS problem_content_regions_problem_idx
  ON public.problem_content_regions (problem_id);

-- ---------------------------------------------------------------------------
-- 6. RLS: staff SELECT. Writes via SECURITY DEFINER RPCs. service_role retains ALL.
-- ---------------------------------------------------------------------------
ALTER TABLE public.problem_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_duplicate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_source_bbox_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_content_regions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.problem_embeddings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.problem_duplicate_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.problem_source_bbox_corrections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.problem_content_regions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.problem_embeddings TO authenticated;
GRANT SELECT ON TABLE public.problem_duplicate_links TO authenticated;
GRANT SELECT ON TABLE public.problem_source_bbox_corrections TO authenticated;
GRANT SELECT ON TABLE public.problem_content_regions TO authenticated;

GRANT ALL ON TABLE public.problem_embeddings TO service_role;
GRANT ALL ON TABLE public.problem_duplicate_links TO service_role;
GRANT ALL ON TABLE public.problem_source_bbox_corrections TO service_role;
GRANT ALL ON TABLE public.problem_content_regions TO service_role;

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_embeddings;
CREATE POLICY qbank_staff_select ON public.problem_embeddings
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_duplicate_links;
CREATE POLICY qbank_staff_select ON public.problem_duplicate_links
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_source_bbox_corrections;
CREATE POLICY qbank_staff_select ON public.problem_source_bbox_corrections
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

DROP POLICY IF EXISTS qbank_staff_select ON public.problem_content_regions;
CREATE POLICY qbank_staff_select ON public.problem_content_regions
  FOR SELECT TO authenticated
  USING (public.hqb_is_staff());

-- ---------------------------------------------------------------------------
-- 7. Inventory (read-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_vector_inventory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: staff only';
  END IF;
  RETURN jsonb_build_object(
    'vector_extension', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector'),
    'problem_embeddings', to_regclass('public.problem_embeddings') IS NOT NULL,
    'duplicate_links', to_regclass('public.problem_duplicate_links') IS NOT NULL,
    'bbox_corrections', to_regclass('public.problem_source_bbox_corrections') IS NOT NULL,
    'content_regions', to_regclass('public.problem_content_regions') IS NOT NULL,
    'search_rpc', EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'hqb_search_similar_problems'
    ),
    'model_lock', jsonb_build_object(
      'model', 'mistral-embed',
      'dimensions', 1024,
      'embedding_type', 'NORMALIZED_TEXT'
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Upsert embedding (idempotent). Never touches problem_text / VERIFIED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_upsert_problem_embedding(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  v_problem uuid;
  v_type text;
  v_model text;
  v_version text;
  v_hash text;
  v_vec vector(1024);
  v_id uuid;
  v_inserted boolean := false;
BEGIN
  uid := public.hqb_require_staff_writer();
  v_problem := (payload->>'problem_id')::uuid;
  v_type := payload->>'embedding_type';
  v_model := payload->>'model';
  v_version := coalesce(payload->>'model_version', 'locked');
  v_hash := payload->>'text_hash';
  IF v_problem IS NULL OR v_type IS NULL OR v_model IS NULL OR v_hash IS NULL THEN
    RAISE EXCEPTION 'HQB_EMBEDDING_PAYLOAD: problem_id, embedding_type, model, text_hash required';
  END IF;
  IF jsonb_typeof(payload->'embedding') <> 'array' THEN
    RAISE EXCEPTION 'HQB_EMBEDDING_PAYLOAD: embedding array required';
  END IF;
  IF jsonb_array_length(payload->'embedding') <> 1024 THEN
    RAISE EXCEPTION 'HQB_EMBEDDING_DIM: expected 1024, got %', jsonb_array_length(payload->'embedding');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.problems p WHERE p.id = v_problem) THEN
    RAISE EXCEPTION 'HQB_EMBEDDING_PROBLEM: not found';
  END IF;
  v_vec := (
    SELECT array_agg(x ORDER BY ord)::vector(1024)
    FROM jsonb_array_elements_text(payload->'embedding') WITH ORDINALITY AS t(x, ord)
  );
  INSERT INTO public.problem_embeddings (
    problem_id, embedding_type, model, model_version, embedding, text_hash
  ) VALUES (
    v_problem, v_type, v_model, v_version, v_vec, v_hash
  )
  ON CONFLICT (problem_id, embedding_type, model, model_version)
  DO UPDATE SET
    embedding = EXCLUDED.embedding,
    text_hash = EXCLUDED.text_hash
  WHERE public.problem_embeddings.text_hash IS DISTINCT FROM EXCLUDED.text_hash
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.problem_embeddings
    WHERE problem_id = v_problem
      AND embedding_type = v_type
      AND model = v_model
      AND model_version = v_version;
  ELSE
    v_inserted := true;
  END IF;
  PERFORM public.hqb_audit(
    'problem_embedding',
    v_problem,
    CASE WHEN v_inserted THEN 'UPSERT_EMBEDDING' ELSE 'SKIP_EMBEDDING' END,
    jsonb_build_object('embedding_id', v_id, 'model', v_model, 'type', v_type, 'text_hash', v_hash),
    jsonb_build_object('user_id', uid)
  );
  RETURN jsonb_build_object('embedding_id', v_id, 'inserted', v_inserted, 'problem_id', v_problem);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Cosine top-k similar search. Staff SELECT path.
--    Excludes self, BLOCKED, and exact NORMALIZED_TEXT fingerprint twins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hqb_search_similar_problems(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problem uuid;
  v_k integer;
  v_source uuid;
  v_unit uuid;
  v_type text;
  v_diff integer;
  v_query vector(1024);
  v_model text := 'mistral-embed';
  v_type_emb text := 'NORMALIZED_TEXT';
BEGIN
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: staff only';
  END IF;
  v_problem := NULLIF(payload->>'problem_id', '')::uuid;
  v_k := least(greatest(coalesce((payload->>'k')::integer, 5), 1), 50);
  v_source := NULLIF(payload->>'source_document_id', '')::uuid;
  v_unit := NULLIF(payload->>'curriculum_node_id', '')::uuid;
  v_type := NULLIF(payload->>'problem_type', '');
  v_diff := NULLIF(payload->>'difficulty_level', '')::integer;
  v_model := coalesce(NULLIF(payload->>'model', ''), 'mistral-embed');
  v_type_emb := coalesce(NULLIF(payload->>'embedding_type', ''), 'NORMALIZED_TEXT');

  IF payload ? 'query_embedding' AND jsonb_typeof(payload->'query_embedding') = 'array' THEN
    IF jsonb_array_length(payload->'query_embedding') <> 1024 THEN
      RAISE EXCEPTION 'HQB_EMBEDDING_DIM: expected 1024';
    END IF;
    v_query := (
      SELECT array_agg(x ORDER BY ord)::vector(1024)
      FROM jsonb_array_elements_text(payload->'query_embedding') WITH ORDINALITY AS t(x, ord)
    );
  ELSIF v_problem IS NOT NULL THEN
    SELECT pe.embedding INTO v_query
    FROM public.problem_embeddings pe
    WHERE pe.problem_id = v_problem
      AND pe.model = v_model
      AND pe.embedding_type = v_type_emb
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'HQB_SEARCH_QUERY: problem_id or query_embedding required';
  END IF;

  IF v_query IS NULL THEN
    RETURN jsonb_build_object('results', '[]'::jsonb, 'reason', 'NO_QUERY_EMBEDDING');
  END IF;

  RETURN jsonb_build_object(
    'results', coalesce((
      SELECT jsonb_agg(row_to_json(s))
      FROM (
        SELECT
          pe.problem_id,
          p.public_code,
          (1 - (pe.embedding <=> v_query))::float8 AS similarity,
          ps.source_document_id,
          pcm.unit_node_id AS curriculum_node_id,
          hpt.code AS problem_type,
          coalesce(pcm.difficulty_level, round(pd.overall_difficulty)::int) AS difficulty_level
        FROM public.problem_embeddings pe
        JOIN public.problems p ON p.id = pe.problem_id
        LEFT JOIN LATERAL (
          SELECT psx.source_document_id
          FROM public.problem_sources psx
          WHERE psx.problem_id = p.id
            AND (v_source IS NULL OR psx.source_document_id = v_source)
          ORDER BY psx.is_primary_source DESC
          LIMIT 1
        ) ps ON true
        LEFT JOIN public.problem_versions pv
          ON pv.id = p.current_version_id
        LEFT JOIN public.problem_classification_meta pcm
          ON pcm.problem_version_id = pv.id
        LEFT JOIN public.hyper_problem_types hpt
          ON hpt.id = pcm.hyper_problem_type_id
        LEFT JOIN public.problem_difficulty pd
          ON pd.problem_version_id = pv.id
         AND pd.difficulty_source = 'MODEL'
        WHERE pe.model = v_model
          AND pe.embedding_type = v_type_emb
          AND (v_problem IS NULL OR pe.problem_id <> v_problem)
          AND p.use_status <> 'BLOCKED'
          AND p.lifecycle_status <> 'ARCHIVED'
          AND (v_source IS NULL OR EXISTS (
            SELECT 1 FROM public.problem_sources psf
            WHERE psf.problem_id = p.id AND psf.source_document_id = v_source
          ))
          AND (v_unit IS NULL OR pcm.unit_node_id = v_unit)
          AND (v_type IS NULL OR hpt.code = v_type)
          AND (
            v_diff IS NULL
            OR pcm.difficulty_level = v_diff
            OR round(pd.overall_difficulty)::int = v_diff
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.content_fingerprints q
            JOIN public.content_fingerprints o
              ON o.fingerprint_type = q.fingerprint_type
             AND o.fingerprint_value = q.fingerprint_value
             AND o.problem_id = pe.problem_id
            WHERE v_problem IS NOT NULL
              AND q.problem_id = v_problem
              AND q.fingerprint_type = 'NORMALIZED_TEXT'
          )
        ORDER BY pe.embedding <=> v_query
        LIMIT v_k
      ) s
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_vector_inventory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_upsert_problem_embedding(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hqb_search_similar_problems(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hqb_vector_inventory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_embedding(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hqb_search_similar_problems(jsonb) TO authenticated;
