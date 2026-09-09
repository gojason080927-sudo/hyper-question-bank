import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { compareCacheFileName } from '../ocr/ocrCompare'
import { MISTRAL_PROVIDER } from '../ocr/mathOcrTypes'
import { MISTRAL_SEGMENT_PROFILE } from '../recognition/segmentBenchmark'
import type { PipelineCandidate } from '../recognition/bookPipeline'

export const STEP88_DOCUMENT = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'
export const STEP88_EXPECTED_DRAFTS = 115
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'

export function loadEnvLocal(root: string) {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function padPage(page: number): string {
  return String(page).padStart(3, '0')
}

export function pagePngPath(root: string, page: number): string | null {
  const original = path.join(root, 'ocr-tests/original', `page-${padPage(page)}.png`)
  if (existsSync(original)) return original
  const rendered = path.join(root, 'ocr-tests/book-pipeline/pages', `page-${padPage(page)}.png`)
  if (existsSync(rendered)) return rendered
  return null
}

export function readPageOcrText(root: string, page: number): string {
  const image = pagePngPath(root, page)
  if (!image) return ''
  const cache = path.join(root, 'ocr-tests/mistral', compareCacheFileName(MISTRAL_PROVIDER, sha256File(image), MISTRAL_SEGMENT_PROFILE))
  if (!existsSync(cache)) return ''
  const raw = JSON.parse(readFileSync(cache, 'utf8')) as { raw_ocr?: string; raw_response?: { pages?: Array<{ markdown?: string }> } }
  return raw.raw_ocr ?? raw.raw_response?.pages?.[0]?.markdown ?? ''
}

export function loadPipelineCandidates(root: string): PipelineCandidate[] {
  const file = path.join(root, 'ocr-tests/book-pipeline/step8-7/stage-b-candidates.json')
  const loaded = JSON.parse(readFileSync(file, 'utf8')) as { candidates?: PipelineCandidate[] }
  return (loaded.candidates ?? []).filter((row) => row.layout_kind === 'PROBLEM')
}

export function collectCreatedIds(root: string): string[] {
  const dir = path.join(root, 'ocr-tests/book-pipeline/step8-7')
  const ids: string[] = []
  for (const name of readdirSync(dir)) {
    if (!/^stage-e-batch-\d+\.json$/.test(name)) continue
    const batch = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
      created_problem_ids?: string[]
      problem_identities?: string[]
    }
    for (const id of batch.created_problem_ids ?? []) if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export function identityMap(root: string): Array<{ problem_id: string; page: number; problem_number: string }> {
  const dir = path.join(root, 'ocr-tests/book-pipeline/step8-7')
  const out: Array<{ problem_id: string; page: number; problem_number: string }> = []
  for (const name of readdirSync(dir)) {
    if (!/^stage-e-batch-\d+\.json$/.test(name)) continue
    const batch = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
      created_problem_ids?: string[]
      problem_identities?: string[]
    }
    const ids = batch.created_problem_ids ?? []
    const identities = batch.problem_identities ?? []
    for (let i = 0; i < ids.length; i += 1) {
      const parts = (identities[i] ?? '').split('|')
      const page = Number(parts[1])
      const problem_number = parts[2] ?? ''
      if (ids[i] && page && problem_number) out.push({ problem_id: ids[i], page, problem_number })
    }
  }
  return out
}

export async function readDraftsReadonly(root: string, expectedIds: string[]) {
  loadEnvLocal(root)
  const url = process.env.VITE_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) throw new Error('Missing Supabase env')
  if (url.includes(STUDENT_CARE_REF)) throw new Error('Student Care project refused')
  if (!url.includes(QUESTION_BANK_REF)) throw new Error('Wrong Supabase project')
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const problems = await admin.from('problems').select('id, review_status, lifecycle_status, current_version_id').in('id', expectedIds)
  if (problems.error) throw new Error(problems.error.message)
  const versions = await admin
    .from('problem_versions')
    .select('id, problem_id, problem_text, classification_status, review_status')
    .in('problem_id', expectedIds)
  if (versions.error) throw new Error(versions.error.message)
  const sources = await admin.from('problem_sources').select('id, problem_id, source_document_id').in('problem_id', expectedIds)
  if (sources.error) throw new Error(sources.error.message)
  const uniqueProblems = new Set((problems.data ?? []).map((row) => row.id))
  const uniqueSources = new Set((sources.data ?? []).filter((row) => row.source_document_id === STEP88_DOCUMENT).map((row) => row.problem_id))
  return {
    before: STEP88_EXPECTED_DRAFTS,
    after: uniqueProblems.size,
    source_trace: uniqueSources.size,
    duplicate: expectedIds.length - uniqueProblems.size,
    versions: versions.data ?? [],
    db_writes: 0,
  }
}
