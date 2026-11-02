// The active source of the Limits: every USAGE_REFRESH_MS main asks Claude Code for the plan's
// usage (the data behind `/usage`) and records the 5-hour and 7-day windows in the app's
// LimitsTracker, next to the two passive sources (src/main/agent/limits.ts). The ask is skipped
// while the passive sources keep the windows fresh.
//
// The ask itself is the Limits probe of the Claude driver (src/main/vendors/claude/limits.ts): a
// short-lived Claude Code process that spends no model tokens and leaves no Session behind. A missing
// method, an answer without rate limits (an API key, Bedrock, Vertex) or a failure is logged once at
// debug level and the Limits stay with the passive sources; the next try is the next tick, never a
// loop.
//
// The same refresher polls the other Vendors (worfy-multi-vendor ticket 21): Codex, through the poll of
// its driver (src/main/vendors/codex/limits.ts), at the start and every interval. The poll asks the
// windows only while signed in to Codex and answers null otherwise, and the refresher then forgets the
// Vendor's windows. Every poll is stopped by stop() through the same signal as Claude's ask, so the
// app quits without a Codex process or a request left waiting. Claude's ask is not changed by it.
import { LIMIT_WINDOWS, limitUpdatesFromUsage, type LimitUpdate, type LimitWindow, type LimitsState } from '../../shared/agent/limits'

/** How often the usage is asked, and how fresh the data must be for an ask to be skipped. */
export const USAGE_REFRESH_MS = 1_800_000

/**
 * One ask: the SDK's answer, null when there is none to give; throws on a failure. `signal` aborts
 * when the app quits: the ask then closes its process at once.
 */
export type UsageReader = (signal: AbortSignal) => Promise<unknown>

/** The part of the LimitsTracker the refresher uses. */
export interface LimitsStore {
  snapshot(): LimitsState
  record(updates: readonly LimitUpdate[]): void
  /** Replaces the windows of a Vendor other than Claude; null forgets them. */
  setWindows(vendor: string, windows: readonly LimitWindow[] | null): void
}

/**
 * A Vendor other than Claude whose Limits the refresher polls: `poll` answers its windows, null when
 * not signed in to it, and throws on a failure. `signal` aborts when the app quits.
 */
export interface VendorLimitsPoll {
  vendor: string
  poll(signal: AbortSignal): Promise<readonly LimitWindow[] | null>
}

export interface LimitsRefresherOptions {
  limits: LimitsStore
  read: UsageReader
  /** The other Vendors to poll at the start and every interval; none by default. */
  vendors?: readonly VendorLimitsPoll[]
  /** Clock in milliseconds; tests pass a fake one. */
  now?: () => number
  intervalMs?: number
  /** Where the one line about an ask with no result goes; console.debug by default. */
  log?: (message: string, error?: unknown) => void
}

/**
 * Asks the usage at start() when the shown windows are older than the interval, and then every
 * interval unless the passive sources (a Session's `rate_limit_event`, the status line file)
 * brought every shown window in the last interval. One ask at a time; stop() ends it all.
 */
export class LimitsRefresher {
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly log: (message: string, error?: unknown) => void
  private timer: ReturnType<typeof setInterval> | null = null
  /** The ask in flight, if any: a second caller waits for it instead of asking again. */
  private running: Promise<void> | null = null
  private stopped = false
  private readonly quit = new AbortController()
  /** Whether the line for "no rate limits" or for a failure was logged since the last answer. */
  private logged = { unavailable: false, failed: false }
  /** The Vendors whose poll runs now: a tick does not start a second one. */
  private readonly polling = new Set<string>()
  /** The Vendors whose last poll failed and was logged: the next failure is not logged again. */
  private readonly vendorFailed = new Set<string>()

  constructor(private readonly options: LimitsRefresherOptions) {
    this.now = options.now ?? Date.now
    this.intervalMs = options.intervalMs ?? USAGE_REFRESH_MS
    this.log = options.log ?? ((message, error) => console.debug(message, ...(error === undefined ? [] : [error])))
  }

  start(): void {
    if (this.timer !== null || this.stopped) return
    // At start any fresh data counts, the usage recorded by the last run of the app included.
    void this.check(false)
    void this.pollVendors()
    this.timer = setInterval(() => {
      void this.check(true)
      void this.pollVendors()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.quit.abort()
  }

  /**
   * One tick: asks unless an ask runs or every shown window is fresh. `passiveOnly` counts only
   * the passive sources as fresh, so the usage this refresher recorded a tick ago does not skip
   * the next ask.
   */
  async check(passiveOnly: boolean): Promise<void> {
    if (this.running !== null || this.stopped || this.fresh(passiveOnly, this.intervalMs)) return
    await this.ask()
  }

  /**
   * Asks once when a shown window is missing or older than `maxAgeMs`, whatever its source, and
   * resolves once the answer is recorded (or the ask failed: that is logged, never thrown). An ask
   * already running is waited for instead. Autopilot calls it before each Wave's line in its journal
   * (worfy-throughput ticket 40), so the line carries a number at most that old.
   */
  async refreshIfOlder(maxAgeMs: number): Promise<void> {
    if (this.running !== null) return this.running
    // A number exactly `maxAgeMs` old is not older than that: fresh within one millisecond more.
    if (this.stopped || this.fresh(false, maxAgeMs + 1)) return
    await this.ask()
  }

  /**
   * One poll of every other Vendor whose poll is not running already; resolves once each is recorded
   * or failed (that is logged, once per run of failures, never thrown).
   */
  async pollVendors(): Promise<void> {
    await Promise.all((this.options.vendors ?? []).map((source) => this.pollVendor(source)))
  }

  private async pollVendor({ vendor, poll }: VendorLimitsPoll): Promise<void> {
    if (this.stopped || this.polling.has(vendor)) return
    this.polling.add(vendor)
    try {
      const windows = await poll(this.quit.signal)
      if (this.stopped) return
      this.vendorFailed.delete(vendor)
      this.options.limits.setWindows(vendor, windows)
    } catch (error) {
      if (this.stopped || this.vendorFailed.has(vendor)) return
      this.vendorFailed.add(vendor)
      this.log(`[limits] the Limits of ${vendor} could not be read: they keep what was read last`, error)
    } finally {
      this.polling.delete(vendor)
    }
  }

  /** One ask; `running` holds it until it is over. */
  private ask(): Promise<void> {
    const ask = this.askOnce().finally(() => {
      this.running = null
    })
    this.running = ask
    return ask
  }

  private async askOnce(): Promise<void> {
    try {
      const answer = await this.options.read(this.quit.signal)
      if (this.stopped) return
      const updates = limitUpdatesFromUsage(answer, this.now())
      if (updates.length === 0) {
        if (!this.logged.unavailable) this.log('[limits] the usage request gave no rate limits (no method, an API key, Bedrock or Vertex): the Limits come from Sessions and the status line only')
        this.logged.unavailable = true
        return
      }
      this.logged = { unavailable: false, failed: false }
      this.options.limits.record(updates)
    } catch (error) {
      if (!this.logged.failed) this.log('[limits] the usage request failed: the Limits come from Sessions and the status line only', error)
      this.logged.failed = true
    }
  }

  /**
   * Whether every shown window was received less than `maxAgeMs` ago (by a passive source only, with
   * `passiveOnly`). A window known without its share (`utilization` null) is not fresh: there is no
   * number to show or to journal.
   */
  private fresh(passiveOnly: boolean, maxAgeMs: number): boolean {
    const { windows } = this.options.limits.snapshot()
    const since = this.now() - maxAgeMs
    return LIMIT_WINDOWS.every((id) => {
      const known = windows[id]
      return known !== undefined && known.utilization !== null && known.receivedAt > since && !(passiveOnly && known.source === 'usage')
    })
  }
}

/** The app's refresher once installLimitsRefresh has started it; null before, in e2e runs and under vitest. */
let appRefresher: LimitsRefresher | null = null

/**
 * The app's refresher's refreshIfOlder: one usage ask when a window is older than `maxAgeMs`.
 * Resolves at once while no refresher runs (the fake agent, vitest, before the start).
 */
export function refreshAppUsage(maxAgeMs: number): Promise<void> {
  return appRefresher === null ? Promise.resolve() : appRefresher.refreshIfOlder(maxAgeMs)
}

/**
 * Starts the app's refresher over appLimits(), for Claude and Codex; answers the function that stops it
 * (for `will-quit`). With WORFY_AGENT=fake (e2e runs) or under vitest nothing starts: no Claude Code, no
 * Codex.
 */
export async function installLimitsRefresh(env: NodeJS.ProcessEnv = process.env): Promise<() => void> {
  if (env.WORFY_AGENT === 'fake' || env.VITEST) return () => undefined
  const [{ appLimits }, { claudeUsageReader }, { CODEX_VENDOR, codexLimits }] = await Promise.all([import('./limits'), import('../vendors/claude/limits'), import('../vendors/codex/limits')])
  const codex: VendorLimitsPoll = { vendor: CODEX_VENDOR, poll: (signal) => codexLimits.poll(signal) }
  const refresher = new LimitsRefresher({ limits: appLimits(), read: await claudeUsageReader(), vendors: [codex] })
  refresher.start()
  appRefresher = refresher
  return () => {
    refresher.stop()
    if (appRefresher === refresher) appRefresher = null
  }
}
