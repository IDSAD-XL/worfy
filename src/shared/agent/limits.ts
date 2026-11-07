// Limits: how much of the Claude subscription windows (5 hours, 7 days) is used, and when each
// window resets. Three sources feed them:
//
// - the Agent SDK's `rate_limit_event` (SDKRateLimitInfo). Ticket 06 saw it once per Session,
//   before the first request, with `rate_limit_info.{status, rateLimitType, resetsAt}` and an
//   undeclared `unifiedWindows.{five_hour, seven_day}.{utilization, resetsAt}`; `utilization` and
//   `resetsAt` may be missing;
// - the `rate_limits` object Claude Code passes to the status line command (2.1.284:
//   `{five_hour: {used_percentage, resets_at}, seven_day: {...}}`), which
//   scripts/statusline-bridge.mjs copies into <WORFY_DATA_DIR>/statusline-limits.json;
// - the answer of the SDK's usage request (src/main/agent/limits-usage.ts), which main asks at most
//   every 30 minutes when the two passive sources above have nothing fresh:
//   `rate_limits.{five_hour, seven_day}.{utilization 0..100, resets_at ISO 8601}`.
//
// All are read leniently into per-window updates; a newer update replaces the older one of the
// same window, except that an update without a reset time keeps the one already known while it is
// still ahead, and one without a status keeps the known status while the window is the same
// (mergeLimits, the only place one update of a window replaces another). limitBars()
// turns the merged state into what the toolbar and the Session rail draw. Everything here is pure:
// main keeps the state, the renderer draws it.
import { z } from 'zod'
import { VENDOR_IDS, VENDOR_LABELS, type VendorId } from '../vendors/vendor'

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
  /**
   * Where the value came from: `sdk`, `statusline` or `usage`. Any string reads: a source this build
   * does not know (one a newer build added) is kept as it is instead of setting the whole limits.json
   * aside, which would lose a `rejected` status and the reset times Autopilot and Terminal AI wait by,
   * and the next write leaves it for the newer build. This build counts it as a passive source.
   */
  source: z.string(),
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
// The neutral view (ADR-0094, worfy-multi-vendor ticket 11): one Vendor's windows as a list, in a
// form a Vendor without Claude's two named windows fits too. The stored state above stays Claude's
// own; limitWindows() reads it into this view, and the `limits` event of a Session carries it.

/** How full a window is in a Vendor's own words: under the limit, near it, refused; null when not said. */
export const limitStateSchema = z.enum(['ok', 'warning', 'reached'])
export type LimitState = z.infer<typeof limitStateSchema>

export const limitWindowSchema = z.object({
  /** The Vendor whose subscription the window belongs to (`claude`, `codex`). */
  vendor: z.string().min(1),
  /** The provider behind the Vendor, for a Vendor that runs models of several (ticket 10); absent otherwise. */
  provider: z.string().optional(),
  /** The Vendor's name of the window (`five_hour`, `seven_day_opus`, `primary`). */
  id: z.string(),
  /** The window's name as shown (`5-hour`, `weekly`). */
  label: z.string(),
  /** Used share of the window, 0..100 and more; null when unknown. */
  usedPercent: z.number().nullable(),
  /** The length of the window in minutes; null when unknown. */
  windowMinutes: z.number().nullable(),
  /** When the window resets, in Unix seconds; null when unknown. */
  resetsAt: z.number().nullable(),
  state: limitStateSchema.nullable(),
  /** When worfy received the value, in milliseconds since the epoch. */
  receivedAt: z.number(),
  /** Where the value came from, in the Vendor's terms (Claude: `sdk`, `statusline`, `usage`). */
  source: z.string(),
})
export type LimitWindow = z.infer<typeof limitWindowSchema>

/** Claude's SDK status of a window and the state it means; any other status says nothing. */
const STATE_OF_STATUS: Readonly<Record<string, LimitState>> = { allowed: 'ok', allowed_warning: 'warning', rejected: 'reached' }
const STATUS_OF_STATE: Readonly<Record<LimitState, string>> = { ok: 'allowed', warning: 'allowed_warning', reached: 'rejected' }

/** The state of a Claude SDK status (`allowed` → `ok`, `allowed_warning` → `warning`, `rejected` → `reached`); null for none or another. */
export function limitStateOf(status: string | null): LimitState | null {
  return status !== null && Object.hasOwn(STATE_OF_STATUS, status) ? STATE_OF_STATUS[status]! : null
}

/** The Claude SDK status a state stands for: the inverse of limitStateOf. */
export function limitStatusOf(state: LimitState): string {
  return STATUS_OF_STATE[state]
}

/** The length and the label of Claude's windows by the start of their name: `seven_day_opus` is a 7-day window. */
const CLAUDE_WINDOW_KINDS: readonly { prefix: string; minutes: number; label: string }[] = [
  { prefix: 'five_hour', minutes: 5 * 60, label: '5-hour' },
  { prefix: 'seven_day', minutes: 7 * 24 * 60, label: '7-day' },
]

/**
 * One stored Claude window in the neutral view. The length comes from the name (`five_hour`,
 * `seven_day` and the SDK's other `seven_day_*` windows) and is null for one it does not tell
 * (`overage`); the share becomes a percentage, rounded to hundredths so that 0.62 reads 62.
 */
function limitWindowOf(vendor: string, id: string, known: LimitWindowState): LimitWindow {
  const kind = CLAUDE_WINDOW_KINDS.find(({ prefix }) => id === prefix || id.startsWith(`${prefix}_`))
  const rest = kind === undefined ? id : id.slice(kind.prefix.length + 1)
  const label = kind === undefined ? id.replaceAll('_', ' ') : [kind.label, ...rest.split('_')].filter(Boolean).join(' ')
  return {
    vendor,
    id,
    label,
    usedPercent: known.utilization === null ? null : Math.round(known.utilization * 10_000) / 100,
    windowMinutes: kind?.minutes ?? null,
    resetsAt: known.resetsAt,
    state: limitStateOf(known.status),
    receivedAt: known.receivedAt,
    source: known.source,
  }
}

/**
 * The windows of `vendor` in the stored state, as the neutral view: `five_hour` and `seven_day`
 * first, in display order, then the other windows the SDK reported, in the order they came.
 */
export function limitWindows(vendor: string, state: LimitsState): LimitWindow[] {
  const ids = Object.keys(state.windows)
  const ordered = [...LIMIT_WINDOWS.filter((id) => ids.includes(id)), ...ids.filter((id) => !(LIMIT_WINDOWS as readonly string[]).includes(id))]
  return ordered.map((id) => limitWindowOf(vendor, id, state.windows[id]!))
}

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

const usageWindow = z.object({ utilization: optNum, resets_at: optStr }).nullish().catch(null)
const usageAnswer = z.object({ rate_limits: z.object({ five_hour: usageWindow, seven_day: usageWindow }).nullish().catch(null) })

/**
 * The window updates in an answer of the SDK's usage request; [] when it has no `rate_limits`
 * (an API key, Bedrock, Vertex) or is not an object. `utilization` is 0..100 and `resets_at` an
 * ISO 8601 time; one that does not parse counts as missing.
 */
export function limitUpdatesFromUsage(value: unknown, receivedAt: number): LimitUpdate[] {
  const parsed = usageAnswer.safeParse(value)
  if (!parsed.success) return []
  const limits = parsed.data.rate_limits
  if (limits === null || limits === undefined) return []
  return LIMIT_WINDOWS.flatMap((window): LimitUpdate[] => {
    const reported = limits[window]
    if (reported === null || reported === undefined) return []
    const percent = orNull(reported.utilization)
    const at = reported.resets_at === null || reported.resets_at === undefined ? Number.NaN : Date.parse(reported.resets_at)
    const resetsAt = Number.isFinite(at) ? Math.round(at / 1000) : null
    if (percent === null && resetsAt === null) return []
    return [{ window, state: clean({ utilization: percent === null ? null : percent / 100, resetsAt, status: null, receivedAt, source: 'usage' }) }]
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
 * here (worfy-daily ticket 05). An update without a status keeps the known one in the same window
 * (keepKnownStatus): the status line bridge has no status, and an SDK `allowed_warning` must not
 * vanish when the bridge writes (worfy-daily ticket 26). Returns `state` itself when nothing changed.
 */
export function mergeLimits(state: LimitsState, updates: readonly LimitUpdate[]): LimitsState {
  let windows = state.windows
  for (const update of updates) {
    const { window } = update
    const known = windows[window]
    if (known !== undefined && known.receivedAt > update.state.receivedAt) continue
    const next = keepKnownStatus(known, keepKnownReset(known, update.state))
    if (known !== undefined && sameWindow(known, next)) continue
    windows = { ...windows, [window]: next }
  }
  // The spread keeps what else the state holds: the keys of a newer build's limits.json (src/main/agent/limits.ts).
  return windows === state.windows ? state : { ...state, windows }
}

/** `next`, with the known reset time when `next` has none and the known one is still ahead of it. */
function keepKnownReset(known: LimitWindowState | undefined, next: LimitWindowState): LimitWindowState {
  if (next.resetsAt !== null || known === undefined || known.resetsAt === null) return next
  return known.resetsAt * 1000 > next.receivedAt ? { ...next, resetsAt: known.resetsAt } : next
}

/**
 * How far apart two reset times of one window may be. Both sources give the reset time in Unix
 * seconds on the hour (7-day 1791777600 from the SDK and from the status line, 2026-10-06), so one
 * window's time from the two may differ by an hour of rounding at most; the next window resets at
 * least five hours later (the shortest window), so a larger gap is always a new window.
 */
export const SAME_WINDOW_RESET_GAP_S = 60 * 60

/**
 * `next`, with the known status when `next` has none (the status line bridge never has one, the
 * SDK reports it for one window per event) and it is still the same window: the known reset time
 * is ahead of `next` and `next`'s reset time is within SAME_WINDOW_RESET_GAP_S of it. Without a
 * known reset time there is nothing to tell a new window by, and the status is dropped.
 */
function keepKnownStatus(known: LimitWindowState | undefined, next: LimitWindowState): LimitWindowState {
  if (next.status !== null || known === undefined || known.status === null) return next
  if (known.resetsAt === null || next.resetsAt === null || known.resetsAt * 1000 <= next.receivedAt) return next
  return Math.abs(next.resetsAt - known.resetsAt) <= SAME_WINDOW_RESET_GAP_S ? { ...next, status: known.status } : next
}

function sameWindow(a: LimitWindowState, b: LimitWindowState): boolean {
  return a.utilization === b.utilization && a.resetsAt === b.resetsAt && a.status === b.status && a.receivedAt === b.receivedAt && a.source === b.source
}

// ---------------------------------------------------------------------------------------------
// Display

/** Data older than this is drawn dimmed, with "<value> · as of <time>" as the bar's tooltip. */
export const STALE_AFTER_MS = 60 * 60 * 1000
/** Shares from which a bar takes the working and the blocked colour. */
export const WORKING_FROM = 0.6
export const BLOCKED_FROM = 0.85

export type LimitLevel = 'normal' | 'working' | 'blocked'

export interface LimitBar {
  /** The window's id: Claude's `five_hour`, `seven_day`; another Vendor's own (`primary`). */
  window: string
  label: string
  /** Rounded used share, 0..100 and more; null when the source gave no share. */
  percent: number | null
  /** `62%`, or the status in words when there is no share, or `no data`. */
  value: string
  /** `resets 14:20` (5-hour) or `resets Thu 09:00` (7-day); null when unknown. */
  resets: string | null
  /** `as of 13:05` when the data is older than an hour (the bar is dimmed, this ends its tooltip); null when fresh. */
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
    return {
      window,
      label,
      percent,
      value: valueOf(percent, known.status),
      resets: resetsLine(known.resetsAt, window === 'seven_day', timeZone),
      asOf: asOfLine(known.receivedAt, now, timeZone),
      level: levelOf(known.utilization, known.status),
    }
  })
}

/** `62%`, or the status in words when there is no share, or `unknown`. */
function valueOf(percent: number | null, status: string | null): string {
  if (percent !== null) return `${percent}%`
  return status === null ? 'unknown' : (STATUS_WORDS[status] ?? status)
}

/** `resets 14:20`, or `resets Thu 09:00` `withWeekday`; null when the reset time is unknown. */
function resetsLine(resetsAt: number | null, withWeekday: boolean, timeZone: string | undefined): string | null {
  if (resetsAt === null) return null
  const at = resetsAt * 1000
  return withWeekday ? `resets ${weekday(at, timeZone)} ${clock(at, timeZone)}` : `resets ${clock(at, timeZone)}`
}

/** `as of 13:05` (with the weekday on another day) when the data is older than STALE_AFTER_MS; null when fresh. */
function asOfLine(receivedAt: number, now: number, timeZone: string | undefined): string | null {
  if (now - receivedAt <= STALE_AFTER_MS) return null
  const sameDay = day(receivedAt, timeZone) === day(now, timeZone)
  return `as of ${sameDay ? '' : `${weekday(receivedAt, timeZone)} `}${clock(receivedAt, timeZone)}`
}

/** A window longer than a day shows the weekday of its reset, as Claude's 7-day one does. */
const DAY_MINUTES = 24 * 60

/**
 * The bars of a Vendor's windows in the neutral view (another Vendor than Claude: Codex), shortest
 * window first, a window of unknown length last; each labelled with the window's own `label`. The
 * colour thresholds are Claude's (WORKING_FROM, BLOCKED_FROM), and a window in the state `reached`
 * is drawn blocked whatever its share.
 */
export function vendorLimitBars(windows: readonly LimitWindow[], now: number, options: DisplayOptions = {}): LimitBar[] {
  const { timeZone } = options
  const length = (window: LimitWindow): number => window.windowMinutes ?? Number.MAX_VALUE
  return [...windows]
    .sort((a, b) => length(a) - length(b))
    .map((window): LimitBar => {
      const status = window.state === null ? null : limitStatusOf(window.state)
      const percent = window.usedPercent === null ? null : Math.round(window.usedPercent)
      return {
        window: window.id,
        label: window.label,
        percent,
        value: valueOf(percent, status),
        resets: resetsLine(window.resetsAt, window.windowMinutes === null || window.windowMinutes > DAY_MINUTES, timeZone),
        asOf: asOfLine(window.receivedAt, now, timeZone),
        level: levelOf(window.usedPercent === null ? null : window.usedPercent / 100, status),
      }
    })
}

/**
 * What the Limits panel draws (main sends it, src/shared/ipc/limits.ts): Claude's stored state, and
 * the windows of each other Vendor the user is signed in to. A Vendor that is not a key of `vendors`
 * is signed out, or was never read, and has no section; `[]` is a Vendor signed in whose plan reports
 * no windows.
 */
export const limitsViewSchema = z.object({
  claude: limitsStateSchema,
  vendors: z.record(z.string(), z.array(limitWindowSchema)),
})
export type LimitsView = z.infer<typeof limitsViewSchema>

export const emptyLimitsView = (): LimitsView => ({ claude: emptyLimits(), vendors: {} })

/** The Vendor whose Limits are the stored state; its section comes first. */
const CLAUDE: VendorId = 'claude'

/** The line of a section of a signed-in Vendor whose plan reports no windows. */
export const NO_LIMITS_REPORTED = 'No limits reported'

/** One Vendor's part of the Limits panel: its name, and its bars or the line said in their place. */
export interface LimitSection {
  vendor: string
  /** The Vendor's name as shown (VENDOR_LABELS); the id for a Vendor this build does not know. */
  name: string
  bars: LimitBar[]
  /** `no data yet` (Claude, nothing known) or NO_LIMITS_REPORTED in place of the bars; null when there are bars. */
  empty: string | null
}

const vendorName = (vendor: string): string => (Object.hasOwn(VENDOR_LABELS, vendor) ? VENDOR_LABELS[vendor as VendorId] : vendor)

/** The order of the sections after Claude's: the Vendors in VENDOR_IDS order, then any other by id. */
const vendorRank = (vendor: string): number => {
  const known = (VENDOR_IDS as readonly string[]).indexOf(vendor)
  return known === -1 ? VENDOR_IDS.length : known
}

/**
 * The sections to draw at `now`: Claude's first, then one per other Vendor signed in to. Null when
 * nothing is known about Claude's windows and no other Vendor is signed in ("Limits: no data yet").
 */
export function limitSections(view: LimitsView, now: number, options: DisplayOptions = {}): LimitSection[] | null {
  const claude = limitBars(view.claude, now, options)
  const others = Object.keys(view.vendors)
    .filter((vendor) => vendor !== CLAUDE)
    .sort((a, b) => vendorRank(a) - vendorRank(b) || a.localeCompare(b))
  if (claude === null && others.length === 0) return null
  return [
    { vendor: CLAUDE, name: vendorName(CLAUDE), bars: claude ?? [], empty: claude === null ? 'no data yet' : null },
    ...others.map((vendor): LimitSection => {
      const bars = vendorLimitBars(view.vendors[vendor]!, now, options)
      return { vendor, name: vendorName(vendor), bars, empty: bars.length === 0 ? NO_LIMITS_REPORTED : null }
    }),
  ]
}
