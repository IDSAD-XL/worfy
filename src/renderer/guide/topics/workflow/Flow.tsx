// The data flow of the workflow model and the Stages (worfy-guide ticket 11), the diagram of the
// Topic's Under the hood, from the two "Data flow" paragraphs of docs/features/workflow.md. The
// renderer's shared copy asks WorkflowHub on workflow.open; the hub runs epic-status on the Ticket
// files and on moved branches, and answers with workflow.changed. StageHub follows the hub's changes
// of fields, takes the facts of git and GitHub, and answers pipeline.changed. The diagram is
// WORKFLOW_FLOW of spec.ts, labelled from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { WORKFLOW_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={WORKFLOW_FLOW} {...props} />
}
