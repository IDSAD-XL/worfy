// Where the Session of a clicked macOS notification is shown (ticket 21, src/main/notify.ts): a
// Session worfy runs on a Session Node or as the Orchestrator, or a Session from the registry under
// ~/.claude on its read-only Node of the active Project.
//
// A window a click just opened knows no Node yet: its Projects, Canvas and views arrive after the
// note. So a note waits here (NOTE_WAIT_MS at most) until its Session can be found, and the
// overlay (canvas/overlays/NotificationTarget.tsx) tries again whenever what it knows changes.
//
// A note of a Linked machine's Session (worfy-link ticket 13) carries that Machine. A window shows
// the Projects of one Machine (src/renderer/projects/useProjects.ts), so a note of another Machine
// than the window's is not looked up here: the overlay asks that Machine which of its Projects the
// Session is in (projectOfNote), loads the window again on that Project of that Machine — a
// window shows a Canvas, and so this overlay, only with a Project — and the note waits across that
// load in the window's session storage (carryNote).
import { z } from 'zod'
import { create } from 'zustand'
import { notifyOpenSchema, type NotifyOpen, type PipelineOpen, type SessionOpen } from '../../shared/ipc/notify'
import { sameProjectRoot } from '../../shared/paths'
import { invokeOn } from '../ipc'
import { orchestratorViewOf } from '../canvas/nodes/orchestrator-view'
import { sessionNodeId } from '../claude-home/session-nodes'
import type { OpenedSession } from './navigation'
import { sessionNodeViewOf } from './node-sessions'

/** How long a note waits for its Session to become known in this window. */
export const NOTE_WAIT_MS = 10_000

/** The Machine of a note's Session: null — this Machine, as for a Ticket's note (worfy-pipeline ticket 06). */
export const noteMachine = (note: NotifyOpen): string | null => ('machineId' in note ? (note.machineId ?? null) : null)

/**
 * The Session view to open for a notification, or null when this window knows no Node for it.
 * `machine` is the window's Machine (null — this one): a note of another Machine finds nothing
 * here, though a Session of the same id may run on this one. `project` is the Project a Session from
 * the registry is looked for in.
 */
export function notificationTarget(note: SessionOpen, project: { id: string; path: string } | undefined, machine: string | null = null): OpenedSession | null {
  if (noteMachine(note) !== machine) return null
  const node = sessionNodeViewOf(note.sessionId)
  if (node !== undefined) return { nodeId: node.nodeId, projectId: node.projectId }
  const orchestrator = orchestratorViewOf(note.sessionId)
  if (orchestrator !== undefined) return { nodeId: orchestrator.nodeId, projectId: orchestrator.projectId }
  if (note.projectRoot !== null && project !== undefined && sameProjectRoot(project.path, note.projectRoot)) {
    return { nodeId: sessionNodeId(note.sessionId), projectId: project.id, external: { sessionId: note.sessionId } }
  }
  return null
}

/**
 * The Project whose Pipeline board a Ticket's note opens, among the Projects of the window's
 * Machine: by id for a Linked machine's Ticket (worfy-pipeline ticket 10: its root is not sent), by
 * root for this Machine's. Undefined when the list no longer has it.
 */
export function pipelineProjectOf<P extends { id: string; path: string }>(note: PipelineOpen, projects: readonly P[]): P | undefined {
  if (note.projectId !== undefined) return projects.find((project) => project.id === note.projectId)
  const root = note.projectRoot
  return root === undefined ? undefined : projects.find((project) => sameProjectRoot(project.path, root))
}

/**
 * The Project of its Machine a window loads on for a note of another Machine: a Ticket's names it
 * by id (null for this Machine's, found by root after the load); a Session's is asked of that
 * Machine (projectOfNote). Null when the window is to go back to this Machine.
 */
export function projectToLoad(note: NotifyOpen, machine: string | null): Promise<string | null> {
  if (machine === null) return Promise.resolve(null)
  if ('view' in note) return Promise.resolve(note.projectId ?? null)
  return projectOfNote(note, machine)
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

/**
 * The Project of Linked machine `machine` a note's Session is in: the Project with the note's root
 * for a Session from the registry, else the one whose Session Node runs it. When none is known
 * (an Orchestrator, a Session closed meanwhile) the Machine's active Project, where the window
 * keeps looking; null when the Machine does not answer or has no Project.
 */
export async function projectOfNote(note: SessionOpen, machine: string): Promise<string | null> {
  const list = await invokeOn(machine, 'projects.list')
  if (!list.ok) {
    console.error(`a notification of Machine ${machine}: projects.list failed:`, list.error)
    return null
  }
  const { projects, activeId } = list.value
  const root = note.projectRoot
  if (root !== null) return projects.find((project) => sameProjectRoot(project.path, root))?.id ?? activeId
  for (const project of projects) {
    const views = await invokeOn(machine, 'sessions.views', { projectId: project.id })
    const runs = views.ok && views.value.views.some((view) => view.state !== 'closed' && (view.sessionId === note.sessionId || view.sdkSessionId === note.sessionId))
    if (runs) return project.id
  }
  return activeId
}

/** Where a note waits while its window loads again on another Machine. */
const CARRIED_KEY = 'worfy.notify.carried'

const carriedSchema = z.object({ note: notifyOpenSchema, until: z.number() })

/** The window's session storage: it outlives a load of the page in the same window, and only that. */
function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/** Keeps `pending` across the load of this window that comes next (with the time it may still wait). */
export function carryNote(pending: PendingNote): void {
  try {
    storage()?.setItem(CARRIED_KEY, JSON.stringify({ note: pending.note, until: pending.until }))
  } catch (error) {
    console.error('a notification could not wait across the load of the window', error)
  }
}

/** The note carried across the last load of this window, once; null when none or it waited too long. */
export function takeCarriedNote(now: number = Date.now()): PendingNote | null {
  const store = storage()
  let text: string | null
  try {
    text = store?.getItem(CARRIED_KEY) ?? null
    store?.removeItem(CARRIED_KEY)
  } catch {
    return null
  }
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = carriedSchema.safeParse(value)
  return parsed.success && parsed.data.until > now ? parsed.data : null
}
