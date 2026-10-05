import type { NotifyOpen } from '../../shared/ipc/notify'
import { orchestratorViewOf } from '../canvas/nodes/orchestrator-view'
import { sessionNodeId } from '../claude-home/session-nodes'
import type { OpenedSession } from './navigation'
import { sessionNodeViewOf } from './node-sessions'

// Where the Session of a clicked macOS notification is shown (ticket 21, src/main/notify.ts): a
// Session worfy runs on a Session Node or as the Orchestrator, or a Session from the registry under
// ~/.claude on its read-only Node of the active Project.

/** The Session view to open for a notification, or null when this window knows no Node for it. */
export function notificationTarget(note: NotifyOpen, project: { id: string; path: string } | undefined): OpenedSession | null {
  const node = sessionNodeViewOf(note.sessionId)
  if (node !== undefined) return { nodeId: node.nodeId, projectId: node.projectId }
  const orchestrator = orchestratorViewOf(note.sessionId)
  if (orchestrator !== undefined) return { nodeId: orchestrator.nodeId, projectId: orchestrator.projectId }
  if (note.projectRoot !== null && project !== undefined && project.path === note.projectRoot) {
    return { nodeId: sessionNodeId(note.sessionId), projectId: project.id, external: { sessionId: note.sessionId } }
  }
  return null
}
