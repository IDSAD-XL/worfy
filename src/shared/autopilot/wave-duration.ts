// How long a Wave takes (worfy-resource-planner ticket 02, ADR-0093): the samples a Start window
// judges by whether a Wave still fits before the window ends. A sample is the time from a Run's
// wave-started to its wave-finished of the same Wave number, minus the waits for the Limits inside
// that pair: from limits-hit to resumed, or to wave-finished when no resumed came. The waits for
// the budget and for the window never fall inside the pair: the Run decides them before it sends
// Run wave, and writes wave-started after that. A Wave with no wave-finished (the Run broke off, a
// Force stop) gives no sample; the turn of Process gate queue is not a Wave. The last
// DURATION_WAVES samples by the Wave's end count; their p90 by the nearest rank (percentile,
// forecast.ts) is the duration, none under DURATION_MIN_SAMPLES samples ("not enough data on the
// duration"). Times are the lines' `at` with their offsets, so a change of the clocks does not
// shift them. Everything here is pure.
import { percentile } from './forecast'
import type { JournalEvent } from './journal'

/** How many of the last Waves, by their end, the duration is taken from. */
export const DURATION_WAVES = 10
/** Fewer samples than this give no duration. */
export const DURATION_MIN_SAMPLES = 5

export interface WaveDuration {
  /** The p90 of the samples in ms; null under DURATION_MIN_SAMPLES samples. */
  p90: number | null
  /** How many samples there are, at most DURATION_WAVES. */
  samples: number
}

/** The Wave of a Run between its wave-started and its wave-finished. */
interface OpenWave {
  wave: number
  start: number
  /** The ms waited for the Limits so far. */
  waited: number
  /** When the wait still open began; null when none is. */
  waitFrom: number | null
}

/**
 * The durations in ms of the last DURATION_WAVES Waves that give one, oldest end first, from the
 * events of each past Run (one list per journal file).
 */
export function waveDurations(runs: readonly (readonly JournalEvent[])[]): number[] {
  const samples: { end: number; ms: number }[] = []
  for (const events of runs) {
    let open: OpenWave | null = null
    for (const event of events) {
      const at = Date.parse(event.at)
      if (event.kind === 'wave-started') open = { wave: event.wave, start: at, waited: 0, waitFrom: null }
      else if (open === null) continue
      else if (event.kind === 'limits-hit') open.waitFrom ??= at
      else if (event.kind === 'resumed' && open.waitFrom !== null) {
        open.waited += at - open.waitFrom
        open.waitFrom = null
      } else if (event.kind === 'wave-finished') {
        const waited = open.waited + (open.waitFrom === null ? 0 : at - open.waitFrom)
        if (event.wave === open.wave) samples.push({ end: at, ms: at - open.start - waited })
        open = null
      }
    }
  }
  return samples
    .sort((a, b) => a.end - b.end)
    .slice(-DURATION_WAVES)
    .map((each) => each.ms)
}

/** The p90 of the last Waves' durations and how many there are, from the events of each past Run. */
export function waveDurationP90(runs: readonly (readonly JournalEvent[])[]): WaveDuration {
  const durations = waveDurations(runs)
  return { p90: durations.length < DURATION_MIN_SAMPLES ? null : percentile(durations, 90), samples: durations.length }
}
