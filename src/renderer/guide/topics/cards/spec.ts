// The two diagrams of the Topic Cards (worfy-guide ticket 15), from docs/features/cards.md, apart from
// their components so the tests can read them: CARDS_SCENE, a Card as a person sees it (Scene.tsx),
// and CARDS_FLOW, the data flow of a Card in Under the hood (Flow.tsx).
//
// CARDS_SCENE: on the Canvas frame, the Session of an agent, the Orchestrator and the Card. Outside it,
// the agent's Canvas MCP tools, the Card's files and its saved data (both in the Project data folder,
// not Nodes) and the workflow the Card reads. The steps walk the page's sections: create_card and the
// files, the reload, what a page reaches, worfy.ask.
//
// CARDS_FLOW: four columns, after the page's three "Data flow" paragraphs — the Card's page, the
// window, the main process, and Claude Code above the Project data folder. create_card and the
// agent's writes; a file change through CardStore and cards.changed to a new iframe; a request from
// window.worfy through the bridge to main over IPC.
//
// A thing drawn in both has the same group in both: the Card and its Node are Tools, the Card's files
// and data Machine, the Session or Claude Code Agents. The Canvas MCP tools are Agents, as on the
// data-flow diagram of the Topic Canvas; the Orchestrator is Harness, as on the Map.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

export const CARDS_SCENE: SceneSpec = {
  width: 820,
  height: 510,
  frames: [{ block: 'canvas', kind: 'canvas', x: 16, y: 40, width: 520, height: 350 }],
  blocks: [
    // On the Canvas.
    { id: 'canvas', x: 32, y: 24, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'session', x: 40, y: 90, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'card', x: 340, y: 220, group: 'tools' },
    { id: 'orchestrator', x: 40, y: 300, group: 'harness', topic: 'sessions', page: page('sessions') },
    // Outside the Canvas: not Nodes.
    { id: 'files', x: 640, y: 60, group: 'machine' },
    { id: 'canvasMcp', x: 640, y: 190, group: 'agents' },
    { id: 'workflow', x: 640, y: 320, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'data', x: 340, y: 436, group: 'machine' },
  ],
  edges: [
    // Out of the Session's right side, apart: its writes and its tool call.
    { from: 'session', to: 'files', label: 'writesFiles', fromShift: -12, toShift: -14 },
    { from: 'session', to: 'canvasMcp', label: 'createCard', fromShift: 12 },
    { from: 'canvasMcp', to: 'files', label: 'makesFolder' },
    // Into the Card's right side, apart: the files, the tool and the workflow.
    { from: 'files', to: 'card', label: 'reloads', fromShift: 14, toShift: -18 },
    { from: 'canvasMcp', to: 'card', label: 'makesNode' },
    { from: 'workflow', to: 'card', label: 'snapshot', toShift: 18 },
    { from: 'card', to: 'data', label: 'saves' },
    // Into the Session from below, away from the two Edges that leave its right side.
    { from: 'card', to: 'session', label: 'ask', fromShift: -12, toSide: 'bottom' },
    { from: 'card', to: 'orchestrator', label: 'orAsk', fromShift: 12 },
  ],
  steps: [
    { caption: 'step1', blocks: ['session', 'canvasMcp', 'files', 'card'], edges: ['session->canvasMcp', 'canvasMcp->files', 'canvasMcp->card', 'session->files'] },
    { caption: 'step2', blocks: ['files', 'card'] },
    { caption: 'step3', blocks: ['card', 'data', 'workflow'] },
    { caption: 'step4', blocks: ['card', 'session', 'orchestrator'] },
  ],
}

export const CARDS_FLOW: SceneSpec = {
  width: 1000,
  height: 496,
  regions: [
    { label: 'pageArea', x: 16, y: 30 },
    { label: 'renderer', x: 266, y: 30 },
    { label: 'main', x: 516, y: 30 },
    { label: 'claude', x: 766, y: 30 },
    { label: 'folder', x: 766, y: 156 },
  ],
  blocks: [
    // The Card's page.
    { id: 'page', x: 16, y: 170, group: 'tools' },
    // The window.
    { id: 'cardNode', x: 266, y: 44, group: 'tools' },
    { id: 'bridge', x: 266, y: 422, group: 'machine' },
    // The main process.
    { id: 'server', x: 516, y: 44, group: 'agents' },
    { id: 'store', x: 516, y: 170, group: 'machine' },
    { id: 'protocol', x: 516, y: 296, group: 'machine' },
    { id: 'api', x: 516, y: 422, group: 'machine' },
    // Claude Code, and the Project data folder under it.
    { id: 'session', x: 766, y: 44, group: 'agents' },
    { id: 'files', x: 766, y: 170, group: 'machine' },
    { id: 'data', x: 766, y: 422, group: 'machine' },
  ],
  edges: [
    // create_card and the agent's writes.
    { from: 'session', to: 'server', label: 'toolCalls' },
    { from: 'server', to: 'files', label: 'makesFolder', toShift: -14 },
    // Round the right sides, clear of the caption PROJECT DATA FOLDER over the files.
    { from: 'session', to: 'files', label: 'writes', fromSide: 'right', toSide: 'right' },
    // A file change: the watch, cards.changed, a new iframe that loads the files.
    { from: 'files', to: 'store', label: 'change', fromShift: 0 },
    { from: 'store', to: 'cardNode', label: 'changed' },
    { from: 'cardNode', to: 'page', label: 'iframe', toShift: -14 },
    { from: 'files', to: 'protocol', label: 'reads', fromShift: 14 },
    { from: 'protocol', to: 'page', label: 'serves', toShift: 14 },
    // A request of window.worfy and its answer.
    // Down into the bridge's left side, and back up from its top: two curves apart, their labels apart.
    { from: 'page', to: 'bridge', label: 'post', fromSide: 'bottom', toSide: 'left', fromShift: -20 },
    { from: 'bridge', to: 'page', label: 'answer', fromSide: 'top', toSide: 'bottom', toShift: 30 },
    { from: 'bridge', to: 'api', label: 'ipc' },
    { from: 'api', to: 'data', label: 'saves' },
  ],
  steps: [
    { caption: 'step1', blocks: ['session', 'server', 'files'] },
    { caption: 'step2', blocks: ['files', 'store', 'cardNode', 'protocol', 'page'], edges: ['files->store', 'store->cardNode', 'cardNode->page', 'files->protocol', 'protocol->page'] },
    { caption: 'step3', blocks: ['page', 'bridge', 'api', 'data'] },
  ],
}
