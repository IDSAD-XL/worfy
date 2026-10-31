// The data-flow diagram of the Topic Canvas, in its Under the hood (worfy-guide ticket 07): the
// "Data flow of a drag" of docs/features/canvas.md and the one of epic-frames.md. A gesture goes from
// React Flow through useLayout to main's LayoutStore over `layout.apply`; an agent's Canvas MCP tools
// call the same LayoutStore; main saves layout.json and sends `layout.changed` back to every window.
// The Epic frames are not in the Layout: sources/epics.ts computes them from the workflow model, with
// ELK in a Web Worker. Labels come from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const SPEC: SceneSpec = {
  width: 960,
  height: 430,
  regions: [
    { label: 'renderer', x: 16, y: 28 },
    { label: 'main', x: 560, y: 28 },
  ],
  blocks: [
    { id: 'reactflow', x: 16, y: 40, group: 'project' },
    { id: 'uselayout', x: 280, y: 40, group: 'project' },
    { id: 'store', x: 560, y: 40, group: 'machine' },
    { id: 'file', x: 784, y: 150, group: 'machine' },
    { id: 'mcp', x: 560, y: 150, group: 'agents' },
    { id: 'epics', x: 16, y: 250, group: 'workflow' },
    { id: 'workflow', x: 560, y: 250, group: 'workflow' },
    { id: 'elk', x: 16, y: 360, group: 'tools' },
  ],
  edges: [
    { from: 'reactflow', to: 'uselayout', label: 'operation', fromShift: -10, toShift: -10 },
    { from: 'uselayout', to: 'reactflow', label: 'nodes', fromShift: 10, toShift: 10 },
    { from: 'uselayout', to: 'store', label: 'apply', fromShift: -10, toShift: -10 },
    { from: 'store', to: 'uselayout', label: 'changed', fromShift: 10, toShift: 10 },
    { from: 'mcp', to: 'store', label: 'sameOps' },
    { from: 'store', to: 'file', label: 'save', fromSide: 'right', toSide: 'top' },
    { from: 'workflow', to: 'epics', label: 'model' },
    { from: 'epics', to: 'elk', label: 'request', fromShift: -40, toShift: -40 },
    { from: 'elk', to: 'epics', label: 'places', fromShift: 40, toShift: 40 },
    { from: 'epics', to: 'reactflow', label: 'frames' },
  ],
  steps: [
    { caption: 'step1', blocks: ['reactflow', 'uselayout', 'store'], edges: ['reactflow->uselayout', 'uselayout->store'] },
    { caption: 'step2', blocks: ['store', 'mcp'], edges: ['mcp->store'] },
    { caption: 'step3', blocks: ['store', 'file', 'uselayout', 'reactflow'], edges: ['store->file', 'store->uselayout', 'uselayout->reactflow'] },
    { caption: 'step4', blocks: ['workflow', 'epics', 'elk', 'reactflow'], edges: ['workflow->epics', 'epics->elk', 'elk->epics', 'epics->reactflow'] },
  ],
}

export default function Flow(props: SceneProps) {
  return <LivingScene spec={SPEC} {...props} />
}
