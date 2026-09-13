import { runStep834 } from './step834Run'

const summary = await runStep834(process.cwd(), process.argv.slice(2))
if (summary) {
  console.log(
    `STEP 8.34 residuals=${summary.inspected_residuals} auto=${summary.auto_resolved} human=${summary.human_review_remaining} bbox=${summary.bbox_applied} embed=${summary.embeddings.written} persist_cleared=${summary.persist.cleared} failed=${summary.persist.failed.length}`,
  )
}
