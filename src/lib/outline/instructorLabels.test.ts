import { describe, expect, it } from 'vitest'
import {
  bookQaReady,
  liveReviewQueueLabel,
  pipelineStatusLabel,
  sourcePipelineLabel,
} from './instructorLabels'

describe('source status labels', () => {
  it('keeps pipeline REVIEW_REQUIRED when book QA is not ready', () => {
    expect(pipelineStatusLabel('REVIEW_REQUIRED')).toBe('확인 필요 남음')
    expect(sourcePipelineLabel('REVIEW_REQUIRED', false, 3)).toBe('확인 필요 남음')
    expect(sourcePipelineLabel('REVIEW_REQUIRED', null, 0)).toBe('확인 필요 남음')
    expect(liveReviewQueueLabel(false)).toBe('확인 필요')
  })

  it('does not show leftover HUMAN remaining as pipeline REVIEW_REQUIRED when the book is ready', () => {
    expect(bookQaReady(true, 0)).toBe(true)
    expect(sourcePipelineLabel('REVIEW_REQUIRED', true, 0)).toBe('자동 등록 완료')
    expect(liveReviewQueueLabel(true)).toBe('분류 대기')
  })
})
