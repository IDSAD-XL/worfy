// The Run mode and the Start window (worfy-resource-planner ticket 04, ADR-0093 point 1). A Run of
// Autopilot goes in one of three modes, which act only at the boundary of a Wave:
// - `fastest` — the next Wave goes at once, with no budget and no window;
// - `budget-aware` — the daily budget of the Limits with the reserve (src/shared/autopilot/budget.ts);
// - `start-window` — new Waves start only inside the Start window; the budget too, when it is on.
// The Start window is two whole hours of the local wall clock, `from` and `to`, never the same; a
// window whose `to` is not after its `from` goes across midnight (23:00–07:00, the default). The
// moments are found through setHours, as localDayStart of budget.ts finds the day: on a day the clocks
// change, the window still starts and ends at its hours by the wall clock, so it lasts an hour less
// or more. Settings → Autopilot keeps the default mode and the window (`autopilotRun`,
// src/shared/settings/app-settings.ts).
//
// At the boundary of a Wave (worfy-resource-planner ticket 05, ADR-0093 points 2–3) windowDecision
// says whether the Start window lets the next Wave go: outside the window it waits for the next
// start; inside, a Wave whose p90 of duration (wave-duration.ts) would end after the window's end
// waits too; without enough samples the Wave goes unchecked. A Wave that started inside the window
// is never stopped at its end. The Run asks again after every wait, so an edge the clocks skipped
// (a wake-up that lands outside the window) only makes it wait once more.

/** The modes of a Run, in the order Settings and the start dialog offer them. */
export const RUN_MODES = ['fastest', 'budget-aware', 'start-window'] as const
export type RunMode = (typeof RUN_MODES)[number]

/** The name of each mode in the interface. */
export const RUN_MODE_LABELS: Readonly<Record<RunMode, string>> = Object.freeze({
  fastest: 'Fastest',
  'budget-aware': 'Budget-aware',
  'start-window': 'Start window',
})

/** The Start window: whole local hours 0–23; `from` ≠ `to`, and `to` before `from` goes across midnight. */
export interface StartWindow {
  from: number
  to: number
}

/** The window of a Machine whose person chose none: 23:00–07:00 local time. */
export const DEFAULT_START_WINDOW: Readonly<StartWindow> = Object.freeze({ from: 23, to: 7 })

/** An hour of the window as the interface shows it: 7 → `07:00`. */
export function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** Whether `now` is inside the window: from its start, included, up to its end, not included. */
export function inWindow(now: number, window: StartWindow): boolean {
  const hour = new Date(now).getHours()
  if (window.from < window.to) return window.from <= hour && hour < window.to
  return hour >= window.from || hour < window.to
}

/**
 * The first moment after `now` (not at it) when the local wall clock shows `hour`:00. An hour the
 * clocks skip (03:00 the night they go forward in Kyiv) gives the moment after the jump, 04:00; an
 * hour that comes twice (03:00 the night they go back) gives its first time.
 */
function nextHour(now: number, hour: number): number {
  const day = new Date(now)
  day.setHours(hour, 0, 0, 0)
  if (day.getTime() > now) return day.getTime()
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(hour, 0, 0, 0)
  return next.getTime()
}

/**
 * The end of the window `now` is inside: 07:00 of the next morning at 23:30 for 23:00–07:00. For a
 * `now` outside the window it is the end of the next window.
 *
 * windowEnd and nextWindowStart are moments to wake at, not verdicts: on the night the clocks go
 * forward an edge in the skipped hour moves to the hour after it, so the start of 03:00–04:00 lands
 * outside its window and the end of 04:00–03:00 inside the next one. A caller that waits until one of
 * them asks inWindow again after waking.
 */
export function windowEnd(now: number, window: StartWindow): number {
  return nextHour(now, window.to)
}

/** The nearest start of the window after `now`: at 08:00 — 23:00 of that day, at 23:30 — 23:00 of the next one. */
export function nextWindowStart(now: number, window: StartWindow): number {
  return nextHour(now, window.from)
}

/** Why the Start window holds the next Wave back: the window is not open, or the Wave would end after it. */
export const WINDOW_WAIT_REASONS = ['outside', 'wave-too-long'] as const
export type WindowWaitReason = (typeof WINDOW_WAIT_REASONS)[number]

export interface WindowInput {
  window: StartWindow
  now: number
  /** The p90 of the Waves' duration in ms (waveDurationP90); null under its minimum of samples. */
  p90: number | null
}

/**
 * Whether the Start window lets the next Wave go at `now`. `go` with `unknownDuration` when it goes
 * without the check of its duration (no p90); `wait` until the next start of the window otherwise.
 * A Wave whose p90 ends exactly at the window's end still goes.
 */
export type WindowDecision = { kind: 'go'; unknownDuration: boolean } | { kind: 'wait'; reason: WindowWaitReason; until: number }

export function windowDecision({ window, now, p90 }: WindowInput): WindowDecision {
  if (!inWindow(now, window)) return { kind: 'wait', reason: 'outside', until: nextWindowStart(now, window) }
  if (p90 === null) return { kind: 'go', unknownDuration: true }
  if (now + p90 > windowEnd(now, window)) return { kind: 'wait', reason: 'wave-too-long', until: nextWindowStart(now, window) }
  return { kind: 'go', unknownDuration: false }
}

/**
 * `2 d 5 h` from a day on, `3 h 10 min` under it, `25 min` under an hour.
 *
 * shortcut: a copy of duration() of limits-estimate.ts, which worfy-resource-planner ticket 03 changes
 * while this one is written; redo once both are merged: export that one and use it here.
 */
function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes % 60} min`
  return `${minutes} min`
}

export interface WindowTextOptions {
  /** IANA time zone of the time the Run continues at; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

export type WindowWait = { reason: 'outside'; window: StartWindow; until: number } | { reason: 'wave-too-long'; window: StartWindow; until: number; wave: number; p90: number }

/**
 * Why the Run waits for the Start window, in words, for the Autopilot status and the Journal:
 * `Outside the start window 23:00–07:00: Autopilot continues at 23:00`, or `Wave 3 usually takes up
 * to 2 h 10 min and would end after 07:00: Autopilot continues at 23:00`.
 */
export function windowWaitText(wait: WindowWait, options: WindowTextOptions = {}): string {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: options.timeZone }).format(wait.until)
  const why =
    wait.reason === 'outside'
      ? `Outside the start window ${hourText(wait.window.from)}–${hourText(wait.window.to)}`
      : `Wave ${wait.wave} usually takes up to ${durationText(wait.p90)} and would end after ${hourText(wait.window.to)}`
  return `${why}: Autopilot continues at ${time}`
}

/** What the Autopilot status says while Wave `wave` runs: it went without the check of its duration. */
export const unknownDurationText = (wave: number): string => `Not enough data on Wave duration: Wave ${wave} started without the window check`
