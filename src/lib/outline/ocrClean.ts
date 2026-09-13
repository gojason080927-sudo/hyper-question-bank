export type OcrCleanResult = {
  cleaned: string
  rules: string[]
  changed: boolean
}

const PAGE_MARK_RE = /(?:^|\n)\s*\d{1,3}\s*[IⅠⅡⅢⅣⅤ]\.\s*[가-힣]+\s*(?:\n|$)/
const REPEATED_NO_RE = /^(\d{3,4})\s+\1\b/
const OCR_TYPO: Array<[RegExp, string, string]> = [
  [/서술항/g, '서술형', 'ocr_서술항'],
  [/시술항/g, '서술형', 'ocr_시술항'],
  [/시술함/g, '서술형', 'ocr_시술함'],
]

export function cleanOcrStem(text: string): OcrCleanResult {
  const rules: string[] = []
  let next = text.replace(/\u00a0/g, ' ')
  if (REPEATED_NO_RE.test(next)) {
    next = next.replace(REPEATED_NO_RE, '$1')
    rules.push('repeated_number')
  }
  if (/^(\d{3,4}\s+)?유형\s*\d{1,2}\b[^\n]*\n+/.test(next)) {
    next = next.replace(/^(\d{3,4}\s+)?유형\s*\d{1,2}\b[^\n]*\n+/, '$1')
    rules.push('type_header')
  }
  if (PAGE_MARK_RE.test(next) && next.length > 24) {
    next = next.replace(PAGE_MARK_RE, '\n')
    rules.push('page_header')
  }
  if (/[•◎●]/.test(next)) {
    next = next.replace(/[•◎●]/g, '')
    rules.push('bullet_mark')
  }
  if (/(^|\n)\s*#+\s*/.test(next)) {
    next = next.replace(/(^|\n)\s*#+(\s*)/g, '$1')
    rules.push('hash_mark')
  }
  for (const [pattern, repl, rule] of OCR_TYPO) {
    if (pattern.test(next)) {
      next = next.replace(pattern, repl)
      rules.push(rule)
    }
  }
  next = next.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
  return { cleaned: next, rules, changed: next !== text.trim() && rules.length > 0 }
}

export function normalizeDupText(text: string): string {
  return text
    .replace(/\$\$/g, '$')
    .replace(/[•◎●#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function problemNumberSortKey(raw: string | null | undefined): number {
  const digits = (raw ?? '').replace(/[^0-9]/g, '')
  if (!digits) return 999999
  return Number(digits)
}
