// Limits in main: the last known state of the subscription windows, shared by every Project
// (ADR-0005: <WORFY_DATA_DIR>/limits.json).
//
// Two sources feed it (src/shared/agent/limits.ts reads both):
// - every SDK message of every Session: observe() wraps the app's query factory, so each
//   `rate_limit_event` a Session receives is recorded, whichever window started the Session;
// - <WORFY_DATA_DIR>/statusline-limits.json, which the status line bridge writes from the user's
//   status line command. The bridge is scripts/statusline-bridge.mjs (Node, worfy-windows ticket
//   08) behind its entry scripts/statusline-bridge.sh, both shipped in the .app in
//   Contents/Resources; `statusLine` in ~/.claude/settings.json points at the entry once the user
//   agrees to that row of the Harness migration form (ADR-0040, ADR-0047).
//   This module only reads the file.
// A third, active source asks Claude Code for the usage every 30 minutes while these two bring
// nothing fresh: src/main/agent/limits-usage.ts, which records through record().
//
// A change is written to limits.json and sent to the subscribers (src/main/ipc/limits.ts sends it
// to the windows). This module writes nowhere else: not to ~/.claude, not to a Project's repository.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { emptyLimits, limitUpdatesFromSdk, limitUpdatesFromStatusline, limitsStateSchema, mergeLimits, type LimitUpdate, type LimitsState } from '../../shared/agent/limits'
import { observeMessages } from '../mcp/canvas-server'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { dataRoot } from '../storage/paths'
import { namesTheFolder, watchWithNode } from '../watch-gone'
import type { AgentEvent } from '../../shared/agent/events'
import type { EventSink, QueryFactory } from './session'

export const LIMITS_FILE = 'limits.json'
/** Written by scripts/statusline-bridge.mjs: the status line's `rate_limits` object as is. */
export const STATUSLINE_FILE = 'statusline-limits.json'

/** How long to wait after a change of the status line file before reading it. */
const STATUSLINE_DEBOUNCE_MS = 50
/**
 * The status line file is also polled this often: FSEvents may drop the events of a change made
 * right after the watch starts, and a missed change would leave the bars stale until the next one.
 */
const STATUSLINE_POLL_MS = 1000

/** A watch of one folder, not of what is below it; `close` ends it. */
export type WatchFolder = (dir: string, onEvent: (name: string | null) => void, onError: (error: unknown) => void) => { close: () => void }

const watchFolderWithNode: WatchFolder = (dir, onEvent, onError) => watchWithNode(dir, false, onEvent, onError)

export interface LimitsTrackerOptions {
  /** WORFY_DATA_DIR. */
  dataDir: string
  /** Clock in milliseconds; tests pass a fixed one. */
  now?: () => number
  /** The watch of the system; replaced in tests. */
  watch?: WatchFolder
  /** Whether the name an event carries is a full path; path.win32's rule in tests on any system. */
  isAbsolute?: (name: string) => boolean
}

export type LimitsListener = (state: LimitsState) => void

export class LimitsTracker {
  private state: LimitsState
  private readonly listeners = new Set<LimitsListener>()
  private readonly file: string
  private readonly statuslineFile: string
  private readonly now: () => number
  private watcher: { close: () => void } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private poller: ReturnType<typeof setInterval> | null = null
  /** The status line file's modification time when it was last read; the poll compares with it. */
  private statuslineModified: number | null = null

  constructor(private readonly options: LimitsTrackerOptions) {
    this.file = join(options.dataDir, LIMITS_FILE)
    this.statuslineFile = join(options.dataDir, STATUSLINE_FILE)
    this.now = options.now ?? Date.now
    // An unreadable limits.json is set aside by readJsonFile; the Limits then start empty.
    this.state = readJsonFile(this.file, limitsStateSchema) ?? emptyLimits()
  }

  snapshot(): LimitsState {
    return this.state
  }

  /** Calls `listener` with every new state; returns the function that unsubscribes. */
  subscribe(listener: LimitsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Applies updates; a state that changed is saved and sent to the subscribers. */
  record(updates: readonly LimitUpdate[]): void {
    const next = mergeLimits(this.state, updates)
    if (next === this.state) return
    this.state = next
    try {
      writeJsonFile(this.file, limitsStateSchema, next)
    } catch (error) {
      // The Limits on screen stay right; only the copy for the next start is lost.
      console.warn(`[limits] could not save ${this.file}`, error)
    }
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch (error) {
        console.warn('[limits] a subscriber threw', error)
      }
    }
  }

  /** Records the windows of one SDK message (nothing for messages other than rate_limit_event). */
  recordSdkMessage(message: unknown): void {
    this.record(limitUpdatesFromSdk(message, this.now()))
  }

  /**
   * The same factory, whose queries report every message they yield to this tracker. A failure to
   * record is logged here, under the Limits' own label, and never reaches the Session.
   */
  observe(factory: QueryFactory): QueryFactory {
    return async (request) =>
      observeMessages(await factory(request), (message) => {
        try {
          this.recordSdkMessage(message)
        } catch (error) {
          console.warn('[limits] could not record an SDK message', error)
        }
      })
  }

  /**
   * Reads statusline-limits.json once. Its time is the file's modification time, so a file older
   * than what is known (written before the last SDK event) changes nothing. A missing or broken
   * file is skipped: the bridge rewrites it on the next status line refresh.
   */
  readStatusline(): void {
    let text: string
    let modified: number
    try {
      modified = statSync(this.statuslineFile).mtimeMs
      text = readFileSync(this.statuslineFile, 'utf8')
    } catch {
      return
    }
    this.statuslineModified = modified
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return
    }
    this.record(limitUpdatesFromStatusline(value, Math.round(modified)))
  }

  /**
   * Reads the status line file now and again whenever it changes, until stop(). The data
   * directory is watched rather than the file: the bridge replaces the file by a rename, and the
   * file may not exist yet. A slow poll of the file's time backs the watch up.
   */
  watchStatusline(): void {
    if (this.watcher !== null || this.poller !== null) return
    if (!existsSync(this.options.dataDir)) mkdirSync(this.options.dataDir, { recursive: true })
    this.readStatusline()
    try {
      const { dataDir } = this.options
      const full = this.options.isAbsolute ?? isAbsolute
      const mine: { handle: { close: () => void } | null } = { handle: null }
      mine.handle = (this.options.watch ?? watchFolderWithNode)(
        dataDir,
        (name) => {
          // A watch that was closed may still have events on the way.
          if (this.watcher !== mine.handle) return
          // A name in the folder is not a full path: this one names the folder itself, which is
          // gone. Windows then neither closes the watch nor fails it — it sends such events without
          // end, a whole processor core (worfy-windows ticket 27, watch-gone.ts). The watch is
          // closed at the first of them; the slow poll below still looks at the file.
          if (namesTheFolder(name, full)) {
            mine.handle?.close()
            this.watcher = null
            console.warn(`[limits] the data folder ${dataDir} is gone: the status line file is no longer watched, only looked at every ${STATUSLINE_POLL_MS} ms`)
            return
          }
          if (name === null || name === STATUSLINE_FILE) this.scheduleRead()
        },
        (error) => console.warn('[limits] watching the status line file failed', error),
      )
      this.watcher = mine.handle
    } catch (error) {
      console.warn('[limits] cannot watch the status line file', error)
    }
    // The poll compares with the file as last read above, not with a first look of its own:
    // fs.watchFile takes that look on the thread pool after this method returns, so a file written
    // in between was never reported by it, and FSEvents may miss such a write too.
    this.poller = setInterval(() => this.pollStatusline(), STATUSLINE_POLL_MS)
    this.poller.unref()
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.poller !== null) clearInterval(this.poller)
    this.poller = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private pollStatusline(): void {
    let modified: number
    try {
      modified = statSync(this.statuslineFile).mtimeMs
    } catch {
      return
    }
    if (modified !== this.statuslineModified) this.scheduleRead()
  }

  private scheduleRead(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.readStatusline()
    }, STATUSLINE_DEBOUNCE_MS)
  }
}

/** The Limits status one Session was last told (its `rate_limit` events). */
export interface SessionLimitsStatus {
  /** `allowed`, `allowed_warning` or `rejected`. */
  status: string
  /** The window the status is about (`five_hour`, `seven_day`, …); null when not reported. */
  window: string | null
  /** The window's reset time as reported (Unix seconds); null when not reported. */
  resetsAt: number | null
}

/**
 * Calls `listener` whenever the Limits status of one Session changes: its `rate_limit` events, as
 * the registry sends them (`observe`, SessionRegistry.observe), for the Session that `isSession`
 * accepts (a Session's id changes once Claude Code names it, so the test is the caller's). An event
 * that repeats the last status, window and reset time is not reported again. Answers the unsubscribe.
 */
export function observeSessionLimits(
  observe: (sink: EventSink) => () => void,
  isSession: (sessionId: string) => boolean,
  listener: (status: SessionLimitsStatus) => void,
): () => void {
  let last: SessionLimitsStatus | null = null
  return observe((sessionId: string, event: AgentEvent) => {
    if (event.type !== 'rate_limit' || !isSession(sessionId)) return
    const next: SessionLimitsStatus = { status: event.status, window: event.rateLimitType, resetsAt: event.resetsAt }
    if (last !== null && last.status === next.status && last.window === next.window && last.resetsAt === next.resetsAt) return
    last = next
    listener(next)
  })
}

let appTracker: LimitsTracker | null = null

/** The app's tracker over WORFY_DATA_DIR, made on first use; it starts watching the status line file. */
export function appLimits(): LimitsTracker {
  if (appTracker === null) {
    appTracker = new LimitsTracker({ dataDir: dataRoot() })
    appTracker.watchStatusline()
  }
  return appTracker
}
