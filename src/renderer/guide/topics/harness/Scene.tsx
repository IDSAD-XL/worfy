// The Topic Harness (worfy-guide ticket 18), from docs/features/harness.md and
// docs/features/skills-agents-and-hooks.md: the plugin worfy installs, and the Sessions it reaches.
// worfy and, under "HARNESS HOME", the installed plugin and the Profile; under "SESSIONS", the
// Orchestrator and a Subagent; under "PLUGIN worfy", its skills, hooks, agents, scripts and qmd, with
// the Gate the hooks run. The five steps of the player walk the install, a worfy Session, the agents
// and the Profile, the hooks, and the scripts with qmd.
//
// The Orchestrator, the Subagent and the Gate lead to their Topics, or to their Full pages while those
// are not written; the rest are this Topic and lead nowhere.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { HARNESS_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={HARNESS_SCENE} {...props} />
}
