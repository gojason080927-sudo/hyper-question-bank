import { describe, expect, it } from 'vitest'
import { classifyBookPageV2, emptyKindCountsV2, assertKindSumV2, blockedNonProblemKind } from './bookClassify'
import {
  EXPECTED_PAGE_COUNT,
  PAGE_OCR_BATCH,
  DB_INSERT_BATCH,
  inspectNumberFlowV2,
  isStructureIncomplete,
  pickRecoverySample,
  recoveryHelped,
  recoveryPolicy,
  stageAShouldStop,
  drySummaryAbnormal,
  parsePipelineArgs,
  qaVerdict,
  mapPipelineGateReasons,
  criticalMathConflicts,
  isFatalOcrHttp,
  isRetryableOcrHttp,
} from './bookPipeline'

const PAGE8_TEXT = `단계
기본 다잡기
01 다항식의 연산
### 01-1 다항식의 덧셈과 뺄셈
유형 01
# (1) 다항식의 정리 방법
① 내림차순: 다항식을 한 문자에 대하여 차수가 높은 항부터`

describe('STEP 8.7 classifier v2', () => {
  it('keeps p.8 as THEORY from OCR text, not past problem-page assumption', () => {
    const result = classifyBookPageV2({
      page_number: 8,
      total_pages: 192,
      ink_ratio: 0.28,
      has_ocr: true,
      four_digit_count: 0,
      section_count: 1,
      page_layout_kind: 'THEORY_PAGE',
      cache_text: PAGE8_TEXT,
      block_count: 40,
      image_count: 1,
    })
    expect(result.page_kind).toBe('THEORY')
    expect(result.evidence.four_digit_anchors).toBe(0)
    expect(result.evidence.theory_headings).toBe(true)
    expect(result.evidence.page_position_hint).toBe('middle')
  })

  it('classifies answer keys with 4-digit numbers as ANSWER, not PROBLEM', () => {
    const text = ['정답과 해설', '0159 ③', '0160 ①', '0161 ⑤', '0274 ②', '0275 ④', '0401 ③', '0402 ①', '0403 ②'].join('\n')
    const result = classifyBookPageV2({
      page_number: 180,
      total_pages: 192,
      ink_ratio: 0.2,
      has_ocr: true,
      four_digit_count: 8,
      section_count: 0,
      cache_text: text,
      block_count: 20,
    })
    expect(result.page_kind).toBe('ANSWER')
    expect(blockedNonProblemKind(result.page_kind)).toBe(true)
  })

  it('does not use page position alone', () => {
    const back = classifyBookPageV2({
      page_number: 190,
      total_pages: 192,
      ink_ratio: 0.3,
      has_ocr: true,
      four_digit_count: 6,
      section_count: 0,
      page_layout_kind: 'PROBLEM_PAGE',
      cache_text: '0159 다음 중 옳은 것은?\n① x+1 ② x+2 ③ x+3 ④ x+4 ⑤ x+5\n0160 구하시오',
      block_count: 30,
    })
    expect(back.page_kind).toBe('PROBLEM')
    expect(back.evidence.page_position_hint).toBe('back')
  })

  it('returns OCR_FAILED and UNKNOWN without guessing PROBLEM', () => {
    const failed = classifyBookPageV2({
      page_number: 70,
      ink_ratio: 0.2,
      ocr_failed: true,
      has_ocr: false,
      four_digit_count: 0,
      section_count: 0,
    })
    expect(failed.page_kind).toBe('OCR_FAILED')

    const unknown = classifyBookPageV2({
      page_number: 70,
      ink_ratio: 0.2,
      has_ocr: false,
      four_digit_count: 0,
      section_count: 0,
    })
    expect(unknown.page_kind).toBe('UNKNOWN')
    expect(unknown.needs_ocr).toBe(true)
  })

  it('totals include OCR_FAILED and still sum to 192', () => {
    const counts = emptyKindCountsV2()
    counts.PROBLEM = 100
    counts.THEORY = 20
    counts.ANSWER = 30
    counts.UNKNOWN = 21
    counts.OCR_FAILED = 1
    counts.BLANK = 1
    counts.COVER = 1
    counts.TOC = 1
    counts.MIXED = 17
    assertKindSumV2(counts, EXPECTED_PAGE_COUNT)
  })
})

describe('STEP 8.7 number flow and recovery', () => {
  it('marks chapter resets as EXPECTED_BOOK_STRUCTURE, not automatic error', () => {
    const flow = inspectNumberFlowV2([
      { page: 28, problem_number: '0159' },
      { page: 29, problem_number: '0160' },
      { page: 80, problem_number: '0001' },
    ])
    expect(flow.rows.find((row) => row.problem_number === '0001')?.status).toBe('EXPECTED_BOOK_STRUCTURE')
    expect(flow.duplicate).toBe(0)
  })

  it('does not invent identity for unnumbered problems', () => {
    const flow = inspectNumberFlowV2([{ page: 40, problem_number: '05-3' }])
    expect(flow.unstable).toBe(1)
    expect(flow.rows[0].status).toBe('REVIEW')
  })

  it('tests recovery on a sample before applying the rest', () => {
    const incomplete = [
      { page: 28, problem_number: '0159' },
      { page: 44, problem_number: '0274' },
      { page: 60, problem_number: '0401' },
      { page: 84, problem_number: '0652' },
      { page: 156, problem_number: '1092' },
      { page: 180, problem_number: '1200' },
    ]
    const sample = pickRecoverySample(incomplete, 5)
    expect(sample).toHaveLength(5)
    expect(isStructureIncomplete({ stem: '짧음', choice_count: 0, expected_choices: true })).toBe(true)
    const helped = recoveryHelped(
      { page: 28, problem_number: '0159', stem_length: 3, choice_count: 0, expected_choices: true, incomplete: true },
      { page: 28, problem_number: '0159', stem_length: 40, choice_count: 5, expected_choices: true, incomplete: false },
    )
    expect(helped).toBe(true)
    const snap = {
      page: 28,
      problem_number: '0159',
      stem_length: 3,
      choice_count: 0,
      expected_choices: true,
      incomplete: true,
    }
    const policy = recoveryPolicy([
      { page: 1, problem_number: 'a', reason: 'stem', before: snap, after: snap, recovered: true, api_called: true, cache_hit: false },
      { page: 2, problem_number: 'b', reason: 'stem', before: snap, after: snap, recovered: true, api_called: true, cache_hit: false },
      { page: 3, problem_number: 'c', reason: 'stem', before: snap, after: snap, recovered: false, api_called: true, cache_hit: false },
    ])
    expect(policy.apply_rest).toBe(true)
    const weak = recoveryPolicy([
      { page: 1, problem_number: 'a', reason: 'stem', before: snap, after: snap, recovered: false, api_called: true, cache_hit: false },
      { page: 2, problem_number: 'b', reason: 'stem', before: snap, after: snap, recovered: false, api_called: true, cache_hit: false },
      { page: 3, problem_number: 'c', reason: 'stem', before: snap, after: snap, recovered: true, api_called: true, cache_hit: false },
    ])
    expect(weak.apply_rest).toBe(false)
  })
})

describe('STEP 8.7 gates and CLI', () => {
  it('stops STAGE A on auth/payload and mass UNKNOWN', () => {
    expect(isFatalOcrHttp(401)).toBe(true)
    expect(isFatalOcrHttp(429)).toBe(false)
    expect(isRetryableOcrHttp(503)).toBe(true)
    const stop = stageAShouldStop({
      fatal: 'auth_4xx',
      attempted: 1,
      failed: 1,
      consecutive_same_error: 1,
      unknown_after_ocr: 0,
      ocr_failed: 0,
      problem: 0,
      answer: 0,
      explanation: 0,
      median_text_length: 400,
      answer_leaked_into_problem: 0,
    })
    expect(stop.stop).toBe(true)
    const unknown = stageAShouldStop({
      attempted: 178,
      failed: 2,
      consecutive_same_error: 0,
      unknown_after_ocr: 90,
      ocr_failed: 0,
      problem: 80,
      answer: 0,
      explanation: 0,
      median_text_length: 400,
      answer_leaked_into_problem: 0,
    })
    expect(unknown.reasons).toContain('classifier_mass_unknown')
  })

  it('blocks DB write if answer pages entered candidates', () => {
    const dry = drySummaryAbnormal({
      candidates: 10,
      draft_ready: 8,
      pipeline_review: 2,
      blocked_non_problem: 0,
      answer_pages_in_candidates: 2,
      mathpix_planned: 3,
      hybrid: 3,
    })
    expect(dry.stop).toBe(true)
  })

  it('maps conflicts to REVIEW and parses resume flags', () => {
    expect(mapPipelineGateReasons(['math_conflict'])).toContain('MATH_CONFLICT')
    const conflicts = criticalMathConflicts(['x^2+1'], ['x^3+1'])
    expect(conflicts.some((row) => row.code === 'exponent_mismatch')).toBe(true)
    const args = parsePipelineArgs(['--run', '--resume', '--from-page=40', '--batch=2', '--stage=A', '--allow-paid-api'])
    expect(args.resume).toBe(true)
    expect(args.fromPage).toBe(40)
    expect(args.batch).toBe(2)
    expect(args.stage).toBe('A')
    expect(PAGE_OCR_BATCH).toBe(20)
    expect(DB_INSERT_BATCH).toBe(25)
    expect(qaVerdict({ stem: '', page_kind: 'PROBLEM', problem_number: '0159' }).level).toBe('CRITICAL')
  })
})
