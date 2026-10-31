// The diagram of the Topic Projects (worfy-guide ticket 16), from docs/features/projects.md, in the
// Living Canvas style of the epic's spec. On the left, worfy's window: the Projects list and the
// "Add project" dialog. Under them, the Harness, which writes the Profile on Connect and, in Silent
// mode, keeps the repository free of the workflow. The Profile names the Workflow folder, which in Full
// mode is the root of the repository. On the Canvas frame lie the Orchestrator, which a switch opens,
// and the HANDOFF Node; the ADR section of the sidebar stands outside it. HANDOFF and the ADRs are read
// from the Workflow folder. The steps walk adding a Project, the mode, a switch and the documents.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import type { SceneSpec } from '../../scene/model'

const PROJECTS_SPEC: SceneSpec = {
  width: 976,
  height: 500,
  frames: [{ block: 'canvas', kind: 'canvas', x: 248, y: 40, width: 552, height: 176 }],
  blocks: [
    // worfy's window, outside the Canvas.
    { id: 'projects', x: 16, y: 40, group: 'machine' },
    { id: 'addProject', x: 16, y: 160, group: 'machine' },
    // On the Canvas.
    { id: 'canvas', x: 264, y: 24, group: 'project', topic: 'canvas', page: 'docs/features/canvas.md', shape: 'tab', width: 92 },
    { id: 'orchestrator', x: 296, y: 104, group: 'harness' },
    { id: 'handoff', x: 600, y: 104, group: 'workflow' },
    // The Harness, the Profile and the files.
    { id: 'harness', x: 16, y: 290, group: 'harness', topic: 'harness', page: 'docs/features/harness.md' },
    { id: 'profile', x: 296, y: 290, group: 'harness', topic: 'harness', page: 'docs/features/harness.md' },
    { id: 'repository', x: 16, y: 426, group: 'project' },
    { id: 'workflowFolder', x: 560, y: 426, group: 'workflow' },
    { id: 'adrs', x: 800, y: 426, group: 'machine' },
  ],
  edges: [
    { from: 'addProject', to: 'projects', label: 'joinsList' },
    { from: 'addProject', to: 'harness', label: 'connect' },
    { from: 'harness', to: 'profile', label: 'writes' },
    { from: 'harness', to: 'repository', label: 'noTrace' },
    // Into the Workflow folder's left side above the Edge that leaves it for the repository.
    { from: 'profile', to: 'workflowFolder', label: 'namesFolder', toSide: 'left', toShift: -14 },
    { from: 'workflowFolder', to: 'repository', label: 'fullRoot', fromSide: 'left', fromShift: 14 },
    { from: 'projects', to: 'canvas', label: 'switches', fromShift: -14 },
    { from: 'projects', to: 'orchestrator', label: 'opens', fromShift: 14 },
    { from: 'workflowFolder', to: 'handoff', label: 'handoffFile' },
    { from: 'workflowFolder', to: 'adrs', label: 'adrFiles' },
  ],
  steps: [
    { caption: 'step1', blocks: ['addProject', 'harness', 'profile', 'projects'] },
    { caption: 'step2', blocks: ['profile', 'workflowFolder', 'repository', 'harness'], edges: ['profile->workflowFolder', 'workflowFolder->repository', 'harness->repository'] },
    { caption: 'step3', blocks: ['projects', 'canvas', 'orchestrator'] },
    { caption: 'step4', blocks: ['workflowFolder', 'handoff', 'adrs'] },
  ],
}

export default function Scene(props: SceneProps) {
  return <LivingScene spec={PROJECTS_SPEC} {...props} />
}
