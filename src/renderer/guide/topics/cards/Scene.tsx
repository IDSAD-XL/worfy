// The Topic Cards (worfy-guide ticket 15), from docs/features/cards.md: a Card as a person sees it. On
// the Canvas, the Session of the agent that builds the Card, the Card and the Orchestrator; outside it,
// the agent's Canvas MCP tools, the Card's files and saved data, and the workflow the Card reads. The
// four steps of the player: create_card and the files, the reload, what a page reaches, worfy.ask.
//
// Blocks that have a Topic of their own lead to it, or to its Full page while it is not written; the
// Card and its files lead nowhere, they are this Topic.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { CARDS_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={CARDS_SCENE} {...props} />
}
