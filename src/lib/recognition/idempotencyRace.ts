/**
 * Models the STEP 8.4 persist path: lookup problem_sources, then create if missing.
 * There is no DB UNIQUE on (document, page, problem_number), so two workers can both
 * see "missing" and both call hqb_create_problem_draft_from_region.
 */
export type RaceStore = {
  problems: string[]
  locked: boolean
}

export const RECOMMENDED_IDEMPOTENCY_FIX = {
  kind: 'advisory_lock_rpc' as const,
  rpc: 'hqb_upsert_problem_draft_from_identity',
  why: 'Reuse existing draft RPCs inside one SECURITY DEFINER function. Lock on hashtext(document|page|number) before lookup+create. No client-side race window. Unique identity table is optional later.',
  alternatives: ['unique persist_identity table', 'region UNIQUE(page_id, original_problem_number) where not archived'],
  apply_migration_in_this_step: false,
}

export function simulateConcurrentPersist(input: { workers: number; useAdvisoryLock: boolean }): {
  problem_count: number
  race_possible: boolean
} {
  const store: RaceStore = { problems: [], locked: false }
  const lookups: boolean[] = []
  for (let i = 0; i < input.workers; i += 1) {
    if (input.useAdvisoryLock) {
      store.locked = true
      const missing = store.problems.length === 0
      if (missing) store.problems.push(`p${store.problems.length + 1}`)
      store.locked = false
      lookups.push(missing)
    } else {
      lookups.push(store.problems.length === 0)
    }
  }
  if (!input.useAdvisoryLock) {
    for (const missing of lookups) {
      if (missing) store.problems.push(`p${store.problems.length + 1}`)
    }
  }
  return {
    problem_count: store.problems.length,
    race_possible: !input.useAdvisoryLock && input.workers > 1,
  }
}
