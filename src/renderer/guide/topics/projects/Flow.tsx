// The data-flow diagram of Under the hood of the Topic Projects (worfy-guide ticket 16), from the three
// "Data flow" paragraphs of docs/features/projects.md. Three columns: the renderer, the main process,
// and the Harness with the Workflow folder. "Add project": the dialog drives ProjectConnector over
// projects.connect.*, which runs project-connect and then adds the folder to ProjectStore. A switch:
// projects.select into ProjectStore, projects.changed back, and the Orchestrators follow its onChange.
// The documents: the layout cache asks bin/profile where the files are, DocsHub watches that root, and
// the views get docs.changed and read the text with docs.read. Labelled from `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const PROJECTS_FLOW_SPEC: SceneSpec = {
  width: 976,
  height: 556,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'main', x: 408, y: 24 },
    { label: 'harness', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer.
    { id: 'dialog', x: 16, y: 40, group: 'machine' },
    { id: 'useProjects', x: 16, y: 150, group: 'machine' },
    { id: 'views', x: 16, y: 480, group: 'machine' },
    // The main process.
    { id: 'connector', x: 408, y: 40, group: 'machine' },
    { id: 'store', x: 408, y: 150, group: 'machine' },
    { id: 'orchestrators', x: 408, y: 260, group: 'harness' },
    { id: 'layout', x: 408, y: 370, group: 'machine' },
    { id: 'docsHub', x: 408, y: 480, group: 'machine' },
    // The Harness and the Workflow folder.
    { id: 'connect', x: 800, y: 40, group: 'harness' },
    { id: 'profile', x: 800, y: 370, group: 'harness' },
    { id: 'folder', x: 800, y: 480, group: 'workflow' },
  ],
  edges: [
    // "Add project".
    { from: 'dialog', to: 'connector', label: 'connectCalls' },
    { from: 'connector', to: 'connect', label: 'runs' },
    { from: 'connector', to: 'store', label: 'add' },
    // A switch.
    { from: 'useProjects', to: 'store', label: 'select', fromShift: -12, toShift: -12 },
    { from: 'store', to: 'useProjects', label: 'changed', fromShift: 12, toShift: 12 },
    { from: 'store', to: 'orchestrators', label: 'onChange' },
    // The documents.
    { from: 'layout', to: 'profile', label: 'asks' },
    { from: 'layout', to: 'docsHub', label: 'root' },
    { from: 'folder', to: 'docsHub', label: 'watch' },
    { from: 'docsHub', to: 'views', label: 'docsChanged', fromShift: -12, toShift: -12 },
    { from: 'views', to: 'docsHub', label: 'docsRead', fromShift: 12, toShift: 12 },
  ],
}

export default function Flow(props: SceneProps) {
  return <LivingScene spec={PROJECTS_FLOW_SPEC} {...props} />
}
