// Handlers of the `workTrack` domain (src/shared/ipc/work-track.ts): the Work track of a Project over a
// period from the app's one Work track service (src/main/work-track/service.ts). Read-only (ADR-0002,
// ADR-0005): the Journals, the Harness state, the transcripts, git and gh are only read.
//
// `project` and `read`: a window on a Linked machine reads the Work track of the Machine the Project is on.
import { workTrackRead } from '../../shared/ipc/work-track'
import type { WorkTrackService } from '../work-track/service'
import type { CanvasSession } from '../work-track/transcripts'
import { defineHandler, type HandlerModule } from './index'

/** The handlers over a service; the app's (sharedWorkTrack) when the module is loaded. */
export function workTrackHandlers(service: () => Promise<Pick<WorkTrackService, 'read'>>): HandlerModule {
  return [defineHandler(workTrackRead, async ({ projectId, period, wait }) => (await service()).read(projectId, period, wait === undefined ? {} : { wait }))]
}

let shared: Promise<WorkTrackService> | undefined

/** The Profile's name (`_resolved.name`): the folder of the Project's Wave markers; null when the Profile cannot be read. */
async function harnessProject(root: string): Promise<string | null> {
  const [{ readPipelineProfile }, { harnessScriptEnv }, { claudeHome }] = await Promise.all([import('../workflow/profile'), import('../harness/script-env'), import('../storage/paths')])
  const read = await readPipelineProfile({ root, claudeHome: claudeHome(), env: await harnessScriptEnv() })
  return read.ok ? read.profile.name : null
}

/**
 * The app's service, made on first use: the Projects of the store, the Session Nodes of their Canvas, gh
 * through the app's one PR tracker (GH_TOKEN of the Profile's account, WORFY_GH for a stand-in), Autopilot's
 * state for whether a Run goes on, and the Codex history while Codex has a home on this Machine. Imported
 * lazily, so loading this module starts none of them.
 */
export function sharedWorkTrack(): Promise<WorkTrackService> {
  shared ??= (async () => {
    const [{ existsSync }, { WorkTrackService }, { sharedAutopilot }, { sharedPrTracker }, { projectStore }, { layoutStore }, { harnessHomes }, { claudeHome }, { codexHistory }, { codexHomeOf }, { SESSION_NODE_KIND }, { ORCHESTRATOR_KIND }, { isArchived }] = await Promise.all([
      import('node:fs'),
      import('../work-track/service'),
      import('./autopilot'),
      import('./checks'),
      import('../projects/store'),
      import('../layout/store'),
      import('../harness/locate'),
      import('../storage/paths'),
      import('../vendors/codex/history'),
      import('../vendors/codex/account'),
      import('../../shared/ipc/sessions'),
      import('../../shared/ipc/orchestrator'),
      import('../../shared/layout/types'),
    ])
    return new WorkTrackService({
      harnessHome: harnessHomes(claudeHome()).harnessHome,
      projectRoot: (projectId) => projectStore().get(projectId).path,
      harnessProject,
      // The Session Nodes of the Canvas, the hidden and the archived ones too: the title names the Session.
      canvas: async (projectId) =>
        layoutStore()
          .get(projectId)
          .layout.nodes.flatMap((node): CanvasSession[] => {
            const id = node.data.sessionId
            if ((node.kind !== SESSION_NODE_KIND && node.kind !== ORCHESTRATOR_KIND) || typeof id !== 'string' || id === '') return []
            const title = typeof node.data.title === 'string' && node.data.title.trim() !== '' ? node.data.title : node.kind === ORCHESTRATOR_KIND ? 'Orchestrator' : `Session ${id.slice(0, 4)}`
            return [{ id, title, hidden: node.hidden || isArchived(node) }]
          }),
      gh: (root, args) => sharedPrTracker().gh(root, args),
      running: (projectId, epic) => {
        const state = sharedAutopilot().state(projectId)
        return state.status !== 'stopped' && state.epic === epic
      },
      codex: () => (existsSync(codexHomeOf()) ? codexHistory : null),
    })
  })()
  // A failed start is not kept: the next call tries again.
  shared.catch(() => {
    shared = undefined
  })
  return shared
}

export default workTrackHandlers(sharedWorkTrack) satisfies HandlerModule
