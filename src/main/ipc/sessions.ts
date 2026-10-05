// Handlers of the `sessions` domain (src/shared/ipc/sessions.ts): Sessions worfy runs on Session
// Nodes. The Sessions themselves live in src/main/agent/node-sessions.ts; they run in the app's
// registry (app-registry.ts), so `agent.send`, `agent.interrupt` and `agent.close` reach them too.
import { stat } from 'node:fs/promises'
import { agentEvent } from '../../shared/ipc/agent'
import { sessionsChanged, sessionsClose, sessionsNew, sessionsResumable, sessionsResume, sessionsStart, sessionsViews } from '../../shared/ipc/sessions'
import { toEveryWindow } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { NodeSessions } from '../agent/node-sessions'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { layoutStore } from '../layout/store'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a set of Node Sessions; tests pass their own. */
export function sessionsHandlers(sessions: () => Pick<NodeSessions, 'create' | 'start' | 'resume' | 'resumable' | 'list' | 'close'>): HandlerModule {
  return [
    defineHandler(sessionsNew, ({ projectId }) => sessions().create(projectId)),
    defineHandler(sessionsStart, ({ projectId, nodeId }) => sessions().start(projectId, nodeId)),
    defineHandler(sessionsResume, ({ projectId, sessionId }) => sessions().resume(projectId, sessionId)),
    defineHandler(sessionsResumable, async ({ projectId, sessionIds }) => ({ verdicts: await sessions().resumable(projectId, sessionIds) })),
    defineHandler(sessionsViews, ({ projectId }) => ({ views: sessions().list(projectId) })),
    defineHandler(sessionsClose, ({ nodeId }) => {
      sessions().close(nodeId)
    }),
  ]
}

let shared: NodeSessions | null = null

/** The app's Node Sessions, made on first use. */
export function sharedNodeSessions(): NodeSessions {
  if (shared === null) {
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    shared = new NodeSessions({
      layout: layoutStore(),
      projectPath: (projectId) => projectStore().get(projectId).path,
      registry: sharedRegistry(),
      claude: (projectRoot) => claude.sessions(projectRoot),
      isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
      broadcast: (sessionId, event) => toEveryWindow((target) => emit(target, agentEvent, { sessionId, event })),
      publish: (view) => toEveryWindow((target) => emit(target, sessionsChanged, view)),
    })
  }
  return shared
}

export default sessionsHandlers(sharedNodeSessions) satisfies HandlerModule
