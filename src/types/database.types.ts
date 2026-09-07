/**
 * GENERATED FROM LIVE SUPABASE SCHEMA — Question Bank CORE + workflow v1
 * Project ref: owpxsmdcxjmsgadkdsci (hyper-question-bank)
 *
 * Physical database contract. Not the design draft.
 * Regenerate: npx supabase gen types typescript --linked --schema public
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor: string | null
          after_snapshot: Json | null
          before_snapshot: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor?: string | null
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor?: string | null
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      concept_curriculum_placements: {
        Row: {
          concept_id: string
          created_at: string
          curriculum_node_id: string
          framework_id: string
          id: string
        }
        Insert: {
          concept_id: string
          created_at?: string
          curriculum_node_id: string
          framework_id: string
          id?: string
        }
        Update: {
          concept_id?: string
          created_at?: string
          curriculum_node_id?: string
          framework_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_curriculum_placements_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_curriculum_placements_curriculum_node_id_fkey"
            columns: ["curriculum_node_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_curriculum_placements_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "curriculum_frameworks"
            referencedColumns: ["id"]
          },
        ]
      }
      concepts: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      condition_terms: {
        Row: {
          active: boolean
          approval_status: string
          archived_at: string | null
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approval_status?: string
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approval_status?: string
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_fingerprints: {
        Row: {
          created_at: string
          fingerprint_type: string
          fingerprint_value: string
          id: string
          problem_id: string
          problem_version_id: string | null
        }
        Insert: {
          created_at?: string
          fingerprint_type: string
          fingerprint_value: string
          id?: string
          problem_id: string
          problem_version_id?: string | null
        }
        Update: {
          created_at?: string
          fingerprint_type?: string
          fingerprint_value?: string
          id?: string
          problem_id?: string
          problem_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_fingerprints_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_fingerprints_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_frameworks: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          id: string
          name: string
          region: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      curriculum_nodes: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string | null
          created_at: string
          framework_id: string
          id: string
          name: string
          node_type: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code?: string | null
          created_at?: string
          framework_id: string
          id?: string
          name: string
          node_type: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string | null
          created_at?: string
          framework_id?: string
          id?: string
          name?: string
          node_type?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_nodes_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "curriculum_frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      hyper_problem_types: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hyper_problem_types_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "hyper_problem_types"
            referencedColumns: ["id"]
          },
        ]
      }
      math_expressions: {
        Row: {
          created_at: string
          expression_role: string
          id: string
          latex_expression: string | null
          normalized_expression: string | null
          original_expression: string
          problem_version_id: string
          sort_order: number
          structure_skeleton: string | null
          structure_tags: Json
        }
        Insert: {
          created_at?: string
          expression_role: string
          id?: string
          latex_expression?: string | null
          normalized_expression?: string | null
          original_expression: string
          problem_version_id: string
          sort_order?: number
          structure_skeleton?: string | null
          structure_tags?: Json
        }
        Update: {
          created_at?: string
          expression_role?: string
          id?: string
          latex_expression?: string | null
          normalized_expression?: string | null
          original_expression?: string
          problem_version_id?: string
          sort_order?: number
          structure_skeleton?: string | null
          structure_tags?: Json
        }
        Relationships: [
          {
            foreignKeyName: "math_expressions_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_answers: {
        Row: {
          answer_text: string | null
          answer_type: string
          choice_id: string | null
          created_at: string
          id: string
          metadata: Json
          normalized_answer: string | null
          numeric_value: number | null
          problem_version_id: string
        }
        Insert: {
          answer_text?: string | null
          answer_type: string
          choice_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          normalized_answer?: string | null
          numeric_value?: number | null
          problem_version_id: string
        }
        Update: {
          answer_text?: string | null
          answer_type?: string
          choice_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          normalized_answer?: string | null
          numeric_value?: number | null
          problem_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_answers_choice_id_fkey"
            columns: ["choice_id"]
            isOneToOne: false
            referencedRelation: "problem_choices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_answers_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_assets: {
        Row: {
          alt_text: string | null
          asset_type: string
          created_at: string
          id: string
          metadata: Json
          problem_version_id: string
          storage_path: string | null
          url: string | null
        }
        Insert: {
          alt_text?: string | null
          asset_type: string
          created_at?: string
          id?: string
          metadata?: Json
          problem_version_id: string
          storage_path?: string | null
          url?: string | null
        }
        Update: {
          alt_text?: string | null
          asset_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          problem_version_id?: string
          storage_path?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "problem_assets_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_choices: {
        Row: {
          asset_id: string | null
          choice_order: number
          choice_text: string
          created_at: string
          id: string
          label: string
          math_expression: string | null
          normalized_text: string | null
          problem_version_id: string
        }
        Insert: {
          asset_id?: string | null
          choice_order: number
          choice_text: string
          created_at?: string
          id?: string
          label: string
          math_expression?: string | null
          normalized_text?: string | null
          problem_version_id: string
        }
        Update: {
          asset_id?: string | null
          choice_order?: number
          choice_text?: string
          created_at?: string
          id?: string
          label?: string
          math_expression?: string | null
          normalized_text?: string | null
          problem_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_choices_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "problem_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_choices_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_concepts: {
        Row: {
          application_role: string | null
          assigned_by: string | null
          concept_id: string
          confidence: number | null
          created_at: string
          id: string
          is_primary: boolean
          problem_version_id: string
          weight: number | null
        }
        Insert: {
          application_role?: string | null
          assigned_by?: string | null
          concept_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          is_primary?: boolean
          problem_version_id: string
          weight?: number | null
        }
        Update: {
          application_role?: string | null
          assigned_by?: string | null
          concept_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          is_primary?: boolean
          problem_version_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "problem_concepts_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_concepts_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_conditions: {
        Row: {
          assigned_by: string | null
          assignment_status: string
          condition_term_id: string
          created_at: string
          id: string
          problem_version_id: string
        }
        Insert: {
          assigned_by?: string | null
          assignment_status?: string
          condition_term_id: string
          created_at?: string
          id?: string
          problem_version_id: string
        }
        Update: {
          assigned_by?: string | null
          assignment_status?: string
          condition_term_id?: string
          created_at?: string
          id?: string
          problem_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_conditions_condition_term_id_fkey"
            columns: ["condition_term_id"]
            isOneToOne: false
            referencedRelation: "condition_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_conditions_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_curriculum: {
        Row: {
          created_at: string
          curriculum_node_id: string
          id: string
          is_primary: boolean
          problem_version_id: string
        }
        Insert: {
          created_at?: string
          curriculum_node_id: string
          id?: string
          is_primary?: boolean
          problem_version_id: string
        }
        Update: {
          created_at?: string
          curriculum_node_id?: string
          id?: string
          is_primary?: boolean
          problem_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_curriculum_curriculum_node_id_fkey"
            columns: ["curriculum_node_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_curriculum_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_difficulty: {
        Row: {
          calculation_complexity: number
          concept_difficulty: number
          condition_complexity: number
          created_at: string
          created_by: string | null
          difficulty_source: string
          id: string
          overall_difficulty: number
          problem_version_id: string
          reasoning_depth: number
          representation_complexity: number
          trap_level: number
        }
        Insert: {
          calculation_complexity: number
          concept_difficulty: number
          condition_complexity: number
          created_at?: string
          created_by?: string | null
          difficulty_source: string
          id?: string
          overall_difficulty: number
          problem_version_id: string
          reasoning_depth: number
          representation_complexity: number
          trap_level: number
        }
        Update: {
          calculation_complexity?: number
          concept_difficulty?: number
          condition_complexity?: number
          created_at?: string
          created_by?: string | null
          difficulty_source?: string
          id?: string
          overall_difficulty?: number
          problem_version_id?: string
          reasoning_depth?: number
          representation_complexity?: number
          trap_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "problem_difficulty_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_explanations: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          explanation_type: string
          id: string
          problem_version_id: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          explanation_type: string
          id?: string
          problem_version_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          explanation_type?: string
          id?: string
          problem_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_explanations_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_reasoning: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          problem_version_id: string
          reasoning_term_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          problem_version_id: string
          reasoning_term_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          problem_version_id?: string
          reasoning_term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_reasoning_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_reasoning_reasoning_term_id_fkey"
            columns: ["reasoning_term_id"]
            isOneToOne: false
            referencedRelation: "reasoning_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_sources: {
        Row: {
          bounding_box: Json | null
          created_at: string
          id: string
          is_primary_source: boolean
          original_problem_number: string | null
          problem_id: string
          source_document_id: string
          source_page_id: string | null
          source_type_label: string | null
        }
        Insert: {
          bounding_box?: Json | null
          created_at?: string
          id?: string
          is_primary_source?: boolean
          original_problem_number?: string | null
          problem_id: string
          source_document_id: string
          source_page_id?: string | null
          source_type_label?: string | null
        }
        Update: {
          bounding_box?: Json | null
          created_at?: string
          id?: string
          is_primary_source?: boolean
          original_problem_number?: string | null
          problem_id?: string
          source_document_id?: string
          source_page_id?: string | null
          source_type_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "problem_sources_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_sources_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_sources_source_page_id_fkey"
            columns: ["source_page_id"]
            isOneToOne: false
            referencedRelation: "source_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_strategy_assignments: {
        Row: {
          assigned_by: string | null
          confidence: number | null
          created_at: string
          id: string
          is_primary: boolean
          problem_version_id: string
          strategy_template_id: string
        }
        Insert: {
          assigned_by?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          is_primary?: boolean
          problem_version_id: string
          strategy_template_id: string
        }
        Update: {
          assigned_by?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          is_primary?: boolean
          problem_version_id?: string
          strategy_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_strategy_assignments_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_strategy_assignments_strategy_template_id_fkey"
            columns: ["strategy_template_id"]
            isOneToOne: false
            referencedRelation: "strategy_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_targets: {
        Row: {
          assigned_by: string | null
          assignment_status: string
          created_at: string
          id: string
          is_primary: boolean
          problem_version_id: string
          target_term_id: string
        }
        Insert: {
          assigned_by?: string | null
          assignment_status?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          problem_version_id: string
          target_term_id: string
        }
        Update: {
          assigned_by?: string | null
          assignment_status?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          problem_version_id?: string
          target_term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_targets_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_targets_target_term_id_fkey"
            columns: ["target_term_id"]
            isOneToOne: false
            referencedRelation: "target_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_type_assignments: {
        Row: {
          assigned_by: string | null
          confidence: number | null
          created_at: string
          hyper_problem_type_id: string
          id: string
          is_primary: boolean
          problem_version_id: string
        }
        Insert: {
          assigned_by?: string | null
          confidence?: number | null
          created_at?: string
          hyper_problem_type_id: string
          id?: string
          is_primary?: boolean
          problem_version_id: string
        }
        Update: {
          assigned_by?: string | null
          confidence?: number | null
          created_at?: string
          hyper_problem_type_id?: string
          id?: string
          is_primary?: boolean
          problem_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_type_assignments_hyper_problem_type_id_fkey"
            columns: ["hyper_problem_type_id"]
            isOneToOne: false
            referencedRelation: "hyper_problem_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_type_assignments_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_versions: {
        Row: {
          change_reason: string | null
          choice_count: number
          classification_status: string
          content_metadata: Json
          created_at: string
          created_by: string | null
          extraction_status: string
          id: string
          instruction: string | null
          item_format: string
          normalized_text: string | null
          origin: string
          parent_version_id: string | null
          problem_id: string
          problem_text: string
          review_status: string
          version_no: number
        }
        Insert: {
          change_reason?: string | null
          choice_count?: number
          classification_status?: string
          content_metadata?: Json
          created_at?: string
          created_by?: string | null
          extraction_status?: string
          id?: string
          instruction?: string | null
          item_format?: string
          normalized_text?: string | null
          origin: string
          parent_version_id?: string | null
          problem_id: string
          problem_text: string
          review_status?: string
          version_no: number
        }
        Update: {
          change_reason?: string | null
          choice_count?: number
          classification_status?: string
          content_metadata?: Json
          created_at?: string
          created_by?: string | null
          extraction_status?: string
          id?: string
          instruction?: string | null
          item_format?: string
          normalized_text?: string | null
          origin?: string
          parent_version_id?: string | null
          problem_id?: string
          problem_text?: string
          review_status?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "problem_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_versions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
        ]
      }
      problems: {
        Row: {
          archived_at: string | null
          created_at: string
          current_version_id: string | null
          id: string
          lifecycle_status: string
          public_code: string
          review_status: string
          updated_at: string
          use_status: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          current_version_id?: string | null
          id?: string
          lifecycle_status?: string
          public_code: string
          review_status?: string
          updated_at?: string
          use_status?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          current_version_id?: string | null
          id?: string
          lifecycle_status?: string
          public_code?: string
          review_status?: string
          updated_at?: string
          use_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "problems_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      reasoning_terms: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          created_at: string
          id: string
          note: string | null
          problem_id: string
          problem_version_id: string
          reviewed_at: string | null
          reviewer: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          problem_id: string
          problem_version_id: string
          reviewed_at?: string | null
          reviewer?: string | null
          status: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          problem_id?: string
          problem_version_id?: string
          reviewed_at?: string | null
          reviewer?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      school_exam_profiles: {
        Row: {
          created_at: string
          exam_kind: string | null
          exam_year: number | null
          extra: Json
          grade: string | null
          id: string
          school_name: string | null
          source_document_id: string
          subject: string | null
          term: string | null
        }
        Insert: {
          created_at?: string
          exam_kind?: string | null
          exam_year?: number | null
          extra?: Json
          grade?: string | null
          id?: string
          school_name?: string | null
          source_document_id: string
          subject?: string | null
          term?: string | null
        }
        Update: {
          created_at?: string
          exam_kind?: string | null
          exam_year?: number | null
          extra?: Json
          grade?: string | null
          id?: string
          school_name?: string | null
          source_document_id?: string
          subject?: string | null
          term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_exam_profiles_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: true
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          archived_at: string | null
          author: string | null
          copyright_note: string | null
          created_at: string
          document_type: string
          edition: string | null
          file_hash: string | null
          id: string
          license_status: string
          original_filename: string | null
          page_count: number | null
          publication_year: number | null
          publisher: string | null
          source_type: string | null
          title: string
          updated_at: string
          usage_scope: string | null
        }
        Insert: {
          archived_at?: string | null
          author?: string | null
          copyright_note?: string | null
          created_at?: string
          document_type: string
          edition?: string | null
          file_hash?: string | null
          id?: string
          license_status?: string
          original_filename?: string | null
          page_count?: number | null
          publication_year?: number | null
          publisher?: string | null
          source_type?: string | null
          title: string
          updated_at?: string
          usage_scope?: string | null
        }
        Update: {
          archived_at?: string | null
          author?: string | null
          copyright_note?: string | null
          created_at?: string
          document_type?: string
          edition?: string | null
          file_hash?: string | null
          id?: string
          license_status?: string
          original_filename?: string | null
          page_count?: number | null
          publication_year?: number | null
          publisher?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string
          usage_scope?: string | null
        }
        Relationships: []
      }
      source_pages: {
        Row: {
          archived_at: string | null
          created_at: string
          extraction_status: string
          id: string
          page_image_path: string | null
          page_number: number
          review_status: string
          source_document_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          extraction_status?: string
          id?: string
          page_image_path?: string | null
          page_number: number
          review_status?: string
          source_document_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          extraction_status?: string
          id?: string
          page_image_path?: string | null
          page_number?: number
          review_status?: string
          source_document_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_pages_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_template_steps: {
        Row: {
          created_at: string
          id: string
          label: string
          step_no: number
          strategy_template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          step_no: number
          strategy_template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          step_no?: number
          strategy_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_template_steps_strategy_template_id_fkey"
            columns: ["strategy_template_id"]
            isOneToOne: false
            referencedRelation: "strategy_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_templates: {
        Row: {
          active: boolean
          archived_at: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      target_terms: {
        Row: {
          active: boolean
          approval_status: string
          archived_at: string | null
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approval_status?: string
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approval_status?: string
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      taxonomy_candidates: {
        Row: {
          candidate_kind: string
          created_at: string
          id: string
          proposed_code: string
          proposed_name: string
          source_note: string | null
          status: string
        }
        Insert: {
          candidate_kind: string
          created_at?: string
          id?: string
          proposed_code: string
          proposed_name: string
          source_note?: string | null
          status?: string
        }
        Update: {
          candidate_kind?: string
          created_at?: string
          id?: string
          proposed_code?: string
          proposed_name?: string
          source_note?: string | null
          status?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      verified_problem_relations: {
        Row: {
          algorithm_version: string | null
          component_scores: Json | null
          created_at: string
          id: string
          problem_a_id: string
          problem_b_id: string
          relation_level: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          algorithm_version?: string | null
          component_scores?: Json | null
          created_at?: string
          id?: string
          problem_a_id: string
          problem_b_id: string
          relation_level: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          algorithm_version?: string | null
          component_scores?: Json | null
          created_at?: string
          id?: string
          problem_a_id?: string
          problem_b_id?: string
          relation_level?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verified_problem_relations_problem_a_id_fkey"
            columns: ["problem_a_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_problem_relations_problem_b_id_fkey"
            columns: ["problem_b_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
        ]
      }
      worksheet_items: {
        Row: {
          created_at: string
          id: string
          order_no: number
          problem_id: string
          problem_version_id: string
          worksheet_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_no: number
          problem_id: string
          problem_version_id: string
          worksheet_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_no?: number
          problem_id?: string
          problem_version_id?: string
          worksheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worksheet_items_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worksheet_items_problem_version_id_fkey"
            columns: ["problem_version_id"]
            isOneToOne: false
            referencedRelation: "problem_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worksheet_items_worksheet_id_fkey"
            columns: ["worksheet_id"]
            isOneToOne: false
            referencedRelation: "worksheets"
            referencedColumns: ["id"]
          },
        ]
      }
      worksheets: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          purpose: string | null
          title: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          purpose?: string | null
          title: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          purpose?: string | null
          title?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hqb_assert_verify_gate: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      hqb_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_entity_type: string
        }
        Returns: undefined
      }
      hqb_bootstrap_admin: { Args: never; Returns: Json }
      hqb_can_review: { Args: never; Returns: boolean }
      hqb_can_write_draft: { Args: never; Returns: boolean }
      hqb_clone_problem_version: {
        Args: {
          p_change_reason?: string
          p_content_overrides?: Json
          p_problem_id: string
        }
        Returns: Json
      }
      hqb_create_problem_draft: { Args: { payload: Json }; Returns: Json }
      hqb_current_role: { Args: never; Returns: string }
      hqb_ensure_source: {
        Args: { p_source: Json }
        Returns: {
          source_document_id: string
          source_page_id: string
        }[]
      }
      hqb_fetch_problem_bundle: {
        Args: { p_public_code: string }
        Returns: Json
      }
      hqb_format_public_code: { Args: { n: number }; Returns: string }
      hqb_has_admin: { Args: never; Returns: boolean }
      hqb_is_staff: { Args: never; Returns: boolean }
      hqb_my_profile: { Args: never; Returns: Json }
      hqb_reject_problem_version: {
        Args: { p_note: string; p_version_id: string }
        Returns: Json
      }
      hqb_replace_version_graph: {
        Args: { p_payload: Json; p_version_id: string }
        Returns: undefined
      }
      hqb_require_reviewer: { Args: never; Returns: string }
      hqb_require_staff_writer: { Args: never; Returns: string }
      hqb_submit_for_review: {
        Args: { p_note?: string; p_version_id: string }
        Returns: Json
      }
      hqb_update_draft_version: {
        Args: { p_version_id: string; payload: Json }
        Returns: Json
      }
      hqb_verify_problem_version: {
        Args: { p_note?: string; p_version_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
