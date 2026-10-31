// The Topic Autopilot (worfy-guide ticket 06), from docs/features/autopilot.md: one run of an Epic, as
// a person sees it. On the Canvas, the Epic frame with its Tickets and the "Ready wave · N" chip, the
// Orchestrator and the implementers it starts in the background; outside it, under "NOT NODES",
// Autopilot with the Limits it waits for and the journal it keeps. The five steps of the player walk
// one Wave: take the ready Wave, send "Run wave", the work, the end of the Wave, the waits.
//
// Blocks that have a Topic of their own lead to it, or to its Full page while it is not written; the
// Autopilot block and the journal lead nowhere, they are this Topic.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

const SPEC: SceneSpec = {
  width: 860,
  height: 510,
  regions: [{ label: 'notNodes', x: 680, y: 68 }],
  frames: [
    { block: 'canvas', kind: 'canvas', x: 16, y: 32, width: 600, height: 392 },
    { block: 'epic', kind: 'epic', x: 36, y: 96, width: 560, height: 124 },
  ],
  blocks: [
    // On the Canvas: the Epic frame with its Tickets and Wave, the Orchestrator and its implementers.
    { id: 'canvas', x: 32, y: 16, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'epic', x: 52, y: 80, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'tab', width: 72 },
    { id: 'wave', x: 420, y: 83, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'chip', width: 150 },
    { id: 'tickets', x: 64, y: 140, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'implementers', x: 64, y: 330, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'orchestrator', x: 392, y: 330, group: 'harness', topic: 'sessions', page: page('sessions') },
    // Not Nodes: the run, the Limits it waits for and its journal.
    { id: 'limits', x: 680, y: 80, group: 'machine', topic: 'sessions', page: page('transcripts-and-usage') },
    { id: 'autopilot', x: 680, y: 330, group: 'workflow' },
    { id: 'journal', x: 680, y: 444, group: 'machine' },
  ],
  edges: [
    // Into the chip from below, side by side.
    { from: 'tickets', to: 'wave', label: 'readyNow', fromSide: 'right', toSide: 'bottom', toShift: -30 },
    { from: 'autopilot', to: 'wave', label: 'takes', fromSide: 'top', toSide: 'bottom', fromShift: -40, toShift: 30 },
    // There and back between Autopilot and the Orchestrator: two level lines, apart.
    { from: 'autopilot', to: 'orchestrator', label: 'sendsRunWave', fromShift: -12, toShift: -12 },
    { from: 'orchestrator', to: 'autopilot', label: 'turnEnded', fromShift: 12, toShift: 12 },
    { from: 'orchestrator', to: 'implementers', label: 'startsInBackground' },
    { from: 'implementers', to: 'tickets', label: 'workOn' },
    { from: 'autopilot', to: 'limits', label: 'waitsForReset', fromShift: 20, toShift: 20 },
    { from: 'autopilot', to: 'journal', label: 'records' },
  ],
  steps: [
    { caption: 'step1', blocks: ['epic', 'tickets', 'wave', 'autopilot'] },
    { caption: 'step2', blocks: ['autopilot', 'orchestrator'], edges: ['autopilot->orchestrator'] },
    { caption: 'step3', blocks: ['orchestrator', 'implementers', 'tickets'] },
    { caption: 'step4', blocks: ['orchestrator', 'tickets', 'wave', 'autopilot'], edges: ['orchestrator->autopilot', 'tickets->wave', 'autopilot->wave'] },
    { caption: 'step5', blocks: ['autopilot', 'limits', 'journal'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={SPEC} {...props} />
}
