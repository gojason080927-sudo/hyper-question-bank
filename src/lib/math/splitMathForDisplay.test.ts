import { describe, expect, it } from 'vitest'
import { splitMathForDisplay } from './splitMathForDisplay'
import { safeRenderKatex } from './safeKatex'

describe('splitMathForDisplay', () => {
  it('keeps inline $x^2+1$ as math', () => {
    const parts = splitMathForDisplay('식 $x^2+1$ 의 값')
    expect(parts).toEqual([
      { kind: 'text', value: '식 ', display: false },
      { kind: 'math', value: 'x^2+1', display: false },
      { kind: 'text', value: ' 의 값', display: false },
    ])
  })

  it('keeps block $$...$$ as display math', () => {
    const parts = splitMathForDisplay('행렬 $$A$$ 를 구하시오')
    expect(parts.some((part) => part.kind === 'math' && part.value === 'A' && part.display)).toBe(true)
  })

  it('treats \\frac and \\times inside dollars as math', () => {
    const parts = splitMathForDisplay('값 $\\frac{1}{2} \\times 4$')
    const math = parts.find((part) => part.kind === 'math')
    expect(math?.value).toContain('\\frac{1}{2}')
    expect(math?.value).toContain('\\times')
  })

  it('lifts unwrapped pmatrix environments', () => {
    const src = '다음 행렬 \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix} 의 값'
    const parts = splitMathForDisplay(src)
    const math = parts.find((part) => part.kind === 'math' && part.display)
    expect(math?.value).toContain('\\begin{pmatrix}')
    expect(math?.value).toContain('\\end{pmatrix}')
    expect(parts.some((part) => part.kind === 'text' && part.value.includes('다음 행렬'))).toBe(true)
  })

  it('lifts bare \\frac outside dollars', () => {
    const parts = splitMathForDisplay('계산 \\frac{a}{b} 하시오')
    expect(parts.some((part) => part.kind === 'math' && part.value === '\\frac{a}{b}')).toBe(true)
  })
})

describe('safeRenderKatex', () => {
  it('renders well-formed latex', () => {
    const ok = safeRenderKatex('x^2+1', false)
    expect(ok.ok).toBe(true)
    expect(ok.html).toContain('katex')
    expect(ok.html).not.toContain('katex-error')
  })

  it('renders fractions, times, and pmatrix', () => {
    expect(safeRenderKatex('\\frac{1}{2}', false).ok).toBe(true)
    expect(safeRenderKatex('\\times', false).ok).toBe(true)
    const matrix = safeRenderKatex('\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}', true)
    expect(matrix.ok).toBe(true)
    expect(matrix.html).toContain('katex')
  })

  it('falls back to the original string when latex is broken', () => {
    const broken = safeRenderKatex('\\begin{pmatrix', true)
    expect(broken.ok).toBe(false)
    expect(broken.html).toBe('')
    expect(broken.fallback).toBe('\\begin{pmatrix')
  })
})
