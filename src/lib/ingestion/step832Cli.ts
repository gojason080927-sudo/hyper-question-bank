import { runStep832 } from './step832Run'

const summary = await runStep832(process.cwd(), process.argv.slice(2))
if (summary) {
  console.log(
    `STEP 8.32 pages=${summary.pages_processed} found=${summary.problems_found} create=${summary.tally.create_draft} existing=${summary.tally.record_existing} review=${summary.tally.needs_review} blocked=${summary.tally.blocked} mistral_new=${summary.paid_api_calls.mistral} cached=${summary.paid_api_calls.mistral_cached} usd=${summary.estimated_usd} persist=${summary.persist.created.length}`,
  )
}
