-- HYPER QUESTION BANK — minimal taxonomy seed for STEP 3
-- NOT master taxonomy. NOT test problems.
-- Test problems live in scripts/fixtures/core-v1-test-problems.mjs

INSERT INTO public.curriculum_frameworks (code, name, region, active)
VALUES ('KR_2022', '2022 개정교육과정', 'KR', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.concepts (code, name, description, active)
VALUES
  ('LINEAR_EQUATION', '일차방정식', 'STEP 3 minimal seed — not master taxonomy', true),
  ('QUADRATIC_EQUATION', '이차방정식', 'STEP 3 minimal seed — not master taxonomy', true),
  ('FACTORING', '인수분해', 'STEP 3 minimal seed — not master taxonomy', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.hyper_problem_types (code, name, description, active)
VALUES
  ('LINEAR_DIRECT_SOLVE', '방정식 직접 풀이', 'STEP 3 minimal seed', true),
  ('QUADRATIC_FACTOR_SOLVE', '인수분해를 이용한 이차방정식 풀이', 'STEP 3 minimal seed', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.strategy_templates (code, name, description, active)
VALUES
  ('LINEAR_EQUATION_SOLVE', '일차방정식 풀이', 'STEP 3 minimal seed', true),
  ('FACTORABLE_QUADRATIC_SOLVE', '인수분해 가능한 이차방정식 풀이', 'STEP 3 minimal seed', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.condition_terms (code, name, approval_status, active)
VALUES
  ('NATURAL_NUMBER', '자연수', 'APPROVED', true),
  ('SUM_FIXED', '합이 고정', 'APPROVED', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.target_terms (code, name, approval_status, active)
VALUES
  ('EQUATION_SOLUTION', '방정식의 해', 'APPROVED', true),
  ('MAXIMUM', '최댓값', 'APPROVED', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.reasoning_terms (code, name, active)
VALUES
  ('DIRECT_RECALL', '직접 회상', true),
  ('SUBSTITUTION', '대입', true),
  ('TRANSFORMATION', '변형', true),
  ('MULTI_STEP', '다단계', true),
  ('MODELING', '모델링', true)
ON CONFLICT (code) DO NOTHING;

-- Curriculum tree (variable depth; no fixed semester/unit columns)
INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
SELECT f.id, NULL, 'SCHOOL_LEVEL', 'MIDDLE', '중학교', 1, true
FROM public.curriculum_frameworks f
WHERE f.code = 'KR_2022'
  AND NOT EXISTS (
    SELECT 1 FROM public.curriculum_nodes n
    WHERE n.framework_id = f.id AND n.code = 'MIDDLE' AND n.parent_id IS NULL
  );

INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
SELECT f.id, parent.id, 'GRADE', 'G7', '중1', 1, true
FROM public.curriculum_frameworks f
JOIN public.curriculum_nodes parent
  ON parent.framework_id = f.id AND parent.code = 'MIDDLE' AND parent.parent_id IS NULL
WHERE f.code = 'KR_2022'
  AND NOT EXISTS (
    SELECT 1 FROM public.curriculum_nodes n
    WHERE n.framework_id = f.id AND n.code = 'G7' AND n.parent_id = parent.id
  );

INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
SELECT f.id, parent.id, 'GRADE', 'G9', '중3', 3, true
FROM public.curriculum_frameworks f
JOIN public.curriculum_nodes parent
  ON parent.framework_id = f.id AND parent.code = 'MIDDLE' AND parent.parent_id IS NULL
WHERE f.code = 'KR_2022'
  AND NOT EXISTS (
    SELECT 1 FROM public.curriculum_nodes n
    WHERE n.framework_id = f.id AND n.code = 'G9' AND n.parent_id = parent.id
  );

INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
SELECT f.id, parent.id, 'UNIT', 'LINEAR_EQ_UNIT', '일차방정식', 1, true
FROM public.curriculum_frameworks f
JOIN public.curriculum_nodes parent
  ON parent.framework_id = f.id AND parent.code = 'G7'
WHERE f.code = 'KR_2022'
  AND NOT EXISTS (
    SELECT 1 FROM public.curriculum_nodes n
    WHERE n.framework_id = f.id AND n.code = 'LINEAR_EQ_UNIT' AND n.parent_id = parent.id
  );

INSERT INTO public.curriculum_nodes (framework_id, parent_id, node_type, code, name, sort_order, active)
SELECT f.id, parent.id, 'UNIT', 'QUADRATIC_EQ_UNIT', '이차방정식', 1, true
FROM public.curriculum_frameworks f
JOIN public.curriculum_nodes parent
  ON parent.framework_id = f.id AND parent.code = 'G9'
WHERE f.code = 'KR_2022'
  AND NOT EXISTS (
    SELECT 1 FROM public.curriculum_nodes n
    WHERE n.framework_id = f.id AND n.code = 'QUADRATIC_EQ_UNIT' AND n.parent_id = parent.id
  );

INSERT INTO public.strategy_template_steps (strategy_template_id, step_no, label)
SELECT s.id, 1, '상수항 이항'
FROM public.strategy_templates s
WHERE s.code = 'LINEAR_EQUATION_SOLVE'
  AND NOT EXISTS (
    SELECT 1 FROM public.strategy_template_steps x
    WHERE x.strategy_template_id = s.id AND x.step_no = 1
  );

INSERT INTO public.strategy_template_steps (strategy_template_id, step_no, label)
SELECT s.id, 2, '계수로 나눔'
FROM public.strategy_templates s
WHERE s.code = 'LINEAR_EQUATION_SOLVE'
  AND NOT EXISTS (
    SELECT 1 FROM public.strategy_template_steps x
    WHERE x.strategy_template_id = s.id AND x.step_no = 2
  );

INSERT INTO public.strategy_template_steps (strategy_template_id, step_no, label)
SELECT s.id, 3, '해 확인'
FROM public.strategy_templates s
WHERE s.code = 'LINEAR_EQUATION_SOLVE'
  AND NOT EXISTS (
    SELECT 1 FROM public.strategy_template_steps x
    WHERE x.strategy_template_id = s.id AND x.step_no = 3
  );

INSERT INTO public.strategy_template_steps (strategy_template_id, step_no, label)
SELECT s.id, v.step_no, v.label
FROM public.strategy_templates s
CROSS JOIN (
  VALUES
    (1, '표준형 정리'),
    (2, '인수분해 가능 여부 판단'),
    (3, '인수분해'),
    (4, '각 인수를 0으로 설정'),
    (5, '해 계산')
) AS v(step_no, label)
WHERE s.code = 'FACTORABLE_QUADRATIC_SOLVE'
  AND NOT EXISTS (
    SELECT 1 FROM public.strategy_template_steps x
    WHERE x.strategy_template_id = s.id AND x.step_no = v.step_no
  );

INSERT INTO public.concept_curriculum_placements (concept_id, curriculum_node_id, framework_id)
SELECT c.id, n.id, n.framework_id
FROM public.concepts c
JOIN public.curriculum_nodes n ON n.code = 'LINEAR_EQ_UNIT'
JOIN public.curriculum_frameworks f ON f.id = n.framework_id AND f.code = 'KR_2022'
WHERE c.code = 'LINEAR_EQUATION'
  AND NOT EXISTS (
    SELECT 1 FROM public.concept_curriculum_placements p
    WHERE p.concept_id = c.id AND p.curriculum_node_id = n.id
  );

INSERT INTO public.concept_curriculum_placements (concept_id, curriculum_node_id, framework_id)
SELECT c.id, n.id, n.framework_id
FROM public.concepts c
JOIN public.curriculum_nodes n ON n.code = 'QUADRATIC_EQ_UNIT'
JOIN public.curriculum_frameworks f ON f.id = n.framework_id AND f.code = 'KR_2022'
WHERE c.code IN ('QUADRATIC_EQUATION', 'FACTORING')
  AND NOT EXISTS (
    SELECT 1 FROM public.concept_curriculum_placements p
    WHERE p.concept_id = c.id AND p.curriculum_node_id = n.id
  );
