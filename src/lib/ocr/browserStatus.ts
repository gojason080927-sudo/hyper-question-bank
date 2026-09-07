/** Browser-safe status only. Credentials never exist in the frontend bundle. */
export const MATHPIX_BROWSER_STATUS = {
  provider: 'mathpix-v3-text',
  configured: false,
  label: 'NOT CONFIGURED',
  reason: 'Mathpix credentials are worker-only and are never exposed to the browser',
} as const

export const LOCAL_OCR_PROVIDER_LABEL = 'windows-media-ocr-ko'
