import { runStep833 } from './step833Run'

const summary = await runStep833(process.cwd(), process.argv.slice(2))
if (summary) {
  console.log(
    `STEP 8.33 inspected=${summary.inspected} scoped=${summary.scoped_needs_review} cleared=${summary.auto_cleared} human=${summary.human_review_remaining} fp=${summary.fingerprints_written} class=${summary.classification_written} persist_cleared=${summary.persist.cleared} failed=${summary.persist.failed.length}`,
  )
}
