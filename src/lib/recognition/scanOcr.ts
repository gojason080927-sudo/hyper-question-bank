import { recognizeFromOcrText } from './structure'
import {
  RECOGNITION_ENGINE_SCAN_OCR,
  RECOGNITION_ENGINE_SCAN_OCR_VERSION,
} from './types'
import type { RecognitionOutput } from './types'

export async function recognizeScanCrop(input: {
  image: string
  hasFigure?: boolean
  hasTable?: boolean
}): Promise<RecognitionOutput> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('kor+eng')
  try {
    const result = await worker.recognize(input.image)
    return recognizeFromOcrText((result.data.text || '').trim(), {
      engine: RECOGNITION_ENGINE_SCAN_OCR,
      engineVersion: RECOGNITION_ENGINE_SCAN_OCR_VERSION,
      hasFigure: input.hasFigure,
      hasTable: input.hasTable,
    })
  } finally {
    await worker.terminate()
  }
}
