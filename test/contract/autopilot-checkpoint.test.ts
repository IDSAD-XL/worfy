// The Run's journal as its checkpoint across a restart of the app (worfy-continuity ticket 02): a Force stop in the
// middle of Wave 1 leaves its Tickets resumable; the app starts again (a new Autopilot over the same journals, with
// nothing of the old one's memory), and the next Run of the Epic takes them into its first Wave from the journal
// (src/shared/autopilot/checkpoint.ts), as the run after a Force stop always did within one launch (ADR-0050).
// Runs on faultRun() (autopilot-faults-setup.ts) and ends with checkRecovery (test/autopilot-invariants.ts).
import { describe, expect, it, vi } from 'vitest'
import { readCheckpoint, resumableAfter } from '../../src/shared/autopilot/checkpoint'
import { parseJournal } from '../../src/shared/autopilot/journal'
import { ticketNumber } from '../../src/shared/actions/render-template'
import { checkRecovery } from '../autopilot-invariants'
import { EPIC, faultRun, PROJECT, until, type FaultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

/** The lines of the Wave's command in what the Orchestrator got. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'

describe('the journal as the checkpoint of a Run (worfy-continuity ticket 02)', () => {
  it('after a Force stop and a restart of the app, the next Run of the Epic takes the interrupted Tickets from the journal', async () => {
    // Every Wave's turn is held until the Force stop; the Wave's command claims its Tickets.
    const h = faultRun({ scripts: ['autopilot-fault-held'], marks: 'claimed', processes: 'exit-at-once' })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.journal(1).filter((event) => event.kind === 'ticket-status').length === 2, 'the claims of Wave 1 in the journal')
    const stopped = await h.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop', resumable: [1, 2] })

    // The same journal says the same: the checkpoint's resumable is the memory's.
    const first = h.journals()[0]!
    expect(readCheckpoint(first)).toMatchObject({ epic: EPIC, wave: 1, stopped: { reason: 'user-force-stop', tickets: ['01', '02'] }, cutOff: null, resumable: ['01', '02'] })
    expect(resumableAfter([parseJournal(first).events])?.resumable).toEqual(stopped.resumable.map(ticketNumber))

    // The app starts again: no memory of the stop. 01 and 02 stay claimed, 03 waits for both, so only the
    // journal can make a Wave of them.
    const autopilot = h.restartApp()
    expect(autopilot.state(PROJECT)).toMatchObject({ status: 'stopped', resumable: [] })
    expect(await h.startAgain()).toEqual({ refusal: null })
    await until(() => h.kinds(2).includes('wave-started'), 'the Wave of the Run after the restart')
    expect(h.journal(2)[0]).toMatchObject({ kind: 'run-started', epic: EPIC })
    expect(h.journal(2).filter((event) => event.kind === 'wave-started')).toMatchObject([{ wave: 1, tickets: ['01', '02'] }])
    await until(() => waveCommands(h).length === 2, 'the Wave command of the new Run')
    await h.autopilot.forceStop(PROJECT)
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1])

    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', waves: 2 }))).toEqual([])
  })

  it('a Run cut off by a crash leaves nothing resumable: the next Run after the restart takes nothing along', async () => {
    const h = faultRun({ scripts: ['autopilot-fault-held'], marks: 'claimed', processes: 'exit-at-once' })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.journal(1).filter((event) => event.kind === 'ticket-status').length === 2, 'the claims of Wave 1 in the journal')
    // The journal as a killed app leaves it: the run's lines so far, no end.
    const cut = readCheckpoint(h.journals()[0]!)
    expect(cut).toMatchObject({ wave: 1, inWork: ['01', '02'], stopped: null, cutOff: { after: 'crash' }, resumable: [] })
    expect(resumableAfter([parseJournal(h.journals()[0]!).events])).toEqual({ epic: EPIC, resumable: [] })
  })
})
