// The Map of worfy (worfy-guide ticket 05): the overview diagram of the Guide, from
// docs/features/concepts.md, in the Living Canvas style of the epic's spec. The Canvas is a frame with
// the Nodes inside it — the Epic frame with its Ticket and the "Ready wave · N" chip, the Session and
// its Subagent, a Card, a Browser and a Terminal; what is not a Node stands outside it: the Machines,
// the Project, the Harness with the Profile and the Gate, Autopilot and Limits. Nesting is drawn by
// position: "Canvas → Node" and "Epic → Ticket" have no line.
//
// Every block leads to its Topic (an id of registry.ts); while that Topic is not written yet, to its
// page of docs/features/ on GitHub, the Topic's Full page. The id of each Topic is the slug of its
// Ticket in .scratch/worfy-guide/issues/ (06-topic-autopilot.md → `autopilot`), and
// test/unit/guide-map.test.tsx fails when a Topic of the registry has no block in spec.ts.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { MAP_SPEC } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={MAP_SPEC} {...props} />
}
