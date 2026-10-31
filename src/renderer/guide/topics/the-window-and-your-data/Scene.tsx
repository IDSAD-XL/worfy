// The diagram of the Topic The window and your data (worfy-guide ticket 19), from
// docs/features/app-shell.md, docs/features/notifications.md and docs/features/storage-and-diagnostics.md,
// in the Living Canvas style of the epic's spec. Three areas, left to right: what worfy reads where it
// lies (the workflow files and Claude home); the window — the Command palette, the menu, Settings, a
// toast and the Canvas with a Ticket and a Session; and what is on this Machine outside the window —
// the data folder, the diagnostics that write into it and the system notification. The steps walk
// the palette and Settings, the data folder, what is only read, the notifications and the diagnostics.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

const WINDOW_SPEC: SceneSpec = {
  width: 976,
  height: 472,
  regions: [
    { label: 'read', x: 16, y: 274 },
    { label: 'window', x: 232, y: 18 },
    { label: 'machine', x: 800, y: 18 },
  ],
  frames: [{ block: 'canvas', kind: 'canvas', x: 216, y: 240, width: 416, height: 216 }],
  blocks: [
    // Read where they lie.
    { id: 'workflowFiles', x: 16, y: 290, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'claudeHome', x: 16, y: 384, group: 'machine' },
    // The window.
    { id: 'palette', x: 232, y: 34, group: 'machine' },
    { id: 'menu', x: 232, y: 134, group: 'machine' },
    { id: 'settings', x: 456, y: 34, group: 'machine' },
    { id: 'toast', x: 456, y: 134, group: 'machine' },
    // The tab at the right of the frame's top edge, so its Edges leave toward the data folder and the toast.
    { id: 'canvas', x: 520, y: 224, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'ticket', x: 248, y: 290, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'session', x: 248, y: 384, group: 'agents', topic: 'sessions', page: page('sessions') },
    // On this Machine, outside the window.
    { id: 'diagnostics', x: 800, y: 34, group: 'machine' },
    { id: 'dataFolder', x: 800, y: 180, group: 'machine' },
    { id: 'notification', x: 800, y: 337, group: 'machine' },
  ],
  edges: [
    { from: 'palette', to: 'settings', label: 'opens' },
    { from: 'menu', to: 'settings', label: 'opensToo', toShift: 14 },
    { from: 'settings', to: 'dataFolder', label: 'savesSettings', toShift: -12 },
    { from: 'canvas', to: 'dataFolder', label: 'savesLayout', toShift: 12 },
    // Straight up from the tab into the toast above it.
    { from: 'canvas', to: 'toast', label: 'archived', fromSide: 'top', toSide: 'bottom' },
    { from: 'diagnostics', to: 'dataFolder', label: 'logs' },
    { from: 'workflowFiles', to: 'ticket', label: 'readsFiles' },
    { from: 'claudeHome', to: 'session', label: 'readsTranscripts' },
    { from: 'ticket', to: 'notification', label: 'waits', toShift: -10 },
    { from: 'session', to: 'notification', label: 'needsYou', toShift: 10 },
  ],
  steps: [
    { caption: 'step1', blocks: ['palette', 'menu', 'settings'] },
    { caption: 'step2', blocks: ['settings', 'canvas', 'dataFolder'] },
    { caption: 'step3', blocks: ['workflowFiles', 'claudeHome', 'ticket', 'session'] },
    { caption: 'step4', blocks: ['session', 'ticket', 'notification', 'canvas', 'toast'] },
    { caption: 'step5', blocks: ['diagnostics', 'dataFolder'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={WINDOW_SPEC} {...props} />
}
