// Handlers of the `actions` domain (src/shared/ipc/actions.ts): "Ship ticket" and "Run wave", and
// the Tickets "Ship ticket" has a live Session for. The work itself is src/main/actions/launch.ts;
// here it is wired to the app's Projects, Sessions, Orchestrators and Bindings, and its changes go
// to every client.
import { actionsLaunches, actionsLaunchesChanged, actionsRunWave, actionsShipTicket, type LaunchesSnapshot } from '../../shared/ipc/actions'
import { ActionLauncher } from '../actions/launch'
import { sharedNodeSessions } from '../agent/app-node-sessions'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { toEveryWindow } from '../broadcast'
import { bindingStore } from '../layout/bindings'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readWorkflow } from '../workflow/reader'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a launcher; tests pass their own. */
export function actionsHandlers(launcher: () => Pick<ActionLauncher, 'shipTicket' | 'runWave' | 'launched'>): HandlerModule {
  return [
    defineHandler(actionsShipTicket, ({ projectId, epic, num, near }) =>
      near ? launcher().shipTicket(projectId, epic, num, near) : launcher().shipTicket(projectId, epic, num),
    ),
    defineHandler(actionsRunWave, ({ projectId, epic }) => launcher().runWave(projectId, epic)),
    defineHandler(actionsLaunches, ({ projectId }) => launcher().launched(projectId)),
  ]
}

function broadcast(snapshot: LaunchesSnapshot): void {
  toEveryWindow((client) => emit(client, actionsLaunchesChanged, snapshot))
}

let shared: ActionLauncher | undefined

/** The app's launcher, made on first use; Autopilot (src/main/ipc/autopilot.ts) sends its Waves through it too. */
export function sharedLauncher(): ActionLauncher {
  shared ??= new ActionLauncher({
    projectRoot: (projectId) => projectStore().get(projectId).path,
    settings: (projectId) => readProjectSettings(projectStore().dataDir(projectStore().get(projectId).id)),
    branch: (root) => projectStore().branch(root),
    workflow: async (root) => (await readWorkflow({ root, claudeHome: claudeHome() })).model,
    sessions: { create: (projectId, near) => sharedNodeSessions().create(projectId, near) },
    orchestrators: { open: (projectId) => sharedOrchestrators().open(projectId) },
    registry: { get: (sessionId) => sharedRegistry().get(sessionId) },
    bindings: { setLaunch: (projectId, agent, target) => bindingStore().setLaunch(projectId, agent, target) },
    onLaunchesChange: broadcast,
  })
  return shared
}

export default actionsHandlers(sharedLauncher) satisfies HandlerModule
