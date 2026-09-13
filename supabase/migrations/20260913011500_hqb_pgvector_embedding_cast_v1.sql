-- HYPER QUESTION BANK — STEP 8.34 follow-up
-- Additive: recast jsonb embedding arrays via vector text form.
-- Does not edit 20260913010000. No drops. Never DELETE problems.

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
    SELECT concat('[', string_agg(x, ',' ORDER BY ord), ']')::vector(1024)
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
      SELECT concat('[', string_agg(x, ',' ORDER BY ord), ']')::vector(1024)
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
