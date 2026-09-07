import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectMathCriticalErrors, scoreScanSample } from '../recognition/ocrScore'
import { VERIFY_MESSAGES } from '../workflow/validation'
import { MATHPIX_BROWSER_STATUS } from './browserStatus'
import { classifyCorrectionBurden, conservativeWindowsBaselineBurden } from './correctionBurden'
import {
  assertManifestMatchesSamples,
  parseCorpusManifest,
  summarizeCorpusChecks,
} from './corpus'
import { estimateImageScenario, estimateLiveBenchmark26, MATHPIX_OFFICIAL_PRICING, requiredCostScenarios } from './costModel'
import { PHASE_A_DECISION } from './decisionRule'
import { HYBRID_PRODUCTION_ROUTED } from './hybridRouting'
import { MATHPIX_ENDPOINT, MATHPIX_PROVIDER } from './mathOcrTypes'
import { createMathpixProvider } from './mathpixProvider'
import { forbiddenBrowserMathpixKeys, hasMathpixCredentials, readMathpixCredentials } from './mathpixSecrets'
import { normalizeMathpixToHyper, preserveRawRecord } from './normalizeMathpix'
import { assertPaidMathpixAllowed, parsePaidGate } from './paidGate'
import { STEP7_DOCUMENT_ID, STEP7_SAMPLE_COUNT, STEP7_WINDOWS_OCR_BASELINE } from './step7Baseline'

const root = process.cwd()
const env = process.env

function clearMathpixEnv() {
  delete env.MATHPIX_APP_ID
  delete env.MATHPIX_APP_KEY
  delete env.VITE_MATHPIX_APP_ID
  delete env.VITE_MATHPIX_APP_KEY
}

afterEach(() => {
  clearMathpixEnv()
})

describe('STEP 7.5 provider abstraction', () => {
  it('names the Mathpix adapter and keeps Windows as the frozen baseline engine', () => {
    const provider = createMathpixProvider({ fetchImpl: vi.fn() })
    expect(provider.providerName).toBe(MATHPIX_PROVIDER)
    expect(provider.processingMode).toBe('SCAN_OCR')
    expect(STEP7_WINDOWS_OCR_BASELINE.engine).toBe('windows-media-ocr-ko')
    expect(STEP7_WINDOWS_OCR_BASELINE.GREEN).toBe(8)
    expect(STEP7_WINDOWS_OCR_BASELINE.math_critical_errors).toBe(23)
  })
})

describe('missing Mathpix credentials', () => {
  it('treats empty worker env as not configured', () => {
    clearMathpixEnv()
    expect(hasMathpixCredentials()).toBe(false)
    expect(readMathpixCredentials()).toBeNull()
    expect(() => assertPaidMathpixAllowed({ allowPaidApi: true, confirmCost: true })).toThrow(
      /HQB_MATHPIX_NOT_CONFIGURED/,
    )
  })

  it('ignores VITE_ Mathpix keys so the browser prefix cannot supply secrets', () => {
    env.VITE_MATHPIX_APP_ID = 'must-not-be-read'
    env.VITE_MATHPIX_APP_KEY = 'must-not-be-read'
    expect(hasMathpixCredentials()).toBe(false)
    expect(forbiddenBrowserMathpixKeys().every((key) => key.startsWith('VITE_'))).toBe(true)
  })
})

describe('secrets never exposed to the browser', () => {
  it('keeps Mathpix keys out of Vite env types and frontend imports', () => {
    const envTypes = readFileSync(path.join(root, 'src/lib/supabase/env.d.ts'), 'utf8')
    expect(envTypes).not.toMatch(/MATHPIX/)
    expect(MATHPIX_BROWSER_STATUS.configured).toBe(false)
    expect(MATHPIX_BROWSER_STATUS.label).toBe('NOT CONFIGURED')
    const panel = readFileSync(path.join(root, 'src/features/sources/RecognitionPanel.tsx'), 'utf8')
    expect(panel).toContain('browserStatus')
    expect(panel).not.toContain('mathpixProvider')
    expect(panel).not.toContain('MATHPIX_APP_KEY')
    expect(readFileSync(path.join(root, '.env.example'), 'utf8')).toMatch(/MATHPIX_APP_ID=\s*\nMATHPIX_APP_KEY=\s*/)
    expect(readFileSync(path.join(root, '.env.example'), 'utf8')).not.toMatch(/VITE_MATHPIX/)
  })
})

describe('corpus hash validation', () => {
  it('freezes the same 26 STEP 7 samples, bboxes, and crop hashes', () => {
    const manifest = parseCorpusManifest(JSON.parse(readFileSync(path.join(root, 'workers/ocr/corpus-manifest.json'), 'utf8')))
    const samples = JSON.parse(readFileSync(path.join(root, 'workers/ocr/samples.json'), 'utf8')) as {
      samples: Array<{ id: string; page_number: number; bbox: { x: number; y: number; width: number; height: number } }>
    }
    const truthBytes = readFileSync(path.join(root, 'workers/ocr/ground-truth.json'))
    expect(createHash('sha256').update(truthBytes).digest('hex')).toBe(manifest.ground_truth_version)
    expect(manifest.sample_count).toBe(STEP7_SAMPLE_COUNT)
    expect(manifest.document_id).toBe(STEP7_DOCUMENT_ID)
    assertManifestMatchesSamples(manifest, samples)
    const hashes: Record<string, string | null> = {}
    for (const sample of manifest.samples) {
      const cropPath = path.join(root, 'workers/ocr', sample.crop_file)
      hashes[sample.sample_id] = existsSync(cropPath)
        ? createHash('sha256').update(readFileSync(cropPath)).digest('hex')
        : null
    }
    const summary = summarizeCorpusChecks(manifest, hashes)
    if (summary.hash_validation === 'mismatch') {
      expect(summary.ok).toBe(false)
    } else {
      expect(summary.ok).toBe(true)
    }
    expect(summarizeCorpusChecks(manifest, { S01: 'deadbeef' }).ok).toBe(false)
    expect(summarizeCorpusChecks(manifest, { S01: 'deadbeef' }).errors[0]).toMatch(/S01/)
  })
})

describe('raw response preservation and normalization', () => {
  it('keeps raw Mathpix JSON/text/LaTeX separate and does not Ground-Truth-correct x2', () => {
    const rawResponse = {
      text: '0040 다항식 A=x2-4xy',
      latex_styled: undefined,
      version: 'fixture-not-live',
      confidence: 0.99,
    }
    const raw = preserveRawRecord({
      sampleId: 'S04',
      rawResponse,
      seconds: 0.2,
      httpStatus: 200,
      error: null,
    })
    expect(raw.raw_response).toEqual(rawResponse)
    expect(raw.raw_text).toContain('x2')
    const normalized = normalizeMathpixToHyper(rawResponse)
    expect(normalized.payload.raw_text).toContain('x2')
    expect(normalized.payload.raw_text).not.toContain('x²')
    expect(normalized.payload.confidence).toBeNull()
    expect(normalized.payload.warnings.some((row) => row.includes('Ground Truth'))).toBe(true)
    expect(normalized.engine).toBe(MATHPIX_PROVIDER)
    expect(normalized.processing_mode).toBe('SCAN_OCR')
  })

  it('preserves provider LaTeX fractions instead of flattening them to 1/2', () => {
    const normalized = normalizeMathpixToHyper({
      text: '\\(\\frac{1}{x}\\)',
      data: [{ type: 'latex', value: '\\frac{1}{x}' }, { type: 'mathml', value: '<math/>' }],
      version: 'fixture-not-live',
    })
    expect(normalized.payload.math_expressions[0]?.original).toBe('\\frac{1}{x}')
    expect(normalized.payload.math_expressions[0]?.latex_candidate).toBe('\\frac{1}{x}')
    expect(normalized.payload.math_expressions[0]?.original.includes('1/x')).toBe(false)
  })
})

describe('same STEP 7 scoring rules', () => {
  it('reuses scoreScanSample and does not add a Mathpix-friendly LaTeX rewrite', () => {
    const truth = {
      sample_id: 'S09',
      category: 'F_radical_fraction',
      ground_truth_text: '√3',
      radicals_must: ['√3'],
      superscripts_must: ['²'],
      math_critical_if_collapsed: [{ from: 'x²', not: 'x2' }],
    }
    const latexMiss = scoreScanSample({ sample_id: 'S09', raw_text: '\\sqrt{3} x2' }, truth)
    expect(latexMiss.radicals).toBe(0)
    expect(latexMiss.verdict).toBe('RED')
    expect(detectMathCriticalErrors('x2 and V3', truth).some((row) => row.includes('x²') || row.includes('radical'))).toBe(
      true,
    )
    const scoreboard = JSON.parse(readFileSync(path.join(root, 'workers/ocr/SCOREBOARD.summary.json'), 'utf8')) as {
      ran: Array<{ engine: string; GREEN: number; korean: number }>
    }
    expect(scoreboard.ran[0]?.engine).toBe('windows-media-ocr-ko')
    expect(scoreboard.ran[0]?.GREEN).toBe(STEP7_WINDOWS_OCR_BASELINE.GREEN)
    expect(scoreboard.ran[0]?.korean).toBe(STEP7_WINDOWS_OCR_BASELINE.korean)
  })
})

describe('cost calculator', () => {
  it('uses official dated prices and the required crop/page scenarios', () => {
    const snapshot = JSON.parse(readFileSync(path.join(root, 'src/lib/ocr/official-mathpix-pricing.json'), 'utf8'))
    expect(MATHPIX_OFFICIAL_PRICING.pricing_date).toBe('2026-09-08')
    expect(MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m).toBe(snapshot.image_usd_0_to_1m)
    expect(MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m).toBe(0.002)
    const live = estimateLiveBenchmark26()
    expect(live.typical.usd).toBe(0.052)
    expect(live.conservative_maximum.usd).toBe(0.13)
    expect(live.typical.krw_exchange_marked).toBe('variable')
    const scenarios = requiredCostScenarios()
    expect(scenarios).toHaveLength(7)
    expect(estimateImageScenario('A. 1,000 problem crops', 1000).typical.usd).toBe(2)
    expect(PHASE_A_DECISION).toBeNull()
  })
})

describe('no paid call without an explicit flag', () => {
  it('refuses fetch when flags or credentials are missing', async () => {
    const fetchImpl = vi.fn()
    const provider = createMathpixProvider({ fetchImpl })
    const crop = { sampleId: 'S01', imageBytes: new Uint8Array([1, 2, 3]) }
    await expect(provider.recognizeCrop(crop, parsePaidGate([]))).rejects.toThrow(/HQB_MATHPIX_NOT_CONFIGURED|HQB_PAID_CALL_DENIED/)
    expect(fetchImpl).not.toHaveBeenCalled()
    env.MATHPIX_APP_ID = 'fixture-id'
    env.MATHPIX_APP_KEY = 'fixture-key'
    await expect(provider.recognizeCrop(crop, parsePaidGate(['--allow-paid-api']))).rejects.toThrow(/HQB_PAID_CALL_DENIED/)
    expect(fetchImpl).not.toHaveBeenCalled()
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: 'x2', version: 'fixture-not-live' }),
    })
    const result = await provider.recognizeCrop(crop, parsePaidGate(['--allow-paid-api', '--i-understand-this-costs-money']))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(MATHPIX_ENDPOINT)
    expect(result.raw.raw_text).toBe('x2')
    expect(result.normalized.payload.raw_text).not.toContain('x²')
  })

  it('keeps the CLI in dry-run unless both paid flags are present', () => {
    const dry = execFileSync(process.execPath, ['scripts/mathpix-ab-benchmark.mjs'], { cwd: root, encoding: 'utf8' })
    expect(dry).toMatch(/DRY RUN/)
    expect(dry).toMatch(/PAID API CALLS MADE: 0/)
    expect(dry).not.toMatch(/app_key/i)
    let denied = ''
    try {
      execFileSync(process.execPath, ['scripts/mathpix-ab-benchmark.mjs', '--allow-paid-api'], {
        cwd: root,
        encoding: 'utf8',
      })
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message: string }
      denied = `${err.stdout ?? ''} ${err.stderr ?? ''} ${err.message}`
    }
    expect(denied).toMatch(/HQB_MATHPIX_NOT_CONFIGURED|HQB_PAID_CALL_DENIED|STOP/)
  })
})

describe('VERIFIED lock and correction burden stay unchanged', () => {
  it('does not relax VERIFIED lock copy or invent seconds saved', () => {
    expect(VERIFY_MESSAGES.HQB_VERIFIED_LOCKED).toMatch(/VERIFIED/)
    expect(VERIFY_MESSAGES.HQB_UNAUTHENTICATED).toMatch(/로그인/)
    const burden = classifyCorrectionBurden({
      sample_id: 'S01',
      category: 'A_korean',
      verdict: 'GREEN',
      cer: 0.1,
      korean: 1,
      digits: 1,
      operators: null,
      superscripts: null,
      subscripts: null,
      fractions: null,
      radicals: null,
      inequalities: null,
      parens_abs: null,
      choices: null,
      problem_number: true,
      figure_table: null,
      math_critical_errors: [],
      failed: false,
    })
    expect(burden).toBe('NONE')
    expect(conservativeWindowsBaselineBurden().seconds_saved).toBeNull()
    expect(conservativeWindowsBaselineBurden().counts.RETYPE).toBe(10)
    expect(HYBRID_PRODUCTION_ROUTED).toBe(false)
  })
})
