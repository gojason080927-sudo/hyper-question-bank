const FORBIDDEN_BROWSER_KEYS = ['VITE_MISTRAL_API_KEY', 'VITE_MISTRAL_KEY'] as const

export function forbiddenBrowserMistralKeys(): readonly string[] {
  return FORBIDDEN_BROWSER_KEYS
}

function workerEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env ?? {}
}

function readServerSecret(name: string): string {
  if (name.startsWith('VITE_')) {
    throw new Error('HQB_SECRET_LEAK: Mistral credentials must never use a VITE_ prefix')
  }
  return workerEnv()[name]?.trim() ?? ''
}

export function readMistralCredentials(): { apiKey: string } | null {
  const apiKey = readServerSecret('MISTRAL_API_KEY')
  if (!apiKey) return null
  return { apiKey }
}

export function hasMistralCredentials(): boolean {
  return readMistralCredentials() !== null
}

export function redactMistralSecrets(text: string): string {
  const creds = readMistralCredentials()
  if (!creds) return text
  return text.split(creds.apiKey).join('[REDACTED_MISTRAL_KEY]')
}

export function mistralBrowserStatus(): { configured: false; reason: string } {
  return {
    configured: false,
    reason: 'Mistral credentials are worker-only and are never exposed to the browser',
  }
}
