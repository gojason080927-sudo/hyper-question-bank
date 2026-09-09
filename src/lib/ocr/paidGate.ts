import {
  CACHE_ONLY_NETWORK_BLOCKED,
  MATHPIX_NOT_CONFIGURED,
  MISTRAL_NOT_CONFIGURED,
  PAID_CALL_DENIED,
  type PaidCallGate,
} from './mathOcrTypes'
import { hasMathpixCredentials } from './mathpixSecrets'
import { hasMistralCredentials } from './mistralSecrets'

export function parsePaidGate(argv: string[]): PaidCallGate {
  const cacheOnly = argv.includes('--cache-only')
  return {
    allowPaidApi: argv.includes('--allow-paid-api') && !cacheOnly,
    confirmCost: argv.includes('--i-understand-this-costs-money') && !cacheOnly,
    cacheOnly,
  }
}

export function assertCacheOnlyNetworkBlocked(gate: PaidCallGate): void {
  if (gate.cacheOnly) {
    throw new Error(`${CACHE_ONLY_NETWORK_BLOCKED}: cache-only mode forbids Mistral/Mathpix network calls`)
  }
}

export function assertPaidMathpixAllowed(gate: PaidCallGate): void {
  assertCacheOnlyNetworkBlocked(gate)
  if (!hasMathpixCredentials()) {
    throw new Error(`${MATHPIX_NOT_CONFIGURED}: MATHPIX_APP_ID / MATHPIX_APP_KEY are not set in the local worker environment`)
  }
  if (!gate.allowPaidApi || !gate.confirmCost) {
    throw new Error(
      `${PAID_CALL_DENIED}: live Mathpix requires both --allow-paid-api and --i-understand-this-costs-money. Dry-run only.`,
    )
  }
}

export function assertPaidMistralAllowed(gate: PaidCallGate): void {
  assertCacheOnlyNetworkBlocked(gate)
  if (!hasMistralCredentials()) {
    throw new Error(`${MISTRAL_NOT_CONFIGURED}: MISTRAL_API_KEY is not set in the local worker environment`)
  }
  if (!gate.allowPaidApi || !gate.confirmCost) {
    throw new Error(
      `${PAID_CALL_DENIED}: live Mistral OCR requires both --allow-paid-api and --i-understand-this-costs-money. Dry-run only.`,
    )
  }
}

export function assertPaidCompareAllowed(gate: PaidCallGate): void {
  assertCacheOnlyNetworkBlocked(gate)
  if (!hasMathpixCredentials()) {
    throw new Error(`${MATHPIX_NOT_CONFIGURED}: MATHPIX_APP_ID / MATHPIX_APP_KEY are not set in the local worker environment`)
  }
  if (!hasMistralCredentials()) {
    throw new Error(`${MISTRAL_NOT_CONFIGURED}: MISTRAL_API_KEY is not set. Refuse a one-sided paid run.`)
  }
  if (!gate.allowPaidApi || !gate.confirmCost) {
    throw new Error(
      `${PAID_CALL_DENIED}: live Mathpix+Mistral compare requires both --allow-paid-api and --i-understand-this-costs-money.`,
    )
  }
}

export function isDryRun(gate: PaidCallGate): boolean {
  return !gate.allowPaidApi || !gate.confirmCost || !hasMathpixCredentials()
}
