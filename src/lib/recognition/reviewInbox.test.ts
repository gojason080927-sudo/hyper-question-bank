import { describe, expect, it } from 'vitest'
import { validateBBox } from '../pdf/bbox'
import {
  approveReviewItem,
  bboxChanged,
  emptyInbox,
  inboxFromPages,
  pendingReviewCount,
  visibleInboxItems,
} from './reviewInbox'
import { segmentPageFromLayout } from './layoutSegment'

describe('REVIEW inbox', () => {
  it('hides AUTO_OK by default and keeps auto_bbox when approving as-is', () => {
    const segmentation = segmentPageFromLayout({
      pageWidth: 1000,
      pageHeight: 1400,
      images: [],
      blocks: [
        {
          type: 'text',
          content: '0161',
          bbox: validateBBox({ x: 0.12, y: 0.7, width: 0.12, height: 0.03, unit: 'normalized', origin: 'top-left' }),
        },
        {
          type: 'text',
          content: '본문',
          bbox: validateBBox({ x: 0.12, y: 0.74, width: 0.3, height: 0.08, unit: 'normalized', origin: 'top-left' }),
        },
        {
          type: 'footer',
          content: '28',
          bbox: validateBBox({ x: 0.08, y: 0.96, width: 0.06, height: 0.02, unit: 'normalized', origin: 'top-left' }),
        },
      ],
    })
    const inbox = inboxFromPages([{ page_number: 28, segmentation }])
    expect(pendingReviewCount({ ...inbox, items: inbox.items.map((item) => ({ ...item, original_status: 'REVIEW', workflow_status: 'PENDING_REVIEW' })) })).toBeGreaterThan(0)
    const hidden = visibleInboxItems({
      ...inbox,
      show_auto_ok: false,
      items: inbox.items.map((item) => ({ ...item, original_status: 'AUTO_OK', workflow_status: 'AUTO_PASSED' })),
    })
    expect(hidden).toEqual([])
    const reviewOnly = visibleInboxItems({
      ...emptyInbox(),
      items: [
        {
          id: 'r1',
          page_number: 28,
          detected_problem_number: '0161',
          column_index: 0,
          confidence: 0.8,
          layout_kind: 'PROBLEM',
          original_status: 'REVIEW',
          workflow_status: 'PENDING_REVIEW',
          review_reason: ['last_in_column_bottom_uncertain'],
          warnings: ['last_in_column_bottom_uncertain'],
          auto_bbox: validateBBox({ x: 0.1, y: 0.7, width: 0.4, height: 0.2, unit: 'normalized', origin: 'top-left' }),
          confirmed_bbox: null,
          teacher_action: null,
          reviewed_at: null,
          page_image_rel: 'ocr-tests/original/page-028.png',
        },
        {
          id: 'a1',
          page_number: 28,
          detected_problem_number: '0159',
          column_index: 0,
          confidence: 0.9,
          layout_kind: 'PROBLEM',
          original_status: 'AUTO_OK',
          workflow_status: 'AUTO_PASSED',
          review_reason: [],
          warnings: [],
          auto_bbox: validateBBox({ x: 0.1, y: 0.16, width: 0.4, height: 0.2, unit: 'normalized', origin: 'top-left' }),
          confirmed_bbox: validateBBox({ x: 0.1, y: 0.16, width: 0.4, height: 0.2, unit: 'normalized', origin: 'top-left' }),
          teacher_action: 'APPROVED_AS_IS',
          reviewed_at: null,
          page_image_rel: 'ocr-tests/original/page-028.png',
        },
      ],
    })
    expect(reviewOnly.map((item) => item.id)).toEqual(['r1'])
    const approved = approveReviewItem(
      { step: '8.2', db_writes: 0, show_auto_ok: false, items: reviewOnly },
      'r1',
      reviewOnly[0].auto_bbox,
    )
    expect(approved.items[0].teacher_action).toBe('APPROVED_AS_IS')
    expect(approved.items[0].confirmed_bbox).toEqual(reviewOnly[0].auto_bbox)
    expect(approved.db_writes).toBe(0)
    const moved = validateBBox({ x: 0.12, y: 0.68, width: 0.42, height: 0.22, unit: 'normalized', origin: 'top-left' })
    expect(bboxChanged(reviewOnly[0].auto_bbox, moved)).toBe(true)
    const adjusted = approveReviewItem(
      { step: '8.2', db_writes: 0, show_auto_ok: false, items: reviewOnly },
      'r1',
      moved,
    )
    expect(adjusted.items[0].teacher_action).toBe('BBOX_ADJUSTED')
    expect(visibleInboxItems(adjusted)).toEqual([])
  })
})
