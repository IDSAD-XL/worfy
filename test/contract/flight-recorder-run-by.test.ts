// Who started a Run, in the list of the Runs of a Project (runs.list; worfy-flight-recorder ticket 18): the
// header of the Run history screen shows «Started by» from `run-started.by` of the Journal. A Journal
// written before the field, or with a value the Journal does not know, gives null, and the header hides it.
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
})
