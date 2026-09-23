import { describe, expect, it } from 'vitest'
import { CM2_ASSIGNED_BY, CM2_UNIT_CODE } from './cm2Catalog'
import {
  classifyCm2Problem,
  cm2ClassificationPayload,
  cm2TypeFromStem,
  cm2UnitFromStem,
  structureFromPageTexts,
  typeIdFromCm2Title,
} from './cm2Classify'

describe('cm2 classify reuse', () => {
  it('maps headings and stems to the existing catalog', () => {
    expect(typeIdFromCm2Title('유형 01 두 점 사이의 거리')).toBe('DISTANCE_TWO_POINTS')
    expect(typeIdFromCm2Title('유형 01 원의 방정식')).toBe('CIRCLE_EQUATION')
    expect(typeIdFromCm2Title('유형 12 충분조건, 필요조건, 필요충분조건')).toBe('PROPOSITION_CONDITION')
    expect(cm2UnitFromStem('두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오.')).toEqual({
      unit: '도형의 방정식',
      subunit: '평면좌표',
    })
    expect(cm2TypeFromStem('선분 AB를 2 : 1로 내분하는 점의 좌표를 구하시오.')).toBe('SEGMENT_DIVISION')
  })

  it('AUTO when heading and stem agree, REVIEW on conflict', () => {
    const section = { unit: '도형의 방정식', subunit: '평면좌표', heading: '유형 01 두 점 사이의 거리', type_id: 'DISTANCE_TWO_POINTS' }
    const auto = classifyCm2Problem({
      problem_id: '11111111-1111-1111-1111-111111111111',
      page: 8,
      problem_number: '0001',
      stem: '두 점 A(2, t), B(1-t, 1) 사이의 거리가 √20일 때, 양수 t의 값을 구하시오.',
      section,
    })
    expect(auto.overall).toBe('AUTO')
    expect(auto.type_id).toBe('DISTANCE_TWO_POINTS')
    expect(auto.unit_id).toBe('도형의 방정식')
    expect(auto.key_test_points.length).toBeGreaterThan(0)

    const conflict = classifyCm2Problem({
      problem_id: '11111111-1111-1111-1111-111111111111',
      page: 8,
      problem_number: '0002',
      stem: '두 집합 A, B에 대하여 합집합 A∪B를 구하시오.',
      section,
    })
    expect(conflict.overall).toBe('REVIEW')
    expect(conflict.reasons).toContain('UNIT_CONFLICT')
  })

  it('builds page structure and a document-agnostic AUTO payload', () => {
    const structure = structureFromPageTexts([
      { page: 7, text: '# 01 평면좌표\n유형 01 두 점 사이의 거리\n본문' },
      { page: 8, text: '001 번호\n두 점 사이의 거리를 구하시오.' },
    ])
    expect(structure.get(8)?.unit).toBe('도형의 방정식')
    expect(structure.get(8)?.type_id).toBe('DISTANCE_TWO_POINTS')
    const decision = classifyCm2Problem({
      problem_id: '22222222-2222-2222-2222-222222222222',
      page: 8,
      problem_number: '0001',
      stem: '두 점 A(0, 0), B(3, 4) 사이의 거리를 구하시오.',
      section: structure.get(8),
    })
    const payload = cm2ClassificationPayload({
      decision,
      versionId: '33333333-3333-3333-3333-333333333333',
      sourceDocumentId: '9eee97e2-4252-4348-a842-4d60eb8590f0',
    })
    expect(payload.source_document_id).toBe('9eee97e2-4252-4348-a842-4d60eb8590f0')
    expect(payload.source_document_id).not.toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    expect(payload.assigned_by).toBe(CM2_ASSIGNED_BY)
    expect(payload.classification_status).toBe('AUTO')
    expect(payload.unit_code).toBe(CM2_UNIT_CODE['도형의 방정식'])
    expect(payload.type_code).toBe('DISTANCE_TWO_POINTS')
  })
})
