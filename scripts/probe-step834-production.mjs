/**
 * Read-only Production probe for STEP 8.34.
 * Never INSERT/UPDATE/DELETE. Never logs secrets.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'ocr-tests/taxonomy/step8-34')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const SSEN = '9ff369b4-5b16-4cb8-bfc3-a6b180c18703'

async function countExact(url, key, table, filter) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter ?? {})) q = q.eq(column, value)
  const result = await q
  if (result.error) {
    if (/does not exist|schema cache/i.test(result.error.message)) return { count: null, error: result.error.message }
    throw new Error(`${table} count: ${result.error.message}`)
  }
  return { count: result.count ?? 0, error: null }
}

const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
mkdirSync(dest, { recursive: true })

if (url.includes(STUDENT_CARE_REF)) {
  console.error('Student Care project refused')
  process.exit(1)
}
if (url && !url.includes(QUESTION_BANK_REF)) {
  console.error('Wrong Supabase project')
  process.exit(1)
}

const snapshot = {
  step: '8.34',
  writes: 0,
  student_care_accessed: false,
  queried: Boolean(url && key),
  drafts: null,
  needs_review: null,
  ssen_needs_review: null,
  embeddings: null,
  duplicate_links: null,
  bbox_corrections: null,
  fingerprints: null,
  vector_table: null,
}

if (url && key) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  snapshot.drafts = (await countExact(url, key, 'problems', { lifecycle_status: 'DRAFT' })).count
  snapshot.needs_review = (await countExact(url, key, 'problems', { review_status: 'NEEDS_REVIEW' })).count
  snapshot.fingerprints = (await countExact(url, key, 'content_fingerprints')).count
  const embeddings = await countExact(url, key, 'problem_embeddings')
  snapshot.embeddings = embeddings.count
  snapshot.vector_table = embeddings.error ? 'ABSENT' : 'PRESENT'
  snapshot.duplicate_links = (await countExact(url, key, 'problem_duplicate_links')).count
  snapshot.bbox_corrections = (await countExact(url, key, 'problem_source_bbox_corrections')).count

  const ids = new Set()
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from('problem_sources')
      .select('problem_id')
      .eq('source_document_id', SSEN)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    for (const row of data) ids.add(row.problem_id)
    if (data.length < 1000) break
  }
  let n = 0
  const list = [...ids]
  for (let i = 0; i < list.length; i += 200) {
    const { count, error } = await admin
      .from('problems')
      .select('id', { count: 'exact', head: true })
      .in('id', list.slice(i, i + 200))
      .eq('review_status', 'NEEDS_REVIEW')
    if (error) throw new Error(error.message)
    n += count ?? 0
  }
  snapshot.ssen_needs_review = n
}

writeFileSync(path.join(dest, 'production-readonly.json'), JSON.stringify(snapshot, null, 2), 'utf8')
console.log(JSON.stringify(snapshot, null, 2))
