import { validateBBox, type NormalizedBBox } from '../pdf/bbox'
import { problemRegions, type LayoutKind, type PageSegmentation, type SegmentStatus } from './layoutSegment'

export const REVIEW_INBOX_STORAGE_KEY = 'hqb.segment-review.draft.v1'
export type TeacherAction = 'APPROVED_AS_IS' | 'BBOX_ADJUSTED'
export type ReviewWorkflowStatus = 'AUTO_PASSED' | 'PENDING_REVIEW' | 'REVIEWED'

export type SegmentReviewItem = {
  id: string
  page_number: number
  detected_problem_number: string
  column_index: number
  confidence: number
  layout_kind: LayoutKind
  original_status: SegmentStatus
  workflow_status: ReviewWorkflowStatus
  review_reason: string[]
  warnings: string[]
  auto_bbox: NormalizedBBox
  confirmed_bbox: NormalizedBBox | null
  teacher_action: TeacherAction | null
  reviewed_at: string | null
  page_image_rel: string
}

export type SegmentReviewInbox = {
  step: '8.2'
  db_writes: 0
  show_auto_ok: boolean
  items: SegmentReviewItem[]
}

export function padPage(pageNumber: number): string {
  return String(pageNumber).padStart(3, '0')
}

export function inboxFromPages(
  pages: Array<{ page_number: number; segmentation: PageSegmentation }>,
): SegmentReviewInbox {
  const items: SegmentReviewItem[] = []
  for (const page of pages) {
    for (const region of page.segmentation.regions) {
      const pending = region.status === 'REVIEW'
      items.push({
        id: `p${padPage(page.page_number)}-${region.detected_problem_number}-${region.column_index}-${region.layout_kind}`,
        page_number: page.page_number,
        detected_problem_number: region.detected_problem_number,
        column_index: region.column_index,
        confidence: region.confidence,
        layout_kind: region.layout_kind,
        original_status: region.status,
        workflow_status: pending ? 'PENDING_REVIEW' : 'AUTO_PASSED',
        review_reason: region.warnings,
        warnings: region.warnings,
        auto_bbox: region.bbox,
        confirmed_bbox: pending ? null : region.bbox,
        teacher_action: pending ? null : 'APPROVED_AS_IS',
        reviewed_at: pending ? null : null,
        page_image_rel: `ocr-tests/original/page-${padPage(page.page_number)}.png`,
      })
    }
  }
  return { step: '8.2', db_writes: 0, show_auto_ok: false, items }
}

export function visibleInboxItems(inbox: SegmentReviewInbox): SegmentReviewItem[] {
  return inbox.items.filter((item) => {
    if (item.workflow_status === 'REVIEWED') return false
    if (item.original_status === 'AUTO_OK' && !inbox.show_auto_ok) return false
    return item.original_status === 'REVIEW' || inbox.show_auto_ok
  })
}

export function pendingReviewCount(inbox: SegmentReviewInbox): number {
  return inbox.items.filter(
    (item) => item.original_status === 'REVIEW' && item.workflow_status === 'PENDING_REVIEW',
  ).length
}

export function bboxChanged(autoBBox: NormalizedBBox, next: NormalizedBBox): boolean {
  const keys = ['x', 'y', 'width', 'height'] as const
  return keys.some((key) => Math.abs(autoBBox[key] - next[key]) > 0.002)
}

export function approveReviewItem(
  inbox: SegmentReviewInbox,
  id: string,
  confirmed: NormalizedBBox,
): SegmentReviewInbox {
  const box = validateBBox(confirmed)
  return {
    ...inbox,
    db_writes: 0,
    items: inbox.items.map((item) => {
      if (item.id !== id) return item
      const adjusted = bboxChanged(item.auto_bbox, box)
      return {
        ...item,
        confirmed_bbox: box,
        teacher_action: adjusted ? 'BBOX_ADJUSTED' : 'APPROVED_AS_IS',
        workflow_status: 'REVIEWED',
        reviewed_at: new Date().toISOString(),
      }
    }),
  }
}

export function problemInboxItems(inbox: SegmentReviewInbox): SegmentReviewItem[] {
  return inbox.items.filter((item) => item.layout_kind === 'PROBLEM' || item.layout_kind === 'THEORY')
}

export function loadInbox(storage: Pick<Storage, 'getItem'> | null, fallback: SegmentReviewInbox): SegmentReviewInbox {
  const raw = storage?.getItem(REVIEW_INBOX_STORAGE_KEY)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as SegmentReviewInbox
    if (!parsed || !Array.isArray(parsed.items)) return fallback
    return { ...parsed, db_writes: 0, step: '8.2' }
  } catch {
    return fallback
  }
}

export function saveInbox(storage: Pick<Storage, 'setItem'> | null, inbox: SegmentReviewInbox): void {
  storage?.setItem(REVIEW_INBOX_STORAGE_KEY, JSON.stringify({ ...inbox, db_writes: 0 }))
}

export function emptyInbox(): SegmentReviewInbox {
  return { step: '8.2', db_writes: 0, show_auto_ok: false, items: [] }
}

export function scoredProblemCount(segmentation: PageSegmentation): number {
  return problemRegions(segmentation.regions).length
}
