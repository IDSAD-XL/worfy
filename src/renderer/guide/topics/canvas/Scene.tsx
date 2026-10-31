// The diagram of the Topic Canvas (worfy-guide ticket 07), from docs/features/canvas.md,
// epic-frames.md and focus-mode.md, in the Living Canvas style of the epic's spec. The Canvas frame
// holds the Nodes: the Epic frame with two Tickets, one blocking the other, and its "Ready wave · N"
// chip; under it the chip of a finished Epic on the Done shelf; a Session, a Card, a Terminal, a
// Browser, a Note and an image. Outside the frame, under "A LAYER OVER IT", focus mode takes the
// selected Nodes as tiles.
// Nesting is drawn by position, never by a line.
//
// The blocks of other Features lead to their Topics, or to their pages while those are not written,
// as the Map's blocks do.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

const SPEC: SceneSpec = {
  width: 940,
  height: 470,
  regions: [
    { label: 'overCanvas', x: 764, y: 160 },
  ],
  frames: [
    { block: 'canvas', kind: 'canvas', x: 16, y: 34, width: 700, height: 420 },
    { block: 'epic', kind: 'epic', x: 32, y: 90, width: 440, height: 140 },
  ],
  blocks: [
    { id: 'canvas', x: 32, y: 18, group: 'project', shape: 'tab', width: 100 },
    { id: 'epic', x: 44, y: 74, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'tab', width: 116 },
    { id: 'wave', x: 300, y: 77, group: 'workflow', topic: 'workflow', page: page('workflow'), shape: 'chip', width: 132 },
    { id: 'ticket1', x: 48, y: 150, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'ticket2', x: 296, y: 150, group: 'workflow', topic: 'workflow', page: page('workflow') },
    { id: 'shelf', x: 44, y: 266, group: 'workflow', shape: 'chip', width: 206 },
    { id: 'session', x: 532, y: 74, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'card', x: 532, y: 170, group: 'tools', topic: 'cards', page: page('cards') },
    { id: 'terminal', x: 532, y: 266, group: 'tools', topic: 'terminal', page: page('terminal') },
    { id: 'note', x: 48, y: 360, group: 'tools' },
    { id: 'image', x: 240, y: 360, group: 'tools' },
    { id: 'browser', x: 432, y: 360, group: 'tools', topic: 'browser', page: page('browser') },
    { id: 'focus', x: 764, y: 170, group: 'project' },
  ],
  edges: [
    { from: 'ticket1', to: 'ticket2', label: 'blocks' },
    { from: 'ticket1', to: 'wave', label: 'readyNow', fromSide: 'top', toSide: 'bottom' },
    { from: 'ticket2', to: 'shelf', label: 'allDone', fromSide: 'bottom', toSide: 'right' },
    { from: 'session', to: 'focus', label: 'focusKey', toShift: -16 },
    { from: 'card', to: 'focus', label: 'focusKey' },
    { from: 'terminal', to: 'focus', label: 'focusKey', toShift: 16 },
  ],
  steps: [
    { caption: 'step1', blocks: ['canvas', 'session', 'card', 'terminal', 'browser', 'note', 'image'] },
    { caption: 'step2', blocks: ['epic', 'ticket1', 'ticket2', 'wave', 'shelf'] },
    { caption: 'step3', blocks: ['session', 'card', 'terminal', 'focus'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={SPEC} {...props} />
}
