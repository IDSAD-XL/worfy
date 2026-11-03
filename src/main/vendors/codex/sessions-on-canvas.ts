// The Codex Sessions of a Project on the Canvas (worfy-multi-vendor ticket 27): the threads whose folder
// is the Project's root, one of its worktrees or a folder inside one of them, started in worfy or in a
// terminal. They come from the history part of the Codex driver (history.ts, ticket 22): `history.list`
// of the root and of each worktree outside it, compared by isInsidePath (on Windows either separator
// and any case). Codex keeps no file of its live Sessions (ticket 05), so nothing is watched: the
// Project's window asks again every CODEX_SESSIONS_POLL_MS, and Codex is asked at most that often for
// a Project, however often the window asks (the Claude part of the same answer changes far more
// often). Without a Codex home folder nothing is asked and the window does not poll; a Codex that
// cannot be asked (no binary, no answer) leaves the list as it was, says so once in the log and turns
// the window's polling off. No error reaches the user.
//
// The `claudeHome.*` channel gives these threads as Sessions of the history with `vendor: 'codex'`
// (src/main/ipc/claude-home.ts), and a thread's transcript from `history.read`. worfy writes nothing
// into CODEX_HOME (ADR-0005).
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { CODEX_SESSIONS_POLL_MS, sessionIdSchema, type HistorySession as HomeSession } from '../../../shared/ipc/claude-home'
import type { AgentEvent } from '../../../shared/agent/events'
import { mainThreadEvents } from '../../../shared/transcript/parse'
import { isInsidePath } from '../../claude-home/registry'
import type { HistoryPart, HistorySession } from '../history'
import { codexHomeOf } from './account'
import { codexHistory } from './history'

/**
 * The Codex Sessions whose folder is inside one of `roots` (the Project's root and its worktrees), by
 * the rules of `platform`: `history.list` of every root that is not inside another, each thread once,
 * the newest first. Both sides in NFC, as history.ts compares them.
 */
export async function codexProjectSessions(history: Pick<HistoryPart, 'list'>, roots: readonly string[], platform: NodeJS.Platform = process.platform): Promise<HistorySession[]> {
  const inside = (path: string, root: string): boolean => isInsidePath(path.normalize('NFC'), root.normalize('NFC'), platform)
  // A worktree under the root (<root>/.claude/worktrees/…) is in the root's list already: one ask fewer.
  const asked: string[] = []
  for (const root of roots) if (!asked.some((kept) => inside(root, kept))) asked.push(root)
  const found = new Map<string, HistorySession>()
  // One after another: each list starts its own Codex process.
  for (const root of asked) {
    for (const session of await history.list(root)) {
      if (session.cwd === null || !roots.some((each) => inside(session.cwd as string, each))) continue
      found.set(session.id, session)
    }
  }
  return [...found.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id))
}

/**
 * A Codex thread as a Session of the `claudeHome` history; null for a thread whose id could not name
 * a Session there (sessionIdSchema: Codex's ids are UUIDs).
 */
export function codexHomeSession(session: HistorySession): HomeSession | null {
  if (!sessionIdSchema.safeParse(session.id).success) return null
  const at = session.updatedAt
  return {
    sessionId: session.id,
    ...(session.title === null ? {} : { title: session.title }),
    ...(at === null ? {} : { lastAt: new Date(at).toISOString() }),
    ...(session.cwd === null ? {} : { cwd: session.cwd }),
    size: 0,
    modifiedAt: at ?? 0,
    live: false,
    vendor: 'codex',
    ...(session.origin === null ? {} : { origin: session.origin }),
  }
}

/**
 * How long an answer of `claudeHome.sessions` waits for Codex: the Claude part of the same answer must
 * not wait for a Codex that starts slowly or hangs (an ask may take CODEX_ASK_TIMEOUT_MS, 30 s).
 */
export const CODEX_ANSWER_WAIT_MS = 5_000

/** What the Codex part of `claudeHome.sessions` answers for a Project. */
export interface CodexSessionsAnswer {
  sessions: HomeSession[]
  /** False when Codex could not be asked the last time: the window does not poll. */
  available: boolean
}

/** A read of a transcript, as `claudeHome.transcript` asks for it. */
export interface CodexTranscriptRead {
  cursor?: { offset: number; fileId: string | null } | undefined
  back?: unknown
}

/** The answer of `claudeHome.transcript` for a Codex thread. */
export interface CodexTranscriptAnswer {
  found: true
  events: AgentEvent[]
  cursor: { offset: number; fileId: string }
  reset: boolean
  more: false
  earlier?: number
  offsets: number[]
}

/** The `fileId` of a Codex transcript's cursor: its `offset` counts events, not bytes. */
const CODEX_FILE = 'codex-thread'

/**
 * The answer of `claudeHome.transcript` for the events of a Codex thread. A read from the end gets all
 * of them at once, `earlier` 0: a thread is read whole (`thread/read`), there is nothing before it to
 * load. A read forward from a cursor of this kind gets the events after it; any other cursor starts over
 * (`reset`). Every event's offset is 0, the start of the thread: an offset names no byte here.
 */
export function codexTranscriptAnswer(events: readonly AgentEvent[], read: CodexTranscriptRead): CodexTranscriptAnswer {
  const end = { offset: events.length, fileId: CODEX_FILE }
  if (read.back !== undefined) return { found: true, events: [...events], cursor: end, reset: false, more: false, earlier: 0, offsets: events.map(() => 0) }
  const cursor = read.cursor
  const reset = cursor !== undefined && (cursor.fileId !== CODEX_FILE || cursor.offset > events.length)
  const from = cursor === undefined || reset ? 0 : cursor.offset
  const after = events.slice(from)
  return { found: true, events: after, cursor: end, reset, more: false, offsets: after.map(() => 0) }
}

export interface CodexSessionsOptions {
  /** The history part of the Codex driver. */
  history: Pick<HistoryPart, 'list' | 'read'>
  /** The Project's root and its worktrees, absolute (ClaudeHomeRegistry.roots). */
  roots(root: string): Promise<readonly string[]>
  /**
   * Whether there is a Codex to ask: its home folder exists. Without one no Codex starts, and the
   * window does not poll. Always by default.
   */
  present?: () => boolean
  /** The rules paths compare by; process.platform by default. */
  platform?: NodeJS.Platform
  /** How often Codex is asked at most, per Project; CODEX_SESSIONS_POLL_MS by default. */
  pollMs?: number
  /**
   * How long an answer waits for a list Codex is still giving; CODEX_ANSWER_WAIT_MS by default. After
   * it the answer has the last list, and the list being asked for comes with the next answer.
   */
  waitMs?: number
  now?: () => number
  log?: (message: string, cause: unknown) => void
}

interface Known {
  /** When Codex was last asked for this Project (answered or not). */
  at: number
  sessions: HistorySession[]
  available: boolean
  asking?: Promise<void>
  /** The reason last written to the log, so a Codex that keeps failing says it once. */
  failure?: string
}

/** The Codex Sessions of each Project, asked of Codex at most once per `pollMs`. */
export class CodexSessionsOnCanvas {
  private readonly known = new Map<string, Known>()
  private readonly pollMs: number
  private readonly waitMs: number
  private readonly now: () => number
  private readonly log: (message: string, cause: unknown) => void

  constructor(private readonly options: CodexSessionsOptions) {
    this.pollMs = options.pollMs ?? CODEX_SESSIONS_POLL_MS
    this.waitMs = options.waitMs ?? CODEX_ANSWER_WAIT_MS
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((message, cause) => console.warn(message, cause))
  }

  /** The Codex Sessions of the Project at `root`: asked of Codex when the last ask is older than `pollMs`. */
  async sessions(root: string): Promise<CodexSessionsAnswer> {
    const known = await this.fresh(root)
    return { sessions: known.sessions.flatMap((session) => codexHomeSession(session) ?? []), available: known.available }
  }

  /** The Codex Sessions the last ask found for `root`, without asking Codex; none before the first ask. */
  cached(root: string): readonly HistorySession[] {
    return this.known.get(this.key(root))?.sessions ?? []
  }

  /**
   * One key per Project root however a caller spells it: a window keeps git's `C:/…` on Windows, the
   * Project list another spelling, and either must find the last answer.
   */
  private key(root: string): string {
    const platform = this.options.platform ?? process.platform
    const resolved = (platform === 'win32' ? win32 : posix).resolve(root).normalize('NFC')
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  /**
   * The events of the Project's Codex thread `id` (history.read); null when the last ask for `root` did
   * not list it, so no thread of another folder is read through a Project.
   */
  async transcript(root: string, id: string): Promise<AgentEvent[] | null> {
    const session = this.cached(root).find((each) => each.id === id)
    if (session === undefined) return null
    return mainThreadEvents(await this.options.history.read(id, session.cwd ?? root))
  }

  private async fresh(root: string): Promise<Known> {
    const key = this.key(root)
    const known = this.known.get(key) ?? { at: Number.NEGATIVE_INFINITY, sessions: [], available: true }
    this.known.set(key, known)
    if (this.options.present?.() === false) {
      known.available = false
      return known
    }
    if (known.asking === undefined && this.now() - known.at >= this.pollMs) {
      known.at = this.now()
      known.asking = this.ask(root, known).finally(() => {
        known.asking = undefined
      })
    }
    if (known.asking !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.waitMs)
      })
      await Promise.race([known.asking, waited])
      clearTimeout(timer)
    }
    return known
  }

  private async ask(root: string, known: Known): Promise<void> {
    try {
      known.sessions = await codexProjectSessions(this.options.history, await this.options.roots(root), this.options.platform)
      known.available = true
      known.failure = undefined
    } catch (error) {
      // The list stays as it was: a Codex that did not answer once removes no Session from the Canvas.
      known.available = false
      const reason = error instanceof Error ? error.message : String(error)
      if (known.failure !== reason) this.log(`[codex] could not list the Codex Sessions of ${root}`, error)
      known.failure = reason
    }
  }
}

/** What the `claudeHome` handlers and the rule of Resume use of the Codex Sessions. */
export type CodexSessions = Pick<CodexSessionsOnCanvas, 'sessions' | 'transcript' | 'cached'>

/** For a caller without Codex (tests of the Claude part): no Sessions, nothing to poll. */
export const NO_CODEX_SESSIONS: CodexSessions = {
  sessions: () => Promise.resolve({ sessions: [], available: false }),
  transcript: () => Promise.resolve(null),
  cached: () => [],
}

let app: CodexSessionsOnCanvas | undefined

/**
 * The app's Codex Sessions, one for the `claudeHome` handlers and the rule of Resume
 * (src/main/agent/app-node-sessions.ts), so both see one answer of Codex. `roots` lists a Project's root
 * and worktrees; the first caller's is kept.
 */
export function appCodexSessions(roots: (root: string) => Promise<readonly string[]>): CodexSessionsOnCanvas {
  app ??= new CodexSessionsOnCanvas({ history: codexHistory, roots, present: () => existsSync(codexHomeOf()) })
  return app
}
