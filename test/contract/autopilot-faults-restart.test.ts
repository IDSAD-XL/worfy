// The Fault scenarios of a restart (worfy-continuity ticket 06): worfy quits or is killed while an Autopilot Run goes
// on, and at the next start the Run goes on — the same id, its own journal, `run-continued` — or, cut off too often,
// waits for Resume or Discard. Each runs on faultRun() (autopilot-faults-setup.ts), on the test's clock. The quit is
// the steps of the quit's coordinator (quitSteps of src/main/quit-grace.ts) without its first, which tells the
// registry that the app departs: here the same registry serves the next start, whose Sessions must send. Its grace
// and window are autopilot-faults-quit.test.ts's. restartApp() is the next start, and its continueCutOff() what the
// app does once its first window is made (continueCutOffRuns). Each ends with checkRecovery
// (test/autopilot-invariants.ts).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { reopenRun } from '../../src/main/autopilot/journal'
import { autopilotStatusLine } from '../../src/shared/ipc/autopilot'
import { journalFileName, type JournalEvent, type SuspendCause } from '../../src/shared/autopilot/journal'
import { checkRecovery } from '../autopilot-invariants'
import { EPIC, faultRun, PROJECT, until, type FaultRun, type FaultRunOptions, type FaultScript } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: ['Bash'], mcp_servers: [], model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', slash_commands: ['epic-wave'], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000000c01' }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const interrupted = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000c02' }
const cut = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage, modelUsage: {}, permission_denials: [], session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000c03' }

/** Every turn runs until it is interrupted: no call outside the machine, so the quit has no grace to wait. */
const UNTIL_INTERRUPT: FaultScript = [{ fake: 'wait_message' }, init, { fake: 'wait_interrupt' }, interrupted, cut, { fake: 'wait_message' }, init, { fake: 'wait_interrupt' }, interrupted, cut]

const WAVE_1 = `/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`

/** The lines of the Wave's command in what the Orchestrator got. */
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

/** A Run and its quit: the Run suspended, its Sessions halted and closed, run-suspended with `cause` written. */
function quitRun(options: FaultRunOptions) {
  const h = faultRun(options)
  const grace = {
    leave: async (cause: SuspendCause): Promise<void> => {
      h.autopilot.suspendAll()
      await h.autopilot.recordKilled()
      await h.registry.haltAll(100)
      await h.autopilot.recordQuit(cause)
    },
  }
  return { h, grace }
}

/**
 * Starts the Run and waits until Wave 1's command reached the Orchestrator and both its Tickets are claimed in the journal.
 * Both are waited for: the claims follow the Session's `prompt` event (the marks of faultRun), while the fake agent
 * records the message only when its query reads it, later; a quit in between would halt the query before it did.
 */
async function inWave1(h: FaultRun): Promise<void> {
  expect(await h.start()).toEqual({ refusal: null })
  await until(
    () => waveCommands(h).length === 1 && h.journal(1).filter((event) => event.kind === 'ticket-status' && event.state === 'claimed').length === 2,
    'Wave 1 to reach the Orchestrator and claim its Tickets',
  )
}

const runOf = (h: FaultRun): string => h.journal(1)[0]!.run
const journalFile = (h: FaultRun): string => join(h.dataRoot, 'autopilot', journalFileName(runOf(h)))

/** The journal as a killed app leaves it: every line before the run-suspended the quit wrote. */
function asIfKilled(h: FaultRun): void {
  const lines = readFileSync(journalFile(h), 'utf8').split('\n').filter((line) => line !== '')
  const kept = lines.filter((line) => (JSON.parse(line) as JournalEvent).kind !== 'run-suspended')
  expect(kept).toHaveLength(lines.length - 1)
  writeFileSync(journalFile(h), kept.join('\n') + '\n')
}

/** Two continuations by itself within the hour already: run-continued and run-suspended twice after the quit's line. */
async function continuedTwice(h: FaultRun): Promise<void> {
  const journal = await reopenRun(runOf(h), { env: { WORFY_DATA_DIR: h.dataRoot } })
  for (let round = 0; round < 2; round++) {
    await journal.append({ kind: 'run-continued', after: 'quit' })
    await journal.append({ kind: 'run-suspended', cause: 'quit', wave: 1, tickets: ['01', '02'], wait: null })
  }
}

describe('a Run continued after a restart of the app (worfy-continuity ticket 06)', () => {
  it('a quit in the middle of a Wave: the start continues the same Run — run-continued, one new Wave with the cut-off Tickets as resumed — and the cut-off Wave is not sent again', async () => {
    const { h, grace } = quitRun({ scripts: [UNTIL_INTERRUPT], marks: 'claimed', processes: 'exit-at-once' })
    await inWave1(h)
    await grace.leave('quit')
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'quit', wave: 1, tickets: ['01', '02'] })
    const run = runOf(h)

    const autopilot = h.restartApp()
    // The Orchestrator after the restart claims nothing again: the Tickets are claimed already.
    h.setMarks('none')
    const state = await autopilot.continueCutOff(PROJECT)
    expect(state).toMatchObject({ status: 'running', epic: EPIC, run })
    await until(() => waveCommands(h).length === 2 && h.kinds(1).at(-1) === 'wave-started', 'the Wave of the continued Run')
    // One journal: the Run went on in its own, under its id.
    expect(h.journals()).toHaveLength(1)
    const after = h.journal(1).slice(h.journal(1).findIndex((event) => event.kind === 'run-suspended') + 1)
    expect(after.map((event) => event.kind)).toEqual(['run-continued', 'wave-started'])
    expect(after[0]).toMatchObject({ kind: 'run-continued', after: 'quit', run })
    // The Wave is numbered after the cut-off one, with 01 and 02 as resumed, in a new session with wave-brief.
    expect(after[1]).toMatchObject({ kind: 'wave-started', wave: 2, tickets: ['01', '02'] })
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1])
    expect(h.messages().at(-1)).toContain(`wave-brief ${EPIC}`)
    expect(autopilot.state(PROJECT)).toMatchObject({ status: 'running', wave: 2 })

    const stopped = await autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ reason: 'user-force-stop', resumable: [1, 2] })
    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', suspended: 'quit', continued: 'quit', waves: 2 }))).toEqual([])
  })

  it('a crash without run-suspended: the start continues the Run all the same, with run-continued after crash', async () => {
    const { h, grace } = quitRun({ scripts: [UNTIL_INTERRUPT], marks: 'claimed', processes: 'exit-at-once' })
    await inWave1(h)
    await grace.leave('quit')
    asIfKilled(h)

    const autopilot = h.restartApp()
    // The Orchestrator after the restart claims nothing again: the Tickets are claimed already.
    h.setMarks('none')
    await autopilot.continueCutOff(PROJECT)
    await until(() => waveCommands(h).length === 2 && h.kinds(1).at(-1) === 'wave-started', 'the Wave of the continued Run')
    expect(h.journals()).toHaveLength(1)
    expect(h.kinds(1).slice(-2)).toEqual(['run-continued', 'wave-started'])
    expect(h.journal(1).at(-2)).toMatchObject({ kind: 'run-continued', after: 'crash' })
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'wave-started', wave: 2, tickets: ['01', '02'] })
    expect(waveCommands(h)).toEqual([WAVE_1, WAVE_1])

    await autopilot.forceStop(PROJECT)
    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', continued: 'crash', waves: 2 }))).toEqual([])
  })

  it('a quit during the wait for the Limits: after the start the wait goes on to its until, and no command goes before it', async () => {
    // Wave 1 goes through; the turn of Wave 2 is refused by the Limits, its Ticket 03 claimed.
    const { h, grace } = quitRun({ scripts: ['autopilot-waves', 'autopilot-limits', UNTIL_INTERRUPT] })
    h.registry.observe((_sessionId, event) => {
      if (event.type === 'prompt' && /epic-wave .*\b01, 02\b/u.test(event.text)) h.setMarks('claimed')
    })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.state().status === 'waiting' || h.state().status === 'stopped', 'the wait for the Limits')
    expect(h.state()).toMatchObject({ status: 'waiting', wave: 2 })
    await grace.leave('update')
    const suspended = h.journal(1).at(-1) as Extract<JournalEvent, { kind: 'run-suspended' }>
    expect(suspended).toMatchObject({ kind: 'run-suspended', cause: 'update', wave: 2, tickets: ['03'], wait: { kind: 'limits' } })
    const until_ = Date.parse(suspended.wait!.until!)
    const commands = waveCommands(h).length

    const autopilot = h.restartApp()
    // The Orchestrator after the restart claims nothing again: the Tickets are claimed already.
    h.setMarks('none')
    await autopilot.continueCutOff(PROJECT)
    await until(() => autopilot.state(PROJECT).status === 'waiting', 'the wait after the start')
    const state = autopilot.state(PROJECT)
    expect(state).toMatchObject({ status: 'waiting', waitingFor: 'limits', resumesAt: until_ })
    const resumes = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(until_)
    expect(autopilotStatusLine(state, { timeZone: 'UTC' })).toBe(`waiting for limits · resumes ${resumes}`)
    // Up to the last millisecond of the wait nothing goes.
    h.clock.advance(until_ - h.clock.now - 1)
    for (let tick = 0; tick < 5; tick++) await new Promise((done) => setImmediate(done))
    expect(waveCommands(h)).toHaveLength(commands)
    expect(h.kinds(1).at(-1)).toBe('run-continued')
    h.clock.advance(1)
    await until(() => waveCommands(h).length === commands + 1 && h.kinds(1).at(-1) === 'wave-started', 'the Wave after the wait')
    expect(h.kinds(1).slice(-3)).toEqual(['run-continued', 'resumed', 'wave-started'])
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'wave-started', wave: 3, tickets: ['03'] })
    expect(h.journal(1).at(-3)).toMatchObject({ kind: 'run-continued', after: 'update' })

    await autopilot.forceStop(PROJECT)
    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', suspended: 'update', continued: 'update', waves: 3 }))).toEqual([])
  })

  it('the third start within the hour: no continuation, the line says cut off by restart, and Resume continues the Run', async () => {
    const { h, grace } = quitRun({ scripts: [UNTIL_INTERRUPT], marks: 'claimed', processes: 'exit-at-once' })
    await inWave1(h)
    await grace.leave('quit')
    await continuedTwice(h)
    const lines = h.journal(1).length

    const autopilot = h.restartApp()
    // The Orchestrator after the restart claims nothing again: the Tickets are claimed already.
    h.setMarks('none')
    const state = await autopilot.continueCutOff(PROJECT)
    expect(state).toMatchObject({ status: 'stopped', epic: EPIC, run: runOf(h), reason: null, cutOff: { after: 'quit' } })
    expect(autopilotStatusLine(state)).toMatch(/^cut off by restart · \d\d:\d\d$/u)
    // Nothing went and nothing was written; a new Run is refused while this one waits.
    expect(h.journal(1)).toHaveLength(lines)
    expect(waveCommands(h)).toEqual([WAVE_1])
    expect(await h.start()).toEqual({ refusal: `A Run of Epic ${EPIC} cut off by the restart of worfy waits: Resume or Discard it first` })
    expect(h.journals()).toHaveLength(1)

    const resumed = await autopilot.resumeCutOff(PROJECT)
    expect(resumed).toMatchObject({ status: 'running', run: runOf(h) })
    expect(resumed.cutOff).toBeUndefined()
    await until(() => waveCommands(h).length === 2 && h.kinds(1).at(-1) === 'wave-started', 'the Wave of the resumed Run')
    expect(h.kinds(1).slice(-2)).toEqual(['run-continued', 'wave-started'])
    expect(h.journal(1).filter((event) => event.kind === 'run-continued')).toHaveLength(3)

    await autopilot.forceStop(PROJECT)
    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', suspended: 'quit', continued: 'quit', waves: 2 }))).toEqual([])
  })

  it('the third start within the hour and Discard: run-stopped with discarded and the Tickets in work, and the next Run takes them along', async () => {
    const { h, grace } = quitRun({ scripts: [UNTIL_INTERRUPT], marks: 'claimed', processes: 'exit-at-once' })
    await inWave1(h)
    await grace.leave('quit')
    await continuedTwice(h)

    const autopilot = h.restartApp()
    // The Orchestrator after the restart claims nothing again: the Tickets are claimed already.
    h.setMarks('none')
    expect(await autopilot.continueCutOff(PROJECT)).toMatchObject({ cutOff: { after: 'quit' } })
    const discarded = await autopilot.discardCutOff(PROJECT)
    expect(discarded).toMatchObject({ status: 'stopped', reason: 'discarded', resumable: [1, 2], run: runOf(h) })
    expect(discarded.cutOff).toBeUndefined()
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'discarded', tickets: ['01', '02'] })
    expect(waveCommands(h)).toEqual([WAVE_1])

    // A new Run now begins a journal of its own, and takes the discarded Wave's Tickets along.
    expect(await h.startAgain()).toEqual({ refusal: null })
    // The command goes before its wave-started line is written: wait for both.
    await until(() => waveCommands(h).length === 2 && h.journals().length === 2 && h.kinds(2).includes('wave-started'), 'the Wave of the next Run')
    expect(h.journal(2).filter((event) => event.kind === 'wave-started')).toMatchObject([{ wave: 1, tickets: ['01', '02'] }])
    await h.autopilot.forceStop(PROJECT)
    expect(checkRecovery(h.recovery({ stop: 'discarded', waves: 2 }))).toEqual([])
  })

  it('an implementer held gh pr merge without a result: after the start its Ticket is not in the Wave and stays claimed', async () => {
    const { h, grace } = quitRun({ scripts: [UNTIL_INTERRUPT], marks: 'claimed', processes: 'exit-at-once' })
    await inWave1(h)
    await grace.leave('quit')
    // The transcript of the Orchestrator's session of Wave 1: an implementer of 01 called gh pr merge, no result.
    const session = (h.journal(1).find((event) => event.kind === 'wave-started') as Extract<JournalEvent, { kind: 'wave-started' }>).session!
    writeFileSync(join(h.transcripts, `${session}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: session, timestamp: '2026-11-18T09:59:00.000Z', message: { role: 'user', content: WAVE_1 } })}\n`)
    mkdirSync(join(h.transcripts, session, 'subagents'), { recursive: true })
    const implementer = [
      { type: 'user', isSidechain: true, agentId: 'impl01', sessionId: session, timestamp: '2026-11-18T10:00:00.000Z', message: { role: 'user', content: `Implement the ticket .scratch/${EPIC}/issues/01-ticket-1.md` } },
      {
        type: 'assistant',
        isSidechain: true,
        agentId: 'impl01',
        sessionId: session,
        timestamp: '2026-11-18T10:20:00.000Z',
        message: { id: 'm-1', role: 'assistant', content: [{ type: 'tool_use', id: 't-merge', name: 'Bash', input: { command: 'gh pr merge 41 --squash', description: 'Merge the PR' } }] },
      },
    ]
    appendFileSync(join(h.transcripts, session, 'subagents', 'agent-impl01.jsonl'), implementer.map((line) => JSON.stringify(line)).join('\n') + '\n')

    const autopilot = h.restartApp()
    // The Orchestrator after the restart claims nothing again: the Tickets are claimed already.
    h.setMarks('none')
    await autopilot.continueCutOff(PROJECT)
    await until(() => waveCommands(h).length === 2 && h.kinds(1).at(-1) === 'wave-started', 'the Wave of the continued Run')
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'wave-started', wave: 2, tickets: ['02'] })
    expect(waveCommands(h)).toEqual([WAVE_1, `/epic-wave Ticket-ы 02 эпика ${EPIC}`])
    // 01 is left as it was: claimed, for a person.
    expect(readFileSync(join(h.repo, '.scratch', EPIC, 'issues', '01-ticket-1.md'), 'utf8')).toContain('Status: claimed')

    await autopilot.forceStop(PROJECT)
    expect(checkRecovery(h.recovery({ stop: 'user-force-stop', suspended: 'quit', continued: 'quit', waves: 2 }))).toEqual([])
  })
})
