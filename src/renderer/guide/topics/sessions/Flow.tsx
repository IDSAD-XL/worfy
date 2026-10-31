// The data-flow diagram of Under the hood of the Topic Sessions (worfy-guide ticket 08), from the
// "Data flow" paragraphs of docs/features/sessions.md and docs/features/transcripts-and-usage.md.
// Three columns: the renderer, the main process, and Claude Code with its folder. A message goes
// out on agent.send into the Session's query; its events come back on agent.event. The transcript
// file comes back through claudeHome.transcript, the Subagents through claudeHome.subagents, and
// the Limits through limits.changed. Labelled from the Topic's `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const SESSIONS_FLOW_SPEC: SceneSpec = {
  width: 976,
  height: 476,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'main', x: 408, y: 24 },
    { label: 'claude', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer.
    { id: 'bars', x: 16, y: 40, group: 'machine' },
    { id: 'store', x: 16, y: 160, group: 'project' },
    { id: 'view', x: 16, y: 280, group: 'project' },
    { id: 'tree', x: 16, y: 400, group: 'project' },
    // The main process.
    { id: 'tracker', x: 408, y: 40, group: 'machine' },
    { id: 'session', x: 408, y: 160, group: 'agents' },
    { id: 'reader', x: 408, y: 280, group: 'agents' },
    { id: 'subagents', x: 408, y: 400, group: 'agents' },
    // Claude Code.
    { id: 'process', x: 800, y: 160, group: 'agents' },
    { id: 'home', x: 800, y: 340, group: 'machine' },
  ],
  edges: [
    // Out: the message, from the input field to the process.
    { from: 'view', to: 'session', label: 'send', fromShift: -12, toShift: 14 },
    { from: 'session', to: 'process', label: 'input', fromShift: -12, toShift: -12 },
    // Back: the live events, the file, the Subagents and the Limits.
    { from: 'process', to: 'session', label: 'messages', fromShift: 12, toShift: 12 },
    { from: 'session', to: 'store', label: 'event', fromShift: -12, toShift: -12 },
    { from: 'session', to: 'tracker', label: 'rateLimit' },
    { from: 'tracker', to: 'bars', label: 'changed' },
    { from: 'store', to: 'view', label: 'live' },
    { from: 'process', to: 'home', label: 'writes' },
    { from: 'home', to: 'reader', label: 'lines', fromShift: -10 },
    { from: 'reader', to: 'view', label: 'transcript', toShift: 10 },
    { from: 'home', to: 'subagents', label: 'appended', fromShift: 10 },
    { from: 'subagents', to: 'tree', label: 'subagentsCall' },
  ],
}

export default function Flow(props: SceneProps) {
  return <LivingScene spec={SESSIONS_FLOW_SPEC} {...props} />
}
