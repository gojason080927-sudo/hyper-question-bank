/**
 * Paid Mistral OCR 4 for 쎈 공통수학 2 only.
 * Default is dry-run. Live calls need both paid flags.
 * Writes page text for this document only. Never creates problems.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { MISTRAL_ENDPOINT } from '../ocr/mathOcrTypes'
import { parsePaidGate, assertPaidMistralAllowed } from '../ocr/paidGate'
import { hasMistralCredentials, readMistralCredentials } from '../ocr/mistralSecrets'
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import {
  FORBIDDEN_SOURCE_IDS,
  MATH2_CACHE_DIR,
  MATH2_DOCUMENT_ID,
  MATH2_OCR_BATCH_SIZE,
  MATH2_OCR_COST_CAP_USD,
  MATH2_OCR_MODEL,
  MATH2_OCR_PROFILE,
  MATH2_OCR_PROVIDER,
  MATH2_PAGE_COUNT,
  MATH2_PDF_SHA256,
  MATH2_REPORT_DIR,
  MATH2_TITLE,
  analyzeMath2Page,
  assertMath2Document,
  assertPageRange,
  batchesOf,
  cacheFileName,
  estimateMath2OcrUsd,
  formatMath2QaMarkdown,
  fromApiPageIndex,
  nextSegmentationApproach,
  pageMarkdownFromRaw,
  paidCapAllows,
  pickQaSamples,
  planMath2Ocr,
  stripImageBase64,
  summarizeMath2Qa,
  toApiPages,
  type Math2PageQa,
} from './math2Ocr'

type CachedPage = {
  page: number
  markdown: string
  raw: MistralOcrLike
  model: string
}

function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function reportDir(root: string) {
  return path.join(root, MATH2_REPORT_DIR)
}

function cacheDir(root: string) {
  return path.join(root, MATH2_CACHE_DIR)
}

function loadCachedPages(root: string, pdfHash: string): Map<number, CachedPage> {
  const found = new Map<number, CachedPage>()
  for (let page = 1; page <= MATH2_PAGE_COUNT; page += 1) {
    const file = path.join(cacheDir(root), cacheFileName(pdfHash, page))
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as CachedPage
      if (raw.page === page && raw.markdown) found.set(page, raw)
    } catch {
      /* ignore broken cache */
    }
  }
  return found
}

function writeCachedPage(root: string, pdfHash: string, page: CachedPage) {
  mkdirSync(cacheDir(root), { recursive: true })
  writeFileSync(path.join(cacheDir(root), cacheFileName(pdfHash, page.page)), JSON.stringify(page), 'utf8')
}

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedPdfUrl(): Promise<string> {
  const client = adminClient()
  if (!client) throw new Error('MATH2_OCR_SUPABASE: missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const signed = await client.storage.from('question-bank-sources').createSignedUrl(`${MATH2_DOCUMENT_ID}/original.pdf`, 60 * 60 * 3)
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? 'signed url failed')
  return signed.data.signedUrl
}

async function uploadPdfToMistral(pdfPath: string): Promise<string> {
  const creds = readMistralCredentials()
  if (!creds) throw new Error('MISTRAL_ABSENT')
  const bytes = readFileSync(pdfPath)
  const form = new FormData()
  form.set('purpose', 'ocr')
  form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'ssen-common-math-2.pdf')
  const response = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    body: form,
  })
  const body = (await response.json()) as { id?: string; message?: string }
  if (!response.ok || !body.id) throw new Error(body.message ?? `MISTRAL_FILE_HTTP_${response.status}`)
  const signed = await fetch(`https://api.mistral.ai/v1/files/${body.id}/url`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  })
  const signedBody = (await signed.json()) as { url?: string }
  if (!signed.ok || !signedBody.url) throw new Error(`MISTRAL_FILE_URL_HTTP_${signed.status}`)
  return signedBody.url
}

async function mistralOcrPages(documentUrl: string, bookPages: number[]): Promise<{ raw: MistralOcrLike; http: number; processed: number }> {
  const creds = readMistralCredentials()
  if (!creds) throw new Error('MISTRAL_ABSENT')
  const response = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MATH2_OCR_MODEL,
      document: { type: 'document_url', document_url: documentUrl },
      pages: toApiPages(bookPages),
      include_image_base64: false,
      include_blocks: true,
      table_format: 'html',
    }),
  })
  const raw = stripImageBase64((await response.json()) as MistralOcrLike)
  if (!response.ok) {
    throw new Error(raw.error ?? raw.detail ?? raw.message ?? `HTTP ${response.status}`)
  }
  return {
    raw,
    http: response.status,
    processed: raw.usage_info?.pages_processed ?? (raw.pages?.length ?? 0),
  }
}

async function writePageTextToSource(pages: Array<{ page: number; markdown: string }>) {
  const client = adminClient()
  if (!client) throw new Error('MATH2_OCR_SUPABASE: cannot persist page text')
  assertMath2Document(MATH2_DOCUMENT_ID)
  for (const forbidden of FORBIDDEN_SOURCE_IDS) {
    if (forbidden === MATH2_DOCUMENT_ID) throw new Error('MATH2_OCR_FORBIDDEN: source lock collapsed')
  }
  for (const row of pages) {
    const { data, error } = await client
      .from('source_pages')
      .update({
        extracted_text: row.markdown,
        text_char_count: row.markdown.length,
        ocr_status: row.markdown.trim() ? 'SUCCEEDED' : 'FAILED',
        extraction_status: row.markdown.trim() ? 'EXTRACTED' : 'MANUAL',
      })
      .eq('source_document_id', MATH2_DOCUMENT_ID)
      .eq('page_number', row.page)
      .select('id')
    if (error) throw new Error(`source_pages p${row.page}: ${error.message}`)
    if (!data?.length) throw new Error(`source_pages p${row.page}: no row`)
  }
  const { count } = await client
    .from('source_pages')
    .select('id', { count: 'exact', head: true })
    .eq('source_document_id', MATH2_DOCUMENT_ID)
    .eq('ocr_status', 'SUCCEEDED')
  const allOk = (count ?? 0) >= MATH2_PAGE_COUNT
  const { error: docError } = await client
    .from('source_documents')
    .update({ ocr_status: allOk ? 'SUCCEEDED' : 'REVIEW_REQUIRED' })
    .eq('id', MATH2_DOCUMENT_ID)
  if (docError) throw new Error(`source_documents: ${docError.message}`)
}

function writeReports(
  root: string,
  input: {
    plan: ReturnType<typeof planMath2Ocr>
    qaRows: Math2PageQa[]
    markdownByPage: Map<number, string>
    spentUsd: number
    modelUsed: string
    calledPages: number[]
    persistPageText: boolean
  },
) {
  const dest = reportDir(root)
  mkdirSync(path.join(dest, 'pages'), { recursive: true })
  const qa = summarizeMath2Qa(input.qaRows)
  const samplePages = new Set(pickQaSamples(input.qaRows))
  const samples = input.qaRows.filter((row) => samplePages.has(row.page))
  const next = nextSegmentationApproach(qa)
  const summary = {
    sourceId: MATH2_DOCUMENT_ID,
    title: MATH2_TITLE,
    provider: MATH2_OCR_PROVIDER,
    model: input.modelUsed,
    profile: MATH2_OCR_PROFILE,
    pageCount: MATH2_PAGE_COUNT,
    persist_problems: false,
    persist_page_text: input.persistPageText,
    called_pages: input.calledPages,
    spent_usd: input.spentUsd,
    cap_usd: MATH2_OCR_COST_CAP_USD,
    plan: input.plan,
    qa,
    samples,
    next,
    student_care_accessed: false,
  }
  writeFileSync(path.join(dest, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  writeFileSync(
    path.join(dest, 'qa.md'),
    formatMath2QaMarkdown({
      plan: input.plan,
      qa,
      samples,
      spentUsd: input.spentUsd,
      modelUsed: input.modelUsed,
      next,
    }),
    'utf8',
  )
  for (const row of input.qaRows) {
    const body = input.markdownByPage.get(row.page) ?? row.preview
    writeFileSync(path.join(dest, 'pages', `p${String(row.page).padStart(3, '0')}.md`), `${body}\n`, 'utf8')
  }
  return summary
}

export async function runMath2Ocr(root = process.cwd(), argv = process.argv.slice(2)) {
  const gate = parsePaidGate(argv)
  const persistPageText = argv.includes('--persist-page-text')
  const persistProblems = argv.includes('--persist-problems')
  if (persistProblems) throw new Error('MATH2_OCR_NO_PROBLEMS: problem persist is forbidden in this step')

  const pdfCandidates = [
    '/tmp/ssen-common-math-2.pdf',
    '/tmp/ssen-common-math-2-storage.pdf',
    path.join(root, '.ocr-temp/math2-original.pdf'),
  ]
  const pdfPath = pdfCandidates.find((file) => existsSync(file)) ?? null
  const pdfHash = pdfPath ? sha256Bytes(readFileSync(pdfPath)) : MATH2_PDF_SHA256
  if (pdfHash !== MATH2_PDF_SHA256) throw new Error(`MATH2_OCR_HASH: ${pdfHash} != ${MATH2_PDF_SHA256}`)
  assertMath2Document(MATH2_DOCUMENT_ID)

  const cached = loadCachedPages(root, pdfHash)
  const plan = planMath2Ocr({ cachedPages: [...cached.keys()], pdfHash })
  console.log(
    JSON.stringify(
      {
        phase: 'plan',
        sourceId: plan.sourceId,
        pages: plan.pageCount,
        cached: plan.cachedPages.length,
        miss: plan.missPages.length,
        estimated_usd: plan.estimatedUsd,
        cap: plan.capUsd,
        under_cap: plan.underCap,
        persist_problems: false,
        dry_run: !gate.allowPaidApi || !gate.confirmCost,
        credentials: hasMistralCredentials() ? 'PRESENT' : 'ABSENT',
      },
      null,
      2,
    ),
  )

  if (!gate.allowPaidApi || !gate.confirmCost || gate.cacheOnly) {
    const qaRows = plan.cachedPages.map((page) => {
      const hit = cached.get(page)!
      return analyzeMath2Page({ page, markdown: hit.markdown, raw: hit.raw, cached: true })
    })
    const markdownByPage = new Map(plan.cachedPages.map((page) => [page, cached.get(page)!.markdown]))
    return writeReports(root, {
      plan,
      qaRows,
      markdownByPage,
      spentUsd: 0,
      modelUsed: MATH2_OCR_MODEL,
      calledPages: [],
      persistPageText: false,
    })
  }

  if (!plan.underCap) throw new Error(`MATH2_OCR_CAP: estimated $${plan.estimatedUsd} exceeds $${plan.capUsd}`)
  assertPaidMistralAllowed(gate)
  if (plan.missPages.length) assertPageRange(plan.missPages)

  let documentUrl: string | null = null
  try {
    documentUrl = await signedPdfUrl()
  } catch (error) {
    console.log(JSON.stringify({ phase: 'signed-url-fallback', error: error instanceof Error ? error.message : 'signed-url' }))
    if (!pdfPath) throw error
    documentUrl = await uploadPdfToMistral(pdfPath)
  }

  let spentUsd = 0
  const calledPages: number[] = []
  const qaRows: Math2PageQa[] = []
  for (const page of plan.cachedPages) {
    const hit = cached.get(page)!
    qaRows.push(analyzeMath2Page({ page, markdown: hit.markdown, raw: hit.raw, cached: true }))
  }

  const remaining = [...plan.missPages]
  const queue: number[][] = remaining.length ? [[remaining[0]!], ...batchesOf(remaining.slice(1), MATH2_OCR_BATCH_SIZE)] : []

  for (const batch of queue) {
    const cap = paidCapAllows(spentUsd, batch.length)
    console.log(
      JSON.stringify({
        phase: 'pre-call',
        pages: batch,
        next_calls: batch.length,
        next_usd: cap.nextUsd,
        total_usd: cap.totalUsd,
        cap: MATH2_OCR_COST_CAP_USD,
      }),
    )
    if (!cap.ok) throw new Error(`MATH2_OCR_CAP: next batch would spend $${cap.totalUsd}`)

    let lastError: string | null = null
    let done = false
    for (let attempt = 0; attempt < 4 && !done; attempt += 1) {
      try {
        const result = await mistralOcrPages(documentUrl, batch)
        if (result.processed > batch.length + 1e-9 && result.processed > MATH2_PAGE_COUNT) {
          throw new Error(`MATH2_OCR_OVERBILL: processed ${result.processed}`)
        }
        const billed = Math.max(result.processed, result.raw.pages?.length ?? batch.length)
        spentUsd = Number((spentUsd + estimateMath2OcrUsd(billed)).toFixed(4))
        if (spentUsd > MATH2_OCR_COST_CAP_USD + 1e-9) throw new Error(`MATH2_OCR_CAP: spent $${spentUsd}`)
        const returned = new Map<number, string>()
        for (const rawPage of result.raw.pages ?? []) {
          const bookPage = fromApiPageIndex(rawPage.index ?? 0)
          const markdown = rawPage.markdown ?? ''
          returned.set(bookPage, markdown)
          const record: CachedPage = {
            page: bookPage,
            markdown,
            raw: { ...result.raw, pages: [rawPage] },
            model: result.raw.model ?? MATH2_OCR_MODEL,
          }
          writeCachedPage(root, pdfHash, record)
          calledPages.push(bookPage)
          qaRows.push(analyzeMath2Page({ page: bookPage, markdown, raw: record.raw, cached: false }))
        }
        for (const page of batch) {
          if (returned.has(page)) continue
          const markdown = pageMarkdownFromRaw(result.raw, page - 1)
          if (!markdown) {
            qaRows.push(analyzeMath2Page({ page, markdown: '', error: 'missing_page_in_response' }))
            continue
          }
          const record: CachedPage = { page, markdown, raw: result.raw, model: result.raw.model ?? MATH2_OCR_MODEL }
          writeCachedPage(root, pdfHash, record)
          calledPages.push(page)
          qaRows.push(analyzeMath2Page({ page, markdown, raw: result.raw, cached: false }))
        }
        done = true
        await sleep(200)
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'ocr_failed'
        if (batch.length > 1 && attempt === 2) {
          queue.push(...batch.map((page) => [page]))
          done = true
          lastError = null
          break
        }
        await sleep(1500 * 2 ** attempt)
      }
    }
    if (!done && lastError) {
      for (const page of batch) qaRows.push(analyzeMath2Page({ page, markdown: '', error: lastError }))
    }
  }

  qaRows.sort((a, b) => a.page - b.page)
  const unique = new Map<number, Math2PageQa>()
  for (const row of qaRows) unique.set(row.page, row)
  const finalRows = [...unique.values()].sort((a, b) => a.page - b.page)

  if (persistPageText) {
    const ok = finalRows.filter((row) => row.ok).map((row) => {
      const file = path.join(cacheDir(root), cacheFileName(pdfHash, row.page))
      const cachedPage = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as CachedPage) : null
      return { page: row.page, markdown: cachedPage?.markdown ?? row.preview }
    })
    await writePageTextToSource(ok)
  }

  const markdownByPage = new Map<number, string>()
  for (const row of finalRows) {
    const file = path.join(cacheDir(root), cacheFileName(pdfHash, row.page))
    if (existsSync(file)) markdownByPage.set(row.page, (JSON.parse(readFileSync(file, 'utf8')) as CachedPage).markdown)
  }
  const summary = writeReports(root, {
    plan,
    qaRows: finalRows,
    markdownByPage,
    spentUsd,
    modelUsed: MATH2_OCR_MODEL,
    calledPages: [...new Set(calledPages)].sort((a, b) => a - b),
    persistPageText,
  })
  console.log(
    JSON.stringify(
      {
        phase: 'done',
        success: summary.qa.success,
        failed: summary.qa.failed,
        cached: summary.qa.cached,
        called: summary.called_pages.length,
        spent_usd: spentUsd,
        persist_problems: false,
      },
      null,
      2,
    ),
  )
  return summary
}

const isMain = process.argv[1]?.includes('math2OcrCli')
if (isMain) {
  await runMath2Ocr(process.cwd(), process.argv.slice(2))
}
