// Who started a Run, in the list of the Runs of a Project (runs.list; worfy-flight-recorder ticket 18): the
// header of the Run history screen shows «Started by» from `run-started.by` of the Journal. A Journal
// written before the field, or with a value the Journal does not know, gives null, and the header hides it.
// The Run mode, the Epic forecast and the actual share reach the header the same way (worfy-resource-planner 11).
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FlightRecorder } from '../../src/main/flight-recorder/service'
import { formatJournalLine, makeRunId, RUN_STARTED_BY, type JournalEvent } from '../../src/shared/autopilot/journal'
import { runListItemSchema } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { removeTestTree } from '../remove'

let base: string
beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fr-run-by-')))
})
afterAll(async () => {
  await removeTestTree(base)
})

async function writeJournal(dataDir: string, run: string, events: readonly Record<string, unknown>[]): Promise<void> {
  const dir = join(dataDir, 'autopilot')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${run}.jsonl`), events.map((event) => formatJournalLine(event as JournalEvent)).join(''))
}

describe('who started a Run', () => {
  it('runs.list gives run-started.by of each Run; a Journal without it, or with an unknown value, gives null', async () => {
    const data = join(base, 'data')
    const values: readonly (string | undefined)[] = [...RUN_STARTED_BY, undefined, 'someone']
    const runs = values.map((by, index) => {
      const day = String(index + 1).padStart(2, '0')
      const run = makeRunId(new Date(`2026-10-${day}T10:00:00.000Z`), `a${index}a${index}a${index}`)
      return { run, by, day }
    })
    for (const { run, by, day } of runs) {
      await writeJournal(data, run, [
        { at: `2026-10-${day}T10:00:00.000Z`, run, project: 'p-1', epic: 'alpha', kind: 'run-started', ...(by === undefined ? {} : { by }) },
        { at: `2026-10-${day}T10:00:01.000Z`, run, project: 'p-1', epic: 'alpha', kind: 'wave-started', wave: 1, tickets: ['01'] },
      ])
    }
    const recorder = new FlightRecorder({
      env: { WORFY_DATA_DIR: data },
      harnessHome: join(base, 'harness'),
      projectRoot: () => base,
      profile: async () => ({ name: 'worfy', mode: 'full', finish: 'pr-green-ci', pipeline: DEFAULT_PIPELINE, account: null, accountReason: 'none', crossMachineGate: null, reason: null }),
      gh: async () => '[]',
      running: () => false,
      git: async () => ({ code: 128, stdout: '' }),
    })

    const items = await recorder.list('p-1')
    const byRun = new Map(items.map((item) => [item.run, item.by]))
    expect(runs.map(({ run }) => byRun.get(run))).toEqual(['button', 'command', 'tool', null, null])
    // What the service answers is what the channel carries.
    for (const item of items) expect(runListItemSchema.parse(item)).toEqual(item)
  })

  // worfy-resource-planner ticket 11: the header of Run history shows them beside «Started by».
  it('runs.list gives the Run mode, the range of the forecast line and run-stopped.actual; a Journal before them gives null', async () => {
    const data = join(base, 'data-forecast')
    const recorder = new FlightRecorder({
      env: { WORFY_DATA_DIR: data },
      harnessHome: join(base, 'harness'),
      projectRoot: () => base,
      profile: async () => ({ name: 'worfy', mode: 'full', finish: 'pr-green-ci', pipeline: DEFAULT_PIPELINE, account: null, accountReason: 'none', crossMachineGate: null, reason: null }),
      gh: async () => '[]',
      running: () => false,
      git: async () => ({ code: 128, stdout: '' }),
    })
    const forecast = { waves: 2, tickets: 3, uncounted: 0, samples: 6, fit: 1, week: { utilization: 0.4, resetsAt: '2026-10-25T10:00:00.000Z' }, durationP90Ms: 3_600_000, durationSamples: 6 }
    const planned = makeRunId(new Date('2026-10-21T10:00:00.000Z'), 'f1f1f1')
    const unknown = makeRunId(new Date('2026-10-22T10:00:00.000Z'), 'f2f2f2')
    const before = makeRunId(new Date('2026-10-20T10:00:00.000Z'), 'f0f0f0')
    const at = (day: string, hhmm: string) => `2026-10-${day}T${hhmm}:00.000Z`
    const line = (run: string, day: string, hhmm: string, event: Record<string, unknown>) => ({ at: at(day, hhmm), run, project: 'p-1', epic: 'alpha', ...event })
    await writeJournal(data, planned, [
      line(planned, '21', '10:00', { kind: 'run-started', by: 'button', mode: 'budget-aware' }),
      line(planned, '21', '10:00', { kind: 'forecast', mode: 'budget-aware', low: 0.18, high: 0.31, ...forecast }),
      line(planned, '21', '10:01', { kind: 'wave-started', wave: 1, tickets: ['01'] }),
      line(planned, '21', '11:00', { kind: 'wave-finished', wave: 1, tickets: ['01'] }),
      line(planned, '21', '11:01', { kind: 'run-stopped', reason: 'tickets-done', actual: { share: 0.24, waves: 4, counted: 3 } }),
    ])
    await writeJournal(data, unknown, [
      line(unknown, '22', '10:00', { kind: 'run-started', by: 'tool', mode: 'start-window' }),
      line(unknown, '22', '10:00', { kind: 'forecast', mode: 'start-window', low: null, high: null, ...forecast, window: { from: 23, to: 7 } }),
      line(unknown, '22', '10:01', { kind: 'wave-started', wave: 1, tickets: ['01'] }),
    ])
    await writeJournal(data, before, [
      line(before, '20', '10:00', { kind: 'run-started', by: 'button' }),
      line(before, '20', '10:01', { kind: 'wave-started', wave: 1, tickets: ['01'] }),
      line(before, '20', '11:01', { kind: 'run-stopped', reason: 'tickets-done' }),
    ])

    const items = await recorder.list('p-1')
    expect(items.map(({ run, mode, forecast, actual }) => ({ run, mode, forecast, actual }))).toEqual([
      { run: unknown, mode: 'start-window', forecast: { low: null, high: null }, actual: null },
      { run: planned, mode: 'budget-aware', forecast: { low: 0.18, high: 0.31 }, actual: { share: 0.24, waves: 4, counted: 3 } },
      { run: before, mode: null, forecast: null, actual: null },
    ])
    for (const item of items) expect(runListItemSchema.parse(item)).toEqual(item)
  })
})
