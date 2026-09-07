import { meaningfulCharCount } from '../pdf/classifyPdf'
import { textItemsInBBox } from '../pdf/extractText'
import type { NormalizedBBox } from '../pdf/bbox'
import { recognizeFromText, scanUnavailable } from './structure'
import { REGION_TEXT_MIN_CHARS } from './types'
import type { RecognitionOutput } from './types'

export function recognizeRegionText(input: {
  rawText: string
  pageHint?: string
  bbox?: NormalizedBBox
  pageSize?: { width: number; height: number }
  items?: Array<{ str?: string; transform?: number[] }>
}): RecognitionOutput {
  let text = input.rawText
  if ((!text || meaningfulCharCount(text) < REGION_TEXT_MIN_CHARS) && input.items && input.bbox && input.pageSize) {
    text = textItemsInBBox(input.items, input.bbox, input.pageSize)
  }
  if (meaningfulCharCount(text) < REGION_TEXT_MIN_CHARS) {
    return scanUnavailable(text, input.pageHint)
  }
  return recognizeFromText(text, { pageHint: input.pageHint })
}
