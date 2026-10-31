// The diagram of the Map of worfy (worfy-guide ticket 05), apart from its component so the tests can
// read it: where every block stands, where it leads, the Edges and the steps. Scene.tsx draws it.
//
// Three areas, as the style of the epic's spec names them, and the position says which one a block is
// in: above the caption "THIS MACHINE" only the Linked machine ("OTHER MACHINE"); below it everything
// of this Machine — the column of the Machine, the Project, the Profile, the Harness and the Gate, the
// Canvas frame, and on the right, under "NOT NODES", Autopilot and Limits.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

export const MAP_SPEC: SceneSpec = {
  width: 976,
  height: 690,
  regions: [
    { label: 'otherMachine', x: 16, y: 18 },
    { label: 'thisMachine', x: 16, y: 112 },
    { label: 'notNodes', x: 800, y: 160 },
  ],
  frames: [
    { block: 'canvas', kind: 'canvas', x: 320, y: 140, width: 432, height: 534 },
    { block: 'epic', kind: 'epic', x: 332, y: 200, width: 408, height: 128 },
  ],
  blocks: [
    // The other Machine.
    { id: 'linked', x: 16, y: 28, group: 'machine', topic: 'link', page: page('link') },
    // This Machine, outside the Canvas: the Machine, the Project and the Harness.
    { id: 'machine', x: 16, y: 124, group: 'machine', topic: 'the-window-and-your-data', page: page('storage-and-diagnostics') },
    { id: 'project', x: 16, y: 234, group: 'project', topic: 'projects', page: page('projects') },
    { id: 'profile', x: 16, y: 344, group: 'harness', topic: 'harness', page: page('harness') },
    { id: 'harness', x: 16, y: 454, group: 'harness', topic: 'harness', page: page('harness') },
    { id: 'gate', x: 16, y: 564, group: 'harness', topic: 'gate-and-github', page: page('gate-and-github') },
    // The Canvas and what lies on it.
    { id: 'canvas', x: 336, y: 124, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'epic', x: 348, y: 184, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'tab', width: 72 },
    { id: 'wave', x: 600, y: 187, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'chip', width: 128 },
    { id: 'ticket', x: 360, y: 244, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'session', x: 336, y: 384, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'subagent', x: 576, y: 384, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'card', x: 336, y: 496, group: 'tools', topic: 'cards', page: page('cards') },
    { id: 'browser', x: 512, y: 496, group: 'tools', topic: 'browser', page: page('browser') },
    { id: 'terminal', x: 456, y: 600, group: 'tools', topic: 'terminal', page: page('terminal') },
    // This Machine, not Nodes: Autopilot and the Limits it waits for.
    { id: 'autopilot', x: 800, y: 171, group: 'workflow', topic: 'autopilot', page: page('autopilot') },
    { id: 'limits', x: 800, y: 300, group: 'machine', topic: 'sessions', page: page('transcripts-and-usage') },
  ],
  edges: [
    // No label: the Linked machine's note says it.
    { from: 'linked', to: 'machine', fromShift: 44, toShift: 44 },
    // Into the tab from above: the Project's Edge enters it from the left.
    { from: 'linked', to: 'canvas', label: 'opensIfAllowed', toSide: 'top' },
    { from: 'machine', to: 'project', label: 'hosts' },
    { from: 'project', to: 'canvas', label: 'hasOne' },
    // Round the right of the Project and the Profile, between the column and the Canvas.
    { from: 'machine', to: 'harness', label: 'onePerMachine', fromSide: 'right', toSide: 'right', fromShift: 12, toShift: -14 },
    { from: 'harness', to: 'profile', label: 'runsBy' },
    { from: 'profile', to: 'project', label: 'describes' },
    { from: 'harness', to: 'session', label: 'guides', fromShift: 14 },
    { from: 'harness', to: 'gate', label: 'includes' },
    // Into the chip from below, not along the Epic frame's top edge.
    { from: 'ticket', to: 'wave', label: 'readyNow', fromSide: 'right', toSide: 'bottom' },
    { from: 'autopilot', to: 'wave', label: 'runsWaves' },
    { from: 'autopilot', to: 'limits', label: 'waitsForReset' },
    { from: 'session', to: 'subagent', label: 'starts' },
    { from: 'session', to: 'ticket', label: 'binding', toShift: -30 },
    { from: 'subagent', to: 'ticket', label: 'binding', toShift: 30 },
    { from: 'session', to: 'card', label: 'mayChange', fromShift: -40 },
    { from: 'session', to: 'browser', label: 'signedIn', fromShift: 40 },
  ],
  steps: [
    { caption: 'step1', blocks: ['epic', 'ticket', 'wave', 'autopilot', 'limits'] },
    { caption: 'step2', blocks: ['harness', 'profile', 'project', 'gate', 'session', 'subagent', 'ticket'] },
    { caption: 'step3', blocks: ['session', 'card', 'browser', 'terminal'] },
  ],
}
