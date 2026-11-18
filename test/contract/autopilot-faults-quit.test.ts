// The Fault scenarios of a quit (worfy-continuity ticket 04): worfy quits, restarts for an Update or the system
// shuts down while an Autopilot Run goes on. Each runs on faultRun() (autopilot-faults-setup.ts) with the quit's
// coordinator (src/main/quit-grace.ts) over its registry and Autopilot, on the test's clock: the Run is suspended,
// not stopped — run-suspended with its Wave and its wait is the journal's last line — and the quit waits for the
// external calls of the Orchestrator without a result, GRACE_MS of the test's clock at most, or until Quit now.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GRACE_MS, OpenCalls, QuitGrace, quitSteps, subagentOpenCalls } from '../../src/main/quit-grace'
import type { JournalEvent, SuspendCause } from '../../src/shared/autopilot/journal'
import type { QuitGraceView } from '../../src/shared/ipc/quit-grace'
import { checkRecovery } from '../autopilot-invariants'
import { faultRun, PROJECT, until, type FaultRun, type FaultRunOptions, type FaultScript } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const PUSH = 'git push origin demo/01'
const PUSH_ID = 'toolu_quit_push'

const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: ['Bash'], mcp_servers: [], model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', slash_commands: ['epic-wave'], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000000a01' }
const pushCall = {
  type: 'assistant',
  message: { id: 'msg_quit_push', model: 'claude-opus-5-5', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: PUSH_ID, name: 'Bash', input: { command: PUSH, description: 'Push the branch' } }], stop_reason: 'tool_use' },
  parent_tool_use_id: null,
  session_id: '{{session}}',
  uuid: '00000000-0000-4000-8000-000000000a02',
}
const pushResult = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: PUSH_ID, content: 'Everything up-to-date', is_error: false }] }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000a03' }
const answer = { type: 'assistant', message: { id: 'msg_quit_answer', model: 'claude-opus-5-5', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Pushed.' }], stop_reason: null }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000a04' }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const success = { type: 'result', subtype: 'success', is_error: false, result: 'Pushed.', total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage, modelUsage: {}, permission_denials: [], terminal_reason: 'completed', session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000a05' }
const interrupted = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000a06' }
const cut = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage, modelUsage: {}, permission_denials: [], session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000a07' }

/** The Wave's turn runs until it is interrupted: no call outside the machine. */
const WAVE_UNTIL_INTERRUPT: FaultScript = [{ fake: 'wait_message' }, init, { fake: 'wait_interrupt' }, interrupted, cut]
/** The Wave's turn calls `git push`, which gets no result until it is interrupted. */
const PUSH_UNTIL_INTERRUPT: FaultScript = [{ fake: 'wait_message' }, init, pushCall, { fake: 'wait_interrupt' }, interrupted, cut]
/** The Wave's turn calls `git push`, whose result comes when the test releases `push`; the turn then ends. */
const PUSH_UNTIL_RELEASE: FaultScript = [{ fake: 'wait_message' }, init, pushCall, { fake: 'wait_release', name: 'push' }, pushResult, answer, success]

/**
 * A Run with the quit's coordinator over its registry and Autopilot, on the test's clock. The Subagents' calls come from
 * the transcripts of the test's folder `h.transcripts` (subagentOpenCalls, worfy-continuity ticket 07), counted from the
 * start of the test.
 */
function quitRun(options: FaultRunOptions) {
  const h = faultRun(options)
  const since = Date.now()
  // From the start, as the app follows them from its registry's first Session (src/main/index.ts).
  const calls = new OpenCalls()
  h.registry.observe(calls.sink)
  const views: QuitGraceView[] = []
  let quits = 0
  const grace = new QuitGrace({
    // The Stop's limit of faultRun for the interrupt of a turn.
    ...quitSteps(() => ({ registry: h.registry, autopilot: h.autopilot, haltTurnMs: 100 })),
    calls,
    subagentCalls: () =>
      subagentOpenCalls({
        sessions: () => h.registry.list(),
        transcriptPath: (_root, id) => {
          const path = join(h.transcripts, `${id}.jsonl`)
          return Promise.resolve(existsSync(path) ? path : null)
        },
        since,
      }),
    show: (view) => void views.push(view),
    quit: () => void (quits += 1),
    clock: { now: () => h.clock.now, setTimeout: h.clock.setTimeout, clearTimeout: h.clock.clearTimeout },
  })
  return { h, grace, calls, views, quits: () => quits }
}

/** Starts the Run and waits until Wave 1's command reached the Orchestrator and its Tickets are claimed in the journal. */
async function inWave1(h: FaultRun): Promise<void> {
  expect(await h.start()).toEqual({ refusal: null })
  await until(() => h.journal(1).filter((event) => event.kind === 'ticket-status' && event.state === 'claimed').length === 2, 'Wave 1 to claim its Tickets')
}

const suspendedOf = (h: FaultRun): Extract<JournalEvent, { kind: 'run-suspended' }> | undefined => h.journal(1).find((event) => event.kind === 'run-suspended') as never

describe('a quit during an Autopilot Run (worfy-continuity ticket 04)', () => {
  it('in the middle of a Wave: run-suspended with the Wave and its Tickets is the last line, no run-stopped, and the Wave never goes again', async () => {
    const { h, grace, views, quits } = quitRun({ scripts: [WAVE_UNTIL_INTERRUPT], marks: 'claimed' })
    await inWave1(h)
    await grace.leave('quit')
    expect(quits()).toBe(1)
    // No call outside the machine: no window, no wait.
    expect(views).toEqual([])
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'quit', wave: 1, tickets: ['01', '02'], wait: null })
    expect(h.kinds(1)).not.toContain('run-stopped')
    expect(h.autopilot.running(PROJECT)).toBe(false)
    // The Orchestrator was halted and closed: its turn is over, and nothing more went to it.
    expect(h.registry.list()).toEqual([])
    expect(checkRecovery(h.recovery({ stop: null, suspended: 'quit', waves: 1 }))).toEqual([])
  })

  it('with git push without a result: the quit waits for it no longer than GRACE_MS by the test clock, and the window names it', async () => {
    const { h, grace, calls, views, quits } = quitRun({ scripts: [PUSH_UNTIL_INTERRUPT], marks: 'claimed' })
    await inWave1(h)
    await until(() => calls.open().length > 0, 'git push to be called')
    const left = grace.leave('quit')
    await until(() => grace.view !== null, 'the window «Quitting worfy»')
    expect(grace.view).toEqual({ stage: 'waiting', calls: [{ id: PUSH_ID, description: PUSH }], total: 1, leftMs: GRACE_MS })
    // Up to the last millisecond of the grace nothing is halted and nothing written.
    h.clock.advance(GRACE_MS - 1)
    // The steps after the grace would run on the next ticks: give them those ticks.
    for (let tick = 0; tick < 5; tick++) await new Promise((done) => setImmediate(done))
    expect(quits()).toBe(0)
    expect(suspendedOf(h)).toBeUndefined()
    h.clock.advance(1)
    await left
    expect(quits()).toBe(1)
    expect(views.at(-1)).toBeNull()
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'quit', wave: 1 })
    expect(checkRecovery(h.recovery({ stop: null, suspended: 'quit', waves: 1 }))).toEqual([])
  })

  it('a Subagent holds gh pr merge without a result: the quit waits for it no longer than GRACE_MS by the test clock, and the window names it (worfy-continuity ticket 07)', async () => {
    const { h, grace, views, quits } = quitRun({ scripts: [WAVE_UNTIL_INTERRUPT], marks: 'claimed' })
    await inWave1(h)
    // The Orchestrator's own turn has no call outside the machine; its implementer of 01, a background Subagent, has one.
    const session = h.registry.list().find((info) => info.sdkSessionId !== null)!.sdkSessionId!
    writeFileSync(join(h.transcripts, `${session}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: session, timestamp: '2026-11-18T09:59:00.000Z', message: { role: 'user', content: 'go' } })}\n`)
    mkdirSync(join(h.transcripts, session, 'subagents'), { recursive: true })
    const merge = {
      type: 'assistant',
      isSidechain: true,
      agentId: 'impl01',
      sessionId: session,
      timestamp: '2026-11-18T10:20:00.000Z',
      message: { id: 'm-merge', role: 'assistant', content: [{ type: 'tool_use', id: 't-merge', name: 'Bash', input: { command: 'gh pr merge 41 --squash', description: 'Merge the PR' } }] },
    }
    appendFileSync(join(h.transcripts, session, 'subagents', 'agent-impl01.jsonl'), `${JSON.stringify(merge)}\n`)

    const left = grace.leave('quit')
    await until(() => grace.view !== null, 'the window «Quitting worfy»')
    expect(grace.view).toEqual({ stage: 'waiting', calls: [{ id: 't-merge', description: 'gh pr merge 41' }], total: 1, leftMs: GRACE_MS })
    h.clock.advance(GRACE_MS - 1)
    for (let tick = 0; tick < 5; tick++) await new Promise((done) => setImmediate(done))
    expect(quits()).toBe(0)
    expect(suspendedOf(h)).toBeUndefined()
    h.clock.advance(1)
    await left
    expect(quits()).toBe(1)
    expect(views.at(-1)).toBeNull()
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'quit', wave: 1 })
    expect(checkRecovery(h.recovery({ stop: null, suspended: 'quit', waves: 1 }))).toEqual([])
  })

  it('the result of git push comes before the grace ends: the quit goes on right after it', async () => {
    const { h, grace, calls, quits } = quitRun({ scripts: [PUSH_UNTIL_RELEASE], marks: 'claimed' })
    await inWave1(h)
    await until(() => calls.open().length > 0, 'git push to be called')
    const left = grace.leave('update')
    await until(() => grace.view !== null, 'the window «Quitting worfy»')
    h.clock.advance(1000)
    h.releases.release('push')
    await left
    expect(quits()).toBe(1)
    // The clock moved one second of the 60: the result, not the limit, let the quit go.
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'update', wave: 1 })
  })

  it('Quit now: the quit goes on at once', async () => {
    const { h, grace, calls, quits } = quitRun({ scripts: [PUSH_UNTIL_INTERRUPT], marks: 'claimed' })
    await inWave1(h)
    await until(() => calls.open().length > 0, 'git push to be called')
    const left = grace.leave('quit')
    await until(() => grace.view !== null, 'the window «Quitting worfy»')
    grace.quitNow()
    await left
    expect(quits()).toBe(1)
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'quit' })
  })

  it('during the wait for the Limits: run-suspended carries the wait with its until, and nothing is continued', async () => {
    // Wave 1 goes through; the turn of Wave 2 is refused by the Limits. Its Ticket stays claimed for the record.
    const { h, grace } = quitRun({ scripts: ['autopilot-waves', 'autopilot-limits'] })
    h.registry.observe((_sessionId, event) => {
      if (event.type === 'prompt' && /epic-wave .*\b01, 02\b/u.test(event.text)) h.setMarks('claimed')
    })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.state().status === 'waiting' || h.state().status === 'stopped', 'the wait for the Limits')
    expect(h.state()).toMatchObject({ status: 'waiting', wave: 2 })
    const waiting = h.journal(1).findLast((event) => event.kind === 'waiting-until') as Extract<JournalEvent, { kind: 'waiting-until' }>
    const messages = h.messages().length
    await grace.leave('update')
    expect(h.journal(1).at(-1)).toMatchObject({ kind: 'run-suspended', cause: 'update', wave: 2, tickets: ['03'], wait: { kind: 'limits', until: waiting.until } })
    // The wait's timer is gone: the reset passes and no continuation goes.
    h.clock.advance(24 * 3_600_000)
    expect(h.messages()).toHaveLength(messages)
    expect(h.clock.pending()).toEqual([])
    expect(checkRecovery(h.recovery({ stop: null, suspended: 'update', waves: 2 }))).toEqual([])
  })

  it('a shutdown of the system: run-suspended with shutdown, without the grace', async () => {
    const { h, grace, calls, views, quits } = quitRun({ scripts: [PUSH_UNTIL_INTERRUPT], marks: 'claimed' })
    await inWave1(h)
    await until(() => calls.open().length > 0, 'git push to be called')
    await grace.shutdown()
    expect(quits()).toBe(1)
    expect(views).toEqual([])
    const suspended: SuspendCause | undefined = suspendedOf(h)?.cause
    expect(suspended).toBe('shutdown')
  })
})
