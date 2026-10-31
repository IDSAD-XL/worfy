// The data-flow diagram of Under the hood of the Topic Link (worfy-guide ticket 17), from the "Data
// flow of a call" paragraph of docs/features/link.md. Under "THIS MACHINE": a window, which routes
// each call by the channel's access mark; this Machine's own handlers; the `linked` handlers and
// RemoteCalls of its main. Under "LINKED MACHINE": the link service, the IPC adapter and the same
// handler a window there would call. A call goes out as `linked.invoke` and a call frame; its
// answer and the events come back as frames and `linked.event`. Labelled from the Topic's
// `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const LINK_FLOW_SPEC: SceneSpec = {
  width: 976,
  height: 440,
  regions: [
    { label: 'here', x: 16, y: 24 },
    { label: 'there', x: 800, y: 24 },
  ],
  blocks: [
    // This Machine: the window, then its main.
    { id: 'window', x: 16, y: 120, group: 'machine' },
    { id: 'own', x: 16, y: 340, group: 'machine' },
    { id: 'linked', x: 408, y: 40, group: 'machine' },
    { id: 'remote', x: 408, y: 200, group: 'machine' },
    // The Linked machine.
    { id: 'service', x: 800, y: 40, group: 'machine' },
    { id: 'adapter', x: 800, y: 200, group: 'machine' },
    { id: 'handler', x: 800, y: 360, group: 'machine' },
  ],
  edges: [
    { from: 'window', to: 'own', label: 'stays' },
    // Out: the call, from the window to the handler over there.
    { from: 'window', to: 'linked', label: 'invoke', fromShift: -16, toShift: -16 },
    { from: 'linked', to: 'remote', label: 'call', fromShift: -55, toShift: -55 },
    { from: 'remote', to: 'service', label: 'frame', fromShift: -20, toShift: -20 },
    { from: 'service', to: 'adapter', label: 'passes' },
    { from: 'adapter', to: 'handler', label: 'allowed' },
    // Back: the answer and the events.
    { from: 'service', to: 'remote', label: 'answer', fromShift: 20, toShift: 20 },
    { from: 'remote', to: 'linked', label: 'parsed', fromShift: 55, toShift: 55 },
    { from: 'linked', to: 'window', label: 'event', fromShift: 16, toShift: 16 },
  ],
}

export default function Flow(props: SceneProps) {
  return <LivingScene spec={LINK_FLOW_SPEC} {...props} />
}
