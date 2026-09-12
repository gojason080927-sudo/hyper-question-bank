import { describe, expect, it } from 'vitest'
import {
  applyDuplicateFlags833,
  choicesOk833,
  correctAndJudge833,
  countReasons833,
  inferTypeFromStem833,
  isPolicyReason833,
  mathReadable833,
  neverVerified833,
  qualityReasons833,
  stemReadable833,
  structureKey833,
  type Item833,
} from './autoQa833'

function item(partial: Partial<Item833> & Pick<Item833, 'candidate_id' | 'stem_preview'>): Item833 {
  return {
    page: 9,
    problem_number: partial.canonical ?? '0001',
    canonical: '0001',
    persist_action: 'RECORD_EXISTING',
    status: 'HUMAN_REVIEW',
    reasons: [
      'NO_VERIFIED',
      'QUEUED_HUMAN_REVIEW',
      'SEGMENT_REVIEW',
      'CLASSIFICATION_REVIEW',
      'MATH_UNCERTAIN',
    ],
    crop_present: true,
    crop_sha256: 'abc',
    choice_count: 0,
    has_figure: false,
    has_table: false,
    stitched_from_page: null,
    classification: {
      unit_id: '다항식',
      type_id: 'TYPE_UNCLEAR',
      difficulty_level: 1,
      overall: 'REVIEW',
      review_reasons: ['TYPE_UNCLEAR', 'UNIT_FROM_STEM_ONLY'],
    },
    existing: {
      problem_id: 'p1',
      public_code: 'HQB-1',
      review_status: 'NEEDS_REVIEW',
      lifecycle_status: 'DRAFT',
      current_version_id: 'v1',
    },
    content_fingerprint: 'x',
    ...partial,
  }
}

describe('STEP 8.33 QA rules', () => {
  it('drops policy tags from quality reasons', () => {
    expect(isPolicyReason833('QUEUED_HUMAN_REVIEW')).toBe(true)
    expect(qualityReasons833(['NO_VERIFIED', 'MATH_UNCERTAIN', 'SEGMENT_REVIEW'])).toEqual(['MATH_UNCERTAIN', 'SEGMENT_REVIEW'])
  })

  it('treats latex and short hangul stems as readable', () => {
    expect(mathReadable833('0001 $x$에 대한 내림차순')).toBe(true)
    expect(stemReadable833('0001 $x$에 대한 내림차순')).toBe(true)
    expect(stemReadable833('0016 $(x+2)^3$')).toBe(true)
  })

  it('accepts constructed-response choice counts', () => {
    expect(choicesOk833('다음을 계산하시오. $(x+2)^3$', 0)).toBe(true)
    expect(choicesOk833('보기 ㄱ. $x=1$ ㄴ. $x=2$ ㄷ. $x=3$', 3)).toBe(true)
    expect(choicesOk833('다음 중 옳은 것은?', 2)).toBe(false)
    expect(choicesOk833('다음 중 옳은 것은? ① ② ③ ④ ⑤', 5)).toBe(true)
  })

  it('infers polynomial add/multiply from expressions without keywords', () => {
    expect(inferTypeFromStem833('0005 $(2x^3+x^2-1)+(-x^3+x-3)$').type_id).toBe('POLY_ADD_SUB')
    expect(inferTypeFromStem833('0016 $(x+2)^3$').type_id).toBe('POLY_MULTIPLY')
    expect(inferTypeFromStem833('0001 $x$에 대한 내림차순').type_id).toBe('POLY_ADD_SUB')
    expect(inferTypeFromStem833('[0011~0012] 두 다항식 $A$, $B$를 구하시오. 01 다항식의 연산').type_id).toBe('POLY_ADD_SUB')
    expect(inferTypeFromStem833('0013 $ab(b^3-3a^2b+2b^2)$').type_id).toBe('POLY_MULTIPLY')
    expect(inferTypeFromStem833('0022 $a+b=3$, $ab=-10$일 때, $a^2+b^2$의 값을 구하시오.').type_id).toBe('POLY_PRODUCT_TRANSFORM')
    expect(inferTypeFromStem833('1036 갈 때와 올 때 모두 버스를 이용하는 경우의 수').type_id).toBe('COUNTING_PERM_COMB')
  })

  it('auto-clears a readable SSEN draft and never returns VERIFIED', () => {
    const qa = correctAndJudge833(
      item({
        candidate_id: '9|0005',
        canonical: '0005',
        stem_preview: '0005 $(2x^3+x^2-1)+(-x^3+x-3)$',
      }),
      [],
    )
    expect(qa.verdict).toBe('AUTO_CLEAR')
    expect(qa.pipeline_status).toBe('AUTO_APPROVED')
    expect(qa.review_status_after).toBe('AUTO_CLASSIFIED')
    expect(qa.type_id).toBe('POLY_ADD_SUB')
    expect(neverVerified833(qa.pipeline_status, qa.review_status_after)).toBe(true)
    expect(qa.applied_rules).toContain('DROP_POLICY_TAGS')
    expect(qa.applied_rules.some((row) => row.startsWith('TYPE_INFER'))).toBe(true)
  })

  it('keeps thin content and answer-key leakage in HUMAN_REVIEW', () => {
    const thin = correctAndJudge833(
      item({
        candidate_id: '47|0283',
        canonical: '0283',
        stem_preview: '0283 6',
        reasons: ['CONTENT_THIN_NEEDS_REVIEW', 'QUEUED_HUMAN_REVIEW'],
        classification: {
          unit_id: '미정',
          type_id: 'TYPE_UNCLEAR',
          difficulty_level: null,
          overall: 'REVIEW',
          review_reasons: ['EVIDENCE_INSUFFICIENT', 'TYPE_UNCLEAR'],
        },
      }),
      [],
    )
    expect(thin.verdict).toBe('HUMAN_REVIEW')
    expect(thin.residual_reasons).toContain('EVIDENCE_INSUFFICIENT')

    const leak = correctAndJudge833(
      item({
        candidate_id: '177|1226',
        canonical: '1226',
        stem_preview: '정답 및 풀이 ● 173쪽 1226 두 행렬 $A$',
        classification: {
          unit_id: '행렬',
          type_id: 'MATRIX_ARITHMETIC',
          difficulty_level: 2,
          overall: 'REVIEW',
          review_reasons: [],
        },
      }),
      [],
    )
    expect(leak.residual_reasons).toContain('ANSWER_KEY_LEAK')
    expect(leak.verdict).toBe('HUMAN_REVIEW')
  })

  it('holds exact duplicate fingerprints for human review', () => {
    const a = correctAndJudge833(item({ candidate_id: '9|0005', canonical: '0005', stem_preview: '0005 $(2x^3+x^2-1)+(-x^3+x-3)$' }), [])
    const b = correctAndJudge833(item({ candidate_id: '10|0005', canonical: '0005', stem_preview: '0005 $(2x^3+x^2-1)+(-x^3+x-3)$' }), [])
    const flagged = applyDuplicateFlags833([a, b])
    expect(flagged.every((row) => row.verdict === 'HUMAN_REVIEW')).toBe(true)
    expect(flagged[0]?.residual_reasons).toContain('DUPLICATE_CANDIDATE')
  })

  it('builds a stable structure key and reason census', () => {
    expect(structureKey833({ unit_id: '다항식', type_id: 'POLY_ADD_SUB', choice_count: 0, has_figure: false, has_table: false, difficulty_level: 1 })).toBe(
      '다항식|POLY_ADD_SUB|CR|NOFIG|NOTAB|D1',
    )
    const census = countReasons833([
      item({ candidate_id: '9|0001', stem_preview: '0001 $x$' }),
      item({ candidate_id: '9|0002', stem_preview: '0002 $y$', reasons: ['FIGURE_NEEDS_REVIEW', 'NO_VERIFIED'] }),
    ])
    expect(census.pipeline.NO_VERIFIED).toBe(2)
    expect(census.quality.FIGURE_NEEDS_REVIEW).toBe(1)
    expect(census.quality.NO_VERIFIED).toBeUndefined()
  })
})
