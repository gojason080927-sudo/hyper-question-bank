import { defaultHumanDifficulty, type DifficultyDims } from './difficulty'

export type ExpressionDraft = {
  original_expression: string
  latex_expression: string
  normalized_expression: string
  structure_skeleton: string
  expression_role: string
}

export type ChoiceDraft = {
  label: string
  choice_text: string
  math_expression: string
}

export type ConceptPick = {
  concept_id: string
  is_primary: boolean
}

export type ProblemFormState = {
  sourceMode: 'existing' | 'new'
  sourceDocumentId: string
  sourceTitle: string
  documentType: string
  publisher: string
  publicationYear: string
  licenseStatus: string
  usageScope: string
  pageNumber: string
  originalProblemNumber: string
  sourceTypeLabel: string
  instruction: string
  problemText: string
  normalizedText: string
  normalizedManual: boolean
  itemFormat: 'SHORT_ANSWER' | 'MULTIPLE_CHOICE'
  expressions: ExpressionDraft[]
  choices: ChoiceDraft[]
  answerType: string
  answerText: string
  numericValue: string
  explanation: string
  curriculumNodeId: string
  concepts: ConceptPick[]
  typeId: string
  strategyId: string
  conditionIds: string[]
  targetIds: string[]
  reasoningIds: string[]
  difficulty: DifficultyDims
}

export function emptyForm(): ProblemFormState {
  return {
    sourceMode: 'new',
    sourceDocumentId: '',
    sourceTitle: '',
    documentType: 'TEACHER_CREATED',
    publisher: 'HYPER',
    publicationYear: String(new Date().getFullYear()),
    licenseStatus: 'OWNED',
    usageScope: 'INTERNAL',
    pageNumber: '1',
    originalProblemNumber: '',
    sourceTypeLabel: '',
    instruction: '',
    problemText: '',
    normalizedText: '',
    normalizedManual: false,
    itemFormat: 'SHORT_ANSWER',
    expressions: [
      {
        original_expression: '',
        latex_expression: '',
        normalized_expression: '',
        structure_skeleton: '',
        expression_role: 'TARGET',
      },
    ],
    choices: [
      { label: '①', choice_text: '', math_expression: '' },
      { label: '②', choice_text: '', math_expression: '' },
      { label: '③', choice_text: '', math_expression: '' },
      { label: '④', choice_text: '', math_expression: '' },
    ],
    answerType: 'NUMBER',
    answerText: '',
    numericValue: '',
    explanation: '',
    curriculumNodeId: '',
    concepts: [],
    typeId: '',
    strategyId: '',
    conditionIds: [],
    targetIds: [],
    reasoningIds: [],
    difficulty: defaultHumanDifficulty(),
  }
}

export function buildPayload(state: ProblemFormState) {
  const source =
    state.sourceMode === 'existing' && state.sourceDocumentId
      ? {
          source_document_id: state.sourceDocumentId,
          page_number: Number(state.pageNumber) || 1,
          original_problem_number: state.originalProblemNumber,
          source_type_label: state.sourceTypeLabel,
        }
      : {
          new_document: {
            title: state.sourceTitle,
            document_type: state.documentType,
            publisher: state.publisher,
            publication_year: state.publicationYear ? Number(state.publicationYear) : null,
            license_status: state.licenseStatus || 'UNKNOWN',
            usage_scope: state.usageScope,
          },
          page_number: Number(state.pageNumber) || 1,
          original_problem_number: state.originalProblemNumber,
          source_type_label: state.sourceTypeLabel,
        }

  const choices =
    state.itemFormat === 'MULTIPLE_CHOICE'
      ? state.choices
          .filter((choice) => choice.choice_text.trim())
          .map((choice, index) => ({
            choice_order: index + 1,
            label: choice.label || String(index + 1),
            choice_text: choice.choice_text,
            math_expression: choice.math_expression,
          }))
      : []

  const numeric = state.numericValue.trim()
  return {
    source,
    version: {
      instruction: state.instruction,
      problem_text: state.problemText,
      normalized_text: state.normalizedText || state.problemText,
      item_format: state.itemFormat,
      origin: 'TEACHER_EDIT',
    },
    choices,
    answer: {
      answer_type: state.answerType,
      answer_text: state.answerText,
      normalized_answer: state.answerText,
      numeric_value: numeric === '' ? null : numeric,
    },
    explanation: state.explanation.trim()
      ? { explanation_type: 'TEACHER', content: state.explanation }
      : null,
    expressions: state.expressions
      .filter((row) => row.original_expression.trim())
      .map((row, index) => ({
        ...row,
        sort_order: index + 1,
        structure_tags: [],
      })),
    curriculum_node_ids: state.curriculumNodeId ? [state.curriculumNodeId] : [],
    concepts: state.concepts,
    type_ids: state.typeId ? [state.typeId] : [],
    strategy_ids: state.strategyId ? [state.strategyId] : [],
    condition_ids: state.conditionIds,
    target_ids: state.targetIds,
    reasoning_ids: state.reasoningIds,
    difficulty: state.difficulty,
  }
}
