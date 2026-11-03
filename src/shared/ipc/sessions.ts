// The `sessions` domain: Sessions worfy runs on Session Nodes of a Project (ticket 18), next to the
// Orchestrator. "New session" makes a new live Node in the Project's root; Resume continues a
// finished Session — one started in a terminal, Claude desktop or worfy — on its Node. One
// conversation is one Node: a new conversation is a new Node, the old one stays.
//
// The Node's `data` in the Layout keeps identifiers only (ADR-0010): `origin: 'worfy'`, the Vendor
// whose agent runs the Session (worfy-multi-vendor ticket 23) and, once the agent has reported it,
// the Vendor's session id. Everything else the Node shows comes from the
// live Session (its view, below, kept in memory by main) or from the transcript. Run by
// src/main/agent/node-sessions.ts, handled in src/main/ipc/sessions.ts (ADR-0006). The events of
// these Sessions go to every window on `agent.event`, and the `agent.*` channels take their ids.
import { z } from 'zod'
import { sessionState } from '../agent/events'
import { vendorIdSchema } from '../vendors/vendor'
import { eventChannel, invokeChannel } from './channels'

/** The `kind` of a Session Node in the Layout (the read-only ones of ticket 14 too). */
export const SESSION_NODE_KIND = 'session'
/**
 * What a Session Node worfy runs keeps in `data`, as main writes it (src/main/agent/node-sessions.ts):
 * identifiers only (ADR-0010) — the Vendor and the Vendor's session id, once the agent has reported
 * it. The renderer reads the Node with this schema; a read-only Node of ticket 14 has `origin: 'external'`.
 */
export const worfySessionNodeDataSchema = z.object({
  origin: z.literal('worfy'),
  /**
   * The VendorId of the Session's agent; absent on a Node saved before worfy-multi-vendor ticket 23,
   * which is Claude Code's. A value this build does not know (a later worfy's Vendor) is kept as it
   * is, and main refuses to start the Node.
   */
  vendor: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
})
export type WorfySessionNodeData = z.output<typeof worfySessionNodeDataSchema>

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
  /** The Vendor whose agent runs the Session; Claude Code in a view of a build from before worfy-multi-vendor ticket 23. */
  vendor: vendorIdSchema.default('claude'),
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

/**
 * A new live Session Node with a new Session in the Project's root, on the agent of `vendor`, or of the
 * Project's `defaultVendor` without it. A Vendor this build does not run, or one nobody is signed in
 * to, is refused with the reason; so is a VendorId of a later build, which is why `vendor` is any
 * short string here rather than a VendorId.
 */
export const sessionsNew = invokeChannel('sessions.new', z.object({ projectId, vendor: z.string().min(1).max(64).optional() }), sessionNodeViewSchema, 'project', 'write')

/**
 * What the Vendor picker of "New session" offers (worfy-multi-vendor ticket 24): the Vendors in the
 * order to list them, the Project's `defaultVendor` first, each with why a Session of it cannot start
 * now (nobody is signed in to it) or null. A Vendor is any short string, as in `sessions.new`: a
 * Linked machine of a later build may run one this build does not know.
 */
export const sessionVendorsSchema = z.object({
  defaultVendor: z.string().min(1).max(64),
  choices: z.array(z.object({ vendor: z.string().min(1).max(64), refusal: z.string().nullable() })),
})
export type SessionVendors = z.output<typeof sessionVendorsSchema>

/** The Vendors "New session" of the Project can pick (above); asking may start a Vendor's process to check its sign-in. */
export const sessionsVendors = invokeChannel('sessions.vendors', z.object({ projectId }), sessionVendorsSchema, 'project', 'read')

/**
 * Starts the Session behind an existing worfy Session Node that runs none, on the Node's Vendor: its
 * saved session, resumed under the rule of Resume, or a new one when the Node has none yet. A Node
 * that runs one answers its view and changes nothing.
 */
export const sessionsStart = invokeChannel('sessions.start', z.object({ projectId, nodeId }), sessionNodeViewSchema, 'project', 'write')

/**
 * Continues a finished Session on its Node: the Session Node that names it (a read-only one turns
 * live), or a new one. Refused, with the verdict's label, when the rule of Resume says no.
 */
export const sessionsResume = invokeChannel('sessions.resume', z.object({ projectId, sessionId: sdkSessionId }), sessionNodeViewSchema, 'project', 'write')

/** The verdict of Resume for each of the given Sessions of the Project. */
export const sessionsResumable = invokeChannel(
  'sessions.resumable',
  z.object({ projectId, sessionIds: z.array(sdkSessionId).max(500) }),
  z.object({ verdicts: z.record(z.string(), resumeVerdictSchema) }),
  'project',
  'read',
)

/** The views of the Project's live Session Nodes, for a window that opens later. */
export const sessionsViews = invokeChannel('sessions.views', z.object({ projectId }), z.object({ views: z.array(sessionNodeViewSchema) }), 'project', 'read')

/** Closes the Session behind a Node; refused while a turn runs (Interrupt it first). The Node stays. */
export const sessionsClose = invokeChannel('sessions.close', z.object({ nodeId }), z.void(), 'project', 'write')

/** A view changed; sent to every window. A closed Session's last view has state `closed`. */
export const sessionsChanged = eventChannel('sessions.changed', sessionNodeViewSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'sessions.new': typeof sessionsNew
    'sessions.vendors': typeof sessionsVendors
    'sessions.start': typeof sessionsStart
    'sessions.resume': typeof sessionsResume
    'sessions.resumable': typeof sessionsResumable
    'sessions.views': typeof sessionsViews
    'sessions.close': typeof sessionsClose
    'sessions.changed': typeof sessionsChanged
  }
}
