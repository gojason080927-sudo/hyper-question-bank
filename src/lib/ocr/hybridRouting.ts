/**
 * Architecture notes only. Do not wire this into production recognition.
 * Automatic paid/local routing is deferred until a real Mathpix benchmark exists.
 */
export type HybridHint = 'local_ocr' | 'mathpix_candidate' | 'keep_original_figure'

export function hybridHintForCategory(category: string): HybridHint {
  if (/figure|graph|triangle|path|parabola|rect/i.test(category)) return 'keep_original_figure'
  if (/korean/i.test(category) && !/math|frac|rad|ineq|exp|mcq|abs|sub/i.test(category)) {
    return 'local_ocr'
  }
  if (/exponent|radical|fraction|ineq|abs|mcq|poly|ident|piece|quad|disc|fn|sub/i.test(category)) {
    return 'mathpix_candidate'
  }
  return 'local_ocr'
}

export const HYBRID_PRODUCTION_ROUTED = false
