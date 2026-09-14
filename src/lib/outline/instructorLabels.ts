export const REVIEW_LABELS_KO: Record<string, string> = {
  UNREVIEWED: '미검수',
  AUTO_CLASSIFIED: '자동분류',
  NEEDS_REVIEW: '확인 필요',
  VERIFIED: '확정',
  REJECTED: '반려',
}

export const ITEM_FORMAT_KO: Record<string, string> = {
  MULTIPLE_CHOICE: '객관식',
  SHORT_ANSWER: '단답형',
  CONSTRUCTED_RESPONSE: '서술형',
  MIXED: '혼합',
}

export const DOCUMENT_STATUS_KO: Record<string, string> = {
  UPLOADING: '업로드 중',
  READY: '준비됨',
  FAILED: '실패',
}

export function ocrStatusLabel(status: string, complete: boolean): string {
  if (complete) return 'OCR 완료'
  const map: Record<string, string> = {
    NOT_NEEDED: 'OCR 불필요',
    PENDING: 'OCR 대기',
    PROCESSING: 'OCR 처리 중',
    SUCCEEDED: 'OCR 완료',
    FAILED: 'OCR 실패',
    REVIEW_REQUIRED: 'OCR 확인 필요',
  }
  return map[status] ?? status
}

export function extractionStatusLabel(status: string, complete: boolean): string {
  if (complete) return '문제 추출 완료'
  const map: Record<string, string> = {
    PENDING: '추출 대기',
    EMBEDDED_TEXT: '텍스트 추출',
    MANUAL: '수동 추출',
    FAILED: '추출 실패',
    NOT_NEEDED: '추출 불필요',
  }
  return map[status] ?? status
}

export function pipelineStatusLabel(status: string): string {
  const map: Record<string, string> = {
    COMPLETED: '자동 등록 완료',
    REVIEW_REQUIRED: '확인 필요 남음',
    UPLOADING: '업로드 중',
    PENDING: '대기',
    SUCCEEDED: '완료',
  }
  return map[status] ?? status
}

export function dash(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  return String(value)
}

export function bookReadyLabel(ready: boolean, humanExceptions: number): string {
  if (ready && humanExceptions === 0) return '사용 가능'
  if (ready) return `사용 가능 · 최종 확인 ${humanExceptions}문항`
  return `P1 잔여 · 최종 확인 ${humanExceptions}문항`
}
