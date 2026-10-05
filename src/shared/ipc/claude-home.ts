// The `claudeHome` domain: Sessions of a Project as Claude Code records them under ~/.claude
// (WORFY_CLAUDE_HOME), wherever they were started. worfy only reads these files (ADR 0002,
// ADR 0005); the main process side is src/main/claude-home/ and src/main/ipc/claude-home.ts.
import { z } from 'zod'
import { transcriptEventSchema } from '../transcript/parse'
import { eventChannel, invokeChannel } from './channels'

/** An absolute POSIX path; the main process resolves it again before use. */
const absolutePath = z
  .string()
  .min(1)
  .refine((path) => path.startsWith('/') && !path.includes('\0'), 'must be an absolute path')

/** A Session id names a file: letters, digits and dashes only, so it can never leave its folder. */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/, 'not a session id')

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
 * `claudeHome.changed` for this Project.
 */
export const claudeHomeSessions = invokeChannel(
  'claudeHome.sessions',
  z.object({ projectRoot: absolutePath }),
  z.object({ live: z.array(liveSessionSchema), history: z.array(historySessionSchema) }),
)

/**
 * Events of a Session's transcript after `cursor` (from the start without one). `reset` means
 * the file was truncated or replaced and the events start over; `more` means call again.
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
    events: z.array(transcriptEventSchema),
    cursor: tailCursorSchema,
    reset: z.boolean(),
    more: z.boolean(),
  }),
)

/**
 * Something changed under ~/.claude for a Project: the registry of live Sessions (`sessions`)
 * and/or the transcripts named in `transcripts` (Session ids). Debounced in main.
 */
export const claudeHomeChanged = eventChannel(
  'claudeHome.changed',
  z.object({ projectRoot: z.string(), sessions: z.boolean(), transcripts: z.array(z.string()) }),
)

declare module './channels' {
  interface IpcContract {
    'claudeHome.sessions': typeof claudeHomeSessions
    'claudeHome.transcript': typeof claudeHomeTranscript
    'claudeHome.changed': typeof claudeHomeChanged
  }
}
