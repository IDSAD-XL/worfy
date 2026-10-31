// The two diagrams of the Topic Autopilot (worfy-guide ticket 06), apart from their components so
// the tests can read them: AUTOPILOT_SCENE, one run as a person sees it (Scene.tsx), and
// AUTOPILOT_FLOW, the data flow of a run in Under the hood (Flow.tsx). A thing drawn in both has the
// same group in both, so the same colour: the Orchestrator is `harness`, as scene-colours.ts says,
// and worfy's own code of a run (the run, its cycle, the launcher) is `workflow`.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

export const AUTOPILOT_SCENE: SceneSpec = {
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

export const AUTOPILOT_FLOW: SceneSpec = {
  width: 1020,
  height: 460,
  blocks: [
    { id: 'button', x: 20, y: 20, group: 'workflow' },
    { id: 'ipc', x: 20, y: 160, group: 'machine' },
    { id: 'watch', x: 20, y: 330, group: 'project' },
    { id: 'cycle', x: 300, y: 20, group: 'workflow' },
    { id: 'run', x: 300, y: 160, group: 'workflow' },
    { id: 'journal', x: 300, y: 380, group: 'machine' },
    { id: 'launcher', x: 580, y: 250, group: 'workflow' },
    { id: 'power', x: 580, y: 380, group: 'machine' },
    { id: 'session', x: 840, y: 250, group: 'harness' },
  ],
  edges: [
    // Down and back up between the button and IPC, side by side.
    { from: 'button', to: 'ipc', label: 'start', fromShift: -30, toShift: -30 },
    { from: 'ipc', to: 'button', label: 'changed', fromShift: 30, toShift: 30 },
    { from: 'ipc', to: 'run', label: 'checks', fromShift: -10, toShift: -10 },
    { from: 'run', to: 'ipc', label: 'newState', fromShift: 10, toShift: 10 },
    { from: 'run', to: 'cycle', label: 'event', fromShift: -30, toShift: -30 },
    { from: 'cycle', to: 'run', label: 'effects', fromShift: 30, toShift: 30 },
    { from: 'run', to: 'launcher', label: 'sendWave', fromSide: 'right', toSide: 'left', fromShift: 4 },
    { from: 'launcher', to: 'session', label: 'text' },
    // Up and over the launcher, into the run's right side above the Edge to the launcher.
    { from: 'session', to: 'run', label: 'events', fromSide: 'top', toSide: 'right', toShift: -18 },
    { from: 'watch', to: 'run', label: 'ticketsChanged', toSide: 'bottom', toShift: -40 },
    { from: 'run', to: 'journal', label: 'lines', fromSide: 'bottom', toSide: 'top', fromShift: 20, toShift: 20 },
    { from: 'run', to: 'power', label: 'keepAwake', fromSide: 'right', toSide: 'left', fromShift: 20 },
  ],
  steps: [
    { caption: 'step1', blocks: ['button', 'ipc', 'run'], edges: ['button->ipc', 'ipc->run'] },
    { caption: 'step2', blocks: ['run', 'session', 'journal', 'power', 'watch'], edges: ['run->journal', 'run->power', 'watch->run'] },
    { caption: 'step3', blocks: ['run', 'cycle', 'launcher', 'session'], edges: ['run->cycle', 'cycle->run', 'run->launcher', 'launcher->session'] },
    { caption: 'step4', blocks: ['session', 'watch', 'run', 'ipc', 'button'], edges: ['session->run', 'watch->run', 'run->ipc', 'ipc->button'] },
  ],
}
