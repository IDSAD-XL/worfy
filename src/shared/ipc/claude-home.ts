// The `claudeHome` domain: Sessions of a Project as Claude Code records them under ~/.claude
// (WORFY_CLAUDE_HOME), wherever they were started. worfy only reads these files (ADR 0002,
// ADR 0005); the main process side is src/main/claude-home/ and src/main/ipc/claude-home.ts.
import { z } from 'zod'
import { agentEvent } from '../agent/events'
import { absolutePathSchema } from '../paths'
import { findNeedle, MIN_TRANSCRIPT_FIND } from '../transcript/find'
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
  'read',
)

/**
 * Only the live Sessions of a Project, without reading the history: what the Canvas asks again
 * when the registry changed, and every few seconds while a Session is live, because a process
 * that died without removing its registry file changes no file. No subscription.
 */
export const claudeHomeLive = invokeChannel('claudeHome.live', z.object({ projectRoot: absolutePath }), z.object({ live: z.array(liveSessionSchema) }), 'project', 'read')

/** Stops `claudeHome.changed` for this Project in the calling window. `closed` is false if it was not subscribed. */
export const claudeHomeClose = invokeChannel('claudeHome.close', z.object({ projectRoot: absolutePath }), z.object({ closed: z.boolean() }), 'project', 'read')

/**
 * Bytes of a transcript one read from its end takes (worfy-ui ticket 21): the Session view opens
 * on this window of the file and «Load earlier» brings the window before it. An Orchestrator's
 * transcript grows to tens of megabytes; read whole, it kept the view half-drawn for seconds.
 */
export const TRANSCRIPT_WINDOW_BYTES = 4 * 1024 * 1024

const transcriptBytes = z
  .number()
  .int()
  .positive()
  .max(16 * 1024 * 1024)

/**
 * Events of a Session's transcript after `cursor` (from the start without one). They are the
 * events of a live Session (src/shared/agent/events.ts), of the Session's own thread only
 * (src/shared/transcript/parse.ts), so one transcript view draws both. `reset` means the file was
 * truncated or replaced and the events start over; `more` means call again.
 *
 * With `back`, the events of the window of `back.bytes` that ends at `back.before` — at the end of
 * the file without it — instead, read from the end (src/main/claude-home/tail.ts,
 * readLinesBefore); `cursor` is ignored. `earlier` is where the window's first line starts, the
 * `before` of the window ahead of it; 0 means the start of the file. The answer's `cursor` is
 * where the window ends: after a read at the end of the file, the cursor to follow it from.
 * `reset` means `back.before` no longer names a line of this file: read from the end again.
 *
 * `offsets` gives, for each event, the byte offset of the line it came from: a reader that drops
 * its oldest events knows where the window before the kept ones ends.
 */
export const claudeHomeTranscript = invokeChannel(
  'claudeHome.transcript',
  z.object({
    projectRoot: absolutePath,
    sessionId: sessionIdSchema,
    cursor: tailCursorSchema.optional(),
    maxBytes: transcriptBytes.optional(),
    back: z.object({ bytes: transcriptBytes, before: tailCursorSchema.optional() }).optional(),
  }),
  z.object({
    found: z.boolean(),
    events: z.array(agentEvent),
    cursor: tailCursorSchema,
    reset: z.boolean(),
    more: z.boolean(),
    earlier: z.number().int().nonnegative().optional(),
    offsets: z.array(z.number().int().nonnegative()).optional(),
  }),
  'project',
  'read',
)

/**
 * What the Session's transcript and its `subagents/` folder say about its Subagents (ticket 15):
 * the signals of the Session's own thread and a summary of each Subagent's files. The renderer
 * builds the tree from them (src/shared/transcript/subagents.ts), together with the events of a
 * live Session. `found` is false when the Session has no transcript yet. No subscription: the
 * Session's transcript changes come on `claudeHome.changed`.
 *
 * `truncated` is set when the answer to a Linked machine was shortened to fit a link connection
 * (LINK_MAX_PAYLOAD, src/main/link/messages.ts): the texts of results and answers are cut, and in
 * the last resort the oldest signals and files are left out (src/main/ipc/claude-home.ts,
 * fitSubagentsAnswer).
 */
export const claudeHomeSubagents = invokeChannel(
  'claudeHome.subagents',
  z.object({ projectRoot: absolutePath, sessionId: sessionIdSchema }),
  z.object({ found: z.boolean(), signals: z.array(subagentSignalSchema), files: z.array(subagentFileSchema), truncated: z.boolean().optional() }),
  'project',
  'read',
)

/** The id of a Subagent entry of a tree (SubagentInfo.id): its call's id, `agent:<agentId>` or `workflow:<runId>`. */
export const subagentEntryIdSchema = z.string().min(1).max(200)

/** At most this many entries are hidden by one call; a Session keeps at most HIDDEN_PER_SESSION. */
export const HIDE_SUBAGENTS_MAX = 5000
export const HIDDEN_PER_SESSION = 20_000

/** The hidden Subagent entries of a Project, by Session id. */
export const hiddenSubagentsSchema = z.object({ sessions: z.record(sessionIdSchema, z.array(subagentEntryIdSchema)) })
export type HiddenSubagents = z.infer<typeof hiddenSubagentsSchema>

/**
 * The Subagent entries the user hid with «Hide» (worfy-polish ticket 45, ADR-0085), by Session id.
 * main keeps them in the Project's own data folder, never under ~/.claude; the Canvas and the
 * Session rail leave them out.
 */
export const claudeHomeHiddenSubagents = invokeChannel('claudeHome.hiddenSubagents', z.object({ projectId: z.string().min(1) }), hiddenSubagentsSchema, 'project', 'read')

/** Hides Subagent entries of a Session, of any status; answers every hidden entry of the Project. Writes worfy's data. */
export const claudeHomeHideSubagents = invokeChannel(
  'claudeHome.hideSubagents',
  z.object({ projectId: z.string().min(1), sessionId: sessionIdSchema, ids: z.array(subagentEntryIdSchema).min(1).max(HIDE_SUBAGENTS_MAX) }),
  hiddenSubagentsSchema,
  'project',
  'write',
)

/** «Show hidden Subagents»: shows every hidden entry of a Session again; answers what stays hidden in the Project. */
export const claudeHomeShowSubagents = invokeChannel(
  'claudeHome.showSubagents',
  z.object({ projectId: z.string().min(1), sessionId: sessionIdSchema }),
  hiddenSubagentsSchema,
  'project',
  'write',
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
  'read',
)

/** Bounds of `claudeHome.search`: query length, snippet length, Sessions per answer. */
export const TRANSCRIPT_SEARCH = { minQuery: 3, maxQuery: 200, snippet: 120, hits: 20 } as const

/** A Session whose conversation contains the searched text (`claudeHome.search`). No file path. */
export const transcriptHitSchema = z.object({
  sessionId: sessionIdSchema,
  /** The Session's title, as `claudeHome.sessions` gives it in `history`. */
  title: z.string().optional(),
  /** Last change of the transcript, in ms since the epoch. */
  at: z.number(),
  /** Up to 120 characters of the first message that matches, around the match; `…` where cut. */
  snippet: z.string().max(TRANSCRIPT_SEARCH.snippet),
})

export type TranscriptHit = z.infer<typeof transcriptHitSchema>

/**
 * Sessions of a Project whose transcript contains `query` (at least 3 characters, case ignored)
 * in the user's messages or Claude's replies — not in tool calls or their output. Newest first,
 * at most 20; `limited` says a limit of the search (src/main/claude-home/search.ts) left some of
 * the Project's transcripts unsearched. Reads only; no subscription.
 */
export const claudeHomeSearch = invokeChannel(
  'claudeHome.search',
  z.object({
    projectRoot: absolutePath,
    query: z
      .string()
      .max(TRANSCRIPT_SEARCH.maxQuery)
      .refine((query) => query.trim().length >= TRANSCRIPT_SEARCH.minQuery, `a query of at least ${TRANSCRIPT_SEARCH.minQuery} characters`),
  }),
  z.object({ hits: z.array(transcriptHitSchema).max(TRANSCRIPT_SEARCH.hits), limited: z.boolean() }),
  'project',
  'read',
)

/** Bounds of `claudeHome.transcriptFind`: query length and lines given back. */
export const TRANSCRIPT_FIND = { maxQuery: 200, hits: 20_000 } as const

/**
 * Find in the part of a Session's transcript before byte `before` (worfy-ui ticket 26): the part the
 * Session view has not read yet, behind «Load earlier» (`earlier` of `claudeHome.transcript`). The
 * matches are counted in what the view searches (src/shared/transcript/find.ts), case ignored, for
 * `query` of at least 2 characters after trimming. `hits`: the lines with matches, the byte where
 * each starts and its count, oldest first — the latest 20 000 of them; `skipped` counts the
 * matches in the lines before those. With `from`, only the lines from that byte on: the view asks
 * for the part its window gave up since its last answer. With `agentId`, in that Subagent's
 * transcript. Reads only.
 */
export const claudeHomeTranscriptFind = invokeChannel(
  'claudeHome.transcriptFind',
  z.object({
    projectRoot: absolutePath,
    sessionId: sessionIdSchema,
    agentId: agentIdSchema.optional(),
    query: z
      .string()
      .max(TRANSCRIPT_FIND.maxQuery)
      .refine((query) => findNeedle(query) !== '', `a query of at least ${MIN_TRANSCRIPT_FIND} characters`),
    before: z.number().int().nonnegative(),
    /** Where to start: a line start the view searched up to before (the part before it was searched then); 0 by default. */
    from: z.number().int().nonnegative().optional(),
  }),
  z.object({
    found: z.boolean(),
    hits: z.array(z.object({ offset: z.number().int().nonnegative(), count: z.number().int().positive() })).max(TRANSCRIPT_FIND.hits),
    total: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  'project',
  'read',
)

/**
 * Something changed under ~/.claude for a Project: the registry of live Sessions (`sessions`)
 * and/or the transcripts named in `transcripts` (Session ids). Debounced in main.
 */
export const claudeHomeChanged = eventChannel(
  'claudeHome.changed',
  z.object({ projectRoot: z.string(), sessions: z.boolean(), transcripts: z.array(z.string()) }),
  'project',
  'read',
)

declare module './channels' {
  interface IpcContract {
    'claudeHome.sessions': typeof claudeHomeSessions
    'claudeHome.live': typeof claudeHomeLive
    'claudeHome.close': typeof claudeHomeClose
    'claudeHome.transcript': typeof claudeHomeTranscript
    'claudeHome.subagents': typeof claudeHomeSubagents
    'claudeHome.subagentTranscript': typeof claudeHomeSubagentTranscript
    'claudeHome.hiddenSubagents': typeof claudeHomeHiddenSubagents
    'claudeHome.hideSubagents': typeof claudeHomeHideSubagents
    'claudeHome.showSubagents': typeof claudeHomeShowSubagents
    'claudeHome.search': typeof claudeHomeSearch
    'claudeHome.transcriptFind': typeof claudeHomeTranscriptFind
    'claudeHome.changed': typeof claudeHomeChanged
  }
}
