// The format of `live-sessions.json` (worfy-continuity ticket 03): the Sessions of a Project that have a turn
// running or messages in their queue, as main last saw them. The file lies in the Project's data folder, next to
// `bindings.json` (ADR-0005: never in the Project's repository, never in ~/.claude); src/main/agent/live-sessions.ts
// writes it. After a restart of worfy it tells which Sessions were cut off in a turn and what waited in their queues
// (ticket 05 reads it).
//
// A record is keyed by its Node: the Orchestrator's Node or a Session Node. The id of a live Session is not kept as
// the key, as a resumed one runs under a temporary `pending-…` id until its first init. The Binding of a Session is
// not copied here: it is read again from the transcripts at start (ADR-0002).
//
// A build older than the one that wrote the file may read it (after a rollback to the previous copy): the file
// carries `version`, and a reader that does not know it reads nothing.
import { z } from 'zod'
import { runIdSchema } from '../ipc/runs'
import { vendorIdSchema } from '../vendors/vendor'
import { sessionState } from './events'

export const LIVE_SESSIONS_FILE = 'live-sessions.json'

/** The version this build writes and reads. */
export const LIVE_SESSIONS_VERSION = 1

/** A message waiting in the queue: the text the person typed, and the attachments by their paths and names. */
export const liveQueuedMessageSchema = z.object({
  text: z.string(),
  /** The absolute paths of the attached files (the user's own, or worfy's copies). */
  files: z.array(z.string()),
  /** The names of the attached images; their bytes are not kept. */
  images: z.array(z.string()),
})
export type LiveQueuedMessage = z.output<typeof liveQueuedMessageSchema>

export const liveSessionSchema = z.object({
  /** The Node the Session runs on: the Project's Orchestrator Node or a Session Node. */
  nodeId: z.string().min(1),
  kind: z.enum(['orchestrator', 'session-node']),
  vendor: vendorIdSchema,
  /** The Vendor's own session: Claude Code's session id, Codex's thread id; null before the agent named it. */
  vendorSessionId: z.string().min(1).nullable(),
  /** `busy` or `needs_permission` while a turn runs; any other state while only the queue keeps the record. */
  state: sessionState.exclude(['closed']),
  /** The queue, oldest first; `held` after Interrupt, until "Send queued". */
  queue: z.object({ items: z.array(liveQueuedMessageSchema), held: z.boolean() }),
  /** The Autopilot Run that owns the Session (its Journal's id); null when a person does. */
  runId: runIdSchema.nullable(),
  /** When main last saw the Session do something, in milliseconds since the epoch. */
  lastEventAt: z.number().int().nonnegative(),
  /** When worfy continued the Session by itself within the last hour, in milliseconds since the epoch. */
  continuedAt: z.array(z.number().int().nonnegative()),
})
export type LiveSession = z.output<typeof liveSessionSchema>

export const liveSessionsFileSchema = z.object({
  version: z.literal(LIVE_SESSIONS_VERSION),
  sessions: z.array(liveSessionSchema),
})
export type LiveSessionsFile = z.output<typeof liveSessionsFileSchema>

/**
 * The records of a `live-sessions.json` whose text is `text`; `null` when there is no file. A file that is empty,
 * is not JSON, has a version this build does not know or does not match the format gives no records, and `log`
 * gets one line that says why. Reads nothing itself.
 */
export function parseLiveSessions(text: string | null, log: (line: string) => void): LiveSession[] {
  if (text === null) return []
  if (text.trim() === '') {
    log(`worfy: ${LIVE_SESSIONS_FILE} is empty; no Session is continued from it`)
    return []
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    log(`worfy: ${LIVE_SESSIONS_FILE} is not JSON (${error instanceof Error ? error.message : String(error)}); no Session is continued from it`)
    return []
  }
  const version = typeof value === 'object' && value !== null && 'version' in value ? value.version : undefined
  if (version !== LIVE_SESSIONS_VERSION) {
    log(`worfy: ${LIVE_SESSIONS_FILE} has version ${JSON.stringify(version ?? null)}, this build reads ${LIVE_SESSIONS_VERSION}; no Session is continued from it`)
    return []
  }
  const parsed = liveSessionsFileSchema.safeParse(value)
  if (!parsed.success) {
    log(`worfy: ${LIVE_SESSIONS_FILE} does not match its format (${z.prettifyError(parsed.error).replace(/\s*\n\s*/gu, ' ')}); no Session is continued from it`)
    return []
  }
  return parsed.data.sessions
}
