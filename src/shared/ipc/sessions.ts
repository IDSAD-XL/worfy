// The `sessions` domain: Sessions worfy runs on Session Nodes of a Project (ticket 18), next to the
// Orchestrator. "New session" makes a new live Node in the Project's root; Resume continues a
// finished Session — one started in a terminal, Claude desktop or worfy — on its Node. One
// conversation is one Node: a new conversation is a new Node, the old one stays.
//
// The Node's `data` in the Layout keeps identifiers only (ADR-0010): `origin: 'worfy'` and, once
// Claude Code has reported it, the SDK session id. Everything else the Node shows comes from the
// live Session (its view, below, kept in memory by main) or from the transcript. Run by
// src/main/agent/node-sessions.ts, handled in src/main/ipc/sessions.ts (ADR-0006). The events of
// these Sessions go to every window on `agent.event`, and the `agent.*` channels take their ids.
import { z } from 'zod'
import { sessionState } from '../agent/events'
import { eventChannel, invokeChannel } from './channels'

/** The `kind` of a Session Node in the Layout (the read-only ones of ticket 14 too). */
export const SESSION_NODE_KIND = 'session'
/** Size of a new live Session Node: room for the last answer and the input field. */
export const LIVE_SESSION_WIDTH = 340
export const LIVE_SESSION_HEIGHT = 220

/** Why Resume is refused; RESUME_LABELS says it to the user. */
export const resumeRefusalSchema = z.enum(['open', 'running', 'desktop', 'unknown', 'folder-missing'])
export type ResumeRefusal = z.output<typeof resumeRefusalSchema>

export const RESUME_LABELS: Readonly<Record<ResumeRefusal, string>> = {
  open: 'Already open in worfy',
  running: 'Still running in terminal',
  desktop: 'Still running in Claude desktop',
  unknown: 'No transcript of this Session',
  'folder-missing': 'Folder no longer exists',
}

/** Whether a Session can be resumed now, and in which folder (src/main/agent/resume.ts). */
export const resumeVerdictSchema = z.discriminatedUnion('resumable', [
  z.object({
    resumable: z.literal(true),
    /** The cwd the transcript records: a Session of a worktree goes on in that worktree. */
    cwd: z.string().min(1),
  }),
  z.object({ resumable: z.literal(false), reason: resumeRefusalSchema, label: z.string().min(1) }),
])
export type ResumeVerdict = z.output<typeof resumeVerdictSchema>

const projectId = z.string().min(1)
const nodeId = z.string().min(1)
/** A Session id names a transcript file: letters, digits and dashes only (as in claude-home.ts). */
const sdkSessionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/, 'not a session id')

/** What a live Session Node shows, as main has it now. */
export const sessionNodeViewSchema = z.object({
  projectId,
  nodeId,
  /** The live Session's id for the `agent.*` channels: temporary until Claude Code reports its own. */
  sessionId: z.string().min(1),
  /** The SDK session: the one resumed, or the one Claude Code reported; null for a new one before its first turn. */
  sdkSessionId: z.string().min(1).nullable(),
  state: sessionState,
  /** Why the Session is in `error`. */
  error: z.string().nullable(),
  /** Where the Session runs: as asked, then as Claude Code reported it in system/init. */
  cwd: z.string().min(1),
  /** The model of the last system/init. */
  model: z.string().nullable(),
  /** Grows with every change of any view in this run of the app: of two views, the larger is newer. */
  version: z.number().int().nonnegative(),
})
export type SessionNodeView = z.output<typeof sessionNodeViewSchema>

/** A new live Session Node with a new Session in the Project's root. */
export const sessionsNew = invokeChannel('sessions.new', z.object({ projectId }), sessionNodeViewSchema)

/**
 * Starts the Session behind an existing worfy Session Node that runs none: its saved session,
 * resumed under the rule of Resume, or a new one when the Node has none yet. A Node that runs one
 * answers its view and changes nothing.
 */
export const sessionsStart = invokeChannel('sessions.start', z.object({ projectId, nodeId }), sessionNodeViewSchema)

/**
 * Continues a finished Session on its Node: the Session Node that names it (a read-only one turns
 * live), or a new one. Refused, with the verdict's label, when the rule of Resume says no.
 */
export const sessionsResume = invokeChannel('sessions.resume', z.object({ projectId, sessionId: sdkSessionId }), sessionNodeViewSchema)

/** The verdict of Resume for each of the given Sessions of the Project. */
export const sessionsResumable = invokeChannel(
  'sessions.resumable',
  z.object({ projectId, sessionIds: z.array(sdkSessionId).max(500) }),
  z.object({ verdicts: z.record(z.string(), resumeVerdictSchema) }),
)

/** The views of the Project's live Session Nodes, for a window that opens later. */
export const sessionsViews = invokeChannel('sessions.views', z.object({ projectId }), z.object({ views: z.array(sessionNodeViewSchema) }))

/** Closes the Session behind a Node; refused while a turn runs (Interrupt it first). The Node stays. */
export const sessionsClose = invokeChannel('sessions.close', z.object({ nodeId }), z.void())

/** A view changed; sent to every window. A closed Session's last view has state `closed`. */
export const sessionsChanged = eventChannel('sessions.changed', sessionNodeViewSchema)

declare module './channels' {
  interface IpcContract {
    'sessions.new': typeof sessionsNew
    'sessions.start': typeof sessionsStart
    'sessions.resume': typeof sessionsResume
    'sessions.resumable': typeof sessionsResumable
    'sessions.views': typeof sessionsViews
    'sessions.close': typeof sessionsClose
    'sessions.changed': typeof sessionsChanged
  }
}
