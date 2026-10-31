// The Topic Gate and GitHub (worfy-guide ticket 12), from docs/features/gate-and-github.md: a run of
// the Gate and the PR on GitHub, as a person sees them in the chips on a Ticket and a Session. The
// diagram itself is GATE_SCENE in spec.ts.
//
// Blocks that have a Topic of their own lead to it, or to its Full page while it is not written; the
// Gate, the worktree and GitHub lead nowhere, they are this Topic.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { GATE_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={GATE_SCENE} {...props} />
}
