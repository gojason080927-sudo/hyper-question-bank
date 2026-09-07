-- HYPER QUESTION BANK — STEP 4.5 production safety
-- Additive only. Do not apply to HYPER STUDENT CARE.
-- Does not rewrite STEP 3/4 migrations. No DROP TABLE / TRUNCATE.

-- ---------------------------------------------------------------------------
-- 1. Close public ADMIN bootstrap
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_bootstrap_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'HQB_BOOTSTRAP_DISABLED: 관리자 부트스트랩은 폐쇄되었습니다. Dashboard에서 역할을 지정하세요.';
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_bootstrap_admin() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.hqb_bootstrap_admin() IS
  'Disabled in STEP 4.5. ADMIN is assigned only via Dashboard / service_role management.';

-- ---------------------------------------------------------------------------
-- 2. New Auth users are PENDING, not automatic TEACHER
-- Existing ADMIN/TEACHER/REVIEWER rows are untouched.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_chk;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_chk
  CHECK (role IN ('ADMIN', 'TEACHER', 'REVIEWER', 'PENDING'));

CREATE OR REPLACE FUNCTION public.hqb_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, role, display_name)
  VALUES (NEW.id, 'PENDING', COALESCE(NEW.email, 'staff'))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE public.user_profiles IS
  'Staff roles. New Auth users start as PENDING. ADMIN assigns TEACHER/REVIEWER/ADMIN. SYSTEM_PROCESS is not a login role.';

-- ---------------------------------------------------------------------------
-- 3. Exact-version bundle. Never follows current_version_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_fetch_problem_version_bundle(
  p_problem_id uuid,
  p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'HQB_UNAUTHENTICATED: 로그인이 필요합니다.';
  END IF;
  IF NOT public.hqb_is_staff() THEN
    RAISE EXCEPTION 'HQB_FORBIDDEN: 강사 권한이 있는 계정만 문제를 조회할 수 있습니다.';
  END IF;
  IF p_problem_id IS NULL OR p_version_id IS NULL THEN
    RAISE EXCEPTION 'HQB_VERSION_MISMATCH: 문제와 버전을 지정해 주세요.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.problem_versions pv
    WHERE pv.id = p_version_id
      AND pv.problem_id = p_problem_id
  ) THEN
    RAISE EXCEPTION 'HQB_VERSION_MISMATCH: 요청한 버전이 이 문제에 속하지 않습니다.';
  END IF;

  SELECT jsonb_build_object(
    'problem', jsonb_build_object(
      'id', p.id,
      'public_code', p.public_code,
      'review_status', p.review_status,
      'lifecycle_status', p.lifecycle_status,
      'use_status', p.use_status,
      'current_version_id', p.current_version_id,
      'archived_at', p.archived_at
    ),
    'current_pointer', jsonb_build_object(
      'id', p.current_version_id,
      'version_no', cv.version_no,
      'review_status', cv.review_status
    ),
    'version', to_jsonb(pv) || jsonb_build_object(
      'is_current', pv.id = p.current_version_id
    ),
    'sources', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', ps.id,
        'source_document_id', ps.source_document_id,
        'source_page_id', ps.source_page_id,
        'original_problem_number', ps.original_problem_number,
        'source_type_label', ps.source_type_label,
        'is_primary_source', ps.is_primary_source,
        'document_title', sd.title,
        'page_number', sp.page_number,
        'license_status', sd.license_status,
        'usage_scope', sd.usage_scope
      ) ORDER BY ps.is_primary_source DESC, ps.created_at), '[]'::jsonb)
      FROM public.problem_sources ps
      JOIN public.source_documents sd ON sd.id = ps.source_document_id
      LEFT JOIN public.source_pages sp ON sp.id = ps.source_page_id
      WHERE ps.problem_id = p.id
    ),
    'license_status', (
      SELECT sd.license_status
      FROM public.problem_sources ps
      JOIN public.source_documents sd ON sd.id = ps.source_document_id
      WHERE ps.problem_id = p.id
      ORDER BY ps.is_primary_source DESC, ps.created_at
      LIMIT 1
    ),
    'use_status', p.use_status,
    'curriculum', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'node_id', n.id,
        'node_type', n.node_type,
        'name', n.name,
        'code', n.code,
        'framework_code', f.code,
        'framework_name', f.name,
        'is_primary', pc.is_primary
      )), '[]'::jsonb)
      FROM public.problem_curriculum pc
      JOIN public.curriculum_nodes n ON n.id = pc.curriculum_node_id
      JOIN public.curriculum_frameworks f ON f.id = n.framework_id
      WHERE pc.problem_version_id = pv.id
    ),
    'concepts', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'concept_id', c.id,
        'code', c.code,
        'name', c.name,
        'is_primary', pcl.is_primary,
        'weight', pcl.weight,
        'application_role', pcl.application_role
      ) ORDER BY pcl.is_primary DESC, c.code), '[]'::jsonb)
      FROM public.problem_concepts pcl
      JOIN public.concepts c ON c.id = pcl.concept_id
      WHERE pcl.problem_version_id = pv.id
    ),
    'hyper_types', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'type_id', t.id,
        'code', t.code,
        'name', t.name,
        'is_primary', pta.is_primary
      ) ORDER BY pta.is_primary DESC, t.code), '[]'::jsonb)
      FROM public.problem_type_assignments pta
      JOIN public.hyper_problem_types t ON t.id = pta.hyper_problem_type_id
      WHERE pta.problem_version_id = pv.id
    ),
    'strategies', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'template_id', st.id,
        'code', st.code,
        'name', st.name,
        'is_primary', psa.is_primary,
        'steps', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'step_no', sts.step_no,
            'label', sts.label
          ) ORDER BY sts.step_no), '[]'::jsonb)
          FROM public.strategy_template_steps sts
          WHERE sts.strategy_template_id = st.id
        )
      ) ORDER BY psa.is_primary DESC, st.code), '[]'::jsonb)
      FROM public.problem_strategy_assignments psa
      JOIN public.strategy_templates st ON st.id = psa.strategy_template_id
      WHERE psa.problem_version_id = pv.id
    ),
    'expressions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'role', me.expression_role,
        'original_expression', me.original_expression,
        'normalized_expression', me.normalized_expression,
        'latex_expression', me.latex_expression,
        'structure_skeleton', me.structure_skeleton,
        'structure_tags', me.structure_tags
      ) ORDER BY me.sort_order), '[]'::jsonb)
      FROM public.math_expressions me
      WHERE me.problem_version_id = pv.id
    ),
    'conditions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'code', ct.code,
        'name', ct.name,
        'assignment_status', pcnd.assignment_status
      ) ORDER BY ct.code), '[]'::jsonb)
      FROM public.problem_conditions pcnd
      JOIN public.condition_terms ct ON ct.id = pcnd.condition_term_id
      WHERE pcnd.problem_version_id = pv.id
    ),
    'targets', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'code', tt.code,
        'name', tt.name,
        'is_primary', pt.is_primary
      ) ORDER BY pt.is_primary DESC, tt.code), '[]'::jsonb)
      FROM public.problem_targets pt
      JOIN public.target_terms tt ON tt.id = pt.target_term_id
      WHERE pt.problem_version_id = pv.id
    ),
    'reasoning', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'code', rt.code,
        'name', rt.name
      ) ORDER BY rt.code), '[]'::jsonb)
      FROM public.problem_reasoning pr
      JOIN public.reasoning_terms rt ON rt.id = pr.reasoning_term_id
      WHERE pr.problem_version_id = pv.id
    ),
    'difficulty', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'difficulty_source', d.difficulty_source,
        'concept_difficulty', d.concept_difficulty,
        'calculation_complexity', d.calculation_complexity,
        'reasoning_depth', d.reasoning_depth,
        'condition_complexity', d.condition_complexity,
        'representation_complexity', d.representation_complexity,
        'trap_level', d.trap_level,
        'overall_difficulty', d.overall_difficulty
      ) ORDER BY d.difficulty_source), '[]'::jsonb)
      FROM public.problem_difficulty d
      WHERE d.problem_version_id = pv.id
    ),
    'choices', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'choice_order', ch.choice_order,
        'label', ch.label,
        'choice_text', ch.choice_text,
        'math_expression', ch.math_expression
      ) ORDER BY ch.choice_order), '[]'::jsonb)
      FROM public.problem_choices ch
      WHERE ch.problem_version_id = pv.id
    ),
    'answers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'answer_type', a.answer_type,
        'answer_text', a.answer_text,
        'normalized_answer', a.normalized_answer,
        'numeric_value', a.numeric_value
      )), '[]'::jsonb)
      FROM public.problem_answers a
      WHERE a.problem_version_id = pv.id
    ),
    'explanations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'explanation_type', e.explanation_type,
        'content', e.content
      )), '[]'::jsonb)
      FROM public.problem_explanations e
      WHERE e.problem_version_id = pv.id
    ),
    'assets', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'asset_type', ast.asset_type,
        'storage_path', ast.storage_path,
        'url', ast.url,
        'alt_text', ast.alt_text
      ) ORDER BY ast.created_at), '[]'::jsonb)
      FROM public.problem_assets ast
      WHERE ast.problem_version_id = pv.id
    ),
    'reviews', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'status', r.status,
        'reviewer', r.reviewer,
        'note', r.note,
        'reviewed_at', r.reviewed_at
      ) ORDER BY r.created_at), '[]'::jsonb)
      FROM public.reviews r
      WHERE r.problem_version_id = pv.id
    )
  )
  INTO result
  FROM public.problems p
  JOIN public.problem_versions pv ON pv.id = p_version_id AND pv.problem_id = p.id
  LEFT JOIN public.problem_versions cv ON cv.id = p.current_version_id
  WHERE p.id = p_problem_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.hqb_fetch_problem_version_bundle(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_fetch_problem_version_bundle(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.hqb_fetch_problem_version_bundle(uuid, uuid) IS
  'Staff read of one exact problem_version_id. Does not follow current_version_id.';
