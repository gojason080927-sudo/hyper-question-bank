import { extractDifficultyDims, type DifficultyDims } from './difficulty'

export type VerifyInput = {
  problemText: string
  hasSource: boolean
  hasLicense: boolean
  hasCurrentVersion: boolean
  hasCurriculum: boolean
  primaryConceptCount: number
  hyperTypeCount: number
  strategyCount: number
  targetCount: number
  hasHumanDifficulty: boolean
  difficulty: DifficultyDims | null
  hasAnswer: boolean
  hasExpression: boolean
}

export const VERIFY_MESSAGES: Record<string, string> = {
  HQB_MISSING_TEXT: '문제 본문을 입력해 주세요.',
  HQB_MISSING_SOURCE: '출처를 지정해 주세요.',
  HQB_MISSING_LICENSE: '저작권/라이선스 상태를 지정해 주세요.',
  HQB_MISSING_VERSION: '현재 버전이 없습니다.',
  HQB_MISSING_CURRICULUM: '교육과정을 지정해 주세요.',
  HQB_MISSING_PRIMARY_CONCEPT: '핵심 개념을 하나 이상 선택해 주세요.',
  HQB_MISSING_TYPE: 'HYPER 표준 문제유형을 선택해 주세요.',
  HQB_MISSING_STRATEGY: '풀이전략을 선택해 주세요.',
  HQB_MISSING_TARGET: '목표(target)를 하나 이상 선택해 주세요.',
  HQB_MISSING_DIFFICULTY: '6차원 난이도(HUMAN)를 입력해 주세요.',
  HQB_INVALID_DIFFICULTY: '난이도는 각 차원마다 1부터 5 사이여야 합니다.',
  HQB_MISSING_ANSWER: '정답을 입력해 주세요.',
  HQB_MISSING_EXPRESSION: '수식을 하나 이상 입력해 주세요.',
  HQB_FORBIDDEN: '이 문제는 검수 권한이 있는 계정만 확정할 수 있습니다.',
  HQB_VERIFIED_LOCKED: 'VERIFIED 버전은 덮어쓸 수 없습니다. 새 버전을 만드세요.',
  HQB_UNAUTHENTICATED: '로그인이 필요합니다.',
  HQB_BOOTSTRAP_DISABLED: '관리자 부트스트랩은 폐쇄되었습니다. Dashboard에서 역할을 지정하세요.',
  HQB_VERSION_MISMATCH: '요청한 버전이 이 문제에 속하지 않습니다.',
  HQB_NOT_PDF: 'PDF 파일만 업로드할 수 있습니다.',
  HQB_FILE_TOO_LARGE: 'PDF는 50MB 이하여야 합니다.',
  HQB_DUPLICATE_PDF: '같은 PDF가 이미 등록되어 있습니다.',
  HQB_UPLOAD_FAILED: 'PDF 업로드에 실패했습니다.',
  HQB_UPLOAD_MISSING: 'PDF 원본 업로드를 확인하지 못했습니다.',
  HQB_PAGE_COUNT: '페이지 수를 확인하지 못했습니다.',
  HQB_PDF_RENDER: 'PDF를 열 수 없습니다. 파일이 손상되었을 수 있습니다.',
  HQB_INVALID_BBOX: '영역 좌표가 올바르지 않습니다.',
  HQB_INVALID_REGION: '문제 영역이 없습니다.',
  HQB_REGION_LOCKED: '확정된 문제에 연결된 영역은 삭제하거나 수정할 수 없습니다.',
  HQB_REGION_MISMATCH: '자료/페이지/영역 관계가 올바르지 않습니다.',
  HQB_INVALID_HASH: 'SHA-256 값이 올바르지 않습니다.',
  HQB_INVALID_SOURCE: '선택한 출처가 없습니다.',
  HQB_INVALID_PAGE: '페이지 번호가 올바르지 않습니다.',
}

export function verifyGateIssues(input: VerifyInput): string[] {
  const issues: string[] = []
  if (!input.problemText.trim()) issues.push(VERIFY_MESSAGES.HQB_MISSING_TEXT)
  if (!input.hasSource) issues.push(VERIFY_MESSAGES.HQB_MISSING_SOURCE)
  if (!input.hasLicense) issues.push(VERIFY_MESSAGES.HQB_MISSING_LICENSE)
  if (!input.hasCurrentVersion) issues.push(VERIFY_MESSAGES.HQB_MISSING_VERSION)
  if (!input.hasCurriculum) issues.push(VERIFY_MESSAGES.HQB_MISSING_CURRICULUM)
  if (input.primaryConceptCount < 1) issues.push(VERIFY_MESSAGES.HQB_MISSING_PRIMARY_CONCEPT)
  if (input.hyperTypeCount < 1) issues.push(VERIFY_MESSAGES.HQB_MISSING_TYPE)
  if (input.strategyCount < 1) issues.push(VERIFY_MESSAGES.HQB_MISSING_STRATEGY)
  if (input.targetCount < 1) issues.push(VERIFY_MESSAGES.HQB_MISSING_TARGET)
  const dims = extractDifficultyDims(input.difficulty)
  if (!input.hasHumanDifficulty || !dims) {
    issues.push(input.hasHumanDifficulty ? VERIFY_MESSAGES.HQB_INVALID_DIFFICULTY : VERIFY_MESSAGES.HQB_MISSING_DIFFICULTY)
  }
  if (!input.hasAnswer) issues.push(VERIFY_MESSAGES.HQB_MISSING_ANSWER)
  if (!input.hasExpression) issues.push(VERIFY_MESSAGES.HQB_MISSING_EXPRESSION)
  return issues
}

export function canVerify(input: VerifyInput): boolean {
  return verifyGateIssues(input).length === 0
}

export function parseHqBError(message: string | null | undefined): string {
  if (!message) return '저장에 실패했습니다. 입력 내용을 다시 확인해 주세요.'
  const match = message.match(/HQB_[A-Z0-9_]+:\s*(.+)$/)
  if (match?.[1]) return match[1]
  const code = message.match(/HQB_[A-Z0-9_]+/)?.[0]
  if (code && VERIFY_MESSAGES[code]) return VERIFY_MESSAGES[code]
  return '저장에 실패했습니다. 입력 내용을 다시 확인해 주세요.'
}

export function isUsableLicense(license: string | null | undefined): boolean {
  return license === 'PUBLIC' || license === 'OWNED' || license === 'PERMISSION_GRANTED' || license === 'LICENSED'
}
