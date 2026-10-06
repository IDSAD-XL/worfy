// Limits: how much of the Claude subscription windows (5 hours, 7 days) is used, and when each
// window resets. Two sources feed them:
//
// - the Agent SDK's `rate_limit_event` (SDKRateLimitInfo). Ticket 06 saw it once per Session,
//   before the first request, with `rate_limit_info.{status, rateLimitType, resetsAt}` and an
//   undeclared `unifiedWindows.{five_hour, seven_day}.{utilization, resetsAt}`; `utilization` and
//   `resetsAt` may be missing;
// - the `rate_limits` object Claude Code passes to the status line command (2.1.284:
//   `{five_hour: {used_percentage, resets_at}, seven_day: {...}}`), which
//   scripts/statusline-bridge.sh copies into <WORFY_DATA_DIR>/statusline-limits.json.
//
// Both are read leniently into per-window updates; a newer update replaces the older one of the
// same window, except that an update without a reset time keeps the one already known while it is
// still ahead (mergeLimits, the only place one update of a window replaces another). limitBars()
// turns the merged state into what the toolbar and the Session rail draw. Everything here is pure:
// main keeps the state, the renderer draws it.
import { z } from 'zod'

/** The windows the toolbar shows, in display order. */
export const LIMIT_WINDOWS = ['five_hour', 'seven_day'] as const
export type LimitWindowId = (typeof LIMIT_WINDOWS)[number]

export const limitWindowStateSchema = z.object({
  /** Used share of the window, 0..1; null when the source did not say. */
  utilization: z.number().nonnegative().nullable(),
  /** When the window resets, in Unix seconds; null when unknown. */
  resetsAt: z.number().nullable(),
  /** SDK status of the limit (`allowed`, `allowed_warning`, `rejected`); null when not reported for this window. */
  status: z.string().nullable(),
  /** When worfy received the value, in milliseconds since the epoch. */
  receivedAt: z.number(),
  source: z.enum(['sdk', 'statusline']),
})
export type LimitWindowState = z.infer<typeof limitWindowStateSchema>

/** The last known state of every window, by window name (`five_hour`, `seven_day`, `seven_day_opus`, …). */
export const limitsStateSchema = z.object({ windows: z.record(z.string(), limitWindowStateSchema) })
export type LimitsState = z.infer<typeof limitsStateSchema>

export interface LimitUpdate {
  window: string
  state: LimitWindowState
}

export const emptyLimits = (): LimitsState => ({ windows: {} })

// ---------------------------------------------------------------------------------------------
// Sources, read leniently: a field of the wrong type counts as missing, unknown fields are dropped.

const optNum = z.number().nullish().catch(null)
const optStr = z.string().nullish().catch(null)
const sdkWindow = z.object({ utilization: optNum, resetsAt: optNum }).nullish().catch(null)
const sdkRateLimitEvent = z.object({
  type: z.literal('rate_limit_event'),
  rate_limit_info: z.object({
    status: z.string(),
    rateLimitType: optStr,
    resetsAt: optNum,
    utilization: optNum,
    unifiedWindows: z.object({ five_hour: sdkWindow, seven_day: sdkWindow }).nullish().catch(null),
  }),
})

const orNull = <T>(value: T | null | undefined): T | null => value ?? null

/**
 * The window updates in one SDK message; [] for any other message or a rate_limit_event whose
 * shape changed. `status` belongs to the window named by `rateLimitType`; the windows reported
 * only in `unifiedWindows` get their share and reset time without a status.
 */
export function limitUpdatesFromSdk(message: unknown, receivedAt: number): LimitUpdate[] {
  const parsed = sdkRateLimitEvent.safeParse(message)
  if (!parsed.success) return []
  const info = parsed.data.rate_limit_info
  const primary = orNull(info.rateLimitType)
  const unified = info.unifiedWindows ?? {}

  const windows = new Map<string, LimitWindowState>()
  for (const window of LIMIT_WINDOWS) {
    const reported = unified[window]
    if (reported === null || reported === undefined || window === primary) continue
    windows.set(window, { utilization: orNull(reported.utilization), resetsAt: orNull(reported.resetsAt), status: null, receivedAt, source: 'sdk' })
  }
  if (primary !== null) {
    const reported = (LIMIT_WINDOWS as readonly string[]).includes(primary) ? unified[primary as LimitWindowId] : null
    windows.set(primary, {
      utilization: reported?.utilization ?? orNull(info.utilization),
      resetsAt: reported?.resetsAt ?? orNull(info.resetsAt),
      status: info.status,
      receivedAt,
      source: 'sdk',
    })
  }
  return [...windows].map(([window, state]) => ({ window, state: clean(state) }))
}

const statuslineWindow = z.object({ used_percentage: optNum, resets_at: optNum }).nullish().catch(null)
const statuslineLimits = z.object({ five_hour: statuslineWindow, seven_day: statuslineWindow })

/**
 * The window updates in the status line's `rate_limits` object (what statusline-limits.json
 * holds); [] when it is not an object. `used_percentage` is 0..100.
 */
export function limitUpdatesFromStatusline(value: unknown, receivedAt: number): LimitUpdate[] {
  const parsed = statuslineLimits.safeParse(value)
  if (!parsed.success) return []
  return LIMIT_WINDOWS.flatMap((window): LimitUpdate[] => {
    const reported = parsed.data[window]
    if (reported === null || reported === undefined) return []
    const percent = orNull(reported.used_percentage)
    const resetsAt = orNull(reported.resets_at)
    if (percent === null && resetsAt === null) return []
    return [{ window, state: clean({ utilization: percent === null ? null : percent / 100, resetsAt, status: null, receivedAt, source: 'statusline' }) }]
  })
}

/** A negative or non-finite share or time from a source counts as missing. */
function clean(state: LimitWindowState): LimitWindowState {
  const finite = (value: number | null): number | null => (value !== null && Number.isFinite(value) && value >= 0 ? value : null)
  return { ...state, utilization: finite(state.utilization), resetsAt: finite(state.resetsAt) }
}

/**
 * The state after `updates`: each one replaces what is known about its window, unless what is
 * known is newer (a status line file read late must not undo a fresher SDK event). An update
 * without a reset time keeps the known one while it is still ahead of the update's `receivedAt`:
 * a refusal (`rejected`) may come without `resetsAt`, and Autopilot then waits by the time kept
 * here (worfy-daily ticket 05). Returns `state` itself when nothing changed.
 */
export function mergeLimits(state: LimitsState, updates: readonly LimitUpdate[]): LimitsState {
  let windows = state.windows
  for (const update of updates) {
    const { window } = update
    const known = windows[window]
    if (known !== undefined && known.receivedAt > update.state.receivedAt) continue
    const next = keepKnownReset(known, update.state)
    if (known !== undefined && sameWindow(known, next)) continue
    windows = { ...windows, [window]: next }
  }
  return windows === state.windows ? state : { windows }
}

/** `next`, with the known reset time when `next` has none and the known one is still ahead of it. */
function keepKnownReset(known: LimitWindowState | undefined, next: LimitWindowState): LimitWindowState {
  if (next.resetsAt !== null || known === undefined || known.resetsAt === null) return next
  return known.resetsAt * 1000 > next.receivedAt ? { ...next, resetsAt: known.resetsAt } : next
}

function sameWindow(a: LimitWindowState, b: LimitWindowState): boolean {
  return a.utilization === b.utilization && a.resetsAt === b.resetsAt && a.status === b.status && a.receivedAt === b.receivedAt && a.source === b.source
}

// ---------------------------------------------------------------------------------------------
// Display

/** Data older than this is shown with "as of <time>". */
export const STALE_AFTER_MS = 60 * 60 * 1000
/** Shares from which a bar takes the working and the blocked colour. */
export const WORKING_FROM = 0.6
export const BLOCKED_FROM = 0.85

export type LimitLevel = 'normal' | 'working' | 'blocked'

export interface LimitBar {
  window: LimitWindowId
  label: string
  /** Rounded used share, 0..100 and more; null when the source gave no share. */
  percent: number | null
  /** `62%`, or the status in words when there is no share, or `no data`. */
  value: string
  /** `resets 14:20` (5-hour) or `resets Thu 09:00` (7-day); null when unknown. */
  resets: string | null
  /** `as of 13:05` when the data is older than an hour; null when fresh. */
  asOf: string | null
  level: LimitLevel
}

const LABELS: Record<LimitWindowId, string> = { five_hour: '5-hour', seven_day: '7-day' }

const STATUS_WORDS: Record<string, string> = { allowed: 'allowed', allowed_warning: 'near limit', rejected: 'limit reached' }

export interface DisplayOptions {
  /** IANA time zone for the times shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

function clock(ms: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(ms)
}

function weekday(ms: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(ms)
}

function day(ms: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(ms)
}

function levelOf(utilization: number | null, status: string | null): LimitLevel {
  if (status === 'rejected' || (utilization !== null && utilization >= BLOCKED_FROM)) return 'blocked'
  if (status === 'allowed_warning' || (utilization !== null && utilization >= WORKING_FROM)) return 'working'
  return 'normal'
}

/**
 * The two bars (5-hour, 7-day) to draw at `now`; null when nothing is known about either window
 * ("Limits: no data yet").
 */
export function limitBars(state: LimitsState, now: number, options: DisplayOptions = {}): LimitBar[] | null {
  const { timeZone } = options
  if (LIMIT_WINDOWS.every((window) => state.windows[window] === undefined)) return null
  return LIMIT_WINDOWS.map((window): LimitBar => {
    const label = LABELS[window]
    const known = state.windows[window]
    if (known === undefined) return { window, label, percent: null, value: 'no data', resets: null, asOf: null, level: 'normal' }

    const percent = known.utilization === null ? null : Math.round(known.utilization * 100)
    const value = percent !== null ? `${percent}%` : known.status === null ? 'unknown' : (STATUS_WORDS[known.status] ?? known.status)
    let resets: string | null = null
    if (known.resetsAt !== null) {
      const at = known.resetsAt * 1000
      resets = window === 'seven_day' ? `resets ${weekday(at, timeZone)} ${clock(at, timeZone)}` : `resets ${clock(at, timeZone)}`
    }
    let asOf: string | null = null
    if (now - known.receivedAt > STALE_AFTER_MS) {
      const sameDay = day(known.receivedAt, timeZone) === day(now, timeZone)
      asOf = `as of ${sameDay ? '' : `${weekday(known.receivedAt, timeZone)} `}${clock(known.receivedAt, timeZone)}`
    }
    return { window, label, percent, value, resets, asOf, level: levelOf(known.utilization, known.status) }
  })
}
