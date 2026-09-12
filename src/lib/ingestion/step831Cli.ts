import { runStep831 } from './step831Run'

const summary = await runStep831(process.cwd(), process.argv.slice(2))
if (summary) {
  console.log(
    `STEP 8.31 compared=${summary.tally.compared} HUMAN_REVIEW=${summary.tally.human_review} BLOCKED=${summary.tally.blocked} AUTO=${summary.tally.auto_approved} mistral_new=${summary.paid_api_calls.mistral}`,
  )
}
