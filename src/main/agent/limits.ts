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
//
// Next to Claude's state the tracker keeps the windows of the other Vendors (Codex, worfy-multi-vendor
// ticket 21), as the neutral Limit windows their drivers read, in memory only: limits.json keeps
// Claude's form (spec, decision 3 of the order), and the poll at the start brings them back. Two
// sources write them: the background poll (limits-usage.ts) and every `limits` event of a Codex
// Session (src/main/vendors/codex/session.ts, ticket 26). view() is what the Limits panel draws.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { emptyLimits, limitStatusOf, limitUpdatesFromSdk, limitUpdatesFromStatusline, limitWindowStateSchema, limitsStateSchema, mergeLimits, type LimitUpdate, type LimitWindow, type LimitsState, type LimitsView } from '../../shared/agent/limits'
import { observeMessages } from '../mcp/canvas-server'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { dataRoot } from '../storage/paths'
import { namesTheFolder, watchWithNode } from '../watch-gone'
import type { AgentEvent } from '../../shared/agent/events'
import type { EventSink, QueryFactory } from './session'

export const LIMITS_FILE = 'limits.json'
/** Written by scripts/statusline-bridge.mjs: the status line's `rate_limits` object as is. */
export const STATUSLINE_FILE = 'statusline-limits.json'

/**
 * limits.json as this build reads and writes it: the stored state, loose at both levels (worfy-polish
 * ticket 63). The file may come from a newer build (Roll back, ADR-0089, runs the previous copy on the
 * same data folder): a key this build does not know stays in the state, so the next write keeps it, and
 * a window this build replaces drops the keys of its old value. What goes over IPC is still parsed with
 * the strict limitsStateSchema, so those keys never reach the renderer.
 */
const limitsFileSchema = limitsStateSchema.extend({ windows: z.record(z.string(), limitWindowStateSchema.loose()) }).loose()

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
  /**
   * The watch of the system; replaced in tests. null: no watch, the slow poll alone — the app's
   * choice on Windows (appLimits, worfy-polish ticket 47).
   */
  watch?: WatchFolder | null
  /** Whether the name an event carries is a full path; path.win32's rule in tests on any system. */
  isAbsolute?: (name: string) => boolean
}

export type LimitsListener = (state: LimitsState) => void
/**
 * Told the windows of a Vendor other than Claude whenever they are recorded: [] when it is signed in
 * and its plan reports none, null once it is signed out.
 */
export type VendorWindowsListener = (vendor: string, windows: readonly LimitWindow[] | null) => void

export class LimitsTracker {
  private state: LimitsState
  private readonly listeners = new Set<LimitsListener>()
  /** The windows of the Vendors other than Claude, by Vendor, as last read. */
  private readonly vendorWindows = new Map<string, readonly LimitWindow[]>()
  private readonly vendorListeners = new Set<VendorWindowsListener>()
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
    this.state = readJsonFile(this.file, limitsFileSchema) ?? emptyLimits()
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
      writeJsonFile(this.file, limitsFileSchema, next)
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

  /**
   * The windows of a Vendor other than Claude as last read: [] when it is signed in and its plan
   * reports none, null when it is signed out or was not read yet (the Limits panel then has no
   * section for it).
   */
  windowsOf(vendor: string): readonly LimitWindow[] | null {
    return this.vendorWindows.get(vendor) ?? null
  }

  /** What the Limits panel draws: Claude's state, and the windows of every other Vendor signed in to. */
  view(): LimitsView {
    return { claude: this.state, vendors: Object.fromEntries([...this.vendorWindows].map(([vendor, windows]) => [vendor, [...windows]])) }
  }

  /** Calls `listener` with every recording of a Vendor's windows; returns the function that unsubscribes. */
  subscribeWindows(listener: VendorWindowsListener): () => void {
    this.vendorListeners.add(listener)
    return () => this.vendorListeners.delete(listener)
  }

  /**
   * Replaces the windows of a Vendor other than Claude (Claude's go through record()) with the full
   * list a read of its driver gave; null forgets them: the Vendor is signed out. Forgetting a Vendor
   * with nothing known tells no one.
   */
  setWindows(vendor: string, windows: readonly LimitWindow[] | null): void {
    if (windows === null && !this.vendorWindows.has(vendor)) return
    if (windows === null) this.vendorWindows.delete(vendor)
    else this.vendorWindows.set(vendor, windows)
    for (const listener of this.vendorListeners) {
      try {
        listener(vendor, windows)
      } catch (error) {
        console.warn('[limits] a subscriber of the Vendor windows threw', error)
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
   * file may not exist yet. A slow poll of the file's time backs the watch up; with the option
   * `watch` null the poll is all there is.
   */
  watchStatusline(): void {
    if (this.watcher !== null || this.poller !== null) return
    if (!existsSync(this.options.dataDir)) mkdirSync(this.options.dataDir, { recursive: true })
    this.readStatusline()
    const watchFolder = this.options.watch === undefined ? watchFolderWithNode : this.options.watch
    if (watchFolder !== null) this.watchDataFolder(watchFolder)
    // The poll compares with the file as last read above, not with a first look of its own:
    // fs.watchFile takes that look on the thread pool after this method returns, so a file written
    // in between was never reported by it, and FSEvents may miss such a write too.
    this.poller = setInterval(() => this.pollStatusline(), STATUSLINE_POLL_MS)
    this.poller.unref()
  }

  private watchDataFolder(watchFolder: WatchFolder): void {
    try {
      const { dataDir } = this.options
      const full = this.options.isAbsolute ?? isAbsolute
      const mine: { handle: { close: () => void } | null } = { handle: null }
      mine.handle = watchFolder(
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

/** The Limits status one Session was last told (its `limits` and `limit_reached` events), in Claude's SDK words. */
export interface SessionLimitsStatus {
  /** `allowed`, `allowed_warning` or `rejected`. */
  status: string
  /** The window the status is about (`five_hour`, `seven_day`, …); null when not reported. */
  window: string | null
  /** The window's reset time as reported (Unix seconds); null when not reported. */
  resetsAt: number | null
  /**
   * A `limit_reached` with `reason: 'quota'` (Codex, worfy-multi-vendor ticket 38): refused without a
   * window that resets, so waiting does not help. Absent otherwise, as for every refusal of Claude.
   */
  quota?: true
}

/**
 * Calls `listener` whenever the Limits status of one Session changes, as the registry sends its
 * events (`observe`, SessionRegistry.observe), for the Session that `isSession` accepts (a
 * Session's id changes once Claude Code names it, so the test is the caller's). A `limit_reached`
 * event is `rejected` for its window and reset time; a `limits` event is the status it carries, as
 * the Vendor worded it, with the window and reset time of that status (not of a window), and
 * nothing when it carries none; a `limit_reached` of a quota says so (`quota`). An event that repeats
 * the last status, window, reset time and quota is not
 * reported again: so a refusal, which comes as `limits` and then as `limit_reached` with the same
 * window and time, is reported once. Answers the unsubscribe.
 */
export function observeSessionLimits(
  observe: (sink: EventSink) => () => void,
  isSession: (sessionId: string) => boolean,
  listener: (status: SessionLimitsStatus) => void,
): () => void {
  let last: SessionLimitsStatus | null = null
  return observe((sessionId: string, event: AgentEvent) => {
    if ((event.type !== 'limits' && event.type !== 'limit_reached') || !isSession(sessionId)) return
    const next = sessionLimitsStatusOf(event)
    if (next === null) return
    if (last !== null && last.status === next.status && last.window === next.window && last.resetsAt === next.resetsAt && last.quota === next.quota) return
    last = next
    listener(next)
  })
}

function sessionLimitsStatusOf(event: Extract<AgentEvent, { type: 'limits' | 'limit_reached' }>): SessionLimitsStatus | null {
  if (event.type === 'limit_reached') return { status: limitStatusOf('reached'), window: event.windowId, resetsAt: event.resetsAt, ...(event.reason === 'quota' ? { quota: true as const } : {}) }
  const told = event.status
  return told === null ? null : { status: told.text, window: told.windowId, resetsAt: told.resetsAt }
}

let appTracker: LimitsTracker | null = null

/**
 * How the app follows the status line file on `platform`: on Windows by the slow poll alone, no
 * watch of the data folder (worfy-polish ticket 47). That folder is also Chromium's profile
 * (userData), and Chromium writes there all the time; for each event of a folder watch libuv calls
 * GetLongPathNameW twice on the main thread before the callback (src/win/fs-event.c). On the GitHub
 * Windows runner the main thread stood 1–2 s at a time in Node's loop with next to no CPU, and the
 * first JavaScript to run after it was each time the callback of this watch; meanwhile the app
 * answered nothing, not even the page, whose DevTools messages that thread passes on. The bridge
 * writes the file at most as often as the status line runs, so a second of delay costs nothing.
 */
export function statuslineWatchFor(platform: NodeJS.Platform): WatchFolder | null | undefined {
  return platform === 'win32' ? null : undefined
}

/** The app's tracker over WORFY_DATA_DIR, made on first use; it starts following the status line file. */
export function appLimits(): LimitsTracker {
  if (appTracker === null) {
    appTracker = new LimitsTracker({ dataDir: dataRoot(), watch: statuslineWatchFor(process.platform) })
    appTracker.watchStatusline()
  }
  return appTracker
}
