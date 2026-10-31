// The diagram of the test Topic (worfy-guide tickets 03 and 04): the two ways into the Guide and where
// it reads its Topics from, drawn with the scene kit (../../scene/): moving dots on the Edges, the
// highlight of a block's Edges, and three steps. Labels come from the Topic's texts, so the diagram
// speaks the Guide's language.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const SPEC: SceneSpec = {
  width: 660,
  height: 230,
  blocks: [
    { id: 'menu', x: 20, y: 30, group: 'workflow' },
    { id: 'palette', x: 20, y: 142, group: 'agents' },
    { id: 'guide', x: 250, y: 86, group: 'harness' },
    { id: 'topics', x: 480, y: 86, group: 'tools' },
  ],
  edges: [
    { from: 'menu', to: 'guide', label: 'opens' },
    { from: 'palette', to: 'guide', label: 'opens' },
    { from: 'guide', to: 'topics', label: 'reads' },
  ],
  steps: [
    { caption: 'step1', blocks: ['menu', 'guide'] },
    { caption: 'step2', blocks: ['palette', 'guide'] },
    { caption: 'step3', blocks: ['guide', 'topics'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={SPEC} {...props} />
}
