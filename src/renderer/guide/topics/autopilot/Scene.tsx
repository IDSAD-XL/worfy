// The Topic Autopilot (worfy-guide ticket 06), from docs/features/autopilot.md: one run of an Epic, as
// a person sees it. On the Canvas, the Epic frame with its Tickets and the "Ready wave · N" chip, the
// Orchestrator and the implementers it starts in the background; outside it, under "NOT NODES",
// Autopilot with the Limits it waits for and the journal it keeps. The five steps of the player walk
// one Wave: take the ready Wave, send "Run wave", the work, the end of the Wave, the waits.
//
// Blocks that have a Topic of their own lead to it, or to its Full page while it is not written; the
// Autopilot block and the journal lead nowhere, they are this Topic.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { AUTOPILOT_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={AUTOPILOT_SCENE} {...props} />
}
