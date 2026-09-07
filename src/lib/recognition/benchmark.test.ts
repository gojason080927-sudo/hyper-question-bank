import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runBenchmark, type BenchmarkFile } from './benchmark'

const fixturePath = path.resolve(process.cwd(), 'fixtures/recognition/ground-truth.json')

describe('STEP 6 synthetic benchmark', () => {
  it('covers A-M and records GREEN/YELLOW/RED without guessing', () => {
    const file = JSON.parse(readFileSync(fixturePath, 'utf8')) as BenchmarkFile
    expect(file.kind).toBe('synthetic')
    expect(file.items.length).toBeGreaterThanOrEqual(15)
    expect(file.items.length).toBeLessThanOrEqual(30)
    const categories = file.items.map((row) => row.category[0])
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      expect(categories).toContain(letter)
    }

    const result = runBenchmark(file)
    writeFileSync(
      path.resolve(process.cwd(), 'fixtures/recognition/last-run.json'),
      JSON.stringify({
        kind: file.kind,
        render_dpi: file.render_dpi,
        counts: { green: result.green, yellow: result.yellow, red: result.red },
        rows: result.rows,
      }, null, 2),
    )

    expect(result.green + result.yellow + result.red).toBe(file.items.length)
    expect(result.red).toBeGreaterThan(0)
    const lost = result.rows.find((row) => row.id === 'G2')
    expect(lost?.verdict).toBe('RED')
    expect(lost?.reasons.some((row) => row.includes('MATH') || row === 'math_structure')).toBe(true)
    const scan = result.rows.find((row) => row.id === 'M1')
    expect(scan?.verdict).toBe('RED')
    expect(scan?.engine).toBe('hqb-scan-unavailable-v1')
    const green = result.rows.find((row) => row.id === 'G1')
    expect(green?.verdict).toBe('GREEN')
  })
})
