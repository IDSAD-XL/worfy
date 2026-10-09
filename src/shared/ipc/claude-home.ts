// The `claudeHome` domain: Sessions of a Project as Claude Code records them under ~/.claude
// (WORFY_CLAUDE_HOME), wherever they were started. worfy only reads these files (ADR 0002,
// ADR 0005); the main process side is src/main/claude-home/ and src/main/ipc/claude-home.ts.
import { z } from 'zod'
import { agentEvent } from '../agent/events'
import { absolutePathSchema } from '../paths'
import { subagentFileSchema, subagentSignalSchema } from '../transcript/subagents'
import { eventChannel, invokeChannel } from './channels'

/** An absolute path, POSIX or Windows; the main process resolves it again before use. */
const absolutePath = absolutePathSchema

/** A Session id names a file: letters, digits and dashes only, so it can never leave its folder. */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/, 'not a session id')

/** A Subagent id names a file too (`agent-<id>.jsonl`): letters, digits, `-` and `_`. */
export const agentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'not an agent id')

/** A Session whose Claude Code process runs now (~/.claude/sessions/<pid>.json, process alive). */
export const liveSessionSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string(),
  cwd: z.string(),
  /** `idle | busy` as Claude Code writes it; anything else is `unknown`. */
  status: z.enum(['idle', 'busy', 'unknown']),
  /** Where it was started: `cli`, `claude-desktop`, … */
  entrypoint: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  version: z.string().optional(),
  /** Milliseconds since the epoch. */
  startedAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

/** A transcript of the Project's root or one of its worktrees (~/.claude/projects/<dir>/<id>.jsonl). */
export const historySessionSchema = z.object({
  sessionId: z.string(),
  /** Last `custom-title`, else last `ai-title`, else the first prompt (`/name` for a command). */
  title: z.string().optional(),
  /** ISO time of the first and of the last record that has a time. */
  firstAt: z.string().optional(),
  lastAt: z.string().optional(),
  /** cwd of the first record: where the Session was started. */
  cwd: z.string().optional(),
  /** Branch of the last record that names one. */
  gitBranch: z.string().optional(),
  /** Where it was started, as the first record that names it says: `cli`, `claude-desktop`, `sdk-ts`, … */
  entrypoint: z.string().optional(),
  /** File size in bytes and modification time in ms, for sorting and change detection. */
  size: z.number(),
  modifiedAt: z.number(),
  /** True when a live Session with this id is in the registry right now. */
  live: z.boolean(),
})

export const tailCursorSchema = z.object({
  offset: z.number().int().nonnegative(),
  fileId: z.string().nullable(),
})

export type LiveSession = z.infer<typeof liveSessionSchema>
export type HistorySession = z.infer<typeof historySessionSchema>

/**
 * Live Sessions and the history of a Project. The call also subscribes the calling window to
 * `claudeHome.changed` for this Project, until `claudeHome.close` (or until the window is gone),
 * the way `workflow.open` does. The subscription starts before the files are read, so no change
 * falls between the answer and the first event.
 */
export const claudeHomeSessions = invokeChannel(
  'claudeHome.sessions',
  z.object({ projectRoot: absolutePath }),
  z.object({ live: z.array(liveSessionSchema), history: z.array(historySessionSchema) }),
  'project',
)

/**
 * Only the live Sessions of a Project, without reading the history: what the Canvas asks again
 * when the registry changed, and every few seconds while a Session is live, because a process
 * that died without removing its registry file changes no file. No subscription.
 */
export const claudeHomeLive = invokeChannel('claudeHome.live', z.object({ projectRoot: absolutePath }), z.object({ live: z.array(liveSessionSchema) }), 'project')

/** Stops `claudeHome.changed` for this Project in the calling window. `closed` is false if it was not subscribed. */
export const claudeHomeClose = invokeChannel('claudeHome.close', z.object({ projectRoot: absolutePath }), z.object({ closed: z.boolean() }), 'project')

/**
 * Events of a Session's transcript after `cursor` (from the start without one). They are the
 * events of a live Session (src/shared/agent/events.ts), of the Session's own thread only
 * (src/shared/transcript/parse.ts), so one transcript view draws both. `reset` means the file was
 * truncated or replaced and the events start over; `more` means call again.
 */
export const claudeHomeTranscript = invokeChannel(
  'claudeHome.transcript',
  z.object({
    projectRoot: absolutePath,
    sessionId: sessionIdSchema,
    cursor: tailCursorSchema.optional(),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024)
      .optional(),
  }),
  z.object({
    found: z.boolean(),
    events: z.array(agentEvent),
    cursor: tailCursorSchema,
    reset: z.boolean(),
    more: z.boolean(),
  }),
  'project',
)

/**
 * What the Session's transcript and its `subagents/` folder say about its Subagents (ticket 15):
 * the signals of the Session's own thread and a summary of each Subagent's files. The renderer
 * builds the tree from them (src/shared/transcript/subagents.ts), together with the events of a
 * live Session. `found` is false when the Session has no transcript yet. No subscription: the
 * Session's transcript changes come on `claudeHome.changed`.
 */
export const claudeHomeSubagents = invokeChannel(
  'claudeHome.subagents',
  z.object({ projectRoot: absolutePath, sessionId: sessionIdSchema }),
  z.object({ found: z.boolean(), signals: z.array(subagentSignalSchema), files: z.array(subagentFileSchema) }),
  'project',
)

/**
 * Events of one Subagent's transcript (`<sessionId>/subagents/agent-<agentId>.jsonl`) after
 * `cursor`, like `claudeHome.transcript`: every record of the file is the Subagent's own.
 */
export const claudeHomeSubagentTranscript = invokeChannel(
  'claudeHome.subagentTranscript',
  claudeHomeTranscript.input.extend({ agentId: agentIdSchema }),
  claudeHomeTranscript.output,
  'project',
)

/**
 * Something changed under ~/.claude for a Project: the registry of live Sessions (`sessions`)
 * and/or the transcripts named in `transcripts` (Session ids). Debounced in main.
 */
export const claudeHomeChanged = eventChannel(
  'claudeHome.changed',
  z.object({ projectRoot: z.string(), sessions: z.boolean(), transcripts: z.array(z.string()) }),
  'project',
)

declare module './channels' {
  interface IpcContract {
    'claudeHome.sessions': typeof claudeHomeSessions
    'claudeHome.live': typeof claudeHomeLive
    'claudeHome.close': typeof claudeHomeClose
    'claudeHome.transcript': typeof claudeHomeTranscript
    'claudeHome.subagents': typeof claudeHomeSubagents
    'claudeHome.subagentTranscript': typeof claudeHomeSubagentTranscript
    'claudeHome.changed': typeof claudeHomeChanged
  }
}
