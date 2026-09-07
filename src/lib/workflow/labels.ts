export const ANSWER_TYPES = [
  { value: 'NUMBER', label: '숫자' },
  { value: 'EXPRESSION', label: '식' },
  { value: 'TEXT', label: '텍스트' },
  { value: 'SET', label: '집합' },
  { value: 'MULTI', label: '복수 정답' },
  { value: 'CHOICE_LABEL', label: '객관식 번호' },
  { value: 'INTERVAL', label: '구간' },
] as const

export const DOCUMENT_TYPES = [
  { value: 'TEACHER_CREATED', label: '강사 자체 제작' },
  { value: 'PUBLIC_RESOURCE', label: '공개 자료' },
  { value: 'TEXTBOOK', label: '교과서' },
  { value: 'WORKBOOK', label: '문제집' },
  { value: 'MOCK_EXAM', label: '모의고사' },
  { value: 'SCHOOL_EXAM', label: '학교 시험' },
  { value: 'OTHER', label: '기타' },
] as const

export const LICENSE_STATUSES = [
  { value: 'UNKNOWN', label: '미확인' },
  { value: 'OWNED', label: '자체 보유' },
  { value: 'PUBLIC', label: '공개' },
  { value: 'PERMISSION_GRANTED', label: '이용 허락' },
  { value: 'LICENSED', label: '라이선스' },
  { value: 'RESTRICTED', label: '제한' },
] as const

export const EXPRESSION_ROLES = [
  { value: 'GIVEN', label: '주어진 식' },
  { value: 'CONDITION', label: '조건' },
  { value: 'TARGET', label: '목표' },
  { value: 'CHOICE', label: '선택지' },
  { value: 'INTERMEDIATE', label: '중간 과정' },
] as const

export const REVIEW_LABELS: Record<string, string> = {
  UNREVIEWED: '미검수',
  AUTO_CLASSIFIED: '자동분류',
  NEEDS_REVIEW: '검수 필요',
  VERIFIED: '확정',
  REJECTED: '반려',
}

export type StaffRole = 'ADMIN' | 'TEACHER' | 'REVIEWER'

export function canReview(role: StaffRole | null | undefined): boolean {
  return role === 'ADMIN' || role === 'REVIEWER'
}

export function canWriteDraft(role: StaffRole | null | undefined): boolean {
  return role === 'ADMIN' || role === 'TEACHER' || role === 'REVIEWER'
}
