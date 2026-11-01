// The Topic Harness (worfy-guide ticket 18), from docs/features/harness.md and
// docs/features/skills-agents-and-hooks.md: the plugin worfy installs, and the Sessions it reaches.
// worfy and, under "HARNESS HOME", the installed plugin and the Profile; under "SESSIONS", the
// Orchestrator and a Subagent; under "PLUGIN worfy", its skills, hooks, agents, scripts and qmd. The
// Gate the hooks run has no block: step 4 names it, and it has a Topic of its own. The five steps of
// the player walk the install, a worfy Session, the agents and the Profile, the hooks, and the
// scripts with qmd.
//
// The Orchestrator and the Subagent lead to the Topic Sessions, or to its Full page while it is not
// written; the rest are this Topic and lead nowhere.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { HARNESS_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={HARNESS_SCENE} {...props} />
}
