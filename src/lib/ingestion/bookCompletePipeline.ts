/**
 * Source-agnostic complete-book pipeline.
 * Default dry-run. `--apply` is the only Production write switch.
 * Do not hardcode 쎈수학 problem numbers or pages here — TOC rules live in adapters.
 */
export const BOOK_COMPLETE_STAGES = [
  'PDF_HASH',
  'CHANGED_PAGES',
  'OCR_CACHE',
  'SELECTIVE_OCR',
  'SEGMENT',
  'NUMBER_SORT',
  'OUTLINE',
  'DUP_CHECK',
  'RANGE_PROMPT',
  'KATEX',
  'CHOICE_FIGURE',
  'FULL_QA',
  'DRY_RUN',
  'AUTO_SAFE_APPLY',
  'EXCEPTION_QUEUE',
  'BOOK_STATUS',
] as const

export type BookCompleteStage = (typeof BOOK_COMPLETE_STAGES)[number]

export type OutlineNode = {
  code: string
  title: string
  startPage: number
  level: 'MAJOR' | 'SECTION'
}

export type OutlineAdapter = {
  id: string
  parseToc(pages: Array<{ page: number; text: string }>): OutlineNode[]
  assignUnit(input: { page: number; stem: string }, toc: OutlineNode[]): { major?: string; section?: string } | null
}

export type OcrProviderName = 'mathpix' | 'mistral' | 'cache'

export type BookCompleteInput = {
  sourceId: string
  title: string
  pdfHash: string
  previousPdfHash?: string | null
  pageCount: number
  pageHashes: Array<{ page: number; sha256: string }>
  previousPageHashes?: Array<{ page: number; sha256: string }>
  cachedOcrKeys: string[]
  costCapUsd: number
  spentUsd?: number
  apply: boolean
  lockHeld: boolean
  ocrPolicy: 'cache-only' | 'cache-first' | 'paid-allowed'
  adapter: OutlineAdapter
  pageTexts?: Array<{ page: number; text: string }>
}

export type BookCompletePlan = {
  sourceId: string
  title: string
  stages: BookCompleteStage[]
  dry_run: boolean
  apply: boolean
  identical_pdf: boolean
  changed_pages: number[]
  ocr_pages: number[]
  ocr_cache_hits: number
  ocr_new_calls: number
  estimated_usd: number
  writes: number
  extra_writes_on_rerun: number
  lock_ok: boolean
  resume_from: BookCompleteStage | null
  toc_nodes: number
  exceptions: number
  reports: { json: string; markdown: string }
}

export function sourceLockPath(sourceId: string): string {
  return `ocr-tests/taxonomy/locks/${sourceId}.lock`
}

export function bookStatusPath(sourceId: string): string {
  return `public/book-status/${sourceId}.json`
}

export function parseIngestBookFlags(argv: string[]): {
  sourceId: string | null
  mode: string
  apply: boolean
  resume: boolean
  costCapUsd: number
  ocrPolicy: BookCompleteInput['ocrPolicy']
} {
  const read = (name: string): string | undefined => {
    const eq = argv.find((row) => row.startsWith(`${name}=`))
    if (eq) return eq.slice(name.length + 1)
    const idx = argv.indexOf(name)
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith('--')) return argv[idx + 1]
    return undefined
  }
  const sourceId = read('--source-id') ?? read('--source-document-id') ?? null
  const cap = Number(read('--cost-cap') ?? '1')
  const persistAlias = argv.includes('--apply') || argv.includes('--persist')
  return {
    sourceId,
    mode: read('--mode') ?? 'complete',
    apply: persistAlias,
    resume: argv.includes('--resume'),
    costCapUsd: Number.isFinite(cap) ? cap : 1,
    ocrPolicy: (read('--ocr-policy') as BookCompleteInput['ocrPolicy'] | undefined) ?? 'cache-first',
  }
}

export function genericOutlineAdapter(): OutlineAdapter {
  return {
    id: 'generic-toc',
    parseToc(pages) {
      const nodes: OutlineNode[] = []
      for (const page of pages) {
        const major = /(?:^|\n)\s*(?:제\s*)?([IVX]+|[0-9]+)\s*[.장.\s]+([^\n]{2,40})/.exec(page.text)
        if (major) {
          nodes.push({ code: major[1]!, title: major[2]!.trim(), startPage: page.page, level: 'MAJOR' })
        }
        const section = /(?:^|\n)\s*(\d{1,2})\s*[.]\s*([^\n]{2,40})/.exec(page.text)
        if (section) {
          nodes.push({ code: section[1]!.padStart(2, '0'), title: section[2]!.trim(), startPage: page.page, level: 'SECTION' })
        }
      }
      return nodes
    },
    assignUnit(input, toc) {
      const majors = toc.filter((node) => node.level === 'MAJOR' && node.startPage <= input.page)
      const sections = toc.filter((node) => node.level === 'SECTION' && node.startPage <= input.page)
      const major = majors.at(-1)
      const section = sections.at(-1)
      if (!major && !section) return null
      return { major: major?.code, section: section?.code }
    },
  }
}

export function changedPagesFromHashes(
  current: Array<{ page: number; sha256: string }>,
  previous?: Array<{ page: number; sha256: string }>,
): number[] {
  if (!previous?.length) return current.map((row) => row.page)
  const prev = new Map(previous.map((row) => [row.page, row.sha256]))
  return current.filter((row) => prev.get(row.page) !== row.sha256).map((row) => row.page)
}

export function selectiveOcrPages(input: {
  changedPages: number[]
  cachedOcrKeys: string[]
  pageHashes: Array<{ page: number; sha256: string }>
}): { cacheHits: number; ocrPages: number[] } {
  const cached = new Set(input.cachedOcrKeys)
  const ocrPages: number[] = []
  let cacheHits = 0
  for (const page of input.changedPages) {
    const sha = input.pageHashes.find((row) => row.page === page)?.sha256 ?? ''
    const key = `p${String(page).padStart(3, '0')}-${sha}`
    if (cached.has(key)) cacheHits += 1
    else ocrPages.push(page)
  }
  return { cacheHits, ocrPages }
}

export function nextIncompleteStage(completed: BookCompleteStage[]): BookCompleteStage | null {
  for (const stage of BOOK_COMPLETE_STAGES) {
    if (!completed.includes(stage)) return stage
  }
  return null
}

export function planBookComplete(
  input: BookCompleteInput,
  checkpoint?: { completed_stages?: BookCompleteStage[] },
): BookCompletePlan {
  const identical = Boolean(input.previousPdfHash && input.previousPdfHash === input.pdfHash)
  const changed = identical ? [] : changedPagesFromHashes(input.pageHashes, input.previousPageHashes)
  const selective = identical
    ? { cacheHits: input.pageCount, ocrPages: [] as number[] }
    : selectiveOcrPages({ changedPages: changed, cachedOcrKeys: input.cachedOcrKeys, pageHashes: input.pageHashes })
  const unit = 0.005
  const estimated = Number((selective.ocrPages.length * unit).toFixed(4))
  const overCap = estimated + (input.spentUsd ?? 0) > input.costCapUsd
  const ocrPages = input.ocrPolicy === 'cache-only' || overCap ? [] : selective.ocrPages
  const toc = input.adapter.parseToc(input.pageTexts ?? [])
  const writes = input.apply && !identical ? 1 : 0
  return {
    sourceId: input.sourceId,
    title: input.title,
    stages: [...BOOK_COMPLETE_STAGES],
    dry_run: !input.apply,
    apply: input.apply,
    identical_pdf: identical,
    changed_pages: changed,
    ocr_pages: ocrPages,
    ocr_cache_hits: selective.cacheHits,
    ocr_new_calls: ocrPages.length,
    estimated_usd: ocrPages.length ? estimated : 0,
    writes,
    extra_writes_on_rerun: identical || !input.apply ? 0 : 0,
    lock_ok: input.lockHeld,
    resume_from: nextIncompleteStage(checkpoint?.completed_stages ?? []),
    toc_nodes: toc.length,
    exceptions: 0,
    reports: {
      json: `ocr-tests/taxonomy/book-complete/${input.sourceId}/summary.json`,
      markdown: `ocr-tests/taxonomy/book-complete/${input.sourceId}/REPORT.md`,
    },
  }
}

export function formatBookCompleteMarkdown(plan: BookCompletePlan): string {
  return [
    `# Book complete ${plan.title}`,
    '',
    `- source ${plan.sourceId}`,
    `- dry-run ${plan.dry_run}`,
    `- identical PDF ${plan.identical_pdf}`,
    `- changed pages ${plan.changed_pages.length}`,
    `- OCR new ${plan.ocr_new_calls} cache ${plan.ocr_cache_hits} est $${plan.estimated_usd.toFixed(4)}`,
    `- writes ${plan.writes} extra-on-rerun ${plan.extra_writes_on_rerun}`,
    `- lock ${plan.lock_ok ? 'held' : 'missing'}`,
    `- stages ${plan.stages.join(' → ')}`,
    '',
  ].join('\n')
}
