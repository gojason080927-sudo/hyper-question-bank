/**
 * Read-only Production count probe for STEP 8.32.
 * Never INSERT/UPDATE/DELETE. Never logs secrets.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'ocr-tests/taxonomy/step8-32')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'

function snapshot(partial) {
  return {
    step: '8.32',
    writes: 0,
    student_care_accessed: false,
    ...partial,
  }
}

async function countExact(url, key, table, filter) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  let q = admin.from(table).select('id', { count: 'exact', head: true })
  for (const [column, value] of Object.entries(filter ?? {})) q = q.eq(column, value)
  const result = await q
  if (result.error) throw new Error(`${table} count: ${result.error.message}`)
  return result.count ?? 0
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

let payload
if (!url || !key) {
  payload = snapshot({
    queried: false,
    reason: 'SUPABASE_SERVICE_ROLE_KEY_MISSING',
    drafts: null,
    type_auto: null,
    figure_assets: null,
    figure_links: null,
    pipeline_runs: null,
    pipeline_items: null,
    needs_review: null,
  })
} else {
  try {
    payload = snapshot({
      queried: true,
      reason: 'read_only',
      drafts: await countExact(url, key, 'problems', { lifecycle_status: 'DRAFT' }),
      type_auto: await countExact(url, key, 'problem_classification_meta', {
        classification_status: 'AUTO',
      }),
      figure_assets: await countExact(url, key, 'problem_figure_assets'),
      figure_links: await countExact(url, key, 'problem_figure_links'),
      pipeline_runs: await countExact(url, key, 'pipeline_runs'),
      pipeline_items: await countExact(url, key, 'pipeline_items'),
      needs_review: await countExact(url, key, 'problems', { review_status: 'NEEDS_REVIEW' }),
    })
  } catch (error) {
    payload = snapshot({
      queried: false,
      reason: error instanceof Error ? error.message : 'probe_failed',
      drafts: null,
      type_auto: null,
      figure_assets: null,
      figure_links: null,
      pipeline_runs: null,
      pipeline_items: null,
      needs_review: null,
    })
  }
}

writeFileSync(path.join(dest, 'production-readonly.json'), JSON.stringify(payload, null, 2), 'utf8')
console.log(
  `STEP 8.32 production probe queried=${payload.queried} drafts=${payload.drafts} type_auto=${payload.type_auto} figures=${payload.figure_assets}/${payload.figure_links} needs_review=${payload.needs_review}`,
)
process.exit(payload.queried || payload.reason === 'SUPABASE_SERVICE_ROLE_KEY_MISSING' ? 0 : 1)
