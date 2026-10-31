// The data-flow diagram of the test Topic's Under the hood (worfy-guide ticket 07): how a Topic's files
// reach the window. It shows the optional Flow.tsx of a Topic at work, so the tests of the window
// have one to draw. Labels come from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const SPEC: SceneSpec = {
  width: 660,
  height: 110,
  blocks: [
    { id: 'files', x: 20, y: 26, group: 'tools' },
    { id: 'content', x: 250, y: 26, group: 'harness' },
    { id: 'window', x: 480, y: 26, group: 'workflow' },
  ],
  edges: [
    { from: 'files', to: 'content', label: 'bundled' },
    { from: 'content', to: 'window', label: 'topics' },
  ],
}

export default function Flow(props: SceneProps) {
  return <LivingScene spec={SPEC} {...props} />
}
