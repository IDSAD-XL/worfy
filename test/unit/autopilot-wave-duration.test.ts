// How long a Wave takes (worfy-resource-planner ticket 02): wave-started to wave-finished of one Run
// minus the waits for the Limits inside it, the last DURATION_WAVES samples by the Wave's end, and
// their p90, null under DURATION_MIN_SAMPLES samples.
import { describe, expect, it } from 'vitest'
import { journalEventSchema, type JournalEvent } from '../../src/shared/autopilot/journal'
import { DURATION_MIN_SAMPLES, DURATION_WAVES, waveDurationP90, waveDurations } from '../../src/shared/autopilot/wave-duration'

const RUN_A = '2026-10-06T01-02-03-004Z-a1b2c3'
const RUN_B = '2026-10-07T01-02-03-004Z-d4e5f6'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const T0 = Date.parse('2026-10-06T09:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()

type Line = Record<string, unknown> & { kind: JournalEvent['kind'] }

/** The lines of one Run, each with the common fields; `at` is ms unless it is already a text. Every line is checked by the journal's schema. */
function run(id: string, ...lines: (Line & { at: number | string })[]): JournalEvent[] {
  const common = { run: id, project: 'demo-00000001', epic: 'demo' }
  return [
    { ...common, at: iso(T0 - MINUTE), kind: 'run-started' },
    ...lines.map((line) => ({ ...common, ...line, at: typeof line.at === 'string' ? line.at : iso(line.at) })),
  ].map((line) => journalEventSchema.parse(line))
}

const started = (wave: number, at: number | string) => ({ kind: 'wave-started' as const, at, wave, tickets: ['01'] })
const finished = (wave: number, at: number | string) => ({ kind: 'wave-finished' as const, at, wave, tickets: ['01'] })
const limitsHit = (at: number) => ({ kind: 'limits-hit' as const, at, window: 'seven_day', resetsAt: null })
const waitingUntil = (at: number, until: number) => ({ kind: 'waiting-until' as const, at, until: iso(until) })
const resumed = (at: number) => ({ kind: 'resumed' as const, at })

/** A Run of Waves 1, 2, … one after another, the n-th lasting `minutes[n]` minutes, the first starting at `from`. */
function waves(id: string, from: number, minutes: readonly number[]): JournalEvent[] {
  const lines: (Line & { at: number | string })[] = []
  let at = from
  minutes.forEach((each, index) => {
    lines.push(started(index + 1, at), finished(index + 1, at + each * MINUTE))
    at += each * MINUTE + MINUTE
  })
  return run(id, ...lines)
}

describe('waveDurations', () => {
  it('names its limits', () => {
    expect(DURATION_WAVES).toBe(10)
    expect(DURATION_MIN_SAMPLES).toBe(5)
  })

  it('gives nothing for no Runs and for a Run without a Wave', () => {
    expect(waveDurations([])).toEqual([])
    expect(waveDurations([run(RUN_A)])).toEqual([])
  })

  it('a Wave of 40 minutes without waits is 40 minutes', () => {
    expect(waveDurations([run(RUN_A, started(1, T0), finished(1, T0 + 40 * MINUTE))])).toEqual([40 * MINUTE])
  })

  it('takes a wait for the Limits inside the Wave off it: limits-hit 10:00, resumed 12:00 take 2 hours off', () => {
    const at10 = Date.parse('2026-10-06T10:00:00.000Z')
    const events = run(RUN_A, started(1, T0), limitsHit(at10), waitingUntil(at10, at10 + 2 * HOUR), resumed(at10 + 2 * HOUR), finished(1, at10 + 3 * HOUR))
    // 09:00 to 13:00 is 4 hours, 2 of them waited.
    expect(waveDurations([events])).toEqual([2 * HOUR])
  })

  it('a wait a turn ended before its timer counts until that resumed: 09:00 start, 10:00 hit, 11:00 pass, 13:00 finish is 3 hours', () => {
    // The Run writes resumed when a person's turn goes through during the wait (run.ts).
    const events = run(
      RUN_A,
      started(1, T0),
      limitsHit(T0 + HOUR),
      waitingUntil(T0 + HOUR, T0 + 5 * HOUR),
      resumed(T0 + 2 * HOUR),
      { kind: 'ticket-status', at: T0 + 2 * HOUR, ticket: '01', state: 'claimed' },
      finished(1, T0 + 4 * HOUR),
    )
    expect(waveDurations([events])).toEqual([3 * HOUR])
  })

  it('takes every wait inside the Wave off it', () => {
    const events = run(RUN_A, started(1, T0), limitsHit(T0 + 10 * MINUTE), resumed(T0 + 30 * MINUTE), limitsHit(T0 + 40 * MINUTE), resumed(T0 + 70 * MINUTE), finished(1, T0 + 80 * MINUTE))
    expect(waveDurations([events])).toEqual([30 * MINUTE])
  })

  it('a wait without resumed lasts until wave-finished', () => {
    const events = run(RUN_A, started(1, T0), limitsHit(T0 + 25 * MINUTE), finished(1, T0 + 60 * MINUTE))
    expect(waveDurations([events])).toEqual([25 * MINUTE])
  })

  it('a second limits-hit while the wait is open does not start the wait again', () => {
    const events = run(RUN_A, started(1, T0), limitsHit(T0 + 10 * MINUTE), limitsHit(T0 + 40 * MINUTE), resumed(T0 + 50 * MINUTE), finished(1, T0 + 60 * MINUTE))
    expect(waveDurations([events])).toEqual([20 * MINUTE])
  })

  it('a resumed with no open wait takes nothing off', () => {
    const events = run(RUN_A, started(1, T0), resumed(T0 + 10 * MINUTE), finished(1, T0 + 60 * MINUTE))
    expect(waveDurations([events])).toEqual([60 * MINUTE])
  })

  it('a wait between Waves belongs to neither of them', () => {
    const events = run(
      RUN_A,
      started(1, T0),
      finished(1, T0 + 20 * MINUTE),
      limitsHit(T0 + 21 * MINUTE),
      resumed(T0 + 50 * MINUTE),
      started(2, T0 + 51 * MINUTE),
      finished(2, T0 + 81 * MINUTE),
    )
    expect(waveDurations([events])).toEqual([20 * MINUTE, 30 * MINUTE])
  })

  it('a wait still open at wave-started is not taken off the Wave', () => {
    // The Run never writes it so (the Limits are waited out before Run wave), but a journal may.
    const events = run(RUN_A, limitsHit(T0 - 30 * MINUTE), started(1, T0), resumed(T0 + 10 * MINUTE), finished(1, T0 + 40 * MINUTE))
    expect(waveDurations([events])).toEqual([40 * MINUTE])
  })

  it('a Wave without wave-finished gives no sample', () => {
    const cut = run(RUN_A, started(1, T0), limitsHit(T0 + 5 * MINUTE))
    const forceStopped = run(RUN_B, started(1, T0 + 2 * HOUR), { kind: 'run-stopped', at: T0 + 3 * HOUR, reason: 'user-force-stop' })
    expect(waveDurations([cut, forceStopped])).toEqual([])
  })

  it('a Wave left without wave-finished does not join the next Wave', () => {
    const events = run(RUN_A, started(1, T0), started(2, T0 + HOUR), finished(2, T0 + 90 * MINUTE))
    expect(waveDurations([events])).toEqual([30 * MINUTE])
  })

  it('a wait left open by a Wave without wave-finished is not taken off the next Wave', () => {
    const events = run(RUN_A, started(1, T0), limitsHit(T0 + 10 * MINUTE), started(2, T0 + HOUR), finished(2, T0 + 90 * MINUTE))
    expect(waveDurations([events])).toEqual([30 * MINUTE])
  })

  it('a wave-finished of another number than the open Wave gives no sample', () => {
    const events = run(RUN_A, started(1, T0), finished(2, T0 + 30 * MINUTE))
    expect(waveDurations([events])).toEqual([])
  })

  it('a wave-finished of another number closes the open Wave: its own wave-finished after it gives no sample', () => {
    const events = run(RUN_A, started(1, T0), finished(2, T0 + 30 * MINUTE), finished(1, T0 + 40 * MINUTE))
    expect(waveDurations([events])).toEqual([])
  })

  it('lines whose time goes back (the clock was set back) give no sample; a Wave of no time gives 0', () => {
    const back = run(RUN_A, started(1, T0 + HOUR), finished(1, T0 + 30 * MINUTE))
    const waitedBack = run(RUN_B, started(1, T0 + 2 * HOUR), limitsHit(T0 + 2 * HOUR), finished(1, T0 + 3 * HOUR), started(2, T0 + 4 * HOUR), finished(2, T0 + 4 * HOUR))
    // Run B's Wave 1 waited all of its hour: 0, kept. Its Wave 2 starts and ends at once: 0, kept.
    expect(waveDurations([back, waitedBack])).toEqual([0, 0])
  })

  it('a wave-finished written twice gives one sample', () => {
    const events = run(RUN_A, started(1, T0), finished(1, T0 + 30 * MINUTE), finished(1, T0 + 31 * MINUTE))
    expect(waveDurations([events])).toEqual([30 * MINUTE])
  })

  it('pairs the lines inside one Run only: two Waves in different Runs, and no pair across Runs', () => {
    const a = run(RUN_A, started(1, T0), finished(1, T0 + 15 * MINUTE), started(2, T0 + 20 * MINUTE))
    const b = run(RUN_B, finished(2, T0 + 2 * HOUR), started(1, T0 + 3 * HOUR), finished(1, T0 + 3 * HOUR + 45 * MINUTE))
    expect(waveDurations([a, b])).toEqual([15 * MINUTE, 45 * MINUTE])
  })

  it('an open wait does not cross into the next Run', () => {
    const a = run(RUN_A, started(1, T0), finished(1, T0 + 15 * MINUTE), limitsHit(T0 + 16 * MINUTE))
    const b = run(RUN_B, started(1, T0 + 2 * HOUR), finished(1, T0 + 2 * HOUR + 45 * MINUTE))
    expect(waveDurations([a, b])).toEqual([15 * MINUTE, 45 * MINUTE])
  })

  it('the turn of Process gate queue is not a Wave, nor is a wait inside it', () => {
    const events = run(
      RUN_A,
      started(1, T0),
      finished(1, T0 + 10 * MINUTE),
      { kind: 'gate-queue', at: T0 + 11 * MINUTE, text: 'Process gate queue' },
      limitsHit(T0 + 20 * MINUTE),
      resumed(T0 + 40 * MINUTE),
      { kind: 'gate-queue-finished', at: T0 + 50 * MINUTE },
    )
    expect(waveDurations([events])).toEqual([10 * MINUTE])
  })

  it('counts real time across a change of the clocks and across midnight', () => {
    // Summer time ends at 04:00 local (+03:00) on 2026-10-25: 02:30+03:00 to 03:30+02:00 is two hours.
    const dst = run(RUN_A, started(1, '2026-10-25T02:30:00+03:00'), finished(1, '2026-10-25T03:30:00+02:00'))
    const midnight = run(RUN_B, started(1, '2026-10-26T23:40:00+02:00'), finished(1, '2026-10-27T00:10:00+02:00'))
    expect(waveDurations([dst, midnight])).toEqual([2 * HOUR, 30 * MINUTE])
  })

  it('takes the last 10 by the Wave\'s end, oldest first', () => {
    const minutes = Array.from({ length: 12 }, (_, index) => index + 1)
    expect(waveDurations([waves(RUN_A, T0, minutes)])).toEqual(minutes.slice(-10).map((each) => each * MINUTE))
  })

  it('orders by the Wave\'s end across Runs, whatever order the Runs come in', () => {
    // Run A is listed first and its long Wave starts first, but it ends last: the oldest end
    // dropped is Run B's first Wave. In list order or by start, Run A's Wave would be dropped.
    const a = run(RUN_A, started(1, T0), finished(1, T0 + 10 * HOUR))
    const b = waves(RUN_B, T0 + HOUR, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(waveDurations([a, b])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 600].map((each) => each * MINUTE))
  })
})

describe('waveDurationP90', () => {
  it('no samples: no p90', () => {
    expect(waveDurationP90([])).toEqual({ p90: null, samples: 0 })
  })

  it('one sample: no p90', () => {
    expect(waveDurationP90([waves(RUN_A, T0, [7])])).toEqual({ p90: null, samples: 1 })
  })

  it('4 samples: no p90, the 4 counted', () => {
    expect(waveDurationP90([waves(RUN_A, T0, [1, 2, 3, 4])])).toEqual({ p90: null, samples: 4 })
  })

  it('5 samples: a p90', () => {
    expect(waveDurationP90([waves(RUN_A, T0, [1, 2, 3, 4, 5])])).toEqual({ p90: 5 * MINUTE, samples: 5 })
  })

  it('7 samples of 1…7 minutes: p90 is 7 minutes (p85 would give 6)', () => {
    expect(waveDurationP90([waves(RUN_A, T0, [1, 2, 3, 4, 5, 6, 7])])).toEqual({ p90: 7 * MINUTE, samples: 7 })
  })

  it('10 samples of 1…10 minutes: p90 is 9 minutes by the nearest rank', () => {
    expect(waveDurationP90([waves(RUN_A, T0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])])).toEqual({ p90: 9 * MINUTE, samples: 10 })
  })

  it('12 samples: the p90 of the last 10', () => {
    // The first two are long; taken, they would make p90 the second-longest of all.
    const events = waves(RUN_A, T0, [600, 500, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(waveDurationP90([events])).toEqual({ p90: 9 * MINUTE, samples: 10 })
  })

  it('the p90 is of the durations without the waits', () => {
    const lines = [1, 2, 3, 4].map((n) => [started(n, T0 + n * 2 * HOUR), finished(n, T0 + n * 2 * HOUR + 10 * MINUTE)]).flat()
    const waited = [started(5, T0 + 12 * HOUR), limitsHit(T0 + 12 * HOUR + MINUTE), resumed(T0 + 13 * HOUR + MINUTE), finished(5, T0 + 13 * HOUR + 10 * MINUTE)]
    expect(waveDurationP90([run(RUN_A, ...lines, ...waited)])).toEqual({ p90: 10 * MINUTE, samples: 5 })
  })
})
