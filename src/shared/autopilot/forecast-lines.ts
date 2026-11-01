// The words of the Epic forecast (worfy-resource-planner ticket 03, ADR-0093): the forecast line
// of the Autopilot button's tooltip, the recommendation, the Fastest warning, the Start window line,
// the mode line and the lines of the autopilot_start dialog. The texts are the spec's ("What the
// user sees"), in the form of the Wave line of worfy-throughput ticket 40 (waveEstimateLine,
// limits-estimate.ts): sentences joined by ". ", whole percents, durations by duration().
//
// K — how many of the first Waves fit before the 7-day window resets — reads the p90 edge of the
// forecast (`cumulativeHigh`), never its low edge. The share free before the reset is 1 − reserve −
// used when the budget acts in the Run (Budget-aware, or Start window with the budget on), and 1 −
// used when it does not (Fastest, Start window without the budget): such a Run stops on the Limits,
// not on the reserve. Only a fresh 7-day number (BUDGET_FRESH_MS) with a reset time ahead gives a K.
// The 5-hour window plays no part here (the spec's narrow reading of Q3, "Not decided", point 14).
// The recommendation is words only: the Run is still led by the daily budget of ticket 41.
// Everything here is pure.
import type { LimitsState, LimitWindowState } from '../agent/limits'
import { BUDGET_FRESH_MS } from './budget'
import { FORECAST_MIN_SAMPLES, type EpicForecast } from './forecast'
import { duration, usedNowText, type WeekNow } from './limits-estimate'
import { toMs } from './resume-at'
import { hourText, RUN_MODE_LABELS, type RunMode, type StartWindow } from './run-mode'
import type { WaveDuration } from './wave-duration'

/** The 7-day window when its number is fresh at `now`. */
function freshWeek(limits: LimitsState, now: number): (LimitWindowState & { utilization: number }) | null {
  const week = limits.windows.seven_day
  if (week === undefined || week.utilization === null || now - week.receivedAt > BUDGET_FRESH_MS) return null
  return { ...week, utilization: week.utilization }
}

/** The 7-day window as the "Used now" tail reads it: null unless its number is fresh. */
function weekNow(limits: LimitsState, now: number): WeekNow | null {
  const week = freshWeek(limits, now)
  return week === null ? null : { utilization: week.utilization, resetsAt: week.resetsAt === null ? null : toMs(week.resetsAt) / 1000 }
}

/**
 * A share of the week in whole millionths, so that "at most" compares what the numbers mean and not
 * their binary error: 1 − 0.15 − 0.45 is 0.39999999999999997 in floating point, and a Wave whose p90
 * is 0.4 still fits.
 */
const shareUnits = (share: number): number => Math.round(share * 1_000_000)

export interface FitInput {
  forecast: EpicForecast
  limits: LimitsState
  now: number
  /** The reserve of the week, 0..1, when the budget acts in the Run; null when it does not. */
  reserve: number | null
}

/**
 * K: the largest k whose p90 of the first k Waves is at most the share free before the 7-day reset
 * (1 − reserve − used, or 1 − used with no reserve); 0 when not even the first Wave fits. Null
 * without a fresh 7-day number with a reset time ahead, without a range, or with no Wave left.
 */
export function fitBeforeReset({ forecast, limits, now, reserve }: FitInput): number | null {
  const week = freshWeek(limits, now)
  if (week === null || week.resetsAt === null || toMs(week.resetsAt) <= now) return null
  if (forecast.cumulativeHigh === null || forecast.waves === 0) return null
  const free = shareUnits(1 - (reserve ?? 0) - week.utilization)
  return Math.max(0, forecast.cumulativeHigh.findLastIndex((high) => shareUnits(high) <= free))
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** The range in words: `18–31%`, `about 18%` when both edges round to one number, `less than 1%` when both are under 1 %. */
function shareText({ low, high }: { low: number; high: number }): string {
  if (high < 0.01) return 'less than 1%'
  const from = Math.round(low * 100)
  const to = Math.round(high * 100)
  return from === to ? `about ${to}%` : `${from}–${to}%`
}

export interface ForecastLineInput {
  forecast: EpicForecast
  limits: LimitsState
  now: number
}

/**
 * The forecast line, in place of the Wave line of ticket 40: "This Epic: 4 Waves, 11 Tickets left,
 * usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h"; with too few samples it says so,
 * with Tickets without a Wave it says how many are not counted, with no Wave left it says that alone.
 */
export function forecastLine({ forecast, limits, now }: ForecastLineInput): string {
  const uncounted = forecast.uncounted === 0 ? [] : [forecast.uncounted === 1 ? '1 Ticket without a Wave is not counted' : `${forecast.uncounted} Tickets without a Wave are not counted`]
  if (forecast.waves === 0) return ['This Epic: no Wave left to forecast', ...uncounted].join('. ')
  const left = `This Epic: ${count(forecast.waves, 'Wave')}, ${count(forecast.tickets, 'Ticket')} left`
  const sentences =
    forecast.range === null
      ? [left, ...uncounted, `Not enough data for a forecast: fewer than ${FORECAST_MIN_SAMPLES} past Waves with fresh Limits`]
      : [`${left}, usually ${shareText(forecast.range)} of the week`, ...uncounted]
  return [...sentences, usedNowText(weekNow(limits, now), now)].join('. ')
}

/**
 * The recommendation when the budget acts in the Run, from K (fitBeforeReset with the reserve) and
 * the Waves left W: "Recommended: 2 Waves now, the other 2 after the reset"; null without a K.
 */
export function recommendationLine(fit: number | null, waves: number): string | null {
  if (fit === null || waves === 0) return null
  if (fit >= waves) return waves === 1 ? '1 Wave fits before the reset without the reserve' : `All ${waves} Waves fit before the reset without the reserve`
  if (fit === 0) return waves === 1 ? 'Recommended: no Wave now, 1 after the reset' : `Recommended: no Wave now, all ${waves} after the reset`
  return `Recommended: ${count(fit, 'Wave')} now, the other ${waves - fit} after the reset`
}

/**
 * The warning when the budget does not act in the Run, from K (fitBeforeReset without the reserve)
 * and the Waves left W: "Only 2 of 4 Waves fit before the reset: then the run waits for the Limits";
 * null without a K or when all W fit.
 */
export function warningLine(fit: number | null, waves: number): string | null {
  if (fit === null || fit >= waves) return null
  const then = 'then the run waits for the Limits'
  if (fit === 0) return `No Wave fits before the reset: ${then}`
  return `Only ${fit} of ${waves} Waves ${fit === 1 ? 'fits' : 'fit'} before the reset: ${then}`
}

/** The Start window line: "Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min", or that the duration is not known. */
export function windowLine(window: StartWindow, wave: WaveDuration): string {
  const hours = `Start window ${hourText(window.from)}–${hourText(window.to)}`
  return wave.p90 === null ? `${hours}. Not enough data on Wave duration: every Wave may start inside the window` : `${hours}: a Wave usually takes up to ${duration(wave.p90)}`
}

/** The mode of the Run for the tooltip: "Mode: Budget-aware (Settings → Autopilot)". */
export function modeLine(mode: RunMode): string {
  return `Mode: ${RUN_MODE_LABELS[mode]} (Settings → Autopilot)`
}

export interface DialogLinesInput {
  forecast: EpicForecast
  /** The p90 of the Wave duration, waveDurationP90. */
  wave: WaveDuration
  limits: LimitsState
  now: number
  /** The reserve of the week from Settings, 0..1: Budget-aware applies it whatever the budget switch says. */
  reserve: number
  window: StartWindow
}

/**
 * The lines the autopilot_start dialog adds to its `detail`, one per mode, whichever mode is chosen
 * (the person chooses it in the same dialog): `Forecast:`, `Budget-aware:` (the recommendation),
 * `Fastest:` (the warning) and the Start window line. A line with nothing to say is left out.
 */
export function dialogLines({ forecast, wave, limits, now, reserve, window }: DialogLinesInput): string[] {
  const recommendation = recommendationLine(fitBeforeReset({ forecast, limits, now, reserve }), forecast.waves)
  const warning = warningLine(fitBeforeReset({ forecast, limits, now, reserve: null }), forecast.waves)
  return [
    `Forecast: ${forecastLine({ forecast, limits, now })}`,
    recommendation === null ? null : `Budget-aware: ${recommendation}`,
    warning === null ? null : `Fastest: ${warning}`,
    windowLine(window, wave),
  ]
    .filter((line): line is string => line !== null)
    .map((line) => `${line}.`)
}
