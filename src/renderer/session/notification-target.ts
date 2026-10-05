// Where the Session of a clicked macOS notification is shown (ticket 21, src/main/notify.ts): a
// Session worfy runs on a Session Node or as the Orchestrator, or a Session from the registry under
// ~/.claude on its read-only Node of the active Project.
//
// A window a click just opened knows no Node yet: its Projects, Canvas and views arrive after the
// note. So a note waits here (NOTE_WAIT_MS at most) until its Session can be found, and the
// overlay (canvas/overlays/NotificationTarget.tsx) tries again whenever what it knows changes.
import { create } from 'zustand'
import type { NotifyOpen } from '../../shared/ipc/notify'
import { orchestratorViewOf } from '../canvas/nodes/orchestrator-view'
import { sessionNodeId } from '../claude-home/session-nodes'
import type { OpenedSession } from './navigation'
import { sessionNodeViewOf } from './node-sessions'

/** How long a note waits for its Session to become known in this window. */
export const NOTE_WAIT_MS = 10_000

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

/** A note waiting for its Session, and until when it waits. */
export interface PendingNote {
  note: NotifyOpen
  until: number
}

export const usePendingNote = create<{ pending: PendingNote | null }>(() => ({ pending: null }))

/** Takes a clicked note; it replaces one still waiting. */
export function holdNote(note: NotifyOpen, now: number = Date.now()): void {
  usePendingNote.setState({ pending: { note, until: now + NOTE_WAIT_MS } })
}

/** Lets go of `pending` (opened, or waited too long), unless a newer note replaced it. */
export function dropNote(pending: PendingNote): void {
  if (usePendingNote.getState().pending === pending) usePendingNote.setState({ pending: null })
}
