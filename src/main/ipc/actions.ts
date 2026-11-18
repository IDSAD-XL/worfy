// Handlers of the `actions` domain (src/shared/ipc/actions.ts): "Ship ticket", "Run wave",
// "Process gate queue" (this Machine's role from the app's gate queue reader, ./gate-queue.ts), "Draft replies", "Fix
// checks", "Resolve conflicts" and "Address comments" (the app's PR inbox, Layouts, Bindings, Claude home, Orchestrators
// and Session Nodes), and the Tickets "Ship ticket" has a live Session for. The work itself is src/main/actions/launch.ts;
// here it is wired to the app's Projects, Sessions, Orchestrators and Bindings, and its changes go
// to every client.
import { actionsGateQueue, actionsLaunches, actionsLaunchesChanged, actionsPrFollow, actionsPrReply, actionsRunWave, actionsShipTicket, type LaunchesSnapshot } from '../../shared/ipc/actions'
import { ActionLauncher, type PrFollowDeps } from '../actions/launch'
import { sharedNodeSessions } from '../agent/app-node-sessions'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { toEveryWindow } from '../broadcast'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { appNow } from '../clock'
import { harnessScriptEnv } from '../harness/script-env'
import { bindingStore } from '../layout/bindings'
import { layoutStore } from '../layout/store'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readWorkflow } from '../workflow/reader'
import { sharedGateQueue } from './gate-queue'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a launcher; tests pass their own. */
export function actionsHandlers(launcher: () => Pick<ActionLauncher, 'shipTicket' | 'runWave' | 'gateQueue' | 'prReply' | 'prFollow' | 'launched'>): HandlerModule {
  return [
    defineHandler(actionsShipTicket, ({ projectId, epic, num, near }) =>
      near ? launcher().shipTicket(projectId, epic, num, near) : launcher().shipTicket(projectId, epic, num),
    ),
    defineHandler(actionsRunWave, ({ projectId, epic }) => launcher().runWave(projectId, epic)),
    defineHandler(actionsGateQueue, ({ projectId }) => launcher().gateQueue(projectId)),
    defineHandler(actionsPrReply, ({ projectId, repo, pr }) => launcher().prReply(projectId, repo, pr)),
    defineHandler(actionsPrFollow, ({ projectId, repo, pr, action, near }) => (near ? launcher().prFollow(projectId, repo, pr, action, near) : launcher().prFollow(projectId, repo, pr, action))),
    defineHandler(actionsLaunches, ({ projectId }) => launcher().launched(projectId)),
  ]
}

function broadcast(snapshot: LaunchesSnapshot): void {
  toEveryWindow((client) => emit(client, actionsLaunchesChanged, snapshot))
}

let shared: ActionLauncher | undefined
let claude: ClaudeHomeRegistry | undefined

/** What "Fix checks", "Resolve conflicts" and "Address comments" read and start, over the app's parts. */
const appPrFollow: PrFollowDeps = {
  pull: async (projectId, repo, pr) => {
    // Loaded at the call, as src/main/ipc/stories.ts takes it: the PR inbox stays out of this module's imports.
    const inbox = (await import('./pr-inbox')).sharedPrInbox()
    await inbox.ensureRead(projectId)
    await inbox.refresh(repo, pr)
    const snapshot = inbox.snapshot(projectId)
    const row = snapshot.groups.flatMap((group) => group.rows).find((each) => each.repo.toLowerCase() === repo.toLowerCase() && each.number === pr)
    return { row, viewer: snapshot.viewer }
  },
  nodes: (projectId) => layoutStore().get(projectId).layout.nodes,
  lastAt: async (projectId, sessionIds) => {
    const wanted = new Set(sessionIds)
    claude ??= new ClaudeHomeRegistry({ home: claudeHome() })
    // This Machine's own call (RegistryRoot), as the automatic archive reads the same times (src/main/index.ts).
    const { history } = await claude.sessions({ path: projectStore().get(projectId).path, local: true })
    return new Map(history.flatMap((session) => (wanted.has(session.sessionId) && session.lastAt !== undefined && !Number.isNaN(Date.parse(session.lastAt)) ? [[session.sessionId, Date.parse(session.lastAt)] as const] : [])))
  },
  stored: (projectId) => bindingStore().get(projectId).bindings,
  busyOrchestrator: async (projectId) => {
    const orchestrators = sharedOrchestrators()
    if (orchestrators.busy(projectId) === null) return null
    // Busy means open: open() answers its view and changes nothing.
    const view = await orchestrators.open(projectId)
    if (view.sessionId === null) return { sessionId: null }
    try {
      return { sessionId: sharedRegistry().get(view.sessionId).sdkId }
    } catch {
      return { sessionId: null }
    }
  },
  started: (projectId, nodeId) => sharedNodeSessions().started(projectId, nodeId),
}

/** The app's launcher, made on first use; Autopilot (src/main/ipc/autopilot.ts) sends its Waves through it too. */
export function sharedLauncher(): ActionLauncher {
  shared ??= new ActionLauncher({
    projectRoot: (projectId) => projectStore().get(projectId).path,
    settings: (projectId) => readProjectSettings(projectStore().dataDir(projectStore().get(projectId).id)),
    branch: (root) => projectStore().branch(root),
    workflow: async (root) => (await readWorkflow({ root, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
    sessions: { create: (projectId, near, vendor) => sharedNodeSessions().create(projectId, near, vendor) },
    orchestrators: { open: (projectId) => sharedOrchestrators().open(projectId) },
    registry: { get: (sessionId) => sharedRegistry().get(sessionId) },
    bindings: { setLaunch: (projectId, agent, target) => bindingStore().setLaunch(projectId, agent, target) },
    gateRole: (root) => sharedGateQueue().role(root),
    onLaunchesChange: broadcast,
    prFollow: appPrFollow,
    now: appNow,
  })
  return shared
}

export default actionsHandlers(sharedLauncher) satisfies HandlerModule
