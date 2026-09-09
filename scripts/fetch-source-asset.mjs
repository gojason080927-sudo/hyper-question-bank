#!/usr/bin/env node
/**
 * Least-privilege source-asset helper.
 * Default: dry-run. Never prints secret values. Never uses service role.
 * Live download of copyrighted workbooks requires explicit flags + staff-capable anon session.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUESTION_BANK_REF = 'owpxsmdcxjmsgadkdsci'
const STUDENT_CARE_REF = 'pwuswjauzdxewmtgoitf'
const SOURCE_BUCKET = 'question-bank-sources'

function loadEnvLocal() {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

function present(name) {
  return Boolean(process.env[name]?.trim())
}

function flag(argv, name) {
  return argv.includes(name)
}

function argValue(argv, name) {
  const idx = argv.indexOf(name)
  if (idx < 0) return ''
  return String(argv[idx + 1] ?? '').trim()
}

function die(message) {
  console.error(message)
  process.exit(1)
}

loadEnvLocal()
const argv = process.argv.slice(2)
const allowDownload = flag(argv, '--allow-download')
const understandCopyright = flag(argv, '--i-understand-copyrighted-source')
const storagePath = argValue(argv, '--storage-path')
const dryRun = !allowDownload || flag(argv, '--dry-run')

const url = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const anon = present('VITE_SUPABASE_ANON_KEY')
const serviceRolePresent = present('SUPABASE_SERVICE_ROLE_KEY')
const mistralVite = present('VITE_MISTRAL_API_KEY') || present('VITE_MISTRAL_KEY')
const mathpixVite = present('VITE_MATHPIX_APP_ID') || present('VITE_MATHPIX_APP_KEY')

if (mistralVite || mathpixVite) {
  die('STOP: paid OCR keys must not use a VITE_ prefix. Remove them. Do not print values.')
}

if (url && url.includes(STUDENT_CARE_REF)) {
  die('STOP: Student Care project refused. Question-bank only.')
}

if (url && !url.includes(QUESTION_BANK_REF)) {
  die('STOP: VITE_SUPABASE_URL is not the question-bank project.')
}

console.log('HYPER source-asset fetch')
console.log(`mode: ${dryRun ? 'DRY-RUN' : 'LIVE-DOWNLOAD'}`)
console.log(`bucket: ${SOURCE_BUCKET}`)
console.log(`storage_path: ${storagePath || '(none — pass --storage-path)'}`)
console.log(`VITE_SUPABASE_URL: ${url ? 'set' : 'missing'}`)
console.log(`VITE_SUPABASE_ANON_KEY: ${anon ? 'set' : 'missing'}`)
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${serviceRolePresent ? 'PRESENT (ignored — this script never uses it)' : 'absent (correct for Cloud bootstrap)'}`)
console.log('signed_url: SourceDetailPage uses createSignedUrl with the staff session; this helper does the same if live.')
console.log('least_privilege: prefer signed URL / storage read over service role')

if (dryRun) {
  console.log('LIVE DOWNLOAD: skipped (default dry-run).')
  console.log('To download a single object you already have staff access to:')
  console.log('  node scripts/fetch-source-asset.mjs --storage-path <path> --allow-download --i-understand-copyrighted-source')
  console.log('Cloud bootstrap must not bulk-download copyrighted corpora.')
  process.exit(0)
}

if (!understandCopyright) {
  die('STOP: live download requires --i-understand-copyrighted-source')
}
if (!storagePath) {
  die('STOP: --storage-path is required for live download')
}
if (!url || !anon) {
  die('STOP: live download needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the local worker env (not printed).')
}

die(
  'STOP: live download is intentionally unimplemented in Cloud bootstrap. Use the staff-authenticated app signed-url path, or extend this script later with createSignedUrl + a single object fetch. Service role remains forbidden.',
)
