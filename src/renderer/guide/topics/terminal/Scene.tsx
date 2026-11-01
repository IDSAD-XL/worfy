// The Topic Terminal (worfy-guide ticket 13), from docs/features/terminal.md: the Terminal as a person
// sees it. On the Canvas, the Terminal Node; outside it, the shell it runs in the Project folder, another
// screen that opens the same shell, and Terminal AI, which asks a Claude Code process of its own and
// pauses near the Limits. The five steps of the player walk the start, a shell that outlives its view,
// several screens, the grey text of Terminal AI, and Fix.
//
// The Canvas tab and the Limits lead to their Topics; the other blocks only highlight.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { TERMINAL_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={TERMINAL_SCENE} {...props} />
}
