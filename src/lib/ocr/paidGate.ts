import { MATHPIX_NOT_CONFIGURED, PAID_CALL_DENIED, type PaidCallGate } from './mathOcrTypes'
import { hasMathpixCredentials } from './mathpixSecrets'

export function parsePaidGate(argv: string[]): PaidCallGate {
  return {
    allowPaidApi: argv.includes('--allow-paid-api'),
    confirmCost: argv.includes('--i-understand-this-costs-money'),
  }
}

export function assertPaidMathpixAllowed(gate: PaidCallGate): void {
  if (!hasMathpixCredentials()) {
    throw new Error(`${MATHPIX_NOT_CONFIGURED}: MATHPIX_APP_ID / MATHPIX_APP_KEY are not set in the local worker environment`)
  }
  if (!gate.allowPaidApi || !gate.confirmCost) {
    throw new Error(
      `${PAID_CALL_DENIED}: live Mathpix requires both --allow-paid-api and --i-understand-this-costs-money. Dry-run only.`,
    )
  }
}

export function isDryRun(gate: PaidCallGate): boolean {
  return !gate.allowPaidApi || !gate.confirmCost || !hasMathpixCredentials()
}
