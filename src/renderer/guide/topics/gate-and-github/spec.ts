// The two diagrams of the Topic Gate and GitHub (worfy-guide ticket 12), from
// docs/features/gate-and-github.md, apart from their components so the tests can read them.
//
// GATE_SCENE, as a person sees it: under THIS MACHINE, the Gate with the worktree it checks under it, and the
// Canvas frame with a Ticket and a Session, the Nodes that show the chips; under GITHUB, the PR with
// its CI checks and the review mark. The steps walk a run, its verdict as a chip, the held turn, the
// PR's chips and what a merge needs.
//
// GATE_FLOW, the data flow of the badges in Under the hood (the page's two "Data flow" paragraphs):
// the Gate writes its state, GateReader and PrTracker read the Gate and GitHub in main, checks.get
// joins them for the renderer's copy, and ChecksBadges draws the chips.
//
// A thing drawn in both has the same group in both: the Gate is `harness`, as on the Map of worfy,
// GitHub is `project` (the PRs of the Project's repository), and worfy's own code is `machine`.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

export const GATE_SCENE: SceneSpec = {
  width: 756,
  height: 494,
  regions: [
    { label: 'thisMachine', x: 16, y: 24 },
    { label: 'githubRegion', x: 580, y: 188 },
  ],
  frames: [{ block: 'canvas', kind: 'canvas', x: 260, y: 56, width: 240, height: 330 }],
  blocks: [
    // This Machine, outside the Canvas: the Gate and, under it, the worktree it checks.
    { id: 'gate', x: 16, y: 290, group: 'harness' },
    { id: 'worktree', x: 16, y: 420, group: 'project' },
    // On the Canvas: the Nodes that show the chips.
    { id: 'canvas', x: 276, y: 40, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'ticket', x: 300, y: 110, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'session', x: 300, y: 290, group: 'agents', topic: 'sessions', page: page('sessions') },
    // GitHub.
    { id: 'github', x: 580, y: 200, group: 'project' },
  ],
  edges: [
    // There and back between the Session and the Gate: two level lines, apart.
    { from: 'session', to: 'gate', label: 'runsIt', fromShift: 12, toShift: 12 },
    { from: 'gate', to: 'session', label: 'gateChip', fromShift: -12, toShift: -12 },
    // Up out of the Gate, apart from the pair above.
    { from: 'gate', to: 'ticket', label: 'gateChip', fromSide: 'top', toSide: 'left' },
    { from: 'gate', to: 'worktree', label: 'checksChanges' },
    { from: 'session', to: 'github', label: 'opensPr', fromSide: 'right', toSide: 'left', toShift: 12 },
    { from: 'github', to: 'ticket', label: 'prChips', fromSide: 'left', toSide: 'right', fromShift: -12 },
  ],
  steps: [
    { caption: 'step1', blocks: ['session', 'gate', 'worktree'] },
    { caption: 'step2', blocks: ['gate', 'ticket', 'session'], edges: ['gate->ticket', 'gate->session'] },
    { caption: 'step3', blocks: ['gate', 'session'], edges: [] },
    { caption: 'step4', blocks: ['session', 'github', 'ticket'] },
    { caption: 'step5', blocks: ['gate', 'github', 'ticket'], edges: ['gate->ticket', 'github->ticket'] },
  ],
}

export const GATE_FLOW: SceneSpec = {
  width: 976,
  height: 476,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'main', x: 408, y: 24 },
    { label: 'outside', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer.
    { id: 'badges', x: 16, y: 40, group: 'machine' },
    { id: 'useChecks', x: 16, y: 280, group: 'machine' },
    // The main process.
    { id: 'gateReader', x: 408, y: 160, group: 'machine' },
    { id: 'handler', x: 408, y: 280, group: 'machine' },
    { id: 'prTracker', x: 408, y: 400, group: 'machine' },
    // The Harness and GitHub.
    { id: 'gate', x: 800, y: 40, group: 'harness' },
    { id: 'state', x: 800, y: 160, group: 'harness' },
    { id: 'github', x: 800, y: 400, group: 'project' },
  ],
  edges: [
    { from: 'gate', to: 'state', label: 'writes' },
    { from: 'state', to: 'gateReader', label: 'markers' },
    { from: 'gateReader', to: 'handler', label: 'perWorktree' },
    { from: 'github', to: 'prTracker', label: 'prList' },
    { from: 'prTracker', to: 'handler', label: 'prs' },
    // There and back between the renderer's copy and the handler: two level lines, apart.
    { from: 'useChecks', to: 'handler', label: 'get', fromShift: -12, toShift: -12 },
    { from: 'handler', to: 'useChecks', label: 'snapshot', fromShift: 12, toShift: 12 },
    { from: 'useChecks', to: 'badges', label: 'draws' },
  ],
}
