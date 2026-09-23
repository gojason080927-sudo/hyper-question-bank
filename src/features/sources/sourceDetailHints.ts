/** Empty-page OCR hint. Uses this document's page_count, never a leftover SSEN 192. */
export function emptyPageTextHint(pageCount: number | null | undefined): string {
  const n = typeof pageCount === 'number' && Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null
  const whole = n == null ? '문서 전체' : `${n}페이지 전체`
  return `이 페이지에는 의미 있는 텍스트 층이 거의 없습니다. [OCR 테스트]는 선택한 영역 한 곳만 실행합니다. ${whole}는 돌리지 않습니다.`
}
