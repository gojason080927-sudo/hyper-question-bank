import { cm2ProfileById } from './cm2Catalog'
import { CM2_DIFFICULTY_ENGINE, estimateCm2Difficulty, type Cm2DifficultyEstimate } from './cm2DifficultyRubric'

export const CM2_DIFFICULTY_APPLY_BY = 'BOOK_CLASSIFY_CM2'
export const CM2_DIFFICULTY_ARTIFACT = 'cm2-absolute-v1'

export type Cm2DifficultyRow = {
  problem_id: string
  version_id: string
  book: string
  number: string
  stored_type: string | null
  type_used: boolean
  estimate: Cm2DifficultyEstimate
}

export function typeForDifficulty(storedType: string | null | undefined): string | null {
  if (!storedType || storedType === 'TYPE_UNCLEAR') return null
  return cm2ProfileById(storedType) ? storedType : null
}

export function scoreStoredCm2Difficulty(input: { stem: string; storedType?: string | null }): Cm2DifficultyEstimate {
  return estimateCm2Difficulty({ stem: input.stem, type_id: typeForDifficulty(input.storedType) })
}

export function emptyLevelHist(): Record<1 | 2 | 3 | 4 | 5, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
}

export function addLevel(hist: Record<1 | 2 | 3 | 4 | 5, number>, level: 1 | 2 | 3 | 4 | 5): void {
  hist[level] += 1
}

export function dimsAreSplit(row: Cm2DifficultyEstimate): boolean {
  return new Set(Object.values(row.dim_levels)).size > 1 || row.overall_level === 1
}

export function distributionLooksSane(input: {
  total: number
  overall: Record<1 | 2 | 3 | 4 | 5, number>
  books: Record<string, Record<1 | 2 | 3 | 4 | 5, number>>
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (input.total < 100) reasons.push('TOO_FEW_ROWS')
  const d1 = input.overall[1] / input.total
  const d5 = input.overall[5] / input.total
  if (d1 >= 0.85) reasons.push('D1_PILE')
  if (d5 >= 0.25) reasons.push('D5_PILE')
  if (input.overall[2] + input.overall[3] + input.overall[4] === 0) reasons.push('NO_MID_BAND')
  const intro = input.books.lightssen2
  const hard = input.books.gojaeng2
  if (intro && intro[1] + intro[2] < intro[4] + intro[5]) reasons.push('INTRO_TOO_HARD')
  if (hard && hard[4] + hard[5] === 0) reasons.push('HARD_BOOK_NO_TOP')
  return { ok: reasons.length === 0, reasons }
}
