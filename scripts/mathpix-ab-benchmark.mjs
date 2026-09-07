/**
 * STEP 7.5 Mathpix A/B benchmark CLI.
 * Default: DRY RUN ONLY. Never calls api.mathpix.com unless
 * credentials exist AND --allow-paid-api AND --i-understand-this-costs-money.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MATHPIX_ENDPOINT = 'https://api.mathpix.com/v3/text'
const PAID_DENIED = 'HQB_PAID_CALL_DENIED'
const NOT_CONFIGURED = 'HQB_MATHPIX_NOT_CONFIGURED'

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8'))
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function env(name) {
  if (name.startsWith('VITE_')) throw new Error('HQB_SECRET_LEAK')
  return process.env[name]?.trim() ?? ''
}

function hasCreds() {
  return Boolean(env('MATHPIX_APP_ID') && env('MATHPIX_APP_KEY'))
}

function money(usd, rate = 1390) {
  return { usd: Number(usd.toFixed(4)), krw_approx: Math.round(usd * rate), krw_exchange_marked: 'variable' }
}

function parseGate(argv) {
  return {
    allowPaidApi: argv.includes('--allow-paid-api'),
    confirmCost: argv.includes('--i-understand-this-costs-money'),
  }
}

function assertLiveAllowed(gate) {
  if (!hasCreds()) {
    throw new Error(`${NOT_CONFIGURED}: store MATHPIX_APP_ID / MATHPIX_APP_KEY in local .env only. Do not paste secrets into chat.`)
  }
  if (!gate.allowPaidApi || !gate.confirmCost) {
    throw new Error(
      `${PAID_DENIED}: live Mathpix requires both --allow-paid-api and --i-understand-this-costs-money. Default is dry-run.`,
    )
  }
}

function validateCorpus() {
  const manifest = readJson('workers/ocr/corpus-manifest.json')
  const samples = readJson('workers/ocr/samples.json')
  const hashes = {}
  const warnings = []
  const errors = []
  if (manifest.sample_count !== 26 || manifest.samples.length !== 26) {
    errors.push('sample count is not the frozen STEP 7 set of 26')
  }
  for (const [index, row] of manifest.samples.entries()) {
    const sample = samples.samples[index]
    if (!sample || sample.id !== row.sample_id || sample.page_number !== row.page_number) {
      errors.push(`${row.sample_id} no longer matches workers/ocr/samples.json`)
      continue
    }
    const cropPath = path.join(root, 'workers/ocr', row.crop_file)
    if (!existsSync(cropPath)) {
      warnings.push(`${row.sample_id} crop missing; hash not verified`)
      hashes[row.sample_id] = null
      continue
    }
    const actual = sha256File(cropPath)
    hashes[row.sample_id] = actual
    if (actual !== row.crop_sha256) errors.push(`${row.sample_id} crop hash differs from STEP 7`)
  }
  return { manifest, hashes, warnings, errors }
}

function printDryRun({ manifest, warnings, errors, gate }) {
  const typical = money(26 * 0.002)
  const conservative = money(26 * 0.005)
  const configured = hasCreds() ? 'CONFIGURED' : 'NOT CONFIGURED'
  console.log('STEP 7.5 MATHPIX A/B — DRY RUN')
  console.log(`provider: mathpix-v3-text`)
  console.log(`baseline: windows-media-ocr-ko`)
  console.log(`sample count: ${manifest.sample_count}`)
  console.log(`estimated requests: 26`)
  console.log(`estimated typical cost: USD ${typical.usd} / KRW ~${typical.krw_approx} (exchange variable)`)
  console.log(`estimated maximum cost: USD ${conservative.usd} / KRW ~${conservative.krw_approx} (if billed as PDF pages)`)
  console.log(`setup fee if new account: USD 19.99 (official, one-time, non-refundable)`)
  console.log(`MATHPIX CREDENTIALS: ${configured}`)
  console.log(`allow-paid-api: ${gate.allowPaidApi}`)
  console.log(`cost confirmation: ${gate.confirmCost}`)
  console.log('PAID API CALLS MADE: 0')
  console.log('No Mathpix accuracy claim. Ground Truth was not rewritten.')
  for (const warning of warnings) console.log(`WARN ${warning}`)
  for (const error of errors) console.log(`ERROR ${error}`)
}

async function liveRun({ manifest, errors }) {
  if (errors.length) {
    throw new Error('HQB_CORPUS: refuse live Mathpix because the STEP 7 corpus hash check failed')
  }
  const outDir = path.join(root, 'workers/ocr/benchmark-runs', `mathpix-${Date.now()}`)
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const sample of manifest.samples) {
    const cropPath = path.join(root, 'workers/ocr', sample.crop_file)
    const bytes = readFileSync(cropPath)
    const src = `data:image/png;base64,${bytes.toString('base64')}`
    const started = Date.now()
    const response = await fetch(MATHPIX_ENDPOINT, {
      method: 'POST',
      headers: {
        app_id: env('MATHPIX_APP_ID'),
        app_key: env('MATHPIX_APP_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src,
        formats: ['text', 'data', 'html', 'latex_styled'],
        data_options: { include_latex: true, include_mathml: true, include_asciimath: true },
        include_line_data: true,
      }),
    })
    const raw_response = await response.json()
    results.push({
      sample_id: sample.sample_id,
      http_status: response.status,
      seconds: (Date.now() - started) / 1000,
      raw_response,
      raw_text: raw_response.text ?? '',
      raw_latex: raw_response.latex_styled ?? null,
    })
  }
  writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(results, null, 2))
  console.log(`wrote local raw results to ${outDir}`)
}

const gate = parseGate(process.argv.slice(2))
const corpus = validateCorpus()
printDryRun({ ...corpus, gate })

if (corpus.errors.length && (gate.allowPaidApi || gate.confirmCost)) {
  console.error('STOP: corpus mismatch. Refusing a paid call on a different crop set.')
  process.exit(2)
}

const wantsLive = gate.allowPaidApi || gate.confirmCost
if (!wantsLive) {
  console.log('STOP: dry-run complete. Phase B requires credentials plus both paid flags.')
  process.exit(corpus.errors.length ? 2 : 0)
}

try {
  assertLiveAllowed(gate)
} catch (error) {
  console.error(`STOP: ${error.message}`)
  process.exit(2)
}

await liveRun(corpus)
