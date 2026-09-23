/**
 * Generic book page OCR. Default dry-run.
 * Live batch needs both paid flags. Never writes problems.
 * Refuses SSEN / 쎈2 documents. Caps on batch USD, not realtime.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parsePaidGate, assertPaidMistralAllowed } from '../ocr/paidGate'
import { hasMistralCredentials, readMistralCredentials } from '../ocr/mistralSecrets'
import type { MistralOcrLike } from '../ocr/normalizeMistral'
import {
  MATH2_OCR_BATCH_SIZE,
  MATH2_OCR_BATCH_USD_PER_PAGE,
  MATH2_OCR_COST_CAP_USD,
  MATH2_OCR_MODEL,
  MATH2_OCR_PROFILE,
  MATH2_OCR_PROVIDER,
  batchesOf,
  cacheFileName,
  estimateMath2BatchUsd,
  fromApiPageIndex,
  pageMarkdownFromRaw,
  pickQaSamples,
  stripImageBase64,
  toApiPages,
  type Math2PageQa,
} from './math2Ocr'
import {
  BOOK_INGEST_FORBIDDEN_IDS,
  analyzeBookPage,
  assertBookIngestSource,
  assertBookPageRange,
  formatBookOcrMarkdown,
  planBookOcr,
  specFromBookArg,
  summarizeBookQa,
  type BookIngestSpec,
} from './bookIngestSpec'

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

function specFromArgv(argv: string[]): BookIngestSpec {
  return specFromBookArg(argv)
}

function loadCachedPages(root: string, spec: BookIngestSpec, pdfHash: string): Map<number, CachedPage> {
  const found = new Map<number, CachedPage>()
  for (let page = 1; page <= spec.pageCount; page += 1) {
    const file = path.join(root, spec.cacheDir, cacheFileName(pdfHash, page))
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

function writeCachedPage(root: string, spec: BookIngestSpec, pdfHash: string, page: CachedPage) {
  const dest = path.join(root, spec.cacheDir, cacheFileName(pdfHash, page.page))
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, JSON.stringify(page), 'utf8')
}

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function mistralAuthHeaders(): Promise<Record<string, string>> {
  const creds = readMistralCredentials()
  if (!creds) throw new Error('MISTRAL_ABSENT')
  return { Authorization: `Bearer ${creds.apiKey}` }
}

async function uploadMistralFile(bytes: Buffer, fileName: string, purpose: 'ocr' | 'batch'): Promise<string> {
  const form = new FormData()
  form.set('purpose', purpose)
  form.set(
    'file',
    new Blob([new Uint8Array(bytes)], { type: purpose === 'batch' ? 'application/jsonl' : 'application/pdf' }),
    fileName,
  )
  const response = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: await mistralAuthHeaders(),
    body: form,
  })
  const body = (await response.json()) as { id?: string; message?: string }
  if (!response.ok || !body.id) throw new Error(body.message ?? `MISTRAL_FILE_HTTP_${response.status}`)
  return body.id
}

async function mistralFileUrl(fileId: string): Promise<string> {
  const response = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url`, {
    headers: await mistralAuthHeaders(),
  })
  const body = (await response.json()) as { url?: string; message?: string }
  if (!response.ok || !body.url) throw new Error(body.message ?? `MISTRAL_FILE_URL_${response.status}`)
  return body.url
}

function ingestBatchPages(
  root: string,
  spec: BookIngestSpec,
  pdfHash: string,
  raw: MistralOcrLike,
  fallbackPages: number[],
): CachedPage[] {
  const out: CachedPage[] = []
  const returned = new Set<number>()
  for (const rawPage of raw.pages ?? []) {
    const bookPage = fromApiPageIndex(rawPage.index ?? 0)
    if (bookPage < 1 || bookPage > spec.pageCount) continue
    const markdown = rawPage.markdown ?? ''
    const record: CachedPage = {
      page: bookPage,
      markdown,
      raw: { ...raw, pages: [rawPage] },
      model: raw.model ?? MATH2_OCR_MODEL,
    }
    writeCachedPage(root, spec, pdfHash, record)
    out.push(record)
    returned.add(bookPage)
  }
  for (const page of fallbackPages) {
    if (returned.has(page)) continue
    const markdown = pageMarkdownFromRaw(raw, page - 1)
    if (!markdown) continue
    const record: CachedPage = { page, markdown, raw, model: raw.model ?? MATH2_OCR_MODEL }
    writeCachedPage(root, spec, pdfHash, record)
    out.push(record)
  }
  return out
}

async function writePageTextToSource(spec: BookIngestSpec, pages: Array<{ page: number; markdown: string }>) {
  const client = adminClient()
  if (!client) throw new Error('BOOK_OCR_SUPABASE: cannot persist page text')
  assertBookIngestSource(spec, spec.sourceId)
  for (const forbidden of BOOK_INGEST_FORBIDDEN_IDS) {
    if (forbidden === spec.sourceId) throw new Error('BOOK_OCR_FORBIDDEN: source lock collapsed')
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
      .eq('source_document_id', spec.sourceId)
      .eq('page_number', row.page)
      .select('id')
    if (error) throw new Error(`source_pages p${row.page}: ${error.message}`)
    if (!data?.length) throw new Error(`source_pages p${row.page}: no row`)
  }
  const { count } = await client
    .from('source_pages')
    .select('id', { count: 'exact', head: true })
    .eq('source_document_id', spec.sourceId)
    .eq('ocr_status', 'SUCCEEDED')
  const allOk = (count ?? 0) >= spec.pageCount
  const { error: docError } = await client
    .from('source_documents')
    .update({ ocr_status: allOk ? 'SUCCEEDED' : 'REVIEW_REQUIRED' })
    .eq('id', spec.sourceId)
  if (docError) throw new Error(`source_documents: ${docError.message}`)
}

function writeReports(
  root: string,
  spec: BookIngestSpec,
  input: {
    plan: ReturnType<typeof planBookOcr>
    qaRows: Math2PageQa[]
    markdownByPage: Map<number, string>
    spentUsd: number
    modelUsed: string
    calledPages: number[]
    persistPageText: boolean
  },
) {
  const dest = path.join(root, spec.reportDir)
  mkdirSync(path.join(dest, 'pages'), { recursive: true })
  const qa = summarizeBookQa(spec, input.qaRows)
  const samplePages = new Set(pickQaSamples(input.qaRows))
  const samples = input.qaRows.filter((row) => samplePages.has(row.page))
  const summary = {
    sourceId: spec.sourceId,
    title: spec.title,
    provider: MATH2_OCR_PROVIDER,
    model: input.modelUsed,
    profile: MATH2_OCR_PROFILE,
    pageCount: spec.pageCount,
    persist_problems: false,
    persist_page_text: input.persistPageText,
    called_pages: input.calledPages,
    spent_usd: input.spentUsd,
    cap_usd: MATH2_OCR_COST_CAP_USD,
    unit: MATH2_OCR_BATCH_USD_PER_PAGE,
    plan: input.plan,
    qa,
    samples,
    student_care_accessed: false,
  }
  writeFileSync(path.join(dest, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  writeFileSync(
    path.join(dest, 'qa.md'),
    formatBookOcrMarkdown({
      spec,
      plan: input.plan,
      qa,
      samples,
      spentUsd: input.spentUsd,
      modelUsed: input.modelUsed,
    }),
    'utf8',
  )
  for (const row of input.qaRows) {
    const body = input.markdownByPage.get(row.page) ?? row.preview
    writeFileSync(path.join(dest, 'pages', `p${String(row.page).padStart(3, '0')}.md`), `${body}\n`, 'utf8')
  }
  return summary
}

export async function runBookOcr(root = process.cwd(), argv = process.argv.slice(2), spec = specFromArgv(argv)) {
  const gate = parsePaidGate(argv)
  const persistPageText = argv.includes('--persist-page-text')
  if (argv.includes('--persist-problems')) throw new Error('BOOK_OCR_NO_PROBLEMS: problem persist is forbidden in OCR')
  assertBookIngestSource(spec, spec.sourceId)

  const pdfPath = spec.pdfPaths.map((file) => (path.isAbsolute(file) ? file : path.join(root, file))).find((file) => existsSync(file)) ?? null
  const pdfHash = pdfPath ? sha256Bytes(readFileSync(pdfPath)) : spec.pdfHash
  if (pdfHash !== spec.pdfHash) throw new Error(`BOOK_OCR_HASH: ${pdfHash} != ${spec.pdfHash}`)

  const cached = loadCachedPages(root, spec, pdfHash)
  const plan = planBookOcr(spec, { cachedPages: [...cached.keys()], pdfHash })
  console.log(
    JSON.stringify(
      {
        phase: 'plan',
        sourceId: plan.sourceId,
        title: plan.title,
        pages: plan.pageCount,
        cached: plan.cachedPages.length,
        miss: plan.missPages.length,
        batch_usd: plan.batchUsd,
        realtime_usd: plan.realtimeUsd,
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
      return analyzeBookPage(spec, { page, markdown: hit.markdown, raw: hit.raw, cached: true })
    })
    const markdownByPage = new Map(plan.cachedPages.map((page) => [page, cached.get(page)!.markdown]))
    return writeReports(root, spec, {
      plan,
      qaRows,
      markdownByPage,
      spentUsd: 0,
      modelUsed: MATH2_OCR_MODEL,
      calledPages: [],
      persistPageText: false,
    })
  }

  if (!plan.underCap) throw new Error(`BOOK_OCR_CAP: batch $${plan.batchUsd} exceeds $${plan.capUsd}`)
  if (plan.realtimeUsd > plan.capUsd + 1e-9) {
    console.log(JSON.stringify({ phase: 'realtime-refused', realtime_usd: plan.realtimeUsd, reason: 'use batch only' }))
  }
  assertPaidMistralAllowed(gate)
  if (plan.missPages.length) assertBookPageRange(spec, plan.missPages)
  if (!pdfPath) throw new Error('BOOK_OCR_PDF_MISSING')

  console.log(
    JSON.stringify({
      phase: 'batch-pre-call',
      pages: plan.missPages.length,
      batch_usd: plan.batchUsd,
      cap: MATH2_OCR_COST_CAP_USD,
    }),
  )

  const pdfId = await uploadMistralFile(readFileSync(pdfPath), `${spec.slug}.pdf`, 'ocr')
  const documentUrl = await mistralFileUrl(pdfId)
  const groups = batchesOf(plan.missPages, MATH2_OCR_BATCH_SIZE)
  const lines = groups.map((pages, index) =>
    JSON.stringify({
      custom_id: `${spec.slug}-${String(index).padStart(3, '0')}-p${String(pages[0]).padStart(3, '0')}-${String(pages.at(-1)).padStart(3, '0')}`,
      body: {
        model: MATH2_OCR_MODEL,
        document: { type: 'document_url', document_url: documentUrl },
        pages: toApiPages(pages),
        include_image_base64: false,
        include_blocks: true,
        table_format: 'html',
      },
    }),
  )
  const jsonl = Buffer.from(`${lines.join('\n')}\n`)
  mkdirSync(path.join(root, spec.cacheDir), { recursive: true })
  writeFileSync(path.join(root, spec.cacheDir, 'batch-input.jsonl'), jsonl)
  const inputFileId = await uploadMistralFile(jsonl, `${spec.slug}-ocr.jsonl`, 'batch')
  const created = await fetch('https://api.mistral.ai/v1/batch/jobs', {
    method: 'POST',
    headers: { ...(await mistralAuthHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: '/v1/ocr',
      model: MATH2_OCR_MODEL,
      input_files: [inputFileId],
      timeout_hours: 6,
      metadata: { source_id: spec.sourceId, persist_problems: 'false' },
    }),
  })
  const job = (await created.json()) as { id?: string; status?: string; message?: string }
  if (!created.ok || !job.id) {
    throw new Error(`BATCH_CREATE_${created.status} ${job.message ?? JSON.stringify(job)}`)
  }
  writeFileSync(path.join(root, spec.cacheDir, 'batch-job.json'), JSON.stringify(job, null, 2))
  console.log(JSON.stringify({ phase: 'batch-queued', id: job.id, requests: groups.length, status: job.status }))

  let current = job as typeof job & {
    status?: string
    output_file?: string
    succeeded_requests?: number
    failed_requests?: number
    completed_requests?: number
    total_requests?: number
  }
  for (let i = 0; i < 240; i += 1) {
    await sleep(30000)
    const poll = await fetch(`https://api.mistral.ai/v1/batch/jobs/${job.id}`, { headers: await mistralAuthHeaders() })
    current = (await poll.json()) as typeof current
    console.log(
      JSON.stringify({
        phase: 'batch-poll',
        status: current.status,
        succeeded: current.succeeded_requests,
        failed: current.failed_requests,
        completed: current.completed_requests,
        total: current.total_requests,
      }),
    )
    if (current.status === 'SUCCESS' || current.status === 'FAILED' || current.status === 'TIMEOUT_EXCEEDED' || current.status === 'CANCELLED') {
      break
    }
  }
  if (current.status !== 'SUCCESS') throw new Error(`BATCH_STATUS_${current.status ?? 'unknown'}`)

  const outputId = current.output_file
  if (!outputId) throw new Error('BATCH_NO_OUTPUT')
  const outRes = await fetch(`https://api.mistral.ai/v1/files/${outputId}/content`, { headers: await mistralAuthHeaders() })
  if (!outRes.ok) throw new Error(`BATCH_OUTPUT_${outRes.status}`)
  const outText = await outRes.text()
  writeFileSync(path.join(root, spec.cacheDir, 'batch-output.jsonl'), outText)

  const ingested: CachedPage[] = []
  for (const line of outText.split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { custom_id?: string; response?: { body?: MistralOcrLike }; body?: MistralOcrLike }
    const raw = stripImageBase64(row.response?.body ?? row.body ?? {})
    const match = /p(\d{3})-(\d{3})/.exec(row.custom_id ?? '')
    const fallback = match
      ? Array.from({ length: Number(match[2]) - Number(match[1]) + 1 }, (_, i) => Number(match[1]) + i)
      : []
    ingested.push(...ingestBatchPages(root, spec, pdfHash, raw, fallback))
  }

  const qaRows: Math2PageQa[] = []
  const markdownByPage = new Map<number, string>()
  const calledPages: number[] = []
  for (const page of plan.cachedPages) {
    const hit = cached.get(page)!
    qaRows.push(analyzeBookPage(spec, { page, markdown: hit.markdown, raw: hit.raw, cached: true }))
    markdownByPage.set(page, hit.markdown)
  }
  for (const rec of ingested) {
    qaRows.push(analyzeBookPage(spec, { page: rec.page, markdown: rec.markdown, raw: rec.raw, cached: false }))
    markdownByPage.set(rec.page, rec.markdown)
    calledPages.push(rec.page)
  }
  qaRows.sort((a, b) => a.page - b.page)
  const unique = new Map(qaRows.map((row) => [row.page, row]))
  const finalRows = [...unique.values()].sort((a, b) => a.page - b.page)
  const billedPages = new Set(calledPages).size
  const spentUsd = estimateMath2BatchUsd(billedPages)

  if (persistPageText) {
    await writePageTextToSource(
      spec,
      finalRows.filter((row) => row.ok).map((row) => ({ page: row.page, markdown: markdownByPage.get(row.page) ?? '' })),
    )
  }

  const summary = writeReports(root, spec, {
    plan,
    qaRows: finalRows,
    markdownByPage,
    spentUsd,
    modelUsed: `${MATH2_OCR_MODEL}+batch`,
    calledPages: [...new Set(calledPages)].sort((a, b) => a - b),
    persistPageText,
  })
  console.log(
    JSON.stringify({
      phase: 'done',
      mode: 'batch',
      success: summary.qa.success,
      failed: summary.qa.failed,
      cached: summary.qa.cached,
      called: billedPages,
      spent_usd: spentUsd,
      unit: MATH2_OCR_BATCH_USD_PER_PAGE,
      persist_problems: false,
    }),
  )
  return summary
}

const isMain = process.argv[1]?.includes('bookOcrCli')
if (isMain) {
  await runBookOcr(process.cwd(), process.argv.slice(2))
}
