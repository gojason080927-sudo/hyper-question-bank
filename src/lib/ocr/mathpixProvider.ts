/**
 * Local-worker Mathpix adapter. Do not import this module from src/features.
 * Paid HTTPS calls require credentials plus both explicit CLI flags.
 */
import { recognizeFromOcrText } from '../recognition/structure'
import { assertPaidMathpixAllowed } from './paidGate'
import { MATHPIX_ENDPOINT, MATHPIX_PROVIDER, type MathOcrProvider, type MathOcrRecognizeResult } from './mathOcrTypes'
import { readMathpixCredentials } from './mathpixSecrets'
import { normalizeMathpixToHyper, preserveRawRecord, type MathpixApiLike } from './normalizeMathpix'

const MAX_BASE64_BYTES = 2 * 1024 * 1024

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function buildMathpixRequestBody(input: { imageBytes: Uint8Array; mimeType?: 'image/png' | 'image/jpeg' }): {
  src: string
  formats: string[]
  data_options: { include_latex: true; include_mathml: true; include_asciimath: true }
  include_line_data: true
} {
  const mime = input.mimeType ?? 'image/png'
  const encoded = bytesToBase64(input.imageBytes)
  if (encoded.length > MAX_BASE64_BYTES) {
    throw new Error('HQB_MATHPIX_IMAGE_TOO_LARGE: official v3/text base64 image limit is 2 MB')
  }
  return {
    src: `data:${mime};base64,${encoded}`,
    formats: ['text', 'data', 'html', 'latex_styled'],
    data_options: {
      include_latex: true,
      include_mathml: true,
      include_asciimath: true,
    },
    include_line_data: true,
  }
}

export function createMathpixProvider(options: { fetchImpl?: typeof fetch } = {}): MathOcrProvider {
  return {
    providerName: MATHPIX_PROVIDER,
    providerVersion: 'v3/text',
    processingMode: 'SCAN_OCR',
    async recognizeCrop(input, gate): Promise<MathOcrRecognizeResult> {
      assertPaidMathpixAllowed(gate)
      const creds = readMathpixCredentials()
      if (!creds) {
        throw new Error('HQB_MATHPIX_NOT_CONFIGURED: MATHPIX_APP_ID / MATHPIX_APP_KEY are not set')
      }
      const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
      const body = buildMathpixRequestBody(input)
      const started = Date.now()
      const response = await fetchImpl(MATHPIX_ENDPOINT, {
        method: 'POST',
        headers: {
          app_id: creds.appId,
          app_key: creds.appKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const seconds = (Date.now() - started) / 1000
      const rawResponse = (await response.json()) as MathpixApiLike
      const raw = preserveRawRecord({
        sampleId: input.sampleId,
        rawResponse,
        seconds,
        httpStatus: response.status,
        error: rawResponse.error ?? (response.ok ? null : `HTTP ${response.status}`),
        version: rawResponse.version,
      })
      const normalized = normalizeMathpixToHyper(rawResponse, {
        hasFigure: input.hasFigure,
        hasTable: input.hasTable,
      })
      return { raw, normalized }
    },
  }
}

export function windowsOcrLikeNormalize(rawText: string, options: { hasFigure?: boolean; hasTable?: boolean } = {}) {
  return recognizeFromOcrText(rawText, {
    engine: 'windows-media-ocr-ko',
    engineVersion: 'winrt-3.2.1',
    hasFigure: options.hasFigure,
    hasTable: options.hasTable,
  })
}
