import { describe, expect, it } from 'vitest'
import { SSEN_SOURCE_DOCUMENT_ID } from '../outline/ssenToc'
import { MATH2_DOCUMENT_ID } from './math2Ocr'
import {
  QUESTION_BANK_REF,
  STUDENT_CARE_REF,
  assertMath2PersistTarget,
  autoSafePersistItems,
  math2UpsertPayload,
  syntheticMath2BBox,
} from './math2Persist'
import type { Math2ProblemCandidate } from './math2Segment'

function row(partial: Partial<Math2ProblemCandidate>): Math2ProblemCandidate {
  return {
    page: 9,
    problem_number: '0001',
    verdict: 'AUTO_SAFE',
    reasons: [],
    stem_preview: '0001 A(1), B(6)',
    stem: '[0001~0003] 다음 두 점 사이의 거리를 구하시오.\n0001 A(1), B(6)',
    choice_count: 0,
    latex_count: 0,
    image_count: 0,
    section: '01-1',
    page_kind: 'PROBLEM',
    stitched_from_page: null,
    cross_page: false,
    segment_status: 'AUTO_OK',
    ...partial,
  }
}

describe('math2 AUTO_SAFE persist plan', () => {
  it('locks math2 and refuses SSEN / student-care', () => {
    expect(() => assertMath2PersistTarget(MATH2_DOCUMENT_ID, `https://${QUESTION_BANK_REF}.supabase.co`)).not.toThrow()
    expect(() => assertMath2PersistTarget(SSEN_SOURCE_DOCUMENT_ID, `https://${QUESTION_BANK_REF}.supabase.co`)).toThrow(/FORBIDDEN/)
    expect(() => assertMath2PersistTarget(MATH2_DOCUMENT_ID, `https://${STUDENT_CARE_REF}.supabase.co`)).toThrow(/student-care/)
  })

  it('keeps only AUTO_SAFE and builds an identity upsert payload', () => {
    const items = autoSafePersistItems([
      row({ problem_number: '0001' }),
      row({ page: 10, problem_number: '0020', verdict: 'NEEDS_REVIEW', stem: '잘림' }),
      row({ page: 70, problem_number: '0422', choice_count: 5, stem: '0422 값은?' }),
    ])
    expect(items.map((item) => item.problem_number)).toEqual(['0001', '0422'])
    const payload = math2UpsertPayload(items[1]!)
    expect(payload.source_document_id).toBe(MATH2_DOCUMENT_ID)
    expect(payload.original_problem_number).toBe('0422')
    expect((payload.version as { item_format: string }).item_format).toBe('MULTIPLE_CHOICE')
    const box = syntheticMath2BBox(0, 1)
    expect(box.x + box.width).toBeLessThanOrEqual(1)
    expect(box.y + box.height).toBeLessThanOrEqual(1)
  })
})
