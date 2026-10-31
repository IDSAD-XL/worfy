// The diagram of the Map of worfy (worfy-guide ticket 05), apart from its component so the tests can
// read it: where every block stands, where it leads, the Edges and the steps. Scene.tsx draws it.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

export const MAP_SPEC: SceneSpec = {
  width: 880,
  height: 690,
  regions: [
    { label: 'otherMachine', x: 16, y: 18 },
    { label: 'thisMachine', x: 16, y: 136 },
  ],
  frames: [
    { block: 'canvas', kind: 'canvas', x: 400, y: 140, width: 464, height: 534 },
    { block: 'epic', kind: 'epic', x: 416, y: 200, width: 432, height: 128 },
  ],
  blocks: [
    // Outside the Canvas: the Machines, the Project and the Harness.
    { id: 'linked', x: 16, y: 28, group: 'machine', topic: 'link', page: page('link') },
    { id: 'machine', x: 16, y: 150, group: 'machine', topic: 'the-window-and-your-data', page: page('storage-and-diagnostics') },
    { id: 'project', x: 216, y: 150, group: 'project', topic: 'projects', page: page('projects') },
    { id: 'harness', x: 16, y: 300, group: 'harness', topic: 'harness', page: page('harness') },
    { id: 'gate', x: 16, y: 440, group: 'harness', topic: 'gate-and-github', page: page('gate-and-github') },
    { id: 'profile', x: 216, y: 440, group: 'harness', topic: 'harness', page: page('harness') },
    // Over the Canvas: Autopilot and the Limits it waits for.
    { id: 'limits', x: 440, y: 28, group: 'machine', topic: 'sessions', page: page('transcripts-and-usage') },
    { id: 'autopilot', x: 704, y: 28, group: 'workflow', topic: 'autopilot', page: page('autopilot') },
    // The Canvas and what lies on it.
    { id: 'canvas', x: 416, y: 124, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'epic', x: 432, y: 184, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'tab', width: 72 },
    { id: 'wave', x: 704, y: 187, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'chip', width: 128 },
    { id: 'ticket', x: 448, y: 244, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'session', x: 424, y: 384, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'subagent', x: 680, y: 384, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'card', x: 424, y: 496, group: 'tools', topic: 'cards', page: page('cards') },
    { id: 'browser', x: 600, y: 496, group: 'tools', topic: 'browser', page: page('browser') },
    { id: 'terminal', x: 552, y: 600, group: 'tools', topic: 'terminal', page: page('terminal') },
  ],
  edges: [
    { from: 'linked', to: 'machine', label: 'linkedBy', fromShift: 44, toShift: 44 },
    { from: 'linked', to: 'canvas', label: 'opensIfAllowed', toShift: -8 },
    { from: 'machine', to: 'project', label: 'hosts' },
    { from: 'project', to: 'canvas', label: 'hasOne', toShift: 8 },
    { from: 'machine', to: 'harness', label: 'onePerMachine' },
    { from: 'harness', to: 'profile', label: 'runsBy', fromSide: 'right', toSide: 'top', fromShift: 12, toShift: -40 },
    { from: 'profile', to: 'project', label: 'describes', fromShift: 40, toShift: 40 },
    { from: 'harness', to: 'session', label: 'guides', fromShift: -12 },
    { from: 'harness', to: 'gate', label: 'includes' },
    { from: 'ticket', to: 'wave', label: 'readyNow' },
    { from: 'autopilot', to: 'wave', label: 'runsWaves' },
    { from: 'autopilot', to: 'limits', label: 'waitsForReset' },
    { from: 'session', to: 'subagent', label: 'starts' },
    { from: 'session', to: 'ticket', label: 'binding', toShift: -30 },
    { from: 'subagent', to: 'ticket', label: 'binding', toShift: 30 },
    { from: 'session', to: 'card', label: 'mayChange', fromShift: -40 },
    { from: 'session', to: 'browser', label: 'signedIn', fromShift: 40 },
  ],
  steps: [
    { caption: 'step1', blocks: ['linked', 'machine', 'project', 'canvas'] },
    { caption: 'step2', blocks: ['epic', 'ticket', 'wave', 'autopilot', 'limits'] },
    { caption: 'step3', blocks: ['harness', 'profile', 'project', 'gate', 'session', 'subagent', 'ticket'] },
    { caption: 'step4', blocks: ['session', 'card', 'browser', 'terminal'] },
  ],
}

