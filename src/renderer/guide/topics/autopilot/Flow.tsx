// The data flow of an Autopilot run (worfy-guide ticket 06), the diagram of the Topic's Under the hood,
// from the section "Data flow" of docs/features/autopilot.md. The button asks main over IPC; the run
// (src/main/autopilot/run.ts) feeds each event to the pure cycle and carries out its effects: "Run
// wave" through the launcher to the Orchestrator's Session, lines to the journal, keep-awake. The
// Session's events and the workflow watch come back to the run, and every new state goes to every
// window as autopilot.changed. Labelled from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const SPEC: SceneSpec = {
  width: 1020,
  height: 460,
  blocks: [
    { id: 'button', x: 20, y: 20, group: 'workflow' },
    { id: 'ipc', x: 20, y: 160, group: 'machine' },
    { id: 'watch', x: 20, y: 330, group: 'project' },
    { id: 'cycle', x: 300, y: 20, group: 'workflow' },
    { id: 'run', x: 300, y: 160, group: 'workflow' },
    { id: 'journal', x: 300, y: 380, group: 'machine' },
    { id: 'launcher', x: 580, y: 250, group: 'harness' },
    { id: 'power', x: 580, y: 380, group: 'machine' },
    { id: 'session', x: 840, y: 250, group: 'agents' },
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

export default function Flow(props: SceneProps) {
  return <LivingScene spec={SPEC} {...props} />
}
