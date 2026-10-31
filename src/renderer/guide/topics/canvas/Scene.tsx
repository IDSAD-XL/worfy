// The diagram of the Topic Canvas (worfy-guide ticket 07), from docs/features/canvas.md,
// epic-frames.md and focus-mode.md, in the Living Canvas style of the epic's spec; what it draws is
// in spec.ts.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { CANVAS_SPEC } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={CANVAS_SPEC} {...props} />
}
