// The diagram of the Topic Link (worfy-guide ticket 17), from docs/features/link.md, in the Living
// Canvas style of the epic's spec. Two areas, and the position says which Machine a block is on.
// Under "THIS MACHINE": the Machine itself, the Machines section of its sidebar and a window that
// shows a Project of the other Machine. Under "OTHER MACHINE": the Linked machine, the access it
// gives this one in its Settings, and its Project, where the work runs. The steps walk linking, the
// state of a Linked machine, access, and a window on a Project over there.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const LINK_SPEC: SceneSpec = {
  width: 976,
  height: 500,
  regions: [
    { label: 'thisMachine', x: 16, y: 24 },
    { label: 'otherMachine', x: 800, y: 24 },
  ],
  blocks: [
    // This Machine.
    { id: 'machine', x: 16, y: 40, group: 'machine', topic: 'the-window-and-your-data', page: 'docs/features/storage-and-diagnostics.md' },
    { id: 'section', x: 16, y: 160, group: 'machine' },
    { id: 'window', x: 16, y: 300, group: 'machine' },
    // The other Machine.
    { id: 'linked', x: 800, y: 40, group: 'machine' },
    { id: 'access', x: 800, y: 300, group: 'machine' },
    { id: 'project', x: 800, y: 420, group: 'project', topic: 'projects', page: 'docs/features/projects.md' },
  ],
  edges: [
    // Apart on the Linked machine's left side: the code arrives above, the state leaves below.
    { from: 'machine', to: 'linked', label: 'code', fromShift: -10, toShift: -10 },
    { from: 'linked', to: 'section', label: 'state', fromShift: 14 },
    { from: 'window', to: 'access', label: 'commands', fromShift: -12 },
    { from: 'access', to: 'project', label: 'byLevel' },
    // Back under the call, into the window's right side below it.
    { from: 'project', to: 'window', label: 'shown', toShift: 12 },
  ],
  steps: [
    { caption: 'step1', blocks: ['machine', 'linked'] },
    { caption: 'step2', blocks: ['linked', 'section'] },
    { caption: 'step3', blocks: ['access', 'project'] },
    { caption: 'step4', blocks: ['window', 'access', 'project'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={LINK_SPEC} {...props} />
}
