// The two diagrams of the Topic Terminal (worfy-guide ticket 13), from docs/features/terminal.md, apart
// from their components so the tests can read them: TERMINAL_SCENE, the Terminal as a person sees it
// (Scene.tsx), and TERMINAL_FLOW, the data flow of Under the hood (Flow.tsx). A thing drawn in both has
// the same group in both: the Terminal, its shell and Terminal AI are `tools`, as scene-colours.ts says,
// Claude Code is `agents`; what main only keeps or computes for a shell (the kept output, the headless
// screen) is the neutral `machine`.
import type { SceneSpec } from '../../scene/model'

export const TERMINAL_SCENE: SceneSpec = {
  width: 900,
  height: 410,
  frames: [{ block: 'canvas', kind: 'canvas', x: 16, y: 40, width: 300, height: 260 }],
  blocks: [
    // On the Canvas: the Terminal Node.
    { id: 'canvas', x: 32, y: 24, group: 'project', topic: 'canvas', page: 'docs/features/canvas.md', shape: 'tab', width: 92 },
    { id: 'terminal', x: 76, y: 150, group: 'tools' },
    // Outside the Canvas: the shell, its folder, another screen of the same shell, Terminal AI with
    // the Claude Code process it asks, and the Limits.
    { id: 'other', x: 720, y: 40, group: 'machine' },
    { id: 'folder', x: 420, y: 40, group: 'project' },
    { id: 'shell', x: 420, y: 170, group: 'tools' },
    { id: 'terminalAi', x: 420, y: 330, group: 'tools' },
    { id: 'limits', x: 720, y: 170, group: 'machine', topic: 'sessions', page: 'docs/features/transcripts-and-usage.md' },
    { id: 'claude', x: 720, y: 330, group: 'agents' },
  ],
  edges: [
    // There and back between the Node and its shell: two level lines, apart.
    { from: 'terminal', to: 'shell', label: 'keys', fromShift: -12, toShift: -12 },
    { from: 'shell', to: 'terminal', label: 'output', fromShift: 12, toShift: 12 },
    { from: 'shell', to: 'folder', label: 'startsIn' },
    { from: 'other', to: 'shell', label: 'sameShell' },
    // Down to Terminal AI and back up, side by side.
    { from: 'shell', to: 'terminalAi', label: 'typedLine', fromShift: -40, toShift: -40 },
    { from: 'terminalAi', to: 'shell', label: 'greyText', fromShift: 40, toShift: 40 },
    // Out of the bottom of the Node, under the Canvas frame, into Terminal AI's left side.
    { from: 'terminal', to: 'terminalAi', label: 'fix', fromSide: 'bottom', toSide: 'left' },
    { from: 'terminalAi', to: 'claude', label: 'asks', fromShift: 12, toShift: 12 },
    { from: 'claude', to: 'limits', label: 'reports' },
    { from: 'limits', to: 'terminalAi', label: 'pauses', toShift: -16 },
  ],
  steps: [
    { caption: 'step1', blocks: ['canvas', 'terminal', 'shell', 'folder'], edges: ['terminal->shell', 'shell->folder'] },
    { caption: 'step2', blocks: ['terminal', 'shell'] },
    { caption: 'step3', blocks: ['terminal', 'other', 'shell'] },
    { caption: 'step4', blocks: ['shell', 'terminalAi', 'claude'] },
    { caption: 'step5', blocks: ['terminal', 'terminalAi', 'claude', 'limits'], edges: ['terminal->terminalAi', 'terminalAi->claude', 'limits->terminalAi'] },
  ],
}

export const TERMINAL_FLOW: SceneSpec = {
  width: 976,
  height: 496,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'main', x: 320, y: 24 },
    { label: 'processes', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer.
    { id: 'node', x: 16, y: 160, group: 'tools' },
    // The main process.
    { id: 'screen', x: 560, y: 40, group: 'machine' },
    { id: 'registry', x: 320, y: 160, group: 'tools' },
    { id: 'replay', x: 320, y: 300, group: 'machine' },
    { id: 'shellLink', x: 560, y: 300, group: 'tools' },
    { id: 'assist', x: 560, y: 420, group: 'tools' },
    // The processes main starts.
    { id: 'shell', x: 800, y: 160, group: 'tools' },
    { id: 'claude', x: 800, y: 420, group: 'agents' },
  ],
  edges: [
    // The Node and the registry, the registry and the shell: there and back, apart.
    { from: 'node', to: 'registry', label: 'open', fromShift: -12, toShift: -12 },
    { from: 'registry', to: 'node', label: 'output', fromShift: 12, toShift: 12 },
    { from: 'registry', to: 'shell', label: 'keys', fromShift: -12, toShift: -12 },
    { from: 'shell', to: 'registry', label: 'chunks', fromShift: 12, toShift: 12 },
    // Each chunk also goes down to the kept output and up to the headless screen.
    { from: 'registry', to: 'replay', label: 'appends', fromSide: 'bottom', toSide: 'top' },
    { from: 'registry', to: 'screen', label: 'posts', fromSide: 'top', toSide: 'left' },
    { from: 'screen', to: 'shell', label: 'answers', fromSide: 'right', toSide: 'top' },
    // Terminal AI: the shell asks over its socket and gets text back.
    { from: 'shell', to: 'shellLink', label: 'ask', fromSide: 'bottom', toSide: 'right', fromShift: -30, toShift: -12 },
    { from: 'shellLink', to: 'shell', label: 'show', fromSide: 'right', toSide: 'bottom', fromShift: 12, toShift: 30 },
    { from: 'shellLink', to: 'assist', label: 'request' },
    { from: 'assist', to: 'claude', label: 'turn' },
    // Fix starts in the Node's header, over IPC, below everything else.
    { from: 'node', to: 'assist', label: 'fix', fromSide: 'bottom', toSide: 'left' },
  ],
}
