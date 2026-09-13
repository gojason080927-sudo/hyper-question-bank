import { describe, expect, it } from 'vitest'
import {
  acceptRecoveredOcr834,
  bboxHash834,
  classifyDuplicatePair834,
  cleanupResiduals834,
  correctBboxIntrusion834,
  neverVerified834,
  shortStemValid834,
  splitAnswerLeak834,
  type DupDecision834,
} from './exceptionCleanup834'
import { correctAndJudge833, type Item833, type QaResult833 } from './autoQa833'

function item(partial: Partial<Item833> & Pick<Item833, 'candidate_id'>): Item833 {
  return {
    page: 20,
    problem_number: '0100',
    canonical: '0100',
    persist_action: 'RECORD_EXISTING',
    status: 'HUMAN_REVIEW',
    reasons: ['BBOX_INTRUSION'],
    crop_present: true,
    crop_sha256: 'abc',
    choice_count: 0,
    has_figure: false,
    has_table: false,
    stitched_from_page: null,
    classification: {
      unit_id: '다항식',
      type_id: 'POLY_ADD_SUB',
      difficulty_level: 1,
      overall: 'REVIEW',
      review_reasons: [],
    },
    stem_preview: '다음 다항식을 계산하시오. $(x+1)+(x-1)$',
    existing: {
      problem_id: 'p-' + partial.candidate_id,
      public_code: 'HQB-000100',
      review_status: 'NEEDS_REVIEW',
      lifecycle_status: 'DRAFT',
      current_version_id: 'v1',
    },
    content_fingerprint: 'fp',
    bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 },
    problem_text: '다음 다항식을 계산하시오. $(x+1)+(x-1)$',
    ...partial,
  }
}

describe('STEP 8.34 exception cleanup', () => {
  it('shrinks a later overlapping bbox to the previous problem bottom', () => {
    const first = item({
      candidate_id: '20|0100',
      canonical: '0100',
      problem_number: '0100',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.25 },
    })
    const second = item({
      candidate_id: '20|0101',
      canonical: '0101',
      problem_number: '0101',
      bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 },
    })
    const correction = correctBboxIntrusion834(second, [first, second])
    expect(correction?.apply).toBe(true)
    expect(correction?.corrected?.y).toBeGreaterThan(first.bbox!.y + first.bbox!.height - 0.01)
    expect(correction?.overlap_after ?? 1).toBeLessThan(0.25)
    expect(correction?.original_hash).not.toBe(correction?.corrected_hash)
    expect(bboxHash834(second.bbox!)).toHaveLength(64)
  })

  it('keeps uncertain bbox when a shrink would cut a 5-choice block too far', () => {
    const first = item({
      candidate_id: '20|0200',
      canonical: '0200',
      bbox: { x: 0.1, y: 0.05, width: 0.8, height: 0.7 },
      choice_count: 5,
    })
    const second = item({
      candidate_id: '20|0201',
      canonical: '0201',
      problem_number: '0201',
      bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
      choice_count: 5,
    })
    const correction = correctBboxIntrusion834(first, [first, second])
    if (correction?.apply) {
      expect(correction.area_retained).toBeGreaterThanOrEqual(0.45)
    } else {
      expect(correction?.confidence).toBe('UNCERTAIN')
    }
  })

  it('classifies exact same-page same-number twins as linked duplicates without delete', () => {
    const a = item({ candidate_id: '21|0300', canonical: '0300', page: 21 })
    const b = item({ candidate_id: '21|0300b', canonical: '0300', page: 21, existing: { ...a.existing!, problem_id: 'p-other' } })
    const qaA = correctAndJudge833(a, [a, b])
    const qaB = correctAndJudge833(b, [a, b])
    const decision: DupDecision834 = classifyDuplicatePair834(a, b, qaA, qaB)
    expect(decision.kind).toBe('EXACT_DUPLICATE')
    expect(decision.block_extra).toBe(true)
    expect(decision.status).toBe('LINKED')
    expect(decision.clear_duplicate_flag).toBe(true)
  })

  it('keeps short template stems on different numbers as distinct similar problems', () => {
    const a = item({ candidate_id: '9|0016', canonical: '0016', page: 9, problem_text: '0016 $(x+2)^3$', stem_preview: '0016 $(x+2)^3$' })
    const b = item({
      candidate_id: '10|0020',
      canonical: '0020',
      page: 10,
      problem_number: '0020',
      problem_text: '0016 $(x+2)^3$',
      stem_preview: '0016 $(x+2)^3$',
      existing: { ...a.existing!, problem_id: 'p-b' },
    })
    const qaA = correctAndJudge833(a, [a])
    const qaB = { ...correctAndJudge833(b, [b]), normalized_text: qaA.normalized_text }
    const decision = classifyDuplicatePair834(a, b, qaA, qaB)
    expect(decision.kind).toBe('SIMILAR_DISTINCT')
    expect(decision.block_extra).toBe(false)
    expect(decision.clear_duplicate_flag).toBe(true)
  })

  it('splits answer-key leak while preserving original text', () => {
    const split = splitAnswerLeak834('다음을 구하시오. $x^2$. 정답 : $4$ 풀이 전개한다.')
    expect(split.original_preserved).toBe(true)
    expect(split.leaked).toBe(true)
    expect(split.stem).toContain('구하시오')
    expect(split.stem).not.toContain('정답')
  })

  it('strips 정답 및 풀이 page headers and keeps the following stem', () => {
    const split = splitAnswerLeak834('정답 및 풀이 ● 9쪽 # 0094 오른쪽 그림과 같이 밑면의 가로의 길이가 a-2')
    expect(split.leaked).toBe(true)
    expect(split.original_preserved).toBe(true)
    expect(split.stem).toContain('오른쪽 그림')
    expect(split.stem).not.toContain('정답 및 풀이')
  })

  it('accepts recovered OCR that is readable and longer than garbage', () => {
    expect(acceptRecoveredOcr834('시술함 ●', '다음 다항식을 전개하시오. $(x+2)^3$')).toBe(true)
    expect(acceptRecoveredOcr834('시술함 ●', '●●')).toBe(false)
  })

  it('treats short formula stems as valid problems', () => {
    expect(shortStemValid834('0016 $(x+2)^3$')).toBe(true)
  })

  it('clears residuals when bbox, leak, and short-stem rules pass together', () => {
    const keep = item({
      candidate_id: '30|0400',
      canonical: '0400',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
      problem_text: '다음을 계산하시오. $(x+1)^2$ 정답 : $x^2+2x+1$',
      stem_preview: '다음을 계산하시오. $(x+1)^2$ 정답 : $x^2+2x+1$',
    })
    const extra = item({
      candidate_id: '30|0401',
      canonical: '0401',
      problem_number: '0401',
      bbox: { x: 0.1, y: 0.22, width: 0.8, height: 0.3 },
      problem_text: extraText(),
      stem_preview: extraText(),
      existing: { problem_id: 'p-extra', public_code: 'HQB-000401', review_status: 'NEEDS_REVIEW', lifecycle_status: 'DRAFT', current_version_id: 'v2' },
    })
    function extraText() {
      return '다음 식을 전개하시오. $(a+b)^2$'
    }
    const qaKeep = {
      ...correctAndJudge833(keep, [keep, extra], true),
      residual_reasons: ['BBOX_INTRUSION', 'ANSWER_KEY_LEAK', 'DUPLICATE_CANDIDATE'],
      verdict: 'HUMAN_REVIEW',
    } satisfies QaResult833
    const qaExtra = {
      ...correctAndJudge833(extra, [keep, extra], true),
      residual_reasons: ['DUPLICATE_CANDIDATE'],
      verdict: 'HUMAN_REVIEW',
    } satisfies QaResult833
    const results = cleanupResiduals834([keep, extra], [qaKeep, qaExtra])
    expect(results.every((row) => row.content_rewrite === false)).toBe(true)
    expect(neverVerified834('AUTO_APPROVED', 'AUTO_CLASSIFIED')).toBe(true)
    expect(results.some((row) => row.leak_split?.original_preserved)).toBe(true)
  })
})
