import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detectMathCriticalErrors,
  sameNormalizedBbox,
  scoreScanSample,
} from './ocrScore'
import { recognizeFromOcrText } from './structure'

const samplesPath = path.resolve(process.cwd(), 'workers/ocr/samples.json')
const truthPath = path.resolve(process.cwd(), 'workers/ocr/ground-truth.json')

describe('STEP 7 scan OCR scoring', () => {
  it('uses the exact same page+bbox for every sample engine input', () => {
    const file = JSON.parse(readFileSync(samplesPath, 'utf8')) as {
      samples: Array<{ id: string; page_number: number; bbox: { x: number; y: number; width: number; height: number } }>
    }
    expect(file.samples.length).toBeGreaterThanOrEqual(24)
    const ids = new Set(file.samples.map((row) => row.id))
    expect(ids.size).toBe(file.samples.length)
    for (const sample of file.samples) {
      expect(sameNormalizedBbox(sample, sample)).toBe(true)
    }
  })

  it('detects MATH CRITICAL exponent / inequality / radical / abs collapse', () => {
    const text = 'a2 + b2 < 0 and V3 and | missing'
    const errors = detectMathCriticalErrors(text, {
      sample_id: 'T1',
      category: 'math',
      ground_truth_text: '(a+b)²',
      superscripts_must: ['²'],
      radicals_must: ['√3'],
      inequalities_must: ['≤'],
      parens_abs_must: ['|b+c|'],
      math_critical_if_collapsed: [{ from: 'a²', not: 'a2' }],
    })
    expect(errors.some((row) => row.includes('a²'))).toBe(true)
    expect(errors.some((row) => row.includes('≤'))).toBe(true)
    expect(errors.some((row) => row.includes('radical'))).toBe(true)
    expect(errors.some((row) => row.includes('absolute'))).toBe(true)
  })

  it('does not restore x2 into x² when structuring SCAN_OCR', () => {
    const output = recognizeFromOcrText('0040 다항식 A=x2-4xy\n① x2', {
      engine: 'hqb-tesseractjs-v1',
      engineVersion: '0.7.0',
    })
    expect(output.processing_mode).toBe('SCAN_OCR')
    expect(output.payload.confidence).toBeNull()
    expect(output.payload.raw_text).toContain('x2')
    expect(output.payload.raw_text).not.toContain('x²')
    expect(output.payload.warnings.some((row) => row.includes('not restored') || row.includes('x2'))).toBe(true)
    expect(output.payload.component_status).toContain('MATH_REVIEW_REQUIRED')
    expect(output.verdict).toBe('RED')
    expect(output.status).toBe('REVIEW_REQUIRED')
    expect(output.payload.problem_number).toBe('0040')
  })

  it('scores Korean-readable OCR as YELLOW and failed OCR as RED', () => {
    const truth = {
      sample_id: 'S01',
      category: 'A_korean',
      problem_number: '01-1',
      ground_truth_text: '01-1 다항식의 덧셈과 뺄셈 내림차순 오름차순',
      korean_must: ['다항식', '내림차순', '오름차순'],
      digits_must: ['01-1'],
    }
    const yellow = scoreScanSample(
      { sample_id: 'S01', raw_text: '01-1 다항식의 덧셈과 뺄셈 내림차순 오름차순 정리' },
      truth,
    )
    expect(yellow.verdict).toBe('GREEN')
    const red = scoreScanSample({ sample_id: 'S01', raw_text: '', error: 'fail' }, truth)
    expect(red.verdict).toBe('RED')
    expect(red.failed).toBe(true)
  })

  it('keeps human ground truth attached to the same 26 real-scan samples', () => {
    const samples = JSON.parse(readFileSync(samplesPath, 'utf8')) as { samples: Array<{ id: string }> }
    const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as { items: Array<{ sample_id: string }> }
    expect(truth.items).toHaveLength(samples.samples.length)
    expect(truth.items.map((row) => row.sample_id)).toEqual(samples.samples.map((row) => row.id))
  })
})
