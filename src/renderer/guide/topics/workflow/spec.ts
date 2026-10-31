// The two diagrams of the Topic Workflow (worfy-guide ticket 11), from docs/features/workflow.md, apart
// from their components so the tests can read them.
//
// WORKFLOW_SCENE (Scene.tsx): the work of a Project as a person sees it. On the Canvas, the Epic frame
// with a done Ticket that blocks an open one, the "Ready wave · N" chip, and the two agents the
// frame's actions start: the Orchestrator (Run wave) and a Session (Ship ticket), each bound to its
// target. Under "NOT NODES", the Ticket files worfy reads, the Pipeline and GitHub. The five steps walk
// reading the files, the ready Wave, starting the work, the Stages and the Bindings.
//
// WORKFLOW_FLOW (Flow.tsx): the "Data flow" paragraphs of the page's Ticket-and-Epic and Pipeline
// sections. worfy's own plumbing (the renderer's shared copy, WorkflowHub) is the neutral `machine`;
// what draws Epics, Tickets and Stages is `workflow`, as the Pipeline is on the Scene; the Ticket
// files, git and GitHub are the Project's; epic-status and the Orchestrator are the Harness's.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

export const WORKFLOW_SCENE: SceneSpec = {
  width: 976,
  height: 508,
  regions: [{ label: 'notNodes', x: 776, y: 32 }],
  frames: [
    { block: 'canvas', kind: 'canvas', x: 16, y: 40, width: 640, height: 452 },
    { block: 'epic', kind: 'epic', x: 36, y: 104, width: 600, height: 148 },
  ],
  blocks: [
    // On the Canvas: the Epic frame with its Tickets and the ready Wave, and the agents below it.
    { id: 'canvas', x: 32, y: 24, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'epic', x: 52, y: 88, group: 'workflow', shape: 'tab', width: 72 },
    { id: 'wave', x: 446, y: 91, group: 'workflow', shape: 'chip', width: 150 },
    { id: 'ticketDone', x: 216, y: 168, group: 'workflow' },
    { id: 'ticketReady', x: 436, y: 168, group: 'workflow' },
    { id: 'orchestrator', x: 60, y: 392, group: 'harness', topic: 'sessions', page: page('sessions') },
    { id: 'session', x: 436, y: 392, group: 'agents', topic: 'sessions', page: page('sessions') },
    // Not Nodes: the files the workflow is read from, the Pipeline, and GitHub.
    { id: 'files', x: 776, y: 44, group: 'project' },
    { id: 'pipeline', x: 776, y: 236, group: 'workflow' },
    { id: 'github', x: 776, y: 420, group: 'project', topic: 'gate-and-github', page: page('gate-and-github') },
  ],
  edges: [
    { from: 'files', to: 'ticketReady', label: 'readsFiles', toShift: -12 },
    { from: 'ticketDone', to: 'ticketReady', label: 'blocks' },
    { from: 'ticketReady', to: 'wave', label: 'readyNow', fromSide: 'top', toSide: 'bottom' },
    // Down out of the tab to the Orchestrator and back, side by side, left of the Done Ticket.
    { from: 'epic', to: 'orchestrator', label: 'runWave', fromSide: 'bottom', toSide: 'top', fromShift: -14, toShift: -40 },
    { from: 'orchestrator', to: 'epic', label: 'binding', fromSide: 'top', toSide: 'bottom', fromShift: -8, toShift: 14 },
    // Down to the Session and back up, apart.
    { from: 'ticketReady', to: 'session', label: 'shipTicket', fromSide: 'bottom', toSide: 'top', fromShift: -30, toShift: -30 },
    { from: 'session', to: 'ticketReady', label: 'binding', fromSide: 'top', toSide: 'bottom', fromShift: 30, toShift: 30 },
    { from: 'session', to: 'files', label: 'ticketClaim', fromSide: 'right', toSide: 'left', toShift: 14 },
    { from: 'pipeline', to: 'ticketReady', label: 'stepper', toShift: 12 },
    { from: 'files', to: 'pipeline', label: 'status' },
    { from: 'github', to: 'pipeline', label: 'facts' },
  ],
  steps: [
    { caption: 'step1', blocks: ['files', 'epic', 'ticketDone', 'ticketReady'], edges: ['files->ticketReady', 'ticketDone->ticketReady'] },
    { caption: 'step2', blocks: ['ticketDone', 'ticketReady', 'wave'] },
    { caption: 'step3', blocks: ['ticketReady', 'session', 'epic', 'orchestrator', 'files'], edges: ['ticketReady->session', 'epic->orchestrator', 'session->files'] },
    { caption: 'step4', blocks: ['files', 'github', 'pipeline', 'ticketReady'], edges: ['files->pipeline', 'github->pipeline', 'pipeline->ticketReady'] },
    { caption: 'step5', blocks: ['session', 'orchestrator', 'ticketReady', 'epic'], edges: ['session->ticketReady', 'orchestrator->epic'] },
  ],
}

export const WORKFLOW_FLOW: SceneSpec = {
  width: 976,
  height: 452,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'main', x: 408, y: 24 },
    { label: 'outside', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer.
    { id: 'nodes', x: 16, y: 40, group: 'workflow' },
    { id: 'copy', x: 16, y: 160, group: 'machine' },
    { id: 'stages', x: 16, y: 340, group: 'workflow' },
    // The main process.
    { id: 'hub', x: 408, y: 160, group: 'machine' },
    { id: 'stageHub', x: 408, y: 340, group: 'workflow' },
    // Outside worfy.
    { id: 'files', x: 800, y: 40, group: 'project' },
    { id: 'epicStatus', x: 800, y: 160, group: 'harness' },
    { id: 'git', x: 800, y: 270, group: 'project' },
    { id: 'github', x: 800, y: 380, group: 'project' },
  ],
  edges: [
    // The model: asked once, then only what changed.
    { from: 'copy', to: 'hub', label: 'open', fromShift: -12, toShift: -12 },
    { from: 'hub', to: 'copy', label: 'changed', fromShift: 12, toShift: 12 },
    { from: 'copy', to: 'nodes', label: 'toNodes' },
    // Into the hub's top from the files it watches, apart from the Edges to and from epic-status.
    { from: 'files', to: 'hub', label: 'fileEvents', fromSide: 'left', toSide: 'top' },
    { from: 'hub', to: 'epicStatus', label: 'runs', fromShift: -12, toShift: -12 },
    { from: 'epicStatus', to: 'hub', label: 'model', fromShift: 12, toShift: 12 },
    { from: 'files', to: 'epicStatus', label: 'reads' },
    { from: 'git', to: 'hub', label: 'refs', fromShift: -12, toSide: 'bottom', toShift: 30 },
    // The Stages: the hub's changes of fields, then the facts of git and GitHub.
    { from: 'hub', to: 'stageHub', label: 'fields', fromSide: 'bottom', toSide: 'top', fromShift: -30, toShift: -30 },
    { from: 'stages', to: 'stageHub', label: 'get', fromShift: -12, toShift: -12 },
    { from: 'stageHub', to: 'stages', label: 'pipelineChanged', fromShift: 12, toShift: 12 },
    { from: 'git', to: 'stageHub', label: 'heads', fromShift: 12, toShift: -12 },
    { from: 'github', to: 'stageHub', label: 'prs', toShift: 12 },
  ],
}
