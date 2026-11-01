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

/** The first moment after `now` (not at it) when the local wall clock shows `hour`:00. */
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
 */
export function windowEnd(now: number, window: StartWindow): number {
  return nextHour(now, window.to)
}

/** The nearest start of the window after `now`: at 08:00 — 23:00 of that day, at 23:30 — 23:00 of the next one. */
export function nextWindowStart(now: number, window: StartWindow): number {
  return nextHour(now, window.from)
}
