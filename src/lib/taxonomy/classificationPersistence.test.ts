import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProblemClassificationV1 } from './taxonomyClassifier'
import {
  STEP811_THRESHOLDS,
  classificationPayload,
  dictionaryPayload,
  isOverallAuto,
  loadOverallAuto,
  migrationIsAdditive,
  preflightAuto,
  splitBatches,
} from './classificationPersistence'

function autoRow(overrides: Partial<ProblemClassificationV1> = {}): ProblemClassificationV1 {
  return {
    problem_id: '11111111-1111-1111-1111-111111111111',
    page_number: 175,
    original_problem_number: '1201',
    subject_id: '공통수학1',
    unit_id: '행렬',
    unit_confidence: 0.97,
    subunit_id: '행렬과 그 연산',
    subunit_confidence: 0.9,
    type_id: 'MATRIX_ARITHMETIC',
    type_confidence: 0.94,
    subtype_id: null,
    subtype_confidence: 0,
    core_concepts: ['행렬의 꼴'],
    solution_strategy: ['꼴을 확인한다'],
    key_test_points: ['행렬 곱셈과 성분별 연산을 구별할 수 있는가'],
    difficulty_level: 1,
    difficulty_confidence: 0.8,
    difficulty_evidence: [],
    source_difficulty_label: null,
    classification_status: 'AUTO',
    review_reasons: [],
    source_heading: '행렬의 연산',
    source_heading_distance: 1,
    source_alias_match: '행렬의 연산',
    decisions: {
      unit: 'AUTO',
      subunit: 'AUTO',
      type: 'AUTO',
      subtype: 'REVIEW',
      key_point: 'AUTO',
      solution_strategy: 'AUTO',
      common_mistakes: 'AUTO',
      difficulty: 'AUTO',
      overall: 'AUTO',
    },
    stem_excerpt: '행렬 A,B에 대하여',
    evidence_insufficient: false,
    ...overrides,
  }
}

const problem = {
  id: '11111111-1111-1111-1111-111111111111',
  review_status: 'UNREVIEWED',
  current_version_id: '22222222-2222-2222-2222-222222222222',
}
const source = {
  source_document_id: '9ff369b4-5b16-4cb8-bfc3-a6b180c18703',
  page: 175,
  problem_number: '1201',
}
const profile = { unit_id: '행렬', subunit_id: '행렬과 그 연산', type_id: 'MATRIX_ARITHMETIC' }

describe('classification persistence preflight', () => {
  it('accepts overall AUTO when unit/type/key/strategy are AUTO and identities match', () => {
    const result = preflightAuto({
      row: autoRow(),
      problem,
      source,
      profile,
      expectedDocument: source.source_document_id,
    })
    expect(result.pass).toBe(true)
    expect(result.persist_subunit).toBe(true)
    expect(result.persist_difficulty).toBe(true)
    expect(isOverallAuto(autoRow())).toBe(true)
  })

  it('rejects REVIEW and does not treat coverage as a reason to persist', () => {
    const row = autoRow({
      classification_status: 'REVIEW',
      decisions: { ...autoRow().decisions, overall: 'REVIEW', type: 'REVIEW' },
    })
    const result = preflightAuto({
      row,
      problem,
      source,
      profile,
      expectedDocument: source.source_document_id,
    })
    expect(result.pass).toBe(false)
    expect(result.reasons).toContain('NOT_OVERALL_AUTO')
    expect(loadOverallAuto([row, autoRow()])).toHaveLength(1)
  })

  it('rejects invalid type/unit relation and keeps subtype optional', () => {
    const mismatch = preflightAuto({
      row: autoRow({ unit_id: '다항식' }),
      problem,
      source,
      profile,
      expectedDocument: source.source_document_id,
    })
    expect(mismatch.pass).toBe(false)
    expect(mismatch.reasons).toContain('UNIT_TYPE_INCONSISTENT')
    const payload = classificationPayload({
      row: autoRow(),
      versionId: problem.current_version_id,
      preflight: preflightAuto({
        row: autoRow(),
        problem,
        source,
        profile,
        expectedDocument: source.source_document_id,
      }),
    })
    expect(payload.subtype_code).toBe('')
    expect(payload.classification_status).toBe('AUTO')
  })

  it('does not persist difficulty outside 1–5 and keeps 8.11 thresholds frozen', () => {
    const row = autoRow({ difficulty_level: null, decisions: { ...autoRow().decisions, difficulty: 'REVIEW' } })
    const result = preflightAuto({
      row,
      problem,
      source,
      profile,
      expectedDocument: source.source_document_id,
    })
    expect(result.pass).toBe(true)
    expect(result.persist_difficulty).toBe(false)
    expect(STEP811_THRESHOLDS.type).toBe(0.78)
    expect(STEP811_THRESHOLDS.unit).toBe(0.86)
  })

  it('same payload is batch-stable and candidate type stays candidate in dictionary payload', () => {
    const rows = [autoRow(), autoRow({ problem_id: 'a' }), autoRow({ problem_id: 'b' })]
    expect(splitBatches(rows, [2, 10])[0]).toHaveLength(2)
    const dict = dictionaryPayload({
      type_id: 'CUBIC_QUARTIC_EQ',
      canonical_name_ko: '삼차·사차방정식',
      description: 'x',
      unit_id: '방정식',
      subunit_id: '여러 가지 방정식',
      core_concepts: [],
      solution_strategies: [],
      key_test_points: [],
      common_mistakes: [],
      prerequisite_types: [],
      source_aliases: ['삼차방정식과 사차방정식'],
      status: 'VALIDATED',
    })
    expect(dict.dictionary_status).toBe('CANDIDATE')
    expect((dict.source_aliases as Array<{ universal: boolean }>)[0].universal).toBe(false)
  })

  it('low confidence / heading conflict / missing problem stay REVIEW', () => {
    const low = preflightAuto({
      row: autoRow({ review_reasons: ['UNIT_CONFLICT'] }),
      problem,
      source,
      profile,
      expectedDocument: source.source_document_id,
    })
    expect(low.pass).toBe(false)
    expect(low.reasons).toContain('HAS_REVIEW_REASON')
    const missing = preflightAuto({
      row: autoRow(),
      problem: undefined,
      source,
      profile,
      expectedDocument: source.source_document_id,
    })
    expect(missing.reasons).toContain('PROBLEM_MISSING')
  })
})

describe('taxonomy schema migration', () => {
  it('is additive, adds SUBUNIT, and keeps writes behind staff RPC', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260908220000_hqb_classification_persistence_v1.sql'),
      'utf8',
    )
    const check = migrationIsAdditive(sql)
    expect(check.ok).toBe(true)
    expect(check.reasons).toEqual([])
    expect(sql).toContain("node_type IN ('SCHOOL_LEVEL', 'GRADE', 'SEMESTER', 'SUBJECT', 'UNIT', 'SUBUNIT')")
    expect(sql).toContain('REVOKE ALL ON TABLE public.hyper_type_profiles FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('REVOKE ALL ON TABLE public.problem_classification_meta FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.hqb_upsert_problem_classification(jsonb) TO authenticated')
    expect(check.reasons).not.toContain('DROP_TABLE')
    expect(check.reasons).not.toContain('DROP_COLUMN')
  })
})
