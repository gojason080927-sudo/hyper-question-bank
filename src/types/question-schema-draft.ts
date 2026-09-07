/**
 * DESIGN DRAFT — NOT DATABASE CONTRACT
 *
 * HYPER QUESTION BANK STEP 2 schema sketch.
 * This file is for design validation only.
 * It is not a production database schema, not a migration, and not an API contract.
 */

export type Uuid = string

export const DocumentType = {
  TEXTBOOK: 'TEXTBOOK',
  WORKBOOK: 'WORKBOOK',
  MOCK_EXAM: 'MOCK_EXAM',
  SCHOOL_EXAM: 'SCHOOL_EXAM',
  PUBLIC_RESOURCE: 'PUBLIC_RESOURCE',
  TEACHER_CREATED: 'TEACHER_CREATED',
  OTHER: 'OTHER',
} as const
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType]

export const LicenseStatus = {
  PUBLIC: 'PUBLIC',
  LICENSED: 'LICENSED',
  OWNED: 'OWNED',
  PERMISSION_GRANTED: 'PERMISSION_GRANTED',
  RESTRICTED: 'RESTRICTED',
  UNKNOWN: 'UNKNOWN',
} as const
export type LicenseStatus = (typeof LicenseStatus)[keyof typeof LicenseStatus]

export const ItemFormat = {
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  SHORT_ANSWER: 'SHORT_ANSWER',
  CONSTRUCTED_RESPONSE: 'CONSTRUCTED_RESPONSE',
  MIXED: 'MIXED',
} as const
export type ItemFormat = (typeof ItemFormat)[keyof typeof ItemFormat]

export const ExpressionRole = {
  GIVEN: 'GIVEN',
  CONDITION: 'CONDITION',
  TARGET: 'TARGET',
  CHOICE: 'CHOICE',
  INTERMEDIATE: 'INTERMEDIATE',
} as const
export type ExpressionRole = (typeof ExpressionRole)[keyof typeof ExpressionRole]

export const ReviewStatus = {
  UNREVIEWED: 'UNREVIEWED',
  AUTO_CLASSIFIED: 'AUTO_CLASSIFIED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus]

export const AnswerType = {
  CHOICE_LABEL: 'CHOICE_LABEL',
  NUMBER: 'NUMBER',
  EXPRESSION: 'EXPRESSION',
  INTERVAL: 'INTERVAL',
  SET: 'SET',
  TEXT: 'TEXT',
  MULTI: 'MULTI',
} as const
export type AnswerType = (typeof AnswerType)[keyof typeof AnswerType]

export const DifficultySource = {
  HUMAN_ASSIGNED: 'HUMAN_ASSIGNED',
  MODEL_ESTIMATED: 'MODEL_ESTIMATED',
  CALIBRATED: 'CALIBRATED',
} as const
export type DifficultySource = (typeof DifficultySource)[keyof typeof DifficultySource]

export const VersionOrigin = {
  OCR: 'OCR',
  AUTO_CLEAN: 'AUTO_CLEAN',
  TEACHER_EDIT: 'TEACHER_EDIT',
  IMPORT: 'IMPORT',
} as const
export type VersionOrigin = (typeof VersionOrigin)[keyof typeof VersionOrigin]

export const CurriculumNodeKind = {
  SCHOOL_LEVEL: 'SCHOOL_LEVEL',
  GRADE: 'GRADE',
  SEMESTER: 'SEMESTER',
  SUBJECT: 'SUBJECT',
  UNIT: 'UNIT',
} as const
export type CurriculumNodeKind = (typeof CurriculumNodeKind)[keyof typeof CurriculumNodeKind]

export const RepresentationKind = {
  TEXT_ONLY: 'TEXT_ONLY',
  EQUATION: 'EQUATION',
  TABLE: 'TABLE',
  GRAPH: 'GRAPH',
  GEOMETRY_FIGURE: 'GEOMETRY_FIGURE',
  DIAGRAM: 'DIAGRAM',
  MIXED: 'MIXED',
} as const
export type RepresentationKind = (typeof RepresentationKind)[keyof typeof RepresentationKind]

export const DuplicateClass = {
  EXACT: 'EXACT',
  NEAR: 'NEAR',
  SAME_UNDERLYING: 'SAME_UNDERLYING',
  INDEPENDENTLY_SIMILAR: 'INDEPENDENTLY_SIMILAR',
} as const
export type DuplicateClass = (typeof DuplicateClass)[keyof typeof DuplicateClass]

export type BoundingBox = {
  x: number
  y: number
  w: number
  h: number
  unit: 'px' | 'pct' | 'pt'
}

export type SourceDocument = {
  id: Uuid
  title: string
  publisher: string | null
  author: string | null
  year: number | null
  edition: string | null
  documentType: DocumentType
  sourceType: string | null
  originalFilename: string | null
  fileHash: string | null
  pageCount: number | null
  licenseStatus: LicenseStatus
  usageScope: string | null
  copyrightNote: string | null
  createdAt: string
}

export type SchoolExamProfile = {
  id: Uuid
  sourceDocumentId: Uuid
  schoolName: string | null
  examYear: number | null
  grade: string | null
  term: string | null
  examKind: 'MIDTERM' | 'FINAL' | 'OTHER' | null
  subject: string | null
  extra?: Record<string, string>
}

export type SourcePage = {
  id: Uuid
  sourceDocumentId: Uuid
  pageNumber: number
  pageImagePath: string | null
  extractionStatus: string
  reviewStatus: ReviewStatus
}

export type Problem = {
  id: Uuid
  publicCode: string
  currentVersionId: Uuid | null
  lifecycleStatus: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  useStatus: 'INTERNAL_ONLY' | 'REVIEW_ONLY' | 'WORKSHEET_ELIGIBLE' | 'BLOCKED'
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type ProblemVersion = {
  id: Uuid
  problemId: Uuid
  versionNo: number
  origin: VersionOrigin
  problemText: string
  normalizedText: string
  instruction: string | null
  itemFormat: ItemFormat
  choiceCount: number
  extractionStatus: string
  classificationStatus: string
  reviewStatus: ReviewStatus
  createdAt: string
}

export type ProblemSource = {
  problemId: Uuid
  sourceDocumentId: Uuid
  sourcePageId: Uuid | null
  originalProblemNumber: string | null
  region: BoundingBox | null
  isPrimary: boolean
}

export type ProblemChoice = {
  versionId: Uuid
  sortOrder: number
  label: string
  choiceText: string
  latex: string | null
  assetId: Uuid | null
  normalizedText: string
}

export type ProblemAnswer = {
  versionId: Uuid
  answerType: AnswerType
  choiceLabel: string | null
  numericValue: number | null
  expression: string | null
  textValue: string | null
}

export type ProblemExplanation = {
  versionId: Uuid
  kind: 'ORIGINAL' | 'NORMALIZED' | 'TEACHER'
  text: string
}

export type MathExpression = {
  versionId: Uuid
  originalExpression: string
  normalizedExpression: string
  latex: string
  role: ExpressionRole
  structureTags: string[]
  skeleton: string
}

export type CurriculumNode = {
  id: Uuid
  frameworkId: Uuid
  parentId: Uuid | null
  nodeKind: CurriculumNodeKind
  code: string
  name: string
  depth: number
}

export type ProblemConceptLink = {
  versionId: Uuid
  conceptId: Uuid
  conceptName: string
  isPrimary: boolean
  weight: number
  applicationRole: 'SOLVE_WITH' | 'PREREQUISITE' | 'DISTRACTOR_CONCEPT'
}

export type ProblemTypeLink = {
  versionId: Uuid
  hyperTypeId: Uuid
  hyperTypePath: string[]
  sourceTypeLabel: string | null
  isPrimary: boolean
}

export type StrategyStep = {
  sortOrder: number
  taxStrategyStepId: string
  label: string
}

export type SolutionStrategy = {
  versionId: Uuid
  taxStrategyId: string
  isPrimary: boolean
  steps: StrategyStep[]
}

export type DifficultyAssessment = {
  versionId: Uuid
  source: DifficultySource
  conceptDifficulty: 1 | 2 | 3 | 4 | 5
  calculationComplexity: 1 | 2 | 3 | 4 | 5
  reasoningDepth: 1 | 2 | 3 | 4 | 5
  conditionComplexity: 1 | 2 | 3 | 4 | 5
  representationComplexity: 1 | 2 | 3 | 4 | 5
  trapLevel: 1 | 2 | 3 | 4 | 5
  overallDifficulty: 1 | 2 | 3 | 4 | 5
}

export type ProblemEmbedding = {
  problemId: Uuid
  embeddingType: 'PROBLEM_TEXT' | 'NORMALIZED_TEXT' | 'STRUCTURE_HINT'
  model: string
  modelVersion: string
  vector: number[]
  createdAt: string
}

export type SimilarityComponents = {
  curriculum: number
  concept: number
  problemType: number
  solutionStrategy: number
  expressionStructure: number
  condition: number
  target: number
  reasoning: number
  difficulty: number
  representation: number
  semantic: number
}

export type StructuredProblemDraft = {
  problem: Problem
  version: ProblemVersion
  sources: ProblemSource[]
  choices: ProblemChoice[]
  answer: ProblemAnswer
  explanations: ProblemExplanation[]
  expressions: MathExpression[]
  curriculumPath: string[]
  concepts: ProblemConceptLink[]
  types: ProblemTypeLink[]
  strategy: SolutionStrategy
  conditions: string[]
  targets: string[]
  reasoning: string[]
  representations: RepresentationKind[]
  difficulty: DifficultyAssessment
}

const now = '2026-09-07T00:00:00.000Z'
const teacherDocId = '00000000-0000-4000-8000-000000000001'
const pageId = '00000000-0000-4000-8000-000000000002'

function baseSource(problemId: Uuid, number: string): ProblemSource {
  return {
    problemId,
    sourceDocumentId: teacherDocId,
    sourcePageId: pageId,
    originalProblemNumber: number,
    region: null,
    isPrimary: true,
  }
}

/** Sample A: 단순 일차방정식 */
export const SAMPLE_LINEAR_EQUATION: StructuredProblemDraft = {
  problem: {
    id: '11111111-1111-4111-8111-111111111111',
    publicCode: 'HQB-000001',
    currentVersionId: '11111111-1111-4111-8111-111111111112',
    lifecycleStatus: 'ACTIVE',
    useStatus: 'INTERNAL_ONLY',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  version: {
    id: '11111111-1111-4111-8111-111111111112',
    problemId: '11111111-1111-4111-8111-111111111111',
    versionNo: 1,
    origin: 'TEACHER_EDIT',
    problemText: '다음 방정식을 푸시오. 3x + 7 = 22',
    normalizedText: '3x + 7 = 22 를 풀어 x를 구한다',
    instruction: '다음 방정식을 푸시오.',
    itemFormat: 'SHORT_ANSWER',
    choiceCount: 0,
    extractionStatus: 'MANUAL',
    classificationStatus: 'DRAFT',
    reviewStatus: 'UNREVIEWED',
    createdAt: now,
  },
  sources: [baseSource('11111111-1111-4111-8111-111111111111', 'A')],
  choices: [],
  answer: {
    versionId: '11111111-1111-4111-8111-111111111112',
    answerType: 'NUMBER',
    choiceLabel: null,
    numericValue: 5,
    expression: 'x=5',
    textValue: null,
  },
  explanations: [
    {
      versionId: '11111111-1111-4111-8111-111111111112',
      kind: 'TEACHER',
      text: '7을 이항하면 3x = 15, 양변을 3으로 나누면 x = 5.',
    },
  ],
  expressions: [
    {
      versionId: '11111111-1111-4111-8111-111111111112',
      originalExpression: '3x + 7 = 22',
      normalizedExpression: '3x+7=22',
      latex: '3x+7=22',
      role: 'TARGET',
      structureTags: ['linear', 'one_variable'],
      skeleton: 'ax+b=c',
    },
  ],
  curriculumPath: ['2022개정', '중학교', '중1', '1학기', '수학', '문자와 식', '일차방정식'],
  concepts: [
    {
      versionId: '11111111-1111-4111-8111-111111111112',
      conceptId: 'c-linear-solve',
      conceptName: '일차방정식의 풀이',
      isPrimary: true,
      weight: 1,
      applicationRole: 'SOLVE_WITH',
    },
  ],
  types: [
    {
      versionId: '11111111-1111-4111-8111-111111111112',
      hyperTypeId: 't-linear-direct',
      hyperTypePath: ['일차방정식', '직접 풀이'],
      sourceTypeLabel: null,
      isPrimary: true,
    },
  ],
  strategy: {
    versionId: '11111111-1111-4111-8111-111111111112',
    taxStrategyId: 'linear-isolate-divide',
    isPrimary: true,
    steps: [
      { sortOrder: 1, taxStrategyStepId: 'transpose-constant', label: '상수항 이항' },
      { sortOrder: 2, taxStrategyStepId: 'divide-coefficient', label: '계수로 나눔' },
      { sortOrder: 3, taxStrategyStepId: 'read-solution', label: '해 확인' },
    ],
  },
  conditions: [],
  targets: ['EQUATION_ROOT'],
  reasoning: ['DIRECT_RECALL', 'TRANSFORMATION'],
  representations: ['TEXT_ONLY', 'EQUATION'],
  difficulty: {
    versionId: '11111111-1111-4111-8111-111111111112',
    source: 'HUMAN_ASSIGNED',
    conceptDifficulty: 1,
    calculationComplexity: 1,
    reasoningDepth: 1,
    conditionComplexity: 1,
    representationComplexity: 1,
    trapLevel: 1,
    overallDifficulty: 1,
  },
}

/** Sample B: 인수분해 가능한 이차방정식 */
export const SAMPLE_FACTORABLE_QUADRATIC: StructuredProblemDraft = {
  problem: {
    id: '22222222-2222-4222-8222-222222222221',
    publicCode: 'HQB-000002',
    currentVersionId: '22222222-2222-4222-8222-222222222222',
    lifecycleStatus: 'ACTIVE',
    useStatus: 'INTERNAL_ONLY',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  version: {
    id: '22222222-2222-4222-8222-222222222222',
    problemId: '22222222-2222-4222-8222-222222222221',
    versionNo: 1,
    origin: 'TEACHER_EDIT',
    problemText: '다음 이차방정식의 해를 구하시오. x^2 - 5x + 6 = 0',
    normalizedText: 'x^2 - 5x + 6 = 0 의 해를 구한다',
    instruction: '다음 이차방정식의 해를 구하시오.',
    itemFormat: 'SHORT_ANSWER',
    choiceCount: 0,
    extractionStatus: 'MANUAL',
    classificationStatus: 'DRAFT',
    reviewStatus: 'UNREVIEWED',
    createdAt: now,
  },
  sources: [baseSource('22222222-2222-4222-8222-222222222221', 'B')],
  choices: [],
  answer: {
    versionId: '22222222-2222-4222-8222-222222222222',
    answerType: 'SET',
    choiceLabel: null,
    numericValue: null,
    expression: 'x=2, x=3',
    textValue: '{2, 3}',
  },
  explanations: [
    {
      versionId: '22222222-2222-4222-8222-222222222222',
      kind: 'TEACHER',
      text: '(x-2)(x-3)=0 이므로 x=2 또는 x=3.',
    },
  ],
  expressions: [
    {
      versionId: '22222222-2222-4222-8222-222222222222',
      originalExpression: 'x^2 - 5x + 6 = 0',
      normalizedExpression: 'x^2-5x+6=0',
      latex: 'x^{2}-5x+6=0',
      role: 'TARGET',
      structureTags: ['quadratic', 'factorable', 'two_integer_roots'],
      skeleton: 'x^2+px+q=0',
    },
  ],
  curriculumPath: ['2022개정', '중학교', '중3', '1학기', '수학', '문자와 식', '다항식', '곱셈공식의 활용'],
  concepts: [
    {
      versionId: '22222222-2222-4222-8222-222222222222',
      conceptId: 'c-quad-factor',
      conceptName: '인수분해를 이용한 이차방정식 풀이',
      isPrimary: true,
      weight: 0.7,
      applicationRole: 'SOLVE_WITH',
    },
    {
      versionId: '22222222-2222-4222-8222-222222222222',
      conceptId: 'c-mult-formula',
      conceptName: '곱셈공식',
      isPrimary: false,
      weight: 0.2,
      applicationRole: 'PREREQUISITE',
    },
    {
      versionId: '22222222-2222-4222-8222-222222222222',
      conceptId: 'c-root-property',
      conceptName: '근의 성질',
      isPrimary: false,
      weight: 0.1,
      applicationRole: 'SOLVE_WITH',
    },
  ],
  types: [
    {
      versionId: '22222222-2222-4222-8222-222222222222',
      hyperTypeId: 't-quad-factor',
      hyperTypePath: ['이차방정식', '인수분해 활용'],
      sourceTypeLabel: null,
      isPrimary: true,
    },
  ],
  strategy: {
    versionId: '22222222-2222-4222-8222-222222222222',
    taxStrategyId: 'quadratic-factor-zero-product',
    isPrimary: true,
    steps: [
      { sortOrder: 1, taxStrategyStepId: 'write-standard-form', label: '식을 표준형으로 정리' },
      { sortOrder: 2, taxStrategyStepId: 'test-factorable', label: '인수분해 가능 여부 판단' },
      { sortOrder: 3, taxStrategyStepId: 'factor', label: '인수분해' },
      { sortOrder: 4, taxStrategyStepId: 'zero-product', label: '각 인수를 0으로 놓음' },
      { sortOrder: 5, taxStrategyStepId: 'compute-roots', label: '해 계산' },
    ],
  },
  conditions: [],
  targets: ['EQUATION_ROOT'],
  reasoning: ['TRANSFORMATION', 'MULTI_STEP'],
  representations: ['TEXT_ONLY', 'EQUATION'],
  difficulty: {
    versionId: '22222222-2222-4222-8222-222222222222',
    source: 'HUMAN_ASSIGNED',
    conceptDifficulty: 2,
    calculationComplexity: 2,
    reasoningDepth: 2,
    conditionComplexity: 1,
    representationComplexity: 1,
    trapLevel: 1,
    overallDifficulty: 2,
  },
}

/** Twin of B: 표면(변수/계수)만 다른 동일 구조 */
export const SAMPLE_FACTORABLE_QUADRATIC_TWIN: StructuredProblemDraft = {
  ...SAMPLE_FACTORABLE_QUADRATIC,
  problem: {
    ...SAMPLE_FACTORABLE_QUADRATIC.problem,
    id: '22222222-2222-4222-8222-222222222231',
    publicCode: 'HQB-000004',
    currentVersionId: '22222222-2222-4222-8222-222222222232',
  },
  version: {
    ...SAMPLE_FACTORABLE_QUADRATIC.version,
    id: '22222222-2222-4222-8222-222222222232',
    problemId: '22222222-2222-4222-8222-222222222231',
    problemText: '다음 이차방정식의 해를 구하시오. y^2 - 7y + 12 = 0',
    normalizedText: 'y^2 - 7y + 12 = 0 의 해를 구한다',
  },
  sources: [baseSource('22222222-2222-4222-8222-222222222231', 'B2')],
  answer: {
    versionId: '22222222-2222-4222-8222-222222222232',
    answerType: 'SET',
    choiceLabel: null,
    numericValue: null,
    expression: 'y=3, y=4',
    textValue: '{3, 4}',
  },
  expressions: [
    {
      versionId: '22222222-2222-4222-8222-222222222232',
      originalExpression: 'y^2 - 7y + 12 = 0',
      normalizedExpression: 'y^2-7y+12=0',
      latex: 'y^{2}-7y+12=0',
      role: 'TARGET',
      structureTags: ['quadratic', 'factorable', 'two_integer_roots'],
      skeleton: 'x^2+px+q=0',
    },
  ],
  strategy: {
    ...SAMPLE_FACTORABLE_QUADRATIC.strategy,
    versionId: '22222222-2222-4222-8222-222222222232',
  },
}

/** Sample C: 조건이 포함된 응용 문제 */
export const SAMPLE_CONSTRAINED_APPLICATION: StructuredProblemDraft = {
  problem: {
    id: '33333333-3333-4333-8333-333333333331',
    publicCode: 'HQB-000003',
    currentVersionId: '33333333-3333-4333-8333-333333333332',
    lifecycleStatus: 'ACTIVE',
    useStatus: 'INTERNAL_ONLY',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  version: {
    id: '33333333-3333-4333-8333-333333333332',
    problemId: '33333333-3333-4333-8333-333333333331',
    versionNo: 1,
    origin: 'TEACHER_EDIT',
    problemText: '서로 다른 두 자연수 a, b의 합이 10일 때, 곱 ab의 최댓값을 구하시오.',
    normalizedText: '서로 다른 자연수 a,b에 대해 a+b=10 일 때 ab의 최댓값을 구한다',
    instruction: '곱의 최댓값을 구하시오.',
    itemFormat: 'SHORT_ANSWER',
    choiceCount: 0,
    extractionStatus: 'MANUAL',
    classificationStatus: 'DRAFT',
    reviewStatus: 'UNREVIEWED',
    createdAt: now,
  },
  sources: [baseSource('33333333-3333-4333-8333-333333333331', 'C')],
  choices: [],
  answer: {
    versionId: '33333333-3333-4333-8333-333333333332',
    answerType: 'NUMBER',
    choiceLabel: null,
    numericValue: 24,
    expression: null,
    textValue: null,
  },
  explanations: [
    {
      versionId: '33333333-3333-4333-8333-333333333332',
      kind: 'TEACHER',
      text: 'b=10-a, ab=a(10-a). 서로 다른 자연수이므로 a=4,b=6 또는 a=6,b=4에서 곱 24.',
    },
  ],
  expressions: [
    {
      versionId: '33333333-3333-4333-8333-333333333332',
      originalExpression: 'a+b=10',
      normalizedExpression: 'a+b=10',
      latex: 'a+b=10',
      role: 'CONDITION',
      structureTags: ['linear-relation', 'two-variable'],
      skeleton: 'a+b=s',
    },
    {
      versionId: '33333333-3333-4333-8333-333333333332',
      originalExpression: 'ab',
      normalizedExpression: 'ab',
      latex: 'ab',
      role: 'TARGET',
      structureTags: ['product', 'max'],
      skeleton: 'ab',
    },
  ],
  curriculumPath: ['2022개정', '중학교', '중2', '수학', '문자와 식'],
  concepts: [
    {
      versionId: '33333333-3333-4333-8333-333333333332',
      conceptId: 'c-max-product',
      conceptName: '합이 일정할 때 곱의 최댓값',
      isPrimary: true,
      weight: 0.6,
      applicationRole: 'SOLVE_WITH',
    },
    {
      versionId: '33333333-3333-4333-8333-333333333332',
      conceptId: 'c-natural-distinct',
      conceptName: '자연수·서로 다름 조건',
      isPrimary: false,
      weight: 0.4,
      applicationRole: 'SOLVE_WITH',
    },
  ],
  types: [
    {
      versionId: '33333333-3333-4333-8333-333333333332',
      hyperTypeId: 't-applied-max-product',
      hyperTypePath: ['활용', '최댓값'],
      sourceTypeLabel: null,
      isPrimary: true,
    },
  ],
  strategy: {
    versionId: '33333333-3333-4333-8333-333333333332',
    taxStrategyId: 'substitute-then-maximize-discrete',
    isPrimary: true,
    steps: [
      { sortOrder: 1, taxStrategyStepId: 'encode-constraints', label: '조건을 식으로 표현' },
      { sortOrder: 2, taxStrategyStepId: 'reduce-one-variable', label: '한 변수로 치환' },
      { sortOrder: 3, taxStrategyStepId: 'search-feasible-values', label: '가능한 자연수 쌍 검토' },
      { sortOrder: 4, taxStrategyStepId: 'read-extremum', label: '최댓값 확인' },
    ],
  },
  conditions: ['NATURAL_NUMBER', 'DISTINCT', 'SUM_FIXED'],
  targets: ['MAXIMUM'],
  reasoning: ['MODELING', 'INFERENCE', 'CASE_ANALYSIS'],
  representations: ['TEXT_ONLY'],
  difficulty: {
    versionId: '33333333-3333-4333-8333-333333333332',
    source: 'HUMAN_ASSIGNED',
    conceptDifficulty: 3,
    calculationComplexity: 2,
    reasoningDepth: 3,
    conditionComplexity: 3,
    representationComplexity: 1,
    trapLevel: 2,
    overallDifficulty: 3,
  },
}

/** 반례: 이차라는 점만 같고 전략/목표가 다름 */
export const SAMPLE_QUADRATIC_NON_TWIN: StructuredProblemDraft = {
  problem: {
    id: '44444444-4444-4444-8444-444444444441',
    publicCode: 'HQB-000005',
    currentVersionId: '44444444-4444-4444-8444-444444444442',
    lifecycleStatus: 'ACTIVE',
    useStatus: 'INTERNAL_ONLY',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  version: {
    id: '44444444-4444-4444-8444-444444444442',
    problemId: '44444444-4444-4444-8444-444444444441',
    versionNo: 1,
    origin: 'TEACHER_EDIT',
    problemText: '이차함수 y = -x^2 + 4x + 5의 최댓값을 구하시오.',
    normalizedText: 'y=-x^2+4x+5 의 최댓값을 구한다',
    instruction: '최댓값을 구하시오.',
    itemFormat: 'SHORT_ANSWER',
    choiceCount: 0,
    extractionStatus: 'MANUAL',
    classificationStatus: 'DRAFT',
    reviewStatus: 'UNREVIEWED',
    createdAt: now,
  },
  sources: [baseSource('44444444-4444-4444-8444-444444444441', 'X')],
  choices: [],
  answer: {
    versionId: '44444444-4444-4444-8444-444444444442',
    answerType: 'NUMBER',
    choiceLabel: null,
    numericValue: 9,
    expression: null,
    textValue: null,
  },
  explanations: [
    {
      versionId: '44444444-4444-4444-8444-444444444442',
      kind: 'TEACHER',
      text: 'y=-(x-2)^2+9 이므로 최댓값 9.',
    },
  ],
  expressions: [
    {
      versionId: '44444444-4444-4444-8444-444444444442',
      originalExpression: 'y = -x^2 + 4x + 5',
      normalizedExpression: 'y=-x^2+4x+5',
      latex: 'y=-x^{2}+4x+5',
      role: 'GIVEN',
      structureTags: ['quadratic_function', 'downward'],
      skeleton: 'y=ax^2+bx+c',
    },
  ],
  curriculumPath: ['2022개정', '중학교', '중3', '수학', '함수', '이차함수'],
  concepts: [
    {
      versionId: '44444444-4444-4444-8444-444444444442',
      conceptId: 'c-quad-vertex',
      conceptName: '이차함수의 꼭짓점과 최댓값',
      isPrimary: true,
      weight: 1,
      applicationRole: 'SOLVE_WITH',
    },
  ],
  types: [
    {
      versionId: '44444444-4444-4444-8444-444444444442',
      hyperTypeId: 't-quadfn-max',
      hyperTypePath: ['이차함수', '최댓값'],
      sourceTypeLabel: null,
      isPrimary: true,
    },
  ],
  strategy: {
    versionId: '44444444-4444-4444-8444-444444444442',
    taxStrategyId: 'complete-square-read-vertex',
    isPrimary: true,
    steps: [
      { sortOrder: 1, taxStrategyStepId: 'complete-square', label: '완전제곱식으로 변형' },
      { sortOrder: 2, taxStrategyStepId: 'read-vertex', label: '꼭짓점의 y좌표를 읽음' },
    ],
  },
  conditions: [],
  targets: ['MAXIMUM'],
  reasoning: ['TRANSFORMATION', 'INTERPRETATION'],
  representations: ['EQUATION'],
  difficulty: {
    versionId: '44444444-4444-4444-8444-444444444442',
    source: 'HUMAN_ASSIGNED',
    conceptDifficulty: 3,
    calculationComplexity: 2,
    reasoningDepth: 2,
    conditionComplexity: 1,
    representationComplexity: 2,
    trapLevel: 1,
    overallDifficulty: 3,
  },
}

export const TWIN_PAIR_ANALYSIS = {
  pair: [SAMPLE_FACTORABLE_QUADRATIC, SAMPLE_FACTORABLE_QUADRATIC_TWIN],
  whyTwin: {
    concept: true,
    problemType: true,
    solutionStrategy: true,
    expressionSkeleton: 'x^2+px+q=0',
    target: 'EQUATION_ROOT',
    surfaceDifference: ['variable name', 'coefficients'],
  },
  nonTwin: SAMPLE_QUADRATIC_NON_TWIN,
  whyNotTwin: {
    sharedLooseLabel: '이차',
    targetMismatch: true,
    strategyMismatch: true,
    typeMismatch: true,
  },
} as const

/** Weights are examples only — not a contract. */
export const EXAMPLE_TWIN_WEIGHTS_NOT_FINAL: SimilarityComponents = {
  curriculum: 0,
  concept: 0.2,
  problemType: 0.15,
  solutionStrategy: 0.25,
  expressionStructure: 0.15,
  condition: 0.08,
  target: 0.07,
  reasoning: 0,
  difficulty: 0.05,
  representation: 0,
  semantic: 0.05,
}
