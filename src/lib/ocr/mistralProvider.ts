/**
 * Local-worker Mistral OCR adapter. Do not import this module from src/features.
 * Paid HTTPS calls require credentials plus both explicit CLI flags.
 */
import { MISTRAL_ENDPOINT, MISTRAL_MODEL, MISTRAL_PROVIDER, type MathOcrProvider, type MathOcrRecognizeResult } from './mathOcrTypes'
import { readMistralCredentials } from './mistralSecrets'
import { normalizeMistralToHyper, preserveMistralRawRecord, type MistralOcrLike } from './normalizeMistral'
import { assertPaidMistralAllowed } from './paidGate'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function buildMistralOcrRequest(input: { imageBytes: Uint8Array; mimeType?: 'image/png' | 'image/jpeg' }): {
  model: typeof MISTRAL_MODEL
  document: { type: 'image_url'; image_url: string }
  include_blocks: true
  include_image_base64: true
  table_format: 'html'
} {
  const mime = input.mimeType ?? 'image/png'
  return {
    model: MISTRAL_MODEL,
    document: {
      type: 'image_url',
      image_url: `data:${mime};base64,${bytesToBase64(input.imageBytes)}`,
    },
    include_blocks: true,
    include_image_base64: true,
    table_format: 'html',
  }
}

export function createMistralProvider(options: { fetchImpl?: typeof fetch } = {}): MathOcrProvider {
  return {
    providerName: MISTRAL_PROVIDER,
    providerVersion: MISTRAL_MODEL,
    processingMode: 'SCAN_OCR',
    async recognizeCrop(input, gate): Promise<MathOcrRecognizeResult> {
      assertPaidMistralAllowed(gate)
      const creds = readMistralCredentials()
      if (!creds) {
        throw new Error('HQB_MISTRAL_NOT_CONFIGURED: MISTRAL_API_KEY is not set')
      }
      const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
      const body = buildMistralOcrRequest(input)
      const started = Date.now()
      const response = await fetchImpl(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const seconds = (Date.now() - started) / 1000
      const rawResponse = (await response.json()) as MistralOcrLike
      const error =
        rawResponse.error ??
        rawResponse.detail ??
        rawResponse.message ??
        (response.ok ? null : `HTTP ${response.status}`)
      const raw = preserveMistralRawRecord({
        sampleId: input.sampleId,
        rawResponse,
        seconds,
        httpStatus: response.status,
        error,
        version: rawResponse.model,
      })
      const normalized = normalizeMistralToHyper(rawResponse, {
        hasFigure: input.hasFigure,
        hasTable: input.hasTable,
      })
      return { raw, normalized }
    },
  }
}
