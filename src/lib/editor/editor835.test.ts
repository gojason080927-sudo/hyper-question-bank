import { describe, expect, it } from 'vitest'
import { paginateItems, estimateItemHeightMm, DEFAULT_A4_LAYOUT, type WorksheetItemModel } from './a4Pagination'
import { addChoice, defaultChoices, markAnswer, moveChoice, removeChoice, shouldShowChoices } from './choices'
import { isRevisionConflict, localAutosaveKey, parseConflictMessage } from './conflict'
import { extractMathSpans, latexRoundTripEqual, preserveUnsupportedLatex } from './mathNormalize'
import { conversionDiff, ocrTextToDocument } from './ocrAdapter'
import { inspectClipboard, textToEditorDoc } from './paste'
import { looksLikeXss, sanitizeHtml, stripDataImages } from './sanitize'
import { collectLatex, containsBase64Image, documentPlainText, stripTransientImageSrc } from './schema'

const longItem = (id: string, extra = ''): WorksheetItemModel => ({
  id,
  problemId: id,
  versionId: id,
  orderNo: 1,
  points: 5,
  spacingMm: 8,
  forcePageBreak: false,
  stem: `다음 식을 간단히 하시오. ${extra}`.repeat(8),
  hasFigure: true,
  figureHeightMm: 28,
  choiceCount: 5,
  explanation: '풀이',
  answer: '2',
})

describe('sanitizeHtml', () => {
  it('strips script and event handlers', () => {
    const clean = sanitizeHtml('<p onclick="alert(1)">ok</p><script>alert(2)</script>')
    expect(clean).toContain('<p>')
    expect(clean).not.toMatch(/script/i)
    expect(clean).not.toMatch(/onclick/i)
    expect(looksLikeXss('<img src=x onerror=alert(1)>')).toBe(true)
  })

  it('removes javascript urls and data images from final html', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
    expect(stripDataImages('<img src="data:image/png;base64,AAAA">')).toBe('')
  })
})

describe('mathNormalize', () => {
  it('extracts inline, display, paren and bracket latex', () => {
    const spans = extractMathSpans('값 $a+b$ 과 $$\\frac{1}{2}$$ 그리고 \\(x^2\\) \\[\\sqrt{2}\\]')
    expect(spans.map((row) => row.latex)).toEqual(['a+b', '\\frac{1}{2}', 'x^2', '\\sqrt{2}'])
    expect(spans.filter((row) => row.display)).toHaveLength(2)
  })

  it('never drops unsupported commands', () => {
    expect(preserveUnsupportedLatex('\\unknown{z}')).toBe('\\unknown{z}')
    expect(latexRoundTripEqual('\\frac{1}{2}', ' \\frac{1}{2} ')).toBe(true)
  })
})

describe('ocrAdapter', () => {
  it('lazy-converts OCR text with math and reports a diff', () => {
    const ocr = '다음 중 $x^2$ 의 값은?'
    const doc = ocrTextToDocument(ocr, '물음에 답하시오.')
    expect(doc.converted_from_ocr).toBe(true)
    expect(doc.blocks.instruction).toBe(true)
    expect(collectLatex(doc.tiptap_json).map((row) => row.latex)).toEqual(['x^2'])
    expect(conversionDiff(ocr, ocrTextToDocument(ocr).tiptap_json).equal).toBe(true)
  })
})

describe('paste', () => {
  it('keeps html tables and warns on HWP / XSS without dropping the rest', () => {
    const result = inspectClipboard(
      ['text/html', 'application/x-hwp'],
      '<table><tr><td>가</td></tr></table><script>bad()</script>',
      '가',
      0,
    )
    expect(result.dropped).toBe(false)
    expect(result.html).toContain('<table>')
    expect(result.warnings.some((row) => row.code === 'HWP_LOSSY')).toBe(true)
    expect(result.warnings.some((row) => row.code === 'XSS_STRIPPED')).toBe(true)
  })

  it('turns dollar math in pasted text into nodes', () => {
    const doc = textToEditorDoc('식 $a+b$ 를 계산하라')
    const latex = collectLatex(doc)
    expect(latex[0]?.latex).toBe('a+b')
    expect(documentPlainText(doc)).toContain('$a+b$')
  })
})

describe('images', () => {
  it('does not keep base64 src on save', () => {
    const dirty = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', storagePath: 'p/a.png' } }],
    }
    expect(containsBase64Image(dirty)).toBe(true)
    expect(String(stripTransientImageSrc(dirty).content?.[0]?.attrs?.src ?? '')).toBe('')
  })
})

describe('choices', () => {
  it('generates ①-⑤, add/delete/reorder and hides for constructed response', () => {
    const five = defaultChoices(5)
    expect(five.map((row) => row.label)).toEqual(['①', '②', '③', '④', '⑤'])
    const added = addChoice(five)
    const removed = removeChoice(added, 5)
    const moved = moveChoice(removed, 0, 2)
    expect(moved[2]?.label).toBe('③')
    expect(markAnswer(moved, 1)[1]?.is_answer).toBe(true)
    expect(shouldShowChoices('CONSTRUCTED_RESPONSE')).toBe(false)
    expect(shouldShowChoices('MULTIPLE_CHOICE')).toBe(true)
  })
})

describe('conflict', () => {
  it('detects revision mismatch and autosave keys', () => {
    expect(isRevisionConflict(1, 2)).toBe(true)
    expect(parseConflictMessage('HQB_EDIT_CONFLICT: 다른 강사')).toBe(true)
    expect(localAutosaveKey('p1', 'u1')).toContain('p1')
  })
})

describe('a4Pagination', () => {
  it('paginates 1 and 2 columns, honors forced breaks, and keeps figures with items', () => {
    const items = [longItem('a'), { ...longItem('b'), forcePageBreak: true }, longItem('c', '장문 '.repeat(40))]
    const one = paginateItems(items, DEFAULT_A4_LAYOUT)
    const two = paginateItems(items, { ...DEFAULT_A4_LAYOUT, columns: 2 })
    expect(one.length).toBeGreaterThanOrEqual(2)
    expect(two[0]?.columns[0].length + two[0]?.columns[1].length).toBeGreaterThan(0)
    expect(one.some((page) => page.columns[0].some((row) => row.id === 'b' && row.number === 2))).toBe(true)
    expect(estimateItemHeightMm(longItem('fig'), DEFAULT_A4_LAYOUT)).toBeGreaterThan(28)
  })
})
