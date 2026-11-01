// The Topic Workflow (worfy-guide ticket 11), from docs/features/workflow.md: Epics and Tickets on the
// Canvas, the ready Wave, the actions that start the work, the Pipeline and the Bindings, as a person
// sees them. The diagram is WORKFLOW_SCENE of spec.ts.
//
// Blocks that have a Topic of their own lead to it, or to its Full page while it is not written; the
// Epic, the Tickets, the Wave, the Ticket files and the Pipeline lead nowhere, they are this Topic.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { WORKFLOW_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={WORKFLOW_SCENE} {...props} />
}
