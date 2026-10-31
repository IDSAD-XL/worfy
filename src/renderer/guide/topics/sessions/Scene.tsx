// The diagram of the Topic Sessions (worfy-guide ticket 08), from docs/features/sessions.md and
// docs/features/transcripts-and-usage.md, in the Living Canvas style of the epic's spec. On the
// Canvas frame lie the Nodes of Sessions: the Orchestrator, a Session with the Subagent it started to
// its right, and a read-only Session started outside worfy. Outside the Canvas: Claude Code, which
// worfy runs for its Sessions, the folder it keeps its transcripts in (Claude home), the Transcript on
// screen, the Limits in the toolbar, and a terminal or Claude desktop, which start Sessions too.
// The steps walk a message, the Transcript, Subagents, a Session from outside, and the Limits.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const SESSIONS_SPEC: SceneSpec = {
  width: 976,
  height: 500,
  frames: [{ block: 'canvas', kind: 'canvas', x: 16, y: 40, width: 420, height: 452 }],
  blocks: [
    // On the Canvas.
    { id: 'canvas', x: 32, y: 24, group: 'project', topic: 'canvas', page: 'docs/features/canvas.md', shape: 'tab', width: 92 },
    { id: 'orchestrator', x: 40, y: 80, group: 'harness' },
    { id: 'session', x: 40, y: 200, group: 'agents' },
    { id: 'subagent', x: 256, y: 296, group: 'agents' },
    { id: 'readOnly', x: 40, y: 414, group: 'agents' },
    // Outside the Canvas.
    { id: 'claudeCode', x: 520, y: 200, group: 'agents' },
    { id: 'claudeHome', x: 520, y: 414, group: 'machine' },
    { id: 'limits', x: 800, y: 80, group: 'machine' },
    { id: 'transcript', x: 800, y: 200, group: 'project' },
    { id: 'outside', x: 800, y: 414, group: 'tools' },
  ],
  edges: [
    { from: 'orchestrator', to: 'claudeCode', label: 'messages', toShift: -12 },
    { from: 'session', to: 'claudeCode', label: 'messages', toShift: 10 },
    // Down out of the Session's Node, so the Edge does not leave it where its message does.
    { from: 'session', to: 'subagent', label: 'starts', fromSide: 'bottom', toSide: 'left', fromShift: 30 },
    { from: 'claudeCode', to: 'transcript', label: 'liveEvents' },
    // Up and over to the Limits, apart from the Edge to the Transcript.
    { from: 'claudeCode', to: 'limits', label: 'reports', fromSide: 'top', toSide: 'left' },
    { from: 'claudeCode', to: 'claudeHome', label: 'writes', fromShift: -30, toShift: -30 },
    { from: 'claudeHome', to: 'transcript', label: 'readsFile', fromShift: 30 },
    { from: 'outside', to: 'claudeHome', label: 'writesToo' },
    { from: 'claudeHome', to: 'readOnly', label: 'readOnlyNode' },
    { from: 'readOnly', to: 'session', label: 'resume', fromShift: -30, toShift: -30 },
  ],
  steps: [
    { caption: 'step1', blocks: ['orchestrator', 'session', 'claudeCode'] },
    { caption: 'step2', blocks: ['claudeCode', 'claudeHome', 'transcript'] },
    { caption: 'step3', blocks: ['session', 'subagent'] },
    { caption: 'step4', blocks: ['outside', 'claudeHome', 'readOnly', 'session'] },
    { caption: 'step5', blocks: ['claudeCode', 'limits'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={SESSIONS_SPEC} {...props} />
}
