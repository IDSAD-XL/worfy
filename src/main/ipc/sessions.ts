// Handlers of the `sessions` domain (src/shared/ipc/sessions.ts): Sessions worfy runs on Session
// Nodes. The Sessions themselves live in src/main/agent/node-sessions.ts, the app's instance in
// src/main/agent/app-node-sessions.ts.
import { sessionsClose, sessionsNew, sessionsResumable, sessionsResume, sessionsStart, sessionsViews } from '../../shared/ipc/sessions'
import { sharedNodeSessions } from '../agent/app-node-sessions'
import type { NodeSessions } from '../agent/node-sessions'
import { defineHandler, type HandlerModule } from './index'

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

export default sessionsHandlers(sharedNodeSessions) satisfies HandlerModule
