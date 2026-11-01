// The data flow of the PR and CI badges (worfy-guide ticket 12), the diagram of the Topic's Under the
// hood, from the "Data flow" paragraphs of docs/features/gate-and-github.md. The diagram itself is
// GATE_FLOW in spec.ts; it is labelled from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { GATE_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={GATE_FLOW} {...props} />
}
