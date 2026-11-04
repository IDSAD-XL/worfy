// Which Limits window the budget, the Wave estimate and the Epic forecast of an Autopilot run read
// (worfy-multi-vendor ticket 38, decision 09): those of the Vendor of the run's Orchestrator
// (`run-started.vendor`, ticket 37).
//
// - Claude, the Vendor whose Limits are the stored state (src/shared/agent/limits.ts): the budget
//   window is `seven_day`, and `five_hour` is a time window only (ADR-0093, item 5), as before.
// - Another Vendor (Codex), whose windows come as a list of LimitWindow: the budget window is the
//   longest of the windows that came (Codex Pro: one weekly window; Plus: 5 hours and weekly), and
//   every other window is a time window, as `five_hour` is for Claude. Its share is `usedPercent` /
//   100; such a Vendor gives whole percents only (ticket 03), so its estimate needs more samples
//   (VENDOR_ESTIMATE_MIN_WAVES) and its forecast says the range is wide (forecast-lines.ts).
//
// The `limits` of a Wave's journal line has the shape of its Vendor (journal.ts): Claude's
// {five_hour, seven_day}, another Vendor's {windows}. A line of the other shape, or a window of
// another Vendor, gives no number: the samples of a Claude run never mix with those of a Codex run.
// Everything here is pure.
import type { LimitsState, LimitWindow } from '../agent/limits'
import type { JournalLimits, JournalLimitWindow } from './journal'

/** The Vendor whose Limits are the stored state (LimitsState), not a list of windows. */
export const STORED_LIMITS_VENDOR = 'claude'

/** Fewer counted Waves than this give a Vendor of whole percents no Wave estimate (decision 09: "not enough data" under 5). */
export const VENDOR_ESTIMATE_MIN_WAVES = 5

/** The windows of a Vendor other than Claude now (LimitsTracker.windowsOf), for the Vendor of the run. */
export interface VendorLimits {
  vendor: string
  windows: readonly LimitWindow[]
}

/** Whether the run's Vendor reads its Limits from a list of windows (a Vendor other than Claude). */
export const listsWindows = (vendor: string | undefined): vendor is string => vendor !== undefined && vendor !== STORED_LIMITS_VENDOR

/**
 * The longest of `windows`: the greatest known length, the first of equal ones; a window of unknown
 * length only when none has a length. Null for none.
 */
export function longestWindow<T extends { windowMinutes: number | null }>(windows: readonly T[]): T | null {
  let longest: T | null = null
  for (const window of windows) {
    if (longest === null || (window.windowMinutes ?? -1) > (longest.windowMinutes ?? -1)) longest = window
  }
  return longest
}

/** A window as the budget reads it now. */
export interface BudgetWindowNow {
  /** The Vendor's name of the window (`seven_day`, `secondary`). */
  id: string
  /** The used share, 0..1 and more; null when unknown. */
  utilization: number | null
  /** When it resets, in Unix seconds; null when unknown. */
  resetsAt: number | null
  /** When worfy got the number, in milliseconds. */
  receivedAt: number
  /** Whether the Vendor said the window refuses (Claude's `rejected`, the state `reached`). */
  reached: boolean
}

/** The windows of the Limits now as the budget reads them: the budget window and the time windows. */
export interface BudgetWindows {
  /** Claude's `seven_day`; another Vendor's longest window. Null when nothing is known of it. */
  week: BudgetWindowNow | null
  /** Claude's `five_hour`; every other window of another Vendor. */
  short: BudgetWindowNow[]
}

const share = (percent: number | null): number | null => (percent === null ? null : percent / 100)

function fromList(window: LimitWindow): BudgetWindowNow {
  return { id: window.id, utilization: share(window.usedPercent), resetsAt: window.resetsAt, receivedAt: window.receivedAt, reached: window.state === 'reached' }
}

/**
 * The budget window and the time windows now: from Claude's stored state `limits`, or, when the run's
 * Vendor lists its windows (`vendor`), from those of that Vendor only.
 */
export function budgetWindows(limits: LimitsState, vendor?: VendorLimits): BudgetWindows {
  if (vendor !== undefined && listsWindows(vendor.vendor)) {
    const own = vendor.windows.filter((window) => window.vendor === vendor.vendor)
    const week = longestWindow(own)
    return { week: week === null ? null : fromList(week), short: own.filter((window) => window !== week).map(fromList) }
  }
  const claude = (id: string): BudgetWindowNow | null => {
    const known = limits.windows[id]
    return known === undefined ? null : { id, utilization: known.utilization, resetsAt: known.resetsAt, receivedAt: known.receivedAt, reached: known.status === 'rejected' }
  }
  const five = claude('five_hour')
  return { week: claude('seven_day'), short: five === null ? [] : [five] }
}

/** The budget window of a Wave's line, in the journal's terms: the share 0..1 or null, ISO times. */
export interface JournalBudgetWindow {
  id: string
  utilization: number | null
  receivedAt: string
  resetsAt: string | null
}

/**
 * The budget window of a Wave line's `limits` for the run's Vendor (`vendor`, Claude when absent):
 * Claude's `seven_day` of the {five_hour, seven_day} shape; another Vendor's longest window of the
 * {windows} shape, among the windows of that Vendor. Null without `limits`, for the other shape, or
 * when the window is not there.
 */
export function journalBudgetWindow(limits: JournalLimits | undefined, vendor: string = STORED_LIMITS_VENDOR): JournalBudgetWindow | null {
  if (limits === undefined) return null
  if (!listsWindows(vendor)) {
    if (!('seven_day' in limits) || limits.seven_day === null) return null
    return { id: 'seven_day', ...limits.seven_day }
  }
  if (!('windows' in limits)) return null
  const week = longestWindow(limits.windows.filter((window: JournalLimitWindow) => window.vendor === vendor))
  return week === null ? null : { id: week.id, utilization: share(week.usedPercent), receivedAt: week.receivedAt, resetsAt: week.resetsAt }
}
