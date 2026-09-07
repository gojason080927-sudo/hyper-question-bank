import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database.types'
import { emptyForm, type ProblemFormState } from '../../lib/workflow/formState'
import { defaultHumanDifficulty } from '../../lib/workflow/difficulty'

type Client = SupabaseClient<Database>

export async function loadFormFromVersion(
  client: Client,
  problemId: string,
  versionId: string,
): Promise<ProblemFormState> {
  const form = emptyForm()
  const [
    version,
    sources,
    curriculum,
    concepts,
    types,
    strategies,
    expressions,
    conditions,
    targets,
    reasoning,
    difficulty,
    answers,
    explanations,
    choices,
  ] = await Promise.all([
    client.from('problem_versions').select('*').eq('id', versionId).single(),
    client.from('problem_sources').select('*, source_documents(*)').eq('problem_id', problemId),
    client.from('problem_curriculum').select('curriculum_node_id').eq('problem_version_id', versionId),
    client.from('problem_concepts').select('concept_id,is_primary').eq('problem_version_id', versionId),
    client.from('problem_type_assignments').select('hyper_problem_type_id').eq('problem_version_id', versionId),
    client.from('problem_strategy_assignments').select('strategy_template_id').eq('problem_version_id', versionId),
    client.from('math_expressions').select('*').eq('problem_version_id', versionId).order('sort_order'),
    client.from('problem_conditions').select('condition_term_id').eq('problem_version_id', versionId),
    client.from('problem_targets').select('target_term_id').eq('problem_version_id', versionId),
    client.from('problem_reasoning').select('reasoning_term_id').eq('problem_version_id', versionId),
    client
      .from('problem_difficulty')
      .select('*')
      .eq('problem_version_id', versionId)
      .eq('difficulty_source', 'HUMAN')
      .maybeSingle(),
    client.from('problem_answers').select('*').eq('problem_version_id', versionId),
    client.from('problem_explanations').select('*').eq('problem_version_id', versionId),
    client.from('problem_choices').select('*').eq('problem_version_id', versionId).order('choice_order'),
  ])

  const src = sources.data?.[0]
  const doc = src?.source_documents as
    | { id: string; title: string; license_status: string; document_type: string; publisher: string | null; publication_year: number | null }
    | null
  if (doc) {
    form.sourceMode = 'existing'
    form.sourceDocumentId = doc.id
    form.sourceTitle = doc.title
    form.licenseStatus = doc.license_status
    form.documentType = doc.document_type
    form.publisher = doc.publisher ?? ''
    form.publicationYear = doc.publication_year ? String(doc.publication_year) : ''
  }
  form.originalProblemNumber = src?.original_problem_number ?? ''
  form.sourceTypeLabel = src?.source_type_label ?? ''
  form.instruction = version.data?.instruction ?? ''
  form.problemText = version.data?.problem_text ?? ''
  form.normalizedText = version.data?.normalized_text ?? form.problemText
  form.itemFormat = version.data?.item_format === 'MULTIPLE_CHOICE' ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER'
  form.curriculumNodeId = curriculum.data?.[0]?.curriculum_node_id ?? ''
  form.concepts = (concepts.data ?? []).map((row) => ({ concept_id: row.concept_id, is_primary: row.is_primary }))
  form.typeId = types.data?.[0]?.hyper_problem_type_id ?? ''
  form.strategyId = strategies.data?.[0]?.strategy_template_id ?? ''
  if (expressions.data?.length) {
    form.expressions = expressions.data.map((row) => ({
      original_expression: row.original_expression,
      latex_expression: row.latex_expression ?? '',
      normalized_expression: row.normalized_expression ?? '',
      structure_skeleton: row.structure_skeleton ?? '',
      expression_role: row.expression_role,
    }))
  }
  form.conditionIds = (conditions.data ?? []).map((row) => row.condition_term_id)
  form.targetIds = (targets.data ?? []).map((row) => row.target_term_id)
  form.reasoningIds = (reasoning.data ?? []).map((row) => row.reasoning_term_id)
  if (difficulty.data) {
    form.difficulty = {
      concept_difficulty: difficulty.data.concept_difficulty,
      calculation_complexity: difficulty.data.calculation_complexity,
      reasoning_depth: difficulty.data.reasoning_depth,
      condition_complexity: difficulty.data.condition_complexity,
      representation_complexity: difficulty.data.representation_complexity,
      trap_level: difficulty.data.trap_level,
    }
  } else {
    form.difficulty = defaultHumanDifficulty()
  }
  const answer = answers.data?.[0]
  if (answer) {
    form.answerType = answer.answer_type
    form.answerText = answer.answer_text ?? ''
    form.numericValue = answer.numeric_value == null ? '' : String(answer.numeric_value)
  }
  form.explanation = explanations.data?.[0]?.content ?? ''
  if (choices.data?.length) {
    form.choices = choices.data.map((row) => ({
      label: row.label,
      choice_text: row.choice_text,
      math_expression: row.math_expression ?? '',
    }))
  }
  return form
}
