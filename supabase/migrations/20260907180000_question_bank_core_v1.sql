-- HYPER QUESTION BANK — CORE DATABASE v1
-- Project: hyper-question-bank ONLY
-- Do not apply this migration to HYPER STUDENT CARE.
--
-- Safety: additive CREATE TABLE / INDEX / POLICY only.
-- No DROP DATABASE, DROP SCHEMA, TRUNCATE, or destructive ALTER.
-- pgvector is intentionally NOT enabled in this STEP.
--
-- Delete policy (history first):
--   source_documents / source_pages / problems / problem_versions / taxonomy
--   use RESTRICT (or SET NULL where a link can be detached).
--   CASCADE only for snapshot-internal children of a version or template steps.
--   Soft-delete via archived_at. No hard-delete UI in STEP 3.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS public.problems_public_code_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

COMMENT ON SEQUENCE public.problems_public_code_seq IS
  'Race-safe public_code allocator. Gaps allowed. Deleted numbers are never reused.';

CREATE OR REPLACE FUNCTION public.hqb_format_public_code(n bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'HQB-' || lpad(n::text, GREATEST(6, length(n::text)), '0');
$$;

CREATE OR REPLACE FUNCTION public.hqb_assign_public_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Always mint from the sequence. Clients must not choose the next number.
  NEW.public_code := public.hqb_format_public_code(nextval('public.problems_public_code_seq'));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.hqb_compute_overall_difficulty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- v1 arithmetic mean. Trigger (not GENERATED ALWAYS) so the formula can change later.
  NEW.overall_difficulty := round((
    NEW.concept_difficulty
    + NEW.calculation_complexity
    + NEW.reasoning_depth
    + NEW.condition_complexity
    + NEW.representation_complexity
    + NEW.trap_level
  )::numeric / 6, 2);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Catalog / lookup tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.curriculum_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  region text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT curriculum_frameworks_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.curriculum_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL REFERENCES public.curriculum_frameworks (id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES public.curriculum_nodes (id) ON DELETE RESTRICT,
  node_type text NOT NULL,
  code text,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT curriculum_nodes_type_chk CHECK (
    node_type IN ('SCHOOL_LEVEL', 'GRADE', 'SEMESTER', 'SUBJECT', 'UNIT')
  )
);

CREATE INDEX IF NOT EXISTS curriculum_nodes_framework_idx
  ON public.curriculum_nodes (framework_id);
CREATE INDEX IF NOT EXISTS curriculum_nodes_parent_idx
  ON public.curriculum_nodes (parent_id);

CREATE TABLE IF NOT EXISTS public.concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT concepts_code_key UNIQUE (code)
);

-- Mapping: a concept may sit in many curriculum trees (not a curriculum leaf).
CREATE TABLE IF NOT EXISTS public.concept_curriculum_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES public.concepts (id) ON DELETE RESTRICT,
  curriculum_node_id uuid NOT NULL REFERENCES public.curriculum_nodes (id) ON DELETE RESTRICT,
  framework_id uuid NOT NULL REFERENCES public.curriculum_frameworks (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concept_curriculum_placements_uniq UNIQUE (concept_id, curriculum_node_id)
);

CREATE INDEX IF NOT EXISTS concept_curriculum_placements_node_idx
  ON public.concept_curriculum_placements (curriculum_node_id);

CREATE TABLE IF NOT EXISTS public.hyper_problem_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.hyper_problem_types (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT hyper_problem_types_code_key UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS hyper_problem_types_parent_idx
  ON public.hyper_problem_types (parent_id);

CREATE TABLE IF NOT EXISTS public.strategy_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT strategy_templates_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.strategy_template_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_template_id uuid NOT NULL REFERENCES public.strategy_templates (id) ON DELETE CASCADE,
  step_no integer NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_template_steps_step_no_chk CHECK (step_no >= 1),
  CONSTRAINT strategy_template_steps_uniq UNIQUE (strategy_template_id, step_no)
);

CREATE TABLE IF NOT EXISTS public.condition_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  approval_status text NOT NULL DEFAULT 'APPROVED',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT condition_terms_code_key UNIQUE (code),
  CONSTRAINT condition_terms_approval_chk CHECK (approval_status IN ('APPROVED', 'AUTO_DISCOVERED'))
);

CREATE TABLE IF NOT EXISTS public.target_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  approval_status text NOT NULL DEFAULT 'APPROVED',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT target_terms_code_key UNIQUE (code),
  CONSTRAINT target_terms_approval_chk CHECK (approval_status IN ('APPROVED', 'AUTO_DISCOVERED'))
);

CREATE TABLE IF NOT EXISTS public.reasoning_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT reasoning_terms_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.taxonomy_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_kind text NOT NULL,
  proposed_code text NOT NULL,
  proposed_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taxonomy_candidates_kind_chk CHECK (
    candidate_kind IN ('CONDITION', 'TARGET', 'REASONING', 'CONCEPT', 'PROBLEM_TYPE', 'STRATEGY')
  ),
  CONSTRAINT taxonomy_candidates_status_chk CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

-- ---------------------------------------------------------------------------
-- Source lineage
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  publisher text,
  author text,
  publication_year integer,
  edition text,
  document_type text NOT NULL,
  source_type text,
  original_filename text,
  file_hash text,
  page_count integer,
  license_status text NOT NULL DEFAULT 'UNKNOWN',
  usage_scope text,
  copyright_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT source_documents_type_chk CHECK (
    document_type IN (
      'TEXTBOOK', 'WORKBOOK', 'MOCK_EXAM', 'SCHOOL_EXAM',
      'PUBLIC_RESOURCE', 'TEACHER_CREATED', 'OTHER'
    )
  ),
  CONSTRAINT source_documents_license_chk CHECK (
    license_status IN (
      'PUBLIC', 'LICENSED', 'OWNED', 'PERMISSION_GRANTED', 'RESTRICTED', 'UNKNOWN'
    )
  ),
  CONSTRAINT source_documents_page_count_chk CHECK (page_count IS NULL OR page_count >= 0),
  CONSTRAINT source_documents_year_chk CHECK (
    publication_year IS NULL OR (publication_year >= 1900 AND publication_year <= 2100)
  )
);

COMMENT ON COLUMN public.source_documents.publication_year IS
  'Design Freeze field name was year. Physical column is publication_year.';

CREATE TABLE IF NOT EXISTS public.source_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  page_number integer NOT NULL,
  page_image_path text,
  extraction_status text NOT NULL DEFAULT 'PENDING',
  review_status text NOT NULL DEFAULT 'UNREVIEWED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT source_pages_page_number_chk CHECK (page_number >= 1),
  CONSTRAINT source_pages_extraction_chk CHECK (
    extraction_status IN ('PENDING', 'MANUAL', 'EXTRACTED', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT source_pages_review_chk CHECK (
    review_status IN ('UNREVIEWED', 'AUTO_CLASSIFIED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED')
  ),
  CONSTRAINT source_pages_document_page_key UNIQUE (source_document_id, page_number)
);

-- Structure only. Feature implementation is not in STEP 3.
CREATE TABLE IF NOT EXISTS public.school_exam_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES public.source_documents (id) ON DELETE CASCADE,
  school_name text,
  exam_year integer,
  grade text,
  term text,
  exam_kind text,
  subject text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_profiles_document_key UNIQUE (source_document_id),
  CONSTRAINT school_exam_profiles_kind_chk CHECK (
    exam_kind IS NULL OR exam_kind IN ('MIDTERM', 'FINAL', 'OTHER')
  )
);

-- ---------------------------------------------------------------------------
-- Problem identity + versioned content
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code text NOT NULL,
  current_version_id uuid,
  review_status text NOT NULL DEFAULT 'UNREVIEWED',
  lifecycle_status text NOT NULL DEFAULT 'DRAFT',
  use_status text NOT NULL DEFAULT 'INTERNAL_ONLY',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT problems_public_code_key UNIQUE (public_code),
  CONSTRAINT problems_public_code_format_chk CHECK (public_code ~ '^HQB-[0-9]{6,}$'),
  CONSTRAINT problems_review_status_chk CHECK (
    review_status IN ('UNREVIEWED', 'AUTO_CLASSIFIED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED')
  ),
  CONSTRAINT problems_lifecycle_status_chk CHECK (
    lifecycle_status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')
  ),
  CONSTRAINT problems_use_status_chk CHECK (
    use_status IN ('INTERNAL_ONLY', 'REVIEW_ONLY', 'WORKSHEET_ELIGIBLE', 'BLOCKED')
  )
);

COMMENT ON TABLE public.problems IS
  'Identity only. Body text lives on problem_versions. Soft-delete via archived_at.';

CREATE TABLE IF NOT EXISTS public.problem_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  version_no integer NOT NULL,
  origin text NOT NULL,
  parent_version_id uuid REFERENCES public.problem_versions (id) ON DELETE RESTRICT,
  change_reason text,
  problem_text text NOT NULL,
  normalized_text text,
  instruction text,
  item_format text NOT NULL DEFAULT 'SHORT_ANSWER',
  choice_count integer NOT NULL DEFAULT 0,
  content_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction_status text NOT NULL DEFAULT 'MANUAL',
  classification_status text NOT NULL DEFAULT 'DRAFT',
  review_status text NOT NULL DEFAULT 'UNREVIEWED',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_versions_problem_version_key UNIQUE (problem_id, version_no),
  CONSTRAINT problem_versions_version_no_chk CHECK (version_no >= 1),
  CONSTRAINT problem_versions_origin_chk CHECK (
    origin IN ('OCR', 'AUTO_CLEAN', 'TEACHER_EDIT', 'IMPORT')
  ),
  CONSTRAINT problem_versions_item_format_chk CHECK (
    item_format IN ('MULTIPLE_CHOICE', 'SHORT_ANSWER', 'CONSTRUCTED_RESPONSE', 'MIXED')
  ),
  CONSTRAINT problem_versions_choice_count_chk CHECK (choice_count >= 0),
  CONSTRAINT problem_versions_review_status_chk CHECK (
    review_status IN ('UNREVIEWED', 'AUTO_CLASSIFIED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED')
  )
);

COMMENT ON TABLE public.problem_versions IS
  'Versioned source of truth for problem content. VERIFIED edits require a new row.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'problems_current_version_id_fkey'
  ) THEN
    ALTER TABLE public.problems
      ADD CONSTRAINT problems_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES public.problem_versions (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS problem_versions_problem_idx
  ON public.problem_versions (problem_id);

CREATE TABLE IF NOT EXISTS public.problem_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL REFERENCES public.source_documents (id) ON DELETE RESTRICT,
  source_page_id uuid REFERENCES public.source_pages (id) ON DELETE RESTRICT,
  original_problem_number text,
  bounding_box jsonb,
  source_type_label text,
  is_primary_source boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.problem_sources IS
  'N:M source lineage. Detach a source by deleting this row; never CASCADE to problems.';
COMMENT ON COLUMN public.problem_sources.source_type_label IS
  'Textbook/source label only. Not the same as hyper_problem_types.code.';
COMMENT ON COLUMN public.problem_sources.bounding_box IS
  'Canonical {x,y,width,height,unit,pageWidth,pageHeight}. Location metadata, not a search index.';

CREATE INDEX IF NOT EXISTS problem_sources_problem_idx
  ON public.problem_sources (problem_id);
CREATE INDEX IF NOT EXISTS problem_sources_document_idx
  ON public.problem_sources (source_document_id);

CREATE TABLE IF NOT EXISTS public.problem_curriculum (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  curriculum_node_id uuid NOT NULL REFERENCES public.curriculum_nodes (id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_curriculum_uniq UNIQUE (problem_version_id, curriculum_node_id)
);

CREATE TABLE IF NOT EXISTS public.problem_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES public.concepts (id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  weight numeric(5, 2),
  application_role text,
  confidence numeric(5, 4),
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_concepts_uniq UNIQUE (problem_version_id, concept_id),
  CONSTRAINT problem_concepts_role_chk CHECK (
    application_role IS NULL OR application_role IN ('SOLVE_WITH', 'PREREQUISITE', 'DISTRACTOR_CONCEPT')
  ),
  CONSTRAINT problem_concepts_weight_chk CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  CONSTRAINT problem_concepts_confidence_chk CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

COMMENT ON TABLE public.problem_concepts IS
  'Design Freeze name: problem_concept_links. Multiple primary concepts are allowed in v1.';

CREATE TABLE IF NOT EXISTS public.problem_type_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  hyper_problem_type_id uuid NOT NULL REFERENCES public.hyper_problem_types (id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  confidence numeric(5, 4),
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_type_assignments_uniq UNIQUE (problem_version_id, hyper_problem_type_id),
  CONSTRAINT problem_type_assignments_confidence_chk CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

COMMENT ON TABLE public.problem_type_assignments IS
  'Design Freeze name: problem_type_links.';

CREATE TABLE IF NOT EXISTS public.problem_strategy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  strategy_template_id uuid NOT NULL REFERENCES public.strategy_templates (id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  confidence numeric(5, 4),
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_strategy_assignments_uniq UNIQUE (problem_version_id, strategy_template_id),
  CONSTRAINT problem_strategy_assignments_confidence_chk CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

COMMENT ON TABLE public.problem_strategy_assignments IS
  'Design Freeze name: problem_strategies. Ordered steps live on strategy_template_steps.';

CREATE TABLE IF NOT EXISTS public.math_expressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  expression_role text NOT NULL,
  original_expression text NOT NULL,
  normalized_expression text,
  latex_expression text,
  structure_skeleton text,
  structure_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT math_expressions_role_chk CHECK (
    expression_role IN ('GIVEN', 'CONDITION', 'TARGET', 'CHOICE', 'INTERMEDIATE')
  )
);

CREATE INDEX IF NOT EXISTS math_expressions_version_idx
  ON public.math_expressions (problem_version_id);

CREATE TABLE IF NOT EXISTS public.problem_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  condition_term_id uuid NOT NULL REFERENCES public.condition_terms (id) ON DELETE RESTRICT,
  assignment_status text NOT NULL DEFAULT 'APPROVED',
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_conditions_uniq UNIQUE (problem_version_id, condition_term_id),
  CONSTRAINT problem_conditions_status_chk CHECK (
    assignment_status IN ('APPROVED', 'AUTO_DISCOVERED')
  )
);

CREATE TABLE IF NOT EXISTS public.problem_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  target_term_id uuid NOT NULL REFERENCES public.target_terms (id) ON DELETE RESTRICT,
  assignment_status text NOT NULL DEFAULT 'APPROVED',
  is_primary boolean NOT NULL DEFAULT true,
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_targets_uniq UNIQUE (problem_version_id, target_term_id),
  CONSTRAINT problem_targets_status_chk CHECK (
    assignment_status IN ('APPROVED', 'AUTO_DISCOVERED')
  )
);

CREATE TABLE IF NOT EXISTS public.problem_reasoning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  reasoning_term_id uuid NOT NULL REFERENCES public.reasoning_terms (id) ON DELETE RESTRICT,
  assigned_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_reasoning_uniq UNIQUE (problem_version_id, reasoning_term_id)
);

CREATE TABLE IF NOT EXISTS public.problem_difficulty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  difficulty_source text NOT NULL,
  concept_difficulty integer NOT NULL,
  calculation_complexity integer NOT NULL,
  reasoning_depth integer NOT NULL,
  condition_complexity integer NOT NULL,
  representation_complexity integer NOT NULL,
  trap_level integer NOT NULL,
  overall_difficulty numeric(4, 2) NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_difficulty_source_version_key UNIQUE (problem_version_id, difficulty_source),
  CONSTRAINT problem_difficulty_source_chk CHECK (
    difficulty_source IN ('HUMAN', 'MODEL', 'CALIBRATED')
  ),
  CONSTRAINT problem_difficulty_concept_chk CHECK (concept_difficulty BETWEEN 1 AND 5),
  CONSTRAINT problem_difficulty_calc_chk CHECK (calculation_complexity BETWEEN 1 AND 5),
  CONSTRAINT problem_difficulty_reason_chk CHECK (reasoning_depth BETWEEN 1 AND 5),
  CONSTRAINT problem_difficulty_condition_chk CHECK (condition_complexity BETWEEN 1 AND 5),
  CONSTRAINT problem_difficulty_repr_chk CHECK (representation_complexity BETWEEN 1 AND 5),
  CONSTRAINT problem_difficulty_trap_chk CHECK (trap_level BETWEEN 1 AND 5)
);

COMMENT ON TABLE public.problem_difficulty IS
  'One row per (version, source). HUMAN / MODEL / CALIBRATED must not overwrite each other.';

CREATE TABLE IF NOT EXISTS public.problem_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  storage_path text,
  url text,
  alt_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_assets_type_chk CHECK (
    asset_type IN ('IMAGE', 'GRAPH', 'TABLE', 'GEOMETRY', 'DIAGRAM')
  )
);

COMMENT ON TABLE public.problem_assets IS
  'Metadata only in STEP 3. A row does not mean a Storage object exists. No bucket created.';

CREATE TABLE IF NOT EXISTS public.problem_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  choice_order integer NOT NULL,
  label text NOT NULL,
  choice_text text NOT NULL,
  normalized_text text,
  math_expression text,
  asset_id uuid REFERENCES public.problem_assets (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_choices_uniq UNIQUE (problem_version_id, choice_order),
  CONSTRAINT problem_choices_order_chk CHECK (choice_order >= 1)
);

CREATE TABLE IF NOT EXISTS public.problem_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  answer_type text NOT NULL,
  answer_text text,
  normalized_answer text,
  choice_id uuid REFERENCES public.problem_choices (id) ON DELETE RESTRICT,
  numeric_value numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_answers_type_chk CHECK (
    answer_type IN (
      'CHOICE_LABEL', 'NUMBER', 'EXPRESSION', 'INTERVAL', 'SET', 'TEXT', 'MULTI'
    )
  )
);

CREATE INDEX IF NOT EXISTS problem_answers_version_idx
  ON public.problem_answers (problem_version_id);

CREATE TABLE IF NOT EXISTS public.problem_explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE CASCADE,
  explanation_type text NOT NULL,
  content text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT problem_explanations_type_chk CHECK (
    explanation_type IN ('ORIGINAL', 'NORMALIZED', 'TEACHER')
  )
);

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE RESTRICT,
  status text NOT NULL,
  reviewer text,
  note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_status_chk CHECK (
    status IN ('UNREVIEWED', 'AUTO_CLASSIFIED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED')
  )
);

COMMENT ON TABLE public.reviews IS
  'Append-only human review history. problems.review_status is the current pointer only.';

CREATE INDEX IF NOT EXISTS reviews_problem_idx ON public.reviews (problem_id);
CREATE INDEX IF NOT EXISTS reviews_version_idx ON public.reviews (problem_version_id);

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON public.audit_events (entity_type, entity_id);

COMMENT ON TABLE public.audit_events IS
  'Extensible audit log. STEP 3 does not install automatic triggers on every table.';

-- ---------------------------------------------------------------------------
-- Future-compatible skeletons (no feature implementation, no pgvector)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_version_id uuid REFERENCES public.problem_versions (id) ON DELETE RESTRICT,
  fingerprint_type text NOT NULL,
  fingerprint_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_fingerprints_type_chk CHECK (
    fingerprint_type IN ('NORMALIZED_TEXT', 'STRUCTURE', 'FILE_HASH')
  )
);

CREATE TABLE IF NOT EXISTS public.verified_problem_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_a_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_b_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  relation_level text NOT NULL,
  verified_by text,
  verified_at timestamptz,
  component_scores jsonb,
  algorithm_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_problem_relations_pair_chk CHECK (problem_a_id < problem_b_id),
  CONSTRAINT verified_problem_relations_level_chk CHECK (
    relation_level IN ('T1', 'T2', 'T3', 'RELATED', 'NOT_RELATED')
  ),
  CONSTRAINT verified_problem_relations_pair_key UNIQUE (problem_a_id, problem_b_id)
);

CREATE TABLE IF NOT EXISTS public.worksheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  purpose text,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.worksheet_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id uuid NOT NULL REFERENCES public.worksheets (id) ON DELETE RESTRICT,
  problem_id uuid NOT NULL REFERENCES public.problems (id) ON DELETE RESTRICT,
  problem_version_id uuid NOT NULL REFERENCES public.problem_versions (id) ON DELETE RESTRICT,
  order_no integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worksheet_items_order_uniq UNIQUE (worksheet_id, order_no),
  CONSTRAINT worksheet_items_order_chk CHECK (order_no >= 1)
);

-- problem_embeddings is intentionally omitted: no vector column, no pgvector.

-- ---------------------------------------------------------------------------
-- Read helper: one logical problem bundle without cartesian JOIN explosion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hqb_fetch_problem_bundle(p_public_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
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
    'current_version', to_jsonb(pv),
    'sources', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', ps.id,
        'source_document_id', ps.source_document_id,
        'source_page_id', ps.source_page_id,
        'original_problem_number', ps.original_problem_number,
        'bounding_box', ps.bounding_box,
        'source_type_label', ps.source_type_label,
        'is_primary_source', ps.is_primary_source,
        'document_title', sd.title,
        'page_number', sp.page_number
      ) ORDER BY ps.is_primary_source DESC, ps.created_at), '[]'::jsonb)
      FROM public.problem_sources ps
      JOIN public.source_documents sd ON sd.id = ps.source_document_id
      LEFT JOIN public.source_pages sp ON sp.id = ps.source_page_id
      WHERE ps.problem_id = p.id
    ),
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
    'reviews', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'status', r.status,
        'reviewer', r.reviewer,
        'note', r.note,
        'reviewed_at', r.reviewed_at
      ) ORDER BY r.created_at), '[]'::jsonb)
      FROM public.reviews r
      WHERE r.problem_id = p.id
    )
  )
  FROM public.problems p
  JOIN public.problem_versions pv ON pv.id = p.current_version_id
  WHERE p.public_code = p_public_code;
$$;

REVOKE ALL ON FUNCTION public.hqb_fetch_problem_bundle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hqb_fetch_problem_bundle(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS problems_assign_public_code ON public.problems;
CREATE TRIGGER problems_assign_public_code
  BEFORE INSERT ON public.problems
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_assign_public_code();

DROP TRIGGER IF EXISTS problems_set_updated_at ON public.problems;
CREATE TRIGGER problems_set_updated_at
  BEFORE UPDATE ON public.problems
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS source_documents_set_updated_at ON public.source_documents;
CREATE TRIGGER source_documents_set_updated_at
  BEFORE UPDATE ON public.source_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS source_pages_set_updated_at ON public.source_pages;
CREATE TRIGGER source_pages_set_updated_at
  BEFORE UPDATE ON public.source_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS curriculum_frameworks_set_updated_at ON public.curriculum_frameworks;
CREATE TRIGGER curriculum_frameworks_set_updated_at
  BEFORE UPDATE ON public.curriculum_frameworks
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS curriculum_nodes_set_updated_at ON public.curriculum_nodes;
CREATE TRIGGER curriculum_nodes_set_updated_at
  BEFORE UPDATE ON public.curriculum_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS concepts_set_updated_at ON public.concepts;
CREATE TRIGGER concepts_set_updated_at
  BEFORE UPDATE ON public.concepts
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS hyper_problem_types_set_updated_at ON public.hyper_problem_types;
CREATE TRIGGER hyper_problem_types_set_updated_at
  BEFORE UPDATE ON public.hyper_problem_types
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS strategy_templates_set_updated_at ON public.strategy_templates;
CREATE TRIGGER strategy_templates_set_updated_at
  BEFORE UPDATE ON public.strategy_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS condition_terms_set_updated_at ON public.condition_terms;
CREATE TRIGGER condition_terms_set_updated_at
  BEFORE UPDATE ON public.condition_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS target_terms_set_updated_at ON public.target_terms;
CREATE TRIGGER target_terms_set_updated_at
  BEFORE UPDATE ON public.target_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS reasoning_terms_set_updated_at ON public.reasoning_terms;
CREATE TRIGGER reasoning_terms_set_updated_at
  BEFORE UPDATE ON public.reasoning_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_set_updated_at();

DROP TRIGGER IF EXISTS problem_difficulty_compute_overall ON public.problem_difficulty;
CREATE TRIGGER problem_difficulty_compute_overall
  BEFORE INSERT OR UPDATE ON public.problem_difficulty
  FOR EACH ROW
  EXECUTE FUNCTION public.hqb_compute_overall_difficulty();

-- ---------------------------------------------------------------------------
-- Privileges + RLS
-- anon: no table privileges (cannot write core tables)
-- authenticated: SELECT only (minimum teacher read)
-- writes: service_role / future RPC — not the frontend
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'curriculum_frameworks',
    'curriculum_nodes',
    'concepts',
    'concept_curriculum_placements',
    'hyper_problem_types',
    'strategy_templates',
    'strategy_template_steps',
    'condition_terms',
    'target_terms',
    'reasoning_terms',
    'taxonomy_candidates',
    'source_documents',
    'source_pages',
    'school_exam_profiles',
    'problems',
    'problem_versions',
    'problem_sources',
    'problem_curriculum',
    'problem_concepts',
    'problem_type_assignments',
    'problem_strategy_assignments',
    'math_expressions',
    'problem_conditions',
    'problem_targets',
    'problem_reasoning',
    'problem_difficulty',
    'problem_assets',
    'problem_choices',
    'problem_answers',
    'problem_explanations',
    'reviews',
    'audit_events',
    'content_fingerprints',
    'verified_problem_relations',
    'worksheets',
    'worksheet_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS qbank_authenticated_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY qbank_authenticated_select ON public.%I FOR SELECT TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.problems_public_code_seq TO service_role;
