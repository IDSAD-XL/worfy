// Auto-continue on a Codex Orchestrator (worfy-retry ticket 08; .scratch/worfy-retry/spec.md, the rows of
// ticket 08 in the scenarios table and Q6 (a)): the same switch as on Claude Code, with the kind of a failed
// turn read from Codex's `codexErrorInfo`. Each scenario runs on the fake Codex app-server (WORFY_CODEX=fake,
// a CODEX_HOME of the test; the real Codex never starts), through faultRun({ vendor: 'codex' })
// (autopilot-faults-setup.ts): the real Session registry, Orchestrators, LimitsTracker and Autopilot.
//
// - An Autopilot Run, Auto-continue on: `serverOverloaded` is retried as a 529 is (`turn-retry`, one
//   continuation at the timer, `resumed`); an error Codex retries by itself (`willRetry: true`) is left to
//   Codex; a quota with nothing to reset stops the run at once; a Subagent spawned (`collabAgentToolCall`)
//   without its result refuses the retry (`retry-refused` `in-flight`).
// - A manual turn of the Orchestrator: the module of worfy-retry ticket 06 (orchestrator-continue.ts),
//   wired as app-orchestrators.ts wires it, over the same registry, with the clock and timers of the test:
//   the same four cases, and a refusal by a window of the Limits, whose windows are read anew on the fake
//   (account/rateLimits/read) before the continuation goes (spec Q7 (a)).
//
// The scripts: test/fixtures/codex-scripts/auto-continue-*.jsonl (codex-fake.test.ts checks their schema).
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LimitsRefresher } from '../../src/main/agent/limits-usage'
import { clockText, OrchestratorContinue } from '../../src/main/agent/orchestrator-continue'
import { hasExited } from '../../src/main/agent/session/process'
import { CONTINUE_TEXT, type VendorUsage } from '../../src/main/autopilot/limits-wait'
import { codexAskStarter, type StartCodex } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexLimitsPart } from '../../src/main/vendors/codex/limits'
import { MAX_RETRIES, RETRY_DELAYS_MS, retryText } from '../../src/shared/agent/continue-plan'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { scriptNode } from '../script-node'
import { faultRun, LIMITS_RESET_MS, PROJECT, START_MS, until, type FaultRun } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

/** What the default Run wave template sends for Wave 1 of the Epic (ADR-0033). */
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
/** The start of every continuation after a temporary API error (retryText). */
const RETRY_START = 'The previous turn ended with a temporary API error'
/** A person's message in the Orchestrator's chat. */
const PERSON = 'Merge the PRs of Wave 3, then start Wave 4 with background agents.'

type TurnRetry = Extract<JournalEvent, { kind: 'turn-retry' }>

const continuations = (h: FaultRun): string[] => h.messages().filter((text) => text.startsWith(RETRY_START))
const retries = (h: FaultRun): TurnRetry[] => h.journal(1).filter((event): event is TurnRetry => event.kind === 'turn-retry')
const waveCommands = (h: FaultRun): string[] => h.messages().flatMap((text) => text.split('\n').filter((line) => /^\s*\/(?:worfy:)?epic-wave\b/u.test(line)))

const modules: OrchestratorContinue[] = []
afterEach(() => {
  for (const module of modules.splice(0)) module.stop()
})

// ── an Autopilot Run ─────────────────────────────────────────────────────────

/**
 * A Run on Codex with Auto-continue on whose Wave Session plays `script`. The fake app-servers start in
 * this order: 1 the attended Orchestrator (`turn`), 2 the Run's unattended Session (`script`), then
 * whatever the Run starts after it (`autopilot-wave` for a new Wave, `resume` for the give-back).
 */
async function codexRun(script: string): Promise<FaultRun> {
  const h = faultRun({ vendor: 'codex', autoContinue: true, codexScripts: ['turn', script, 'autopilot-wave', 'resume'] })
  expect(await h.start()).toEqual({ refusal: null })
  return h
}

describe('Auto-continue of an Autopilot Run on Codex (worfy-retry ticket 08)', () => {
  it('serverOverloaded, then a turn that goes through: turn-retry 1 of 5, one continuation at the timer, resumed', async () => {
    const h = await codexRun('auto-continue-server-overloaded')
    await until(() => retries(h).length === 1 && h.state().status === 'waiting', 'turn-retry 1')
    const at = START_MS + RETRY_DELAYS_MS[0]!
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'retry', retry: { attempt: 1, of: MAX_RETRIES }, resumesAt: at, wave: 1 })
    expect(retries(h)).toMatchObject([{ attempt: 1, of: MAX_RETRIES, error: 'overloaded' }])
    expect(retries(h)[0]!.message).toMatch(/high demand/u)
    expect(h.messages()).toEqual([WAVE_1])

    h.clock.advanceTo(at)
    await until(() => h.kinds(1).includes('wave-finished'), 'the end of Wave 1')
    const kinds = h.kinds(1).filter((kind) => kind !== 'ticket-status' && kind !== 'background-tasks')
    expect(kinds.slice(0, kinds.indexOf('wave-finished') + 1)).toEqual(['run-started', 'wave-started', 'turn-retry', 'resumed', 'wave-finished'])
    expect(continuations(h)).toEqual([retryText({ attempt: 1, of: MAX_RETRIES, error: 'overloaded', actions: [] })])
    expect(h.kinds(1)).not.toContain('session-error')
    expect(h.kinds(1)).not.toContain('limits-hit')
    // The Wave's command went once; the continuation is not one.
    expect(waveCommands(h)).toEqual([WAVE_1])
    await h.autopilot.forceStop(PROJECT)
  })

  it('willRetry: true is Codex\'s own retry: worfy sends nothing, no turn-retry, and the turn ends as it ends', async () => {
    const h = await codexRun('auto-continue-will-retry')
    await until(() => h.kinds(1).includes('wave-finished'), 'the end of Wave 1')
    expect(h.kinds(1)).not.toContain('turn-retry')
    expect(h.kinds(1)).not.toContain('retry-refused')
    expect(h.kinds(1)).not.toContain('session-error')
    expect(continuations(h)).toEqual([])
    expect(h.state().waitingFor).not.toBe('retry')
    expect(waveCommands(h)).toEqual([WAVE_1])
    await h.autopilot.forceStop(PROJECT)
  })

  it('a quota with nothing to reset: the run stops at once with vendor-quota and the reason, no wait and no continuation', async () => {
    const h = await codexRun('auto-continue-quota')
    await h.stopped(1)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'vendor-quota', wave: 1 })
    expect(h.journal(1).find((event) => event.kind === 'limits-hit')).toMatchObject({ reason: 'quota', message: expect.stringMatching(/usage limit/u) })
    expect(h.journal(1).find((event) => event.kind === 'run-stopped')).toMatchObject({ reason: 'vendor-quota' })
    expect(h.kinds(1)).not.toContain('waiting-until')
    expect(h.kinds(1)).not.toContain('turn-retry')
    expect(h.messages()).toEqual([WAVE_1])
  })

  it('a Subagent spawned (collabAgentToolCall) without its result, then serverOverloaded: retry-refused in-flight, no continuation', async () => {
    const h = await codexRun('auto-continue-collab-in-flight')
    await h.stopped(1)
    expect(h.state()).toMatchObject({ status: 'stopped', reason: 'turn-error', wave: 1 })
    expect(h.journal(1).filter((event) => event.kind === 'retry-refused')).toEqual([expect.objectContaining({ reason: 'in-flight', actions: ['collabAgentToolCall'] })])
    expect(h.kinds(1)).not.toContain('turn-retry')
    expect(continuations(h)).toEqual([])
    expect(h.messages()).toEqual([WAVE_1])
  })
})

// ── the cleanup after a run ──────────────────────────────────────────────────

/** How long each gh call of the run below waits before it ends (the hang mode of gh-stub.mjs). */
const GH_HANG_MS = 3_000

/** The process ids of the run's hung gh calls so far (hang.pids of its gh stand-in). */
function hungPids(h: FaultRun): number[] {
  try {
    return readFileSync(join(h.gh!.dir, 'hang.pids'), 'utf8').split('\n').filter((line) => line.trim() !== '').map(Number)
  } catch {
    return []
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('The cleanup after a Codex run (worfy-polish ticket 90)', () => {
  // A Force stop does not wait for a PR read (Autopilot's endRead drops its answer), so its gh stand-in
  // went on after the run had stopped and wrote gh/calls.jsonl into the folder the afterEach was removing:
  // ENOTEMPTY. The shared cleanup now waits for the run's PR reads before it removes the folder.
  it('a PR read the Force stop left running: the folder goes only after its gh has exited', async () => {
    const h = faultRun({ vendor: 'codex', autoContinue: true, codexScripts: ['turn', 'auto-continue-will-retry', 'autopilot-wave', 'resume'] })
    writeFileSync(join(h.gh!.dir, 'hang'), String(GH_HANG_MS))
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => hungPids(h).length > 0, 'a gh call of the run')
    await h.autopilot.forceStop(PROJECT)
    const [pid] = hungPids(h)
    expect(alive(pid!)).toBe(true)
    // Runs after every afterEach, the removal of the run's folder among them.
    onTestFinished(() => {
      expect(alive(pid!)).toBe(false)
      expect(existsSync(h.scratch)).toBe(false)
    })
  })
})

// ── a manual turn ────────────────────────────────────────────────────────────

const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const REPO = join(import.meta.dirname, '..', '..')

/** The fake app-servers the windows' polls started, for the check that none is left. */
const polls: ChildProcess[] = []
afterEach(async () => {
  for (const child of polls.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    child.kill('SIGKILL')
    await exited
  }
})

/**
 * The Project's Orchestrator on Codex, attended, playing `script`, with Auto-continue on and the module of
 * a manual turn following it as app-orchestrators.ts wires it: the Orchestrators' views, the Limits of the
 * test's LimitsTracker, and the windows read anew through a LimitsRefresher whose Codex poll starts the fake
 * app-server on the next of `pollScripts` (codexLimitsPart.poll: account/read, account/rateLimits/read).
 * A person's message starts the turn. `options.scripts`: the scripts of the app-servers started after the
 * first (a New Orchestrator Session); `options.usage`: the read of the windows the module gets in place of the real one.
 * The switch is on until `switchOff()`, which tells the module as the settings store's `changed` does.
 */
async function manualTurn(script: string, options: { polls?: readonly string[]; scripts?: readonly string[]; usage?: VendorUsage } = {}) {
  const pollScripts = options.polls ?? []
  let continuer: OrchestratorContinue | null = null
  let sessionId: string | null = null
  let on = true
  const settingsListeners: (() => void)[] = []
  const h = faultRun({
    vendor: 'codex',
    codexScripts: [script, ...(options.scripts ?? [])],
    publish: (view) => {
      if (view.sessionId !== null) sessionId = view.sessionId
      continuer?.view(view)
    },
  })
  const events: { sessionId: string; event: AgentEvent }[] = []
  h.registry.observe((id, event) => events.push({ sessionId: id, event }))
  const pollsDone: string[] = []
  const start: StartCodex = (listener) => {
    const name = pollScripts[pollsDone.length]
    if (name === undefined) return Promise.reject(new Error('the test gives no more polls of the windows'))
    pollsDone.push(name)
    return codexAskStarter({
      runtime: RUNTIME,
      appPath: REPO,
      cwd: h.scratch,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: name, WORFY_CODEX_LOG: join(h.scratch, `poll-${pollsDone.length}.log`) },
      spawnProcess: (_file, args, options) => {
        const child = spawn(scriptNode(), [...args], options)
        polls.push(child)
        return child
      },
      log: () => undefined,
    })(listener)
  }
  const codexPoll = codexLimitsPart({ start, codexHome: () => h.codexHome, now: () => h.clock.now })
  const refresher = new LimitsRefresher({ limits: h.tracker, vendors: [{ vendor: 'codex', poll: (signal) => codexPoll.poll(signal) }], now: () => h.clock.now, log: () => undefined })
  const refreshes: (string | undefined)[] = []
  continuer = new OrchestratorContinue({
    observe: (sink) => h.registry.observe(sink),
    session: (id) => h.registry.get(id),
    enabled: (projectId) => projectId === PROJECT && on,
    observeSettings: (listener) => {
      settingsListeners.push(listener)
      return () => undefined
    },
    limits: () => h.tracker.snapshot(),
    windows: (vendor) => h.tracker.windowsOf(vendor),
    usage: options.usage ?? {
      refresh: (olderThanMs, vendor) => {
        refreshes.push(vendor)
        return refresher.refreshIfOlder(olderThanMs, vendor)
      },
    },
    now: () => h.clock.now,
    schedule: h.clock.schedule,
    random: () => 0.5,
  })
  modules.push(continuer)
  const view = await h.orchestrators.open(PROJECT)
  continuer.view(view)
  sessionId = view.sessionId
  expect(view.vendor).toBe('codex')
  const session = () => h.registry.get(sessionId!)
  await until(() => session().state === 'idle', 'the Orchestrator to be idle')
  session().send(PERSON)
  // The Session takes the thread's id once Codex starts it (`renamed`): its events are read by either id.
  const ours = (id: string): boolean => id === sessionId || id === view.sessionId
  const notices = (): string[] => events.flatMap(({ sessionId: id, event }) => (ours(id) && event.type === 'notice' && event.kind === 'notification' && event.text.startsWith('worfy:') ? [event.text] : []))
  const results = (): boolean[] => events.flatMap(({ sessionId: id, event }) => (ours(id) && event.type === 'result' ? [event.isError] : []))
  const switchOff = (): void => {
    on = false
    for (const listener of settingsListeners) listener()
  }
  /** worfy's lines in any Session's transcript, the old Session's and the new one's. */
  const anyNotices = (): string[] => events.flatMap(({ event }) => (event.type === 'notice' && event.kind === 'notification' && event.text.startsWith('worfy:') ? [event.text] : []))
  return { h, continuer, notices, anyNotices, results, pollsDone, refreshes, session, switchOff }
}

/**
 * A read of Codex's windows that does not answer until the test says: `open()` resolves it with nothing
 * read (the windows known decide), `fail()` rejects it.
 */
function heldRead() {
  const calls: (string | undefined)[] = []
  let resolve: (() => void) | null = null
  let reject: ((error: Error) => void) | null = null
  const usage: VendorUsage = {
    refresh: (_olderThanMs, vendor) => {
      calls.push(vendor)
      return new Promise<void>((done, failed) => {
        resolve = done
        reject = failed
      })
    },
  }
  return {
    usage,
    calls,
    open: (): void => resolve?.(),
    fail: (): void => reject?.(new Error('no answer from Codex')),
  }
}

/** Collects the unhandled rejections while `body` runs, and answers them. */
async function unhandledDuring(body: () => Promise<void>): Promise<unknown[]> {
  const found: unknown[] = []
  const listener = (reason: unknown): void => void found.push(reason)
  process.on('unhandledRejection', listener)
  try {
    await body()
    // An unhandled rejection is reported after the microtasks of its turn: give it a turn of the event loop.
    await new Promise((done) => setTimeout(done, 50))
  } finally {
    process.off('unhandledRejection', listener)
  }
  return found
}

const tick = (wait = 100): Promise<void> => new Promise((done) => setTimeout(done, wait))

describe('Auto-continue of a manual turn of a Codex Orchestrator (worfy-retry ticket 08)', () => {
  it('serverOverloaded: one continuation at the timer, never the person\'s message again; the continuation\'s turn goes through', async () => {
    const { h, continuer, notices, results } = await manualTurn('auto-continue-server-overloaded')
    const at = START_MS + RETRY_DELAYS_MS[0]!
    await until(() => continuer.wait(PROJECT) !== null, 'the wait for the continuation')
    expect(continuer.wait(PROJECT)).toEqual({ kind: 'retry', attempt: 1, of: MAX_RETRIES, error: 'overloaded', until: at })
    await until(() => notices().length === 1, 'the line of the wait')
    expect(notices()[0]).toBe(`worfy: API error 529, retry 1 of ${MAX_RETRIES} at ${clockText(at, h.clock.now)}`)
    expect(h.messages()).toEqual([PERSON])

    h.clock.advanceTo(at)
    await until(() => results().length === 2, 'the turn of the continuation')
    expect(results()).toEqual([true, false])
    expect(h.messages()).toEqual([PERSON, retryText({ attempt: 1, of: MAX_RETRIES, error: 'overloaded', actions: [] })])
    expect(notices()[1]).toBe(`worfy: sent "continue" (retry 1 of ${MAX_RETRIES})`)
    expect(continuer.wait(PROJECT)).toBeNull()
    expect(h.clock.pending()).toEqual([])
  })

  it('willRetry: true: Codex retries by itself; worfy sets no timer and sends nothing', async () => {
    const { h, continuer, notices, results } = await manualTurn('auto-continue-will-retry')
    await until(() => results().length === 1, 'the end of the turn')
    await tick()
    expect(results()).toEqual([false])
    expect(continuer.wait(PROJECT)).toBeNull()
    expect(h.clock.pending()).toEqual([])
    expect(notices()).toEqual([])
    expect(h.messages()).toEqual([PERSON])
  })

  it('a quota with nothing to reset: no wait, a line that says why, nothing sent', async () => {
    const { h, continuer, notices, results } = await manualTurn('auto-continue-quota')
    await until(() => results().length === 1, 'the end of the turn')
    await until(() => notices().length === 1, 'the line of the refusal')
    await tick()
    expect(notices()).toEqual(['worfy: not continued: the Limits refused the turn by a quota, and nothing resets'])
    expect(continuer.wait(PROJECT)).toBeNull()
    expect(h.clock.pending()).toEqual([])
    expect(h.messages()).toEqual([PERSON])
  })

  it('a Subagent spawned without its result, then serverOverloaded: not retried, the line names the call', async () => {
    const { h, continuer, notices, results } = await manualTurn('auto-continue-collab-in-flight')
    await until(() => results().length === 1, 'the end of the turn')
    await until(() => notices().length === 1, 'the line of the refusal')
    await tick()
    expect(notices()).toEqual(['worfy: not retried: `collabAgentToolCall` may or may not have run'])
    expect(continuer.wait(PROJECT)).toBeNull()
    expect(h.clock.pending()).toEqual([])
    expect(h.messages()).toEqual([PERSON])
  })

  it('the Limits refuse by the 5-hour window: at its reset the windows are read anew (spec Q7 (a)); still used up — nothing goes and the wait goes on; open — one continuation', async () => {
    const { h, continuer, notices, results, pollsDone, refreshes } = await manualTurn('auto-continue-limits-window', { polls: ['auto-continue-limits-poll-used-up', 'account-plus'] })
    const first = LIMITS_RESET_MS + RESUME_MARGIN_MS
    await until(() => continuer.wait(PROJECT) !== null, 'the wait for the reset')
    expect(continuer.wait(PROJECT)).toEqual({ kind: 'limits', window: 'primary', until: first })
    expect(results()).toEqual([true])
    // The countdown in the chat (worfy-retry ticket 07) is told of each wait, also of the one the read starts.
    const told: (number | null)[] = []
    continuer.observeWaits(() => told.push(continuer.wait(PROJECT)?.until ?? null))

    // The reset: the read says the window is still used up, with a new reset an hour later.
    h.clock.advanceTo(first)
    const second = LIMITS_RESET_MS + 3_600_000 + RESUME_MARGIN_MS
    await until(() => continuer.wait(PROJECT)?.until === second, 'the second wait')
    await until(() => told.includes(second), 'the countdown told of the second wait')
    expect(pollsDone).toEqual(['auto-continue-limits-poll-used-up'])
    expect(refreshes).toEqual(['codex'])
    expect(h.messages()).toEqual([PERSON])
    expect(h.clock.pending().map((timer) => timer.at)).toEqual([second])
    await until(() => notices().length === 2, 'the line of the second wait')
    expect(notices()).toEqual([`worfy: waiting for the Limits, resumes ${clockText(first, START_MS)}`, `worfy: waiting for the Limits, resumes ${clockText(second, first)}`])

    // The next reset: the read finds the window open, and one continuation goes.
    h.clock.advanceTo(second)
    await until(() => results().length === 2, 'the turn of the continuation')
    expect(pollsDone).toEqual(['auto-continue-limits-poll-used-up', 'account-plus'])
    expect(refreshes).toEqual(['codex', 'codex'])
    expect(results()).toEqual([true, false])
    expect(h.messages()).toHaveLength(2)
    expect(h.messages()[1]!.startsWith(CONTINUE_TEXT)).toBe(true)
    expect(notices().at(-1)).toBe('worfy: sent "continue" after the Limits wait')
    expect(continuer.wait(PROJECT)).toBeNull()
    expect(h.clock.pending()).toEqual([])
    await until(() => polls.every((child) => hasExited(child)), 'every poll\'s app-server to exit')
  })
})

/** What a person writes during the read of the windows. */
const SECOND = 'Check the open PRs first.'
/** The line of the first wait for the Limits (the reset of the 5-hour window, then the margin). */
const FIRST_WAIT_LINE = `worfy: waiting for the Limits, resumes ${clockText(LIMITS_RESET_MS + RESUME_MARGIN_MS, START_MS)}`

/**
 * The read of the windows at the reset does not answer until the test says. Whatever ends the wait while
 * it is read (a person's message, the switch, a New Orchestrator Session, the quit) wins: the read answering after
 * it — even "the window is open" — sends nothing (orchestrator-continue.ts limitsFired, isCurrent after the read).
 */
describe('Auto-continue of a manual turn on Codex: the wait ended during the read of the windows (worfy-retry ticket 08)', () => {
  /** The manual turn refused by the 5-hour window, its wait over, the read of the windows asked and held. */
  async function heldAtReset(options: { scripts?: readonly string[] } = {}) {
    const read = heldRead()
    const turn = await manualTurn('auto-continue-limits-window', { ...options, usage: read.usage })
    await until(() => turn.continuer.wait(PROJECT) !== null, 'the wait for the reset')
    turn.h.clock.advanceTo(LIMITS_RESET_MS + RESUME_MARGIN_MS)
    await until(() => read.calls.length === 1, 'the read of the windows at the reset')
    expect(read.calls).toEqual(['codex'])
    return { ...turn, read }
  }

  it("a person's message during the read takes the continuation's place: the read then finds the window open, and nothing more goes", async () => {
    const { h, continuer, notices, results, session, read } = await heldAtReset()
    session().send(SECOND)
    await until(() => results().length === 2, "the person's turn")
    await until(() => session().state === 'idle', 'the Orchestrator to be idle after it')
    read.open()
    await tick(200)
    expect(h.messages()).toEqual([PERSON, SECOND])
    expect(notices()).toEqual([FIRST_WAIT_LINE])
    expect(continuer.wait(PROJECT)).toBeNull()
  })

  it('Auto-continue switched off during the read: one line says so, and the read answering after it sends nothing and says nothing more', async () => {
    const { h, continuer, notices, read, switchOff } = await heldAtReset()
    switchOff()
    await until(() => notices().length === 2, 'the line of the switch')
    read.open()
    await tick(200)
    expect(h.messages()).toEqual([PERSON])
    expect(notices()).toEqual([FIRST_WAIT_LINE, 'worfy: Auto-continue is off; nothing was sent'])
    expect(continuer.wait(PROJECT)).toBeNull()
  })

  it("New Orchestrator Session during the read: the old Session's wait ends with it, and the new Session gets no continuation", async () => {
    const { h, continuer, anyNotices, session, read } = await heldAtReset({ scripts: ['turn'] })
    const old = session().id
    const view = await h.orchestrators.newConversation(PROJECT)
    expect(view.sessionId).not.toBe(old)
    await until(() => h.registry.get(view.sessionId!).state === 'idle', 'the new Session to be idle')
    read.open()
    await tick(200)
    expect(h.messages()).toEqual([PERSON])
    expect(anyNotices()).toEqual([FIRST_WAIT_LINE])
    expect(continuer.wait(PROJECT)).toBeNull()
  })

  it('the app quits during the read (the module stops): the read answering after it sends nothing', async () => {
    const { h, continuer, notices, session, read } = await heldAtReset()
    continuer.stop()
    read.open()
    await tick(200)
    expect(session().state).toBe('idle')
    expect(h.messages()).toEqual([PERSON])
    expect(notices()).toEqual([FIRST_WAIT_LINE])
  })
})

/**
 * The read of the windows at the reset fails (no answer from Codex): the windows known decide, as the
 * comment of LimitsWait.stillRefused says, and the failure reaches no one as an unhandled rejection.
 */
describe('Auto-continue of a manual turn on Codex: the read of the windows fails (worfy-retry ticket 08)', () => {
  it("the windows known have reset: one continuation goes, with no unhandled rejection", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const read = heldRead()
    const { h, continuer, notices, results } = await manualTurn('auto-continue-limits-window', { usage: read.usage })
    const unhandled = await unhandledDuring(async () => {
      await until(() => continuer.wait(PROJECT) !== null, 'the wait for the reset')
      h.clock.advanceTo(LIMITS_RESET_MS + RESUME_MARGIN_MS)
      await until(() => read.calls.length === 1, 'the read of the windows at the reset')
      read.fail()
      await until(() => results().length === 2, 'the turn of the continuation')
    })
    expect(unhandled).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read the Limits of codex after the wait'), expect.any(Error))
    expect(h.messages()).toHaveLength(2)
    expect(h.messages()[1]!.startsWith(CONTINUE_TEXT)).toBe(true)
    expect(notices()).toEqual([FIRST_WAIT_LINE, 'worfy: sent "continue" after the Limits wait'])
    expect(continuer.wait(PROJECT)).toBeNull()
    warn.mockRestore()
  })

  it('the windows known are still used up (a later reset known before the read): the wait goes on to it, nothing sent, no unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const read = heldRead()
    const { h, continuer, notices } = await manualTurn('auto-continue-limits-window', { usage: read.usage })
    const first = LIMITS_RESET_MS + RESUME_MARGIN_MS
    const second = LIMITS_RESET_MS + 3_600_000 + RESUME_MARGIN_MS
    const unhandled = await unhandledDuring(async () => {
      await until(() => continuer.wait(PROJECT) !== null, 'the wait for the reset')
      // The app's poll learnt meanwhile that the 5-hour window, used up, resets an hour later than the refusal said.
      h.tracker.setWindows('codex', [
        { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 100, windowMinutes: 300, resetsAt: LIMITS_RESET_MS / 1000 + 3600, state: 'reached', receivedAt: START_MS, source: 'read' },
        { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: 40, windowMinutes: 10080, resetsAt: LIMITS_RESET_MS / 1000 + 86_400, state: 'ok', receivedAt: START_MS, source: 'read' },
      ])
      h.clock.advanceTo(first)
      await until(() => read.calls.length === 1, 'the read of the windows at the reset')
      read.fail()
      await until(() => continuer.wait(PROJECT)?.until === second, 'the second wait')
    })
    expect(unhandled).toEqual([])
    expect(h.messages()).toEqual([PERSON])
    expect(h.clock.pending().map((timer) => timer.at)).toEqual([second])
    await until(() => notices().length === 2, 'the line of the second wait')
    expect(notices()).toEqual([FIRST_WAIT_LINE, `worfy: waiting for the Limits, resumes ${clockText(second, first)}`])
    warn.mockRestore()
  })
})
