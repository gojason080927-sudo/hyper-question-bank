const FORBIDDEN_BROWSER_KEYS = ['VITE_MATHPIX_APP_ID', 'VITE_MATHPIX_APP_KEY', 'VITE_MATHPIX_APPID'] as const

export function forbiddenBrowserMathpixKeys(): readonly string[] {
  return FORBIDDEN_BROWSER_KEYS
}

function workerEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env ?? {}
}

function readServerSecret(name: string): string {
  if (name.startsWith('VITE_')) {
    throw new Error('HQB_SECRET_LEAK: Mathpix credentials must never use a VITE_ prefix')
  }
  return workerEnv()[name]?.trim() ?? ''
}

export function readMathpixCredentials(): { appId: string; appKey: string } | null {
  const appId = readServerSecret('MATHPIX_APP_ID')
  const appKey = readServerSecret('MATHPIX_APP_KEY')
  if (!appId || !appKey) return null
  return { appId, appKey }
}

export function hasMathpixCredentials(): boolean {
  return readMathpixCredentials() !== null
}

export function redactSecrets(text: string): string {
  const creds = readMathpixCredentials()
  if (!creds) return text
  return text.split(creds.appId).join('[REDACTED_APP_ID]').split(creds.appKey).join('[REDACTED_APP_KEY]')
}

export function mathpixBrowserStatus(): { configured: false; reason: string } {
  return {
    configured: false,
    reason: 'Mathpix credentials are worker-only and are never exposed to the browser',
  }
}
