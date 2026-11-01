// The data-flow diagram of Under the hood of the Topic The window and your data (worfy-guide ticket
// 19), from the "How it works" paragraphs of docs/features/app-shell.md (Settings),
// docs/features/notifications.md and docs/features/storage-and-diagnostics.md (the memory figure).
// Three columns: the renderer, the main process, and the disk and the system. A setting goes out on
// appSettings.set, is written to the data folder and comes back to every window on
// appSettings.changed. A Session's event becomes a system notification, whose click comes back as
// notify.open. The memory figure opens the sampler and gets memory.changed. Labelled from the
// Topic's `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const WINDOW_FLOW_SPEC: SceneSpec = {
  width: 976,
  height: 476,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'main', x: 408, y: 24 },
    { label: 'system', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer.
    { id: 'settingsWindow', x: 16, y: 40, group: 'machine' },
    { id: 'copy', x: 16, y: 160, group: 'machine' },
    { id: 'target', x: 16, y: 280, group: 'machine' },
    { id: 'figure', x: 16, y: 400, group: 'machine' },
    // The main process.
    { id: 'store', x: 408, y: 40, group: 'machine' },
    { id: 'sessions', x: 408, y: 160, group: 'agents' },
    { id: 'notifier', x: 408, y: 280, group: 'machine' },
    { id: 'sampler', x: 408, y: 400, group: 'machine' },
    // The disk and the system.
    { id: 'dataFolder', x: 800, y: 40, group: 'machine' },
    { id: 'os', x: 800, y: 280, group: 'machine' },
  ],
  edges: [
    // A setting: out, onto the disk, and back to every window.
    { from: 'settingsWindow', to: 'store', label: 'set', fromShift: -12, toShift: -12 },
    { from: 'store', to: 'dataFolder', label: 'write' },
    { from: 'store', to: 'copy', label: 'changed', fromShift: 12 },
    { from: 'copy', to: 'settingsWindow', label: 'state' },
    // A notification and its click.
    { from: 'sessions', to: 'notifier', label: 'events' },
    { from: 'notifier', to: 'os', label: 'show', fromShift: -10, toShift: -10 },
    { from: 'os', to: 'notifier', label: 'click', fromShift: 10, toShift: 10 },
    { from: 'notifier', to: 'target', label: 'open' },
    // The memory figure.
    { from: 'figure', to: 'sampler', label: 'memOpen', fromShift: -10, toShift: -10 },
    { from: 'sampler', to: 'figure', label: 'memChanged', fromShift: 10, toShift: 10 },
  ],
}

export default function Flow(props: SceneProps) {
  return <LivingScene spec={WINDOW_FLOW_SPEC} {...props} />
}
