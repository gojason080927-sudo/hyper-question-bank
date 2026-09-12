import { runStep831 } from './step831Run'

const summary = await runStep831(process.cwd(), process.argv.slice(2))
if (summary) {
  console.log(
    `STEP 8.31 compared=${summary.tally.compared} AUTO=${summary.tally.auto_approved} HUMAN_REVIEW=${summary.tally.human_review} BLOCKED=${summary.tally.blocked} mistral_new=${summary.paid_api_calls.mistral} cached=${summary.paid_api_calls.mistral_cached}`,
  )
}
