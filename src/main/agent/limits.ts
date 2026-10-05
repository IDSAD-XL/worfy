// Limits in main: the last known state of the subscription windows, shared by every Project
// (ADR-0005: <WORFY_DATA_DIR>/limits.json).
//
// Two sources feed it (src/shared/agent/limits.ts reads both):
// - every SDK message of every Session: observe() wraps the app's query factory, so each
//   `rate_limit_event` a Session receives is recorded, whichever window started the Session;
// - <WORFY_DATA_DIR>/statusline-limits.json, which scripts/statusline-bridge.sh writes from the
//   user's own status line command. worfy only reads this file; the user installs the bridge.
//
// A change is written to limits.json and sent to the subscribers (src/main/ipc/limits.ts sends it
// to the windows). worfy writes nowhere else: not to ~/.claude, not to a Project's repository.
import { existsSync, mkdirSync, readFileSync, statSync, unwatchFile, watch, watchFile, type FSWatcher, type Stats } from 'node:fs'
import { join } from 'node:path'
import { emptyLimits, limitUpdatesFromSdk, limitUpdatesFromStatusline, limitsStateSchema, mergeLimits, type LimitUpdate, type LimitsState } from '../../shared/agent/limits'
import { observeMessages } from '../mcp/canvas-server'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { dataRoot } from '../storage/paths'
import type { QueryFactory } from './session'

export const LIMITS_FILE = 'limits.json'
/** Written by scripts/statusline-bridge.sh: the status line's `rate_limits` object as is. */
export const STATUSLINE_FILE = 'statusline-limits.json'

/** How long to wait after a change of the status line file before reading it. */
const STATUSLINE_DEBOUNCE_MS = 50
/**
 * The status line file is also polled this often: FSEvents may drop the events of a change made
 * right after the watch starts, and a missed change would leave the bars stale until the next one.
 */
const STATUSLINE_POLL_MS = 1000

export interface LimitsTrackerOptions {
  /** WORFY_DATA_DIR. */
  dataDir: string
  /** Clock in milliseconds; tests pass a fixed one. */
  now?: () => number
}

export type LimitsListener = (state: LimitsState) => void

export class LimitsTracker {
  private state: LimitsState
  private readonly listeners = new Set<LimitsListener>()
  private readonly file: string
  private readonly statuslineFile: string
  private readonly now: () => number
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private poller: ((current: Stats, previous: Stats) => void) | null = null

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
      this.watcher = watch(this.options.dataDir, (_event, name) => {
        if (name === null || name === STATUSLINE_FILE) this.scheduleRead()
      })
      this.watcher.on('error', (error) => console.warn('[limits] watching the status line file failed', error))
    } catch (error) {
      console.warn('[limits] cannot watch the status line file', error)
    }
    this.poller = (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs) this.scheduleRead()
    }
    watchFile(this.statuslineFile, { interval: STATUSLINE_POLL_MS, persistent: false }, this.poller)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.poller !== null) unwatchFile(this.statuslineFile, this.poller)
    this.poller = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private scheduleRead(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.readStatusline()
    }, STATUSLINE_DEBOUNCE_MS)
  }
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
