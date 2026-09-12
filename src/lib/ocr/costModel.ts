/**
 * Official Mistral OCR 4.1 list price. Billed per processed page, not per document.
 * Source fetched 2026-09-12: https://mistral.ai/pricing/api/ and https://docs.mistral.ai/models/ocr-4-1
 * Do not use remembered unofficial numbers.
 */
export const MISTRAL_OFFICIAL_OCR_PRICING = {
  pricing_date: '2026-09-12',
  currency: 'USD',
  model_alias: 'mistral-ocr-latest',
  model_family: 'OCR 4.1',
  usd_per_1000_pages: 4,
  usd_per_page: 0.004,
  billing_unit: 'processed_page' as const,
  annotation_usd_per_1000_pages: 5,
  sources: ['https://mistral.ai/pricing/api/', 'https://docs.mistral.ai/models/ocr-4-1'],
} as const

export function mistralOcrUsdForPages(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount < 0) return 0
  return Number((pageCount * MISTRAL_OFFICIAL_OCR_PRICING.usd_per_page).toFixed(4))
}

export const MATHPIX_OFFICIAL_PRICING = {
  pricing_date: '2026-09-08',
  currency: 'USD',
  krw_per_usd_assumption: 1390,
  krw_exchange_marked: 'variable' as const,
  setup_fee_usd: 19.99,
  setup_fee_refundable: false,
  test_credit_usd: 29,
  free_trial_without_setup: false,
  image_usd_0_to_1m: 0.002,
  image_usd_above_1m: 0.0015,
  image_volume_tier_reset: 'calendar_month',
  dense_image_row_threshold: 12,
  dense_image_uses_page_rate: true,
  page_usd_0_to_1m: 0.005,
  page_usd_above_1m: 0.0035,
  files_api_page_usd_0_to_30m: 0.0015,
  files_api_page_usd_above_30m: 0.001,
  billing_cycle: '1st of month for prior month usage',
  sources: [
    'https://mathpix.com/pricing/api',
    'https://mathpix.com/docs/convert/billing',
    'https://mathpix.com/docs/convert/creating-an-api-key',
  ],
} as const

export type Money = {
  usd: number
  krw_approx: number
  krw_exchange_marked: 'variable'
  krw_per_usd_assumption: number
}

export type CostScenario = {
  name: string
  units: number
  unit: 'image' | 'page'
  typical: Money
  conservative: Money
  notes: string
}

function money(usd: number): Money {
  const rate = MATHPIX_OFFICIAL_PRICING.krw_per_usd_assumption
  return {
    usd: Number(usd.toFixed(4)),
    krw_approx: Math.round(usd * rate),
    krw_exchange_marked: 'variable',
    krw_per_usd_assumption: rate,
  }
}

function imageCost(count: number): number {
  const tier = MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m
  const high = MATHPIX_OFFICIAL_PRICING.image_usd_above_1m
  if (count <= 1_000_000) return count * tier
  return 1_000_000 * tier + (count - 1_000_000) * high
}

function pageCost(count: number): number {
  const tier = MATHPIX_OFFICIAL_PRICING.page_usd_0_to_1m
  const high = MATHPIX_OFFICIAL_PRICING.page_usd_above_1m
  if (count <= 1_000_000) return count * tier
  return 1_000_000 * tier + (count - 1_000_000) * high
}

export function estimateImageScenario(name: string, count: number): CostScenario {
  return {
    name,
    units: count,
    unit: 'image',
    typical: money(imageCost(count)),
    conservative: money(pageCost(count)),
    notes: `Typical uses official v3/text $${MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m}/image. Conservative assumes every crop has >${MATHPIX_OFFICIAL_PRICING.dense_image_row_threshold} text rows and is billed at v3/pdf $${MATHPIX_OFFICIAL_PRICING.page_usd_0_to_1m}/page. Setup fee and test credit are separate.`,
  }
}

export function estimatePageScenario(name: string, pages: number): CostScenario {
  return {
    name,
    units: pages,
    unit: 'page',
    typical: money(pageCost(pages)),
    conservative: money(pageCost(pages)),
    notes: `Official v3/pdf $${MATHPIX_OFFICIAL_PRICING.page_usd_0_to_1m}/page (0–1M). Setup fee is separate. This is not a monthly subscription.`,
  }
}

export function requiredCostScenarios(): CostScenario[] {
  return [
    estimateImageScenario('A. 1,000 problem crops', 1000),
    estimateImageScenario('B. 5,000 problem crops', 5000),
    estimateImageScenario('C. 10,000 problem crops', 10000),
    estimateImageScenario('D. 50,000 problem crops', 50000),
    estimatePageScenario('whole-PDF 200 pages', 200),
    estimatePageScenario('whole-PDF 2,000 pages', 2000),
    estimatePageScenario('whole-PDF 10,000 pages', 10000),
  ]
}

export function estimateLiveBenchmark26(): {
  sample_count: 26
  estimated_requests: 26
  typical: Money
  conservative_maximum: Money
  setup_fee_if_new_account: Money
  test_credit_if_new_account: Money
  assumptions: string[]
} {
  const typicalUsd = 26 * MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m
  const conservativeUsd = 26 * MATHPIX_OFFICIAL_PRICING.page_usd_0_to_1m
  return {
    sample_count: 26,
    estimated_requests: 26,
    typical: money(typicalUsd),
    conservative_maximum: money(conservativeUsd),
    setup_fee_if_new_account: money(MATHPIX_OFFICIAL_PRICING.setup_fee_usd),
    test_credit_if_new_account: money(MATHPIX_OFFICIAL_PRICING.test_credit_usd),
    assumptions: [
      `Pricing date ${MATHPIX_OFFICIAL_PRICING.pricing_date} from official Mathpix pages.`,
      `Typical: 26 × $${MATHPIX_OFFICIAL_PRICING.image_usd_0_to_1m} = $${typicalUsd.toFixed(3)} if each crop is billed as one image.`,
      `Conservative maximum: 26 × $${MATHPIX_OFFICIAL_PRICING.page_usd_0_to_1m} = $${conservativeUsd.toFixed(3)} if every crop is billed as a PDF page (>${MATHPIX_OFFICIAL_PRICING.dense_image_row_threshold} text rows).`,
      `New account also pays a one-time non-refundable setup fee of $${MATHPIX_OFFICIAL_PRICING.setup_fee_usd}. Official docs apply a $${MATHPIX_OFFICIAL_PRICING.test_credit_usd} credit after setup.`,
      `KRW uses a working assumption of 1 USD = ${MATHPIX_OFFICIAL_PRICING.krw_per_usd_assumption} KRW and is marked variable.`,
      'There is no monthly subscription in this estimate. Cost scales with assumed volume.',
      'Phase A made 0 paid calls. These numbers are estimates only.',
    ],
  }
}
