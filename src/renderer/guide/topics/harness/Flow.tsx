// The data-flow diagram of Under the hood of the Topic Harness (worfy-guide ticket 18), from the
// "How it works" and "Implementation" sections of docs/features/harness.md. Three columns: the
// renderer with the plugin folder of the Harness home below it, the main process, and Claude Code
// with its home.
// Labelled from the Topic's `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { HARNESS_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={HARNESS_FLOW} {...props} />
}
