import { describe, expect, it } from 'vitest'
import {
  ASSIGNED_BY,
  STEP832,
  STEP832_DOCUMENT,
  STEP832_PAGE_COUNT,
  STEP832_PAID_OCR_CAP,
  candidateIdFor,
  contentFingerprint,
  countFourDigitAnchors,
  humanReadableContent,
  inBatchDuplicates,
  isExcludedPageKind,
  mapPersistWithExisting,
  neverVerified832,
  paidCapAllows,
  persistEligible832,
  persistPlanSafe832,
  pipelineStatusFor,
  problemPageKind,
  reviewReasonsFor,
  stitchCrossPageProblems,
  structureFromRegionText,
  syntheticLayoutFromMarkdown,
} from './fullBookIngest832'
import { canonicalizeProblemNumber } from '../recognition/draftUpsert'

const bbox = { x: 0.1, y: 0.1, width: 0.4, height: 0.3, unit: 'normalized' as const, origin: 'top-left' as const }

describe('STEP 8.32 persist policy', () => {
  it('locks the SSEN textbook, 192 pages, and STEP_8_32 assigned_by', () => {
    expect(STEP832).toBe('8.32')
    expect(STEP832_DOCUMENT).toBe('9ff369b4-5b16-4cb8-bfc3-a6b180c18703')
    expect(STEP832_PAGE_COUNT).toBe(192)
    expect(ASSIGNED_BY).toBe('STEP_8_32')
    expect(STEP832_PAID_OCR_CAP.maxCalls).toBe(250)
  })

  it('allows CREATE_DRAFT without AUTO_APPROVED when source, bbox, crop, text, and identity hold', () => {
    const result = persistEligible832({
      source_document_id: STEP832_DOCUMENT,
      page: 36,
      bbox,
      crop_present: true,
      text: '0159 다음 중 옳은 것은?',
      canonical: '0159',
      duplicate_check_ran: true,
      identity_collision: false,
      auto_approved: false,
    })
    expect(result.ok).toBe(true)
    expect(result.action).toBe('CREATE_DRAFT')
    expect(result.reasons).toContain('AUTO_APPROVED_NOT_REQUIRED')
    expect(result.reasons).toContain('DRAFT_PERSIST_ALLOWED')
  })

  it('records existing identities instead of rewriting content', () => {
    const eligible = persistEligible832({
      source_document_id: STEP832_DOCUMENT,
      page: 36,
      bbox,
      crop_present: true,
      text: '0159 다음 중 옳은 것은?',
      canonical: '0159',
      duplicate_check_ran: true,
      identity_collision: false,
      auto_approved: false,
    })
    const mapped = mapPersistWithExisting(eligible, {
      problem_id: 'p1',
      public_code: 'Q-1',
      review_status: 'UNREVIEWED',
      lifecycle_status: 'DRAFT',
      current_version_id: 'v1',
    })
    expect(mapped.action).toBe('RECORD_EXISTING')
    expect(mapped.reasons).toContain('NO_CONTENT_REWRITE')
    expect(pipelineStatusFor(mapped.action)).toBe('HUMAN_REVIEW')
  })

  it('blocks only when the region cannot be identified or duplicate check did not run', () => {
    const missingCrop = persistEligible832({
      source_document_id: STEP832_DOCUMENT,
      page: 12,
      bbox,
      crop_present: false,
      text: '충분한 본문입니다',
      canonical: '0001',
      duplicate_check_ran: true,
      identity_collision: false,
      auto_approved: false,
    })
    expect(missingCrop.ok).toBe(false)
    expect(missingCrop.action).toBe('SKIP_BLOCKED')
    expect(pipelineStatusFor(missingCrop.action)).toBe('BLOCKED')
  })

  it('queues non-canonical numbers for HUMAN_REVIEW without CREATE', () => {
    expect(canonicalizeProblemNumber('01-1')).toBeNull()
    const result = persistEligible832({
      source_document_id: STEP832_DOCUMENT,
      page: 8,
      bbox,
      crop_present: true,
      text: '01-1 다항식의 덧셈',
      canonical: null,
      duplicate_check_ran: true,
      identity_collision: false,
      auto_approved: false,
    })
    expect(result.action).toBe('SKIP_IDENTITY')
    expect(pipelineStatusFor(result.action)).toBe('HUMAN_REVIEW')
  })

  it('never maps persist actions to VERIFIED', () => {
    expect(neverVerified832('HUMAN_REVIEW', 'NEEDS_REVIEW')).toBe(true)
    expect(neverVerified832('VERIFIED', 'NEEDS_REVIEW')).toBe(false)
    expect(persistPlanSafe832({
      create_draft: 3,
      auto_approved: 0,
      verified: 0,
      duplicate_ids: [],
      wrong_source: 0,
      lookup_complete: true,
    }).ok).toBe(true)
    expect(persistPlanSafe832({
      create_draft: 3,
      auto_approved: 1,
      verified: 0,
      duplicate_ids: [],
      wrong_source: 0,
      lookup_complete: true,
    }).ok).toBe(false)
  })
})

describe('STEP 8.32 page exclusion and stitch', () => {
  it('excludes cover TOC ads answers explanations theory blanks', () => {
    expect(isExcludedPageKind('COVER')).toBe(true)
    expect(isExcludedPageKind('TOC')).toBe(true)
    expect(isExcludedPageKind('ADVERTISEMENT')).toBe(true)
    expect(isExcludedPageKind('ANSWER')).toBe(true)
    expect(isExcludedPageKind('EXPLANATION')).toBe(true)
    expect(isExcludedPageKind('THEORY')).toBe(true)
    expect(isExcludedPageKind('BLANK')).toBe(true)
    expect(problemPageKind('PROBLEM')).toBe(true)
    expect(problemPageKind('MIXED')).toBe(true)
    expect(isExcludedPageKind('UNKNOWN')).toBe(false)
    expect(isExcludedPageKind('OCR_FAILED')).toBe(false)
  })

  it('stitches a problem that continues on the next page', () => {
    const stitched = stitchCrossPageProblems([
      {
        candidate_id: '36|0159',
        page: 36,
        problem_number: '0159',
        canonical: '0159',
        bbox: { x: 0.1, y: 0.72, width: 0.4, height: 0.22, unit: 'normalized', origin: 'top-left' },
        text: '0159 다음 식을 간단히 하면',
        choice_count: 0,
        incomplete: true,
      },
      {
        candidate_id: '37|cont',
        page: 37,
        problem_number: 'cont',
        canonical: null,
        bbox: { x: 0.1, y: 0.05, width: 0.4, height: 0.12, unit: 'normalized', origin: 'top-left' },
        text: '① x+1 ② x+2 ③ x+3 ④ x+4 ⑤ x+5',
        choice_count: 5,
        incomplete: false,
      },
    ])
    expect(stitched).toHaveLength(1)
    expect(stitched[0].stitched_from_page).toBe(37)
    expect(stitched[0].choice_count).toBe(5)
    expect(stitched[0].text).toContain('① x+1')
  })

  it('builds synthetic layout anchors from markdown', () => {
    const layout = syntheticLayoutFromMarkdown('0159 다음 중 옳은 것은?\n① 1\n0160 구하시오')
    expect(layout.blocks.length).toBeGreaterThanOrEqual(2)
    const counts = countFourDigitAnchors('0159 다음\n0160 구하시오')
    expect(counts.four_digit).toBe(2)
    expect(humanReadableContent('짧은')).toBe(false)
    expect(humanReadableContent('0159 다음 중 옳은 것은?')).toBe(true)
  })

  it('fingerprints content and detects in-batch duplicates', () => {
    expect(contentFingerprint('a  b')).toBe(contentFingerprint('a b'))
    expect(inBatchDuplicates(['36|0159', '36|0160', '36|0159'])).toEqual(['36|0159'])
    expect(candidateIdFor(36, '0159', 'x')).toBe('36|0159')
    const structured = structureFromRegionText('0159 다음 중 옳은 것은?\n① 1\n② 2\n③ 3\n④ 4\n⑤ 5')
    expect(structured.reviewable).toBe(true)
    expect(structured.choice_count).toBe(5)
    const reasons = reviewReasonsFor({
      choice_count: 5,
      math: ['x+1'],
      has_figure: true,
      classification_review: true,
      stitched: true,
      ocr_uncertain: true,
      segmentation_status: 'REVIEW',
      anchor_kind: 'four_digit',
    })
    expect(reasons).toContain('FIGURE_NEEDS_REVIEW')
    expect(reasons).toContain('NO_VERIFIED')
    expect(paidCapAllows(192, 0.768).ok).toBe(true)
    expect(paidCapAllows(300, 0.1).ok).toBe(false)
  })
})
