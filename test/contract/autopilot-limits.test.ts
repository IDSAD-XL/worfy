// Autopilot waits for the Limits (worfy-daily ticket 05) on the fake agent: the real Session
// registry, Orchestrators, launcher, run journal, cycle and LimitsTracker, over a copy of an Epic in
// a temporary folder. The fake agent plays test/fixtures/agent-scripts/autopilot-limits.jsonl: the
// Wave's turn is refused by the Limits (`rate_limit_event` rejected, then an error `result`), the
// next turn goes through. The clock is fixed and the wait's timer is the test's: the test moves the
// clock and fires the timer "at the reset". keep-awake is a fake, nothing calls the model.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { LimitsTracker, LIMITS_FILE, observeSessionLimits, type SessionLimitsStatus } from '../../src/main/agent/limits'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { CONTINUE_TEXT, continueText, LimitsWait, WALL_TICK_MS, wallTimer } from '../../src/main/autopilot/limits-wait'
import { Autopilot, STOP_TEXT } from '../../src/main/autopilot/run'
import { emit } from '../../src/main/ipc/index'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { MAX_WAIT_MS, RECHECK_MS, RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { autopilotChanged, autopilotStateSchema, autopilotStatusLine, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const SCRIPT = 'autopilot-limits'
const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
const WAVE_2 = '/epic-wave Ticket-ы 03 эпика demo'

/** The reset of the refused 5-hour window in the fixture: 2026-10-05T07:10:00Z, in Unix seconds. */
const RESET_S = 1791184200
const RESET_MS = RESET_S * 1000
/** The run starts an hour before the reset. */
const START_MS = RESET_MS - 3_600_000

let scratch: string
let repo: string
let clock: number
let registries: SessionRegistry[] = []
let autopilots: Autopilot[] = []

// ── the Epic in a temporary folder (Wave 1: 01 and 02; Wave 2: 03) ───────────

const TICKETS = [
  { num: 1, blocked: '—' },
  { num: 2, blocked: '—' },
  { num: 3, blocked: '01, 02' },
]
const nn = (num: number): string => String(num).padStart(2, '0')
const ticketPath = (num: number): string => join(repo, '.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)
const written = new Map<string, string>()

function writeTicket(num: number, status: string): void {
  const { blocked } = TICKETS.find((each) => each.num === num)!
  const content = [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
  written.set(relative(repo, ticketPath(num)), content)
  writeFileSync(ticketPath(num), content)
}

const runner: EpicStatusRunner = (cwd) => {
  const dir = join(cwd, '.scratch', EPIC, 'issues')
  const tickets = readdirSync(dir).map((name) => {
    const text = readFileSync(join(dir, name), 'utf8')
    const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)?.[1] ?? null
    const status = field('Status')
    const blocked = field('Blocked by')
    const word = (status ?? '').split(/\s/)[0] ?? ''
    const state = /^done$/i.test(word) ? 'done' : /^claimed$/i.test(word) ? 'work' : 'open'
    const nums = blocked && blocked !== '—' ? blocked.split(',').map((each) => Number(each.trim())) : []
    const match = /^(\d+)-(.*)\.md$/.exec(name)!
    return { epic: EPIC, num: Number(match[1]), slug: match[2], title: text.split('\n')[0]!.replace(/^#\s*/, ''), statusRaw: status, state, blockedRaw: blocked, blockedNums: nums, blockedParsed: true }
  })
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
}

function tree(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(repo, path)] = readFileSync(path, 'utf8')
    }
  }
  walk(repo)
  return out
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autopilot-limits-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const { num } of TICKETS) writeTicket(num, 'open')
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  clock = START_MS
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// ── the harness ──────────────────────────────────────────────────────────────

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

const tick = (ms = 50): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** The fixture's lines as objects, for a variant of the script. */
const fixtureLines = (): Record<string, unknown>[] =>
  readFileSync(join(fixtures, `${SCRIPT}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

const isRejected = (line: Record<string, unknown>): boolean =>
  line.type === 'rate_limit_event' && (line.rate_limit_info as { status?: string } | undefined)?.status === 'rejected'

/** The line, with no `resetsAt` in it when it is the refusal's `rate_limit_event`. */
function withoutResetsAt(line: Record<string, unknown>): Record<string, unknown> {
  if (!isRejected(line)) return line
  const info = { ...(line.rate_limit_info as Record<string, unknown>) }
  delete info.resetsAt
  return { ...line, rate_limit_info: info }
}

/** The fixture's two turns: the one refused by the Limits, then the one that goes through. */
function fixtureTurns(): { refused: Record<string, unknown>[]; passing: Record<string, unknown>[] } {
  const all = fixtureLines()
  const second = all.findIndex((line, i) => i > 0 && line.fake === 'wait_message')
  return { refused: all.slice(0, second), passing: all.slice(second) }
}

/** The Session's only live Session id (the Orchestrator's). */
const orchestratorSession = (registry: SessionRegistry): string => registry.list()[0]!.sessionId

/** The statuses a run went through, each run of the same status once. */
const statusesOf = (states: AutopilotState[]): string[] => states.map((state) => state.status).filter((status, i, all) => i === 0 || all[i - 1] !== status)

interface Timer {
  at: number
  fire: () => void
  cancelled: boolean
}

interface HarnessOptions {
  /** A variant of the fixture: its lines, changed; written to a scripts folder of the test. */
  lines?: Record<string, unknown>[]
  /** limits.json before the app starts. */
  limitsFile?: unknown
}

function harness(options: HarnessOptions = {}) {
  const dataRoot = join(scratch, 'data-root')
  mkdirSync(dataRoot, { recursive: true })
  if (options.limitsFile !== undefined) writeFileSync(join(dataRoot, LIMITS_FILE), JSON.stringify(options.limitsFile))
  let scriptsDir = fixtures
  if (options.lines !== undefined) {
    scriptsDir = join(scratch, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(scriptsDir, `${SCRIPT}.jsonl`), options.lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  }
  const tracker = new LimitsTracker({ dataDir: dataRoot, now: () => clock })
  const calls: FakeCall[] = []
  const registry = new SessionRegistry(
    tracker.observe((request) =>
      fakeQueryFactory({ scriptsDir, script: request.unattended === true ? SCRIPT : 'autopilot-waves', record: (call) => (request.unattended === true ? calls.push(call) : undefined) })(request),
    ),
  )
  registries.push(registry)
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const workflow = async (root: string) => (await readWorkflow({ root, claudeHome: join(scratch, 'claude-home') }, runner)).model
  const launcher = new ActionLauncher({
    projectRoot: () => repo,
    settings: () => ({ actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } }),
    branch: () => Promise.resolve('main'),
    workflow,
    sessions: { create: () => ({ nodeId: 'n', sessionId: 's' }) as never },
    orchestrators,
    registry,
    bindings: { setLaunch: () => undefined },
    pollMs: 5,
    waitMs: 200,
  })
  // What the agent does: marks the Wave's Tickets done when its "Run wave" arrives.
  registry.observe((_sessionId, event) => {
    if (event.type !== 'prompt') return
    if (event.text === WAVE_1) for (const num of [1, 2]) writeTicket(num, 'done — 2026-10-06')
    if (event.text === WAVE_2) writeTicket(3, 'done — 2026-10-06')
  })
  const env = { WORFY_DATA_DIR: dataRoot }
  const timers: Timer[] = []
  const states: AutopilotState[] = []
  const power: string[] = []
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: () => Promise.resolve(null),
    workflow,
    watchWorkflow: () => Promise.resolve(() => undefined),
    orchestrators,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    keepAwake: () => ({ start: () => power.push('start'), stop: () => power.push('stop') }),
    onChange: (state) => states.push(state),
    settleMs: 60_000,
    limits: {
      state: () => tracker.snapshot(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => registry.observe(sink), isSession, listener),
      send: (sessionId, text) => {
        registry.get(sessionId).send(text)
      },
      now: () => clock,
      schedule: (at, fire) => {
        const timer: Timer = { at, fire, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    },
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  const journal = async (): Promise<JournalEvent[]> => {
    const runs = readdirSync(join(dataRoot, 'autopilot')).map((name) => name.replace(/\.jsonl$/, ''))
    expect(runs).toHaveLength(1)
    return (await readRun(runs[0]!, { env }))!.events
  }
  const kinds = async () => (await journal()).map((event) => event.kind)
  const messages = () => calls.filter((call): call is Extract<FakeCall, { kind: 'message' }> => call.kind === 'message').map((call) => call.text)
  const state = () => autopilot.state(PROJECT)
  /** The run's live timer: the last one set and not cancelled. */
  const live = () => timers.filter((timer) => !timer.cancelled)
  return { autopilot, registry, orchestrators, tracker, timers, live, states, power, journal, kinds, messages, state }
}

const iso = (ms: number): string => new Date(ms).toISOString()
const S = (ms: number): number => ms / 1000

// ── the runs ─────────────────────────────────────────────────────────────────

describe('Autopilot and the Limits on the fake agent', () => {
  it('waits for the reset after a refusal, sends the Orchestrator on exactly once at the reset, and runs again', async () => {
    const h = harness()
    const before = tree()
    written.clear()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')

    // Waiting: until the reset of the refused window plus the margin; keep-awake is still held.
    const resumesAt = RESET_MS + RESUME_MARGIN_MS
    expect(h.state()).toMatchObject({ status: 'waiting', wave: 1, resumesAt, reason: null })
    expect(autopilotStateSchema.parse(h.state())).toEqual(h.state())
    expect(autopilotStatusLine(h.state(), { timeZone: 'UTC' })).toBe('waiting for limits · resumes 07:12')
    expect(h.power).toEqual(['start'])
    expect(h.live().map((timer) => timer.at)).toEqual([resumesAt])
    await tick()
    expect(h.messages()).toEqual([WAVE_1])

    // The reset: the Orchestrator gets the continuation once, even if the timer fires twice.
    clock = resumesAt
    const timer = h.live()[0]!
    timer.fire()
    timer.fire()
    await until(() => h.messages().length >= 3, 'the continuation and Wave 2')
    const [, continuation] = h.messages()
    expect(continuation).toBe(continueText(START_MS, resumesAt))
    expect(continuation).toContain('HANDOFF')
    expect(continuation!.startsWith(CONTINUE_TEXT)).toBe(true)
    expect(h.messages().filter((text) => text.startsWith(CONTINUE_TEXT))).toHaveLength(1)
    // Between the waits the run was running again: its states go waiting → running → waiting.
    const statuses = h.states.map((state) => state.status).filter((status, i, all) => i === 0 || all[i - 1] !== status)
    expect(statuses.slice(0, 3)).toEqual(['running', 'waiting', 'running'])

    // The continuation's turn went through: Wave 1 is finished, Wave 2 is refused in its turn too.
    await until(() => h.state().status === 'waiting' && h.messages().length === 3, 'the second wait')
    expect(h.messages()).toEqual([WAVE_1, continuation, WAVE_2])
    expect(h.state()).toMatchObject({ status: 'waiting', wave: 2 })

    await h.autopilot.forceStop(PROJECT)
    expect(await h.kinds()).toEqual([
      'run-started',
      'wave-started',
      'limits-hit',
      'waiting-until',
      'resumed',
      'wave-finished',
      'wave-started',
      'limits-hit',
      'waiting-until',
      'run-stopped',
      'orchestrator-returned',
    ])
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'limits-hit')).toMatchObject({ window: 'five_hour', resetsAt: iso(RESET_MS) })
    expect(events.find((event) => event.kind === 'waiting-until')).toMatchObject({ until: iso(resumesAt) })
    expect(h.power).toEqual(['start', 'stop'])
    // worfy wrote nothing into the Project: every file is as before or what the agent wrote.
    expect(written.size).toBeGreaterThan(0)
    expect(tree()).toEqual({ ...before, ...Object.fromEntries(written) })
  })

  it('a graceful Stop during the wait keeps waiting; at the reset the Orchestrator gets one message, the continuation and STOP_TEXT, and the run ends with that turn (worfy-week ticket 18)', async () => {
    const h = harness()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    const timer = h.live()[0]!
    const stopping = await h.autopilot.stop(PROJECT)
    expect(stopping).toMatchObject({ status: 'waiting', stopping: true, resumesAt: timer.at })
    // The status line keeps the wait: it says when the run goes on.
    expect(autopilotStatusLine(stopping, { timeZone: 'UTC' })).toBe('waiting for limits · resumes 07:12')
    expect(timer.cancelled).toBe(false)
    // Nothing goes during the wait: the Session would refuse the turn.
    await tick()
    expect(h.messages()).toEqual([WAVE_1])
    // The reset: one message, the continuation and then STOP_TEXT.
    clock = timer.at
    timer.fire()
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.messages()).toEqual([WAVE_1, `${continueText(START_MS, timer.at)}\n\n${STOP_TEXT}`])
    expect(h.state()).toMatchObject({ reason: 'user-stop', wave: 1, stopping: false, resumable: [] })
    // Wave 2 was ready after the continuation's turn and did not go.
    expect(await h.kinds()).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until', 'run-stopping', 'resumed', 'run-stopped'])
    await until(() => !h.orchestrators.isUnattended(PROJECT), 'the Orchestrator to be given back')
    expect(autopilotStatusLine(h.state())).toBe('stopped: user stop')
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('a Stop clicked as the wait ends, its step behind the continuation\'s: still one message, the continuation and STOP_TEXT', async () => {
    const h = harness()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    const timer = h.live()[0]!
    clock = timer.at
    // The reset fires first; the click lands before the run has sent the continuation.
    timer.fire()
    const answer = h.autopilot.stop(PROJECT)
    await until(() => h.state().status === 'stopped', 'the run to stop')
    await answer
    expect(h.messages()).toEqual([WAVE_1, `${continueText(START_MS, timer.at)}\n\n${STOP_TEXT}`])
    expect(h.state()).toMatchObject({ reason: 'user-stop', wave: 1 })
    expect(await h.kinds()).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until', 'resumed', 'run-stopping', 'run-stopped'])
  })

  it('Force stop during the wait cancels the timer: no continuation goes out (worfy-week tickets 17, 18)', async () => {
    const h = harness()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    const timer = h.live()[0]!
    const stopped = await h.autopilot.forceStop(PROJECT)
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'user-force-stop', resumesAt: null })
    expect(timer.cancelled).toBe(true)
    // A timer that fires late all the same sends nothing.
    clock = timer.at
    timer.fire()
    await tick()
    expect(h.messages()).toEqual([WAVE_1])
    // Force stop gives the Orchestrator back to the person at once (worfy-week ticket 17): its Session was idle, waiting.
    expect(await h.kinds()).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until', 'run-stopped', 'orchestrator-returned'])
    expect(h.orchestrators.isUnattended(PROJECT)).toBe(false)
    expect(autopilotStatusLine(h.state())).toBe('stopped: user force stop')
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('takes the reset time from limits.json when the refusal has none', async () => {
    const known = RESET_S + 600
    const lines = fixtureLines().map(withoutResetsAt)
    const h = harness({ lines, limitsFile: { windows: { five_hour: { utilization: 0.97, resetsAt: known, status: 'allowed_warning', receivedAt: START_MS - 60_000, source: 'statusline' } } } })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    expect(h.state().resumesAt).toBe(known * 1000 + RESUME_MARGIN_MS)
    expect((await h.journal()).find((event) => event.kind === 'limits-hit')).toMatchObject({ window: 'five_hour', resetsAt: null })
    // The refusal without a reset time did not wipe the one known in limits.json.
    expect(h.tracker.snapshot().windows.five_hour).toMatchObject({ status: 'rejected', resetsAt: known })
    expect(JSON.parse(readFileSync(join(scratch, 'data-root', LIMITS_FILE), 'utf8'))).toMatchObject({ windows: { five_hour: { resetsAt: known } } })
  })

  it('waits by limits.json when the refusal\'s event did not parse, from the error text of the result', async () => {
    const lines = fixtureLines().map((line) => (isRejected(line) ? { ...line, rate_limit_info: { state: 'rejected', window: 'five_hour' } } : line))
    const sevenDay = RESET_S + 7200
    const h = harness({ lines, limitsFile: { windows: { seven_day: { utilization: 1, resetsAt: sevenDay, status: 'rejected', receivedAt: START_MS - 60_000, source: 'sdk' } } } })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    expect(h.state().resumesAt).toBe(sevenDay * 1000 + RESUME_MARGIN_MS)
    expect((await h.journal()).find((event) => event.kind === 'limits-hit')).toMatchObject({ window: null, resetsAt: null })
  })

  it('with no reset time anywhere tries again every RECHECK_MS, and past MAX_WAIT_MS stops with the reason', async () => {
    // Only the refused turn, without resetsAt: every try is refused again.
    const all = fixtureLines()
    const refused = all.slice(0, all.findIndex((line, i) => i > 0 && (line as { fake?: string }).fake === 'wait_message'))
    const lines = refused.map(withoutResetsAt)
    const h = harness({ lines })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the first wait')
    expect(h.live().map((timer) => timer.at)).toEqual([START_MS + RECHECK_MS])

    clock = START_MS + RECHECK_MS
    h.live()[0]!.fire()
    await until(() => h.live().length === 1 && h.live()[0]!.at === START_MS + 2 * RECHECK_MS, 'the second try')
    expect(h.messages()).toEqual([WAVE_1, continueText(START_MS, START_MS + RECHECK_MS)])

    clock = START_MS + MAX_WAIT_MS
    h.live()[0]!.fire()
    await until(() => h.state().status === 'stopped', 'the run to give up')
    expect(h.state()).toMatchObject({ reason: 'limits-timeout', resumesAt: null })
    expect(h.state().message).toContain('longer than 24 h')
    expect(autopilotStatusLine(h.state())).toBe('stopped: limits timeout')
    expect(await h.kinds()).toEqual([
      'run-started',
      'wave-started',
      'limits-hit',
      'waiting-until',
      'resumed',
      'limits-hit',
      'waiting-until',
      'resumed',
      'limits-hit',
      'run-stopped',
    ])
    expect((await h.journal()).at(-1)).toMatchObject({ kind: 'run-stopped', reason: 'limits-timeout' })
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('a turn that goes through ends the wait: a refusal more than MAX_WAIT_MS after the first one starts a new wait, not a stop', async () => {
    const h = harness()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the first wait')
    // The continuation goes out a day and more after the first refusal; its turn goes through and
    // Wave 2 is refused in its turn. That refusal is the first of a new wait.
    clock = START_MS + MAX_WAIT_MS + 60_000
    h.live()[0]!.fire()
    await until(() => h.messages().length === 3 && h.state().status === 'waiting' && h.state().wave === 2, 'the second wait')
    expect(h.state()).toMatchObject({ status: 'waiting', reason: null, resumesAt: clock + RECHECK_MS })
    expect(await h.kinds()).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until', 'resumed', 'wave-finished', 'wave-started', 'limits-hit', 'waiting-until'])
  })

  it("a person's turn that goes through during the wait cancels it: the timer sends no continuation", async () => {
    const h = harness()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the wait for the Limits')
    const timer = h.live()[0]!
    // The Wave is not finished yet (its Tickets are still in work): the run settles, nothing else starts a wait.
    for (const num of [1, 2]) writeTicket(num, 'claimed — 2026-10-06')
    h.registry.get(orchestratorSession(h.registry)).send('how is it going?')
    await until(() => h.state().status === 'running', 'the wait to end')
    expect(timer.cancelled).toBe(true)
    expect(h.state().resumesAt).toBeNull()
    // A timer that fired all the same resumes nothing.
    clock = timer.at
    timer.fire()
    await tick()
    expect(h.messages()).toEqual([WAVE_1, 'how is it going?'])
    expect(h.messages().some((text) => text.startsWith(CONTINUE_TEXT))).toBe(false)
    expect(await h.kinds()).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until'])
  })

  it("the timer of a wait that a person's turn ended does not resume the next wait", async () => {
    const h = harness()
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'waiting', 'the first wait')
    const first = h.live()[0]!
    // A person's turn goes through: Wave 1 is finished, Wave 2 is refused, and a new wait begins.
    h.registry.get(orchestratorSession(h.registry)).send('how is it going?')
    await until(() => h.messages().length === 3 && h.state().status === 'waiting' && h.state().wave === 2, 'the second wait')
    expect(statusesOf(h.states)).toEqual(['running', 'waiting', 'running', 'waiting'])
    const second = h.live()
    expect(second).toHaveLength(1)
    expect(second[0]).not.toBe(first)
    // The first wait's timer fires late, its step already queued: the second wait goes on.
    first.fire()
    await tick()
    expect(h.messages()).toEqual([WAVE_1, 'how is it going?', WAVE_2])
    expect(h.state()).toMatchObject({ status: 'waiting', resumesAt: second[0]!.at })
    expect(await h.kinds()).not.toContain('resumed')
  })

  it('a refusal of an earlier turn does not make a later error of another kind a refusal', async () => {
    // Turn 1 (Wave 1) is told `rejected` for a window that does not block it and goes through;
    // turn 2 (Wave 2) ends with a server error. Claude Code sends no new Limits event for turn 2.
    const { passing } = fixtureTurns()
    const [wait, init, , assistant, result] = passing as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]
    const opus = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: RESET_S, rateLimitType: 'seven_day_opus', isUsingOverage: false }, uuid: '00000000-0000-4000-8000-000000000590', session_id: '{{session}}' }
    const failed = { ...result, is_error: true, result: 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', terminal_reason: 'api_error' }
    const h = harness({ lines: [wait, init, opus, assistant, result, wait, init, failed] })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.messages()).toEqual([WAVE_1, WAVE_2])
    expect(h.state()).toMatchObject({ reason: 'turn-error', resumesAt: null })
    expect(await h.kinds()).not.toContain('limits-hit')
    expect(h.timers).toEqual([])
  })
})

describe('observeSessionLimits', () => {
  it('reports the changes of the Limits status of one Session only, once per change', () => {
    const sinks = new Set<(sessionId: string, event: AgentEvent) => void>()
    const seen: SessionLimitsStatus[] = []
    const off = observeSessionLimits(
      (sink) => {
        sinks.add(sink)
        return () => sinks.delete(sink)
      },
      (sessionId) => sessionId === 'mine',
      (status) => seen.push(status),
    )
    const emit = (sessionId: string, status: string, resetsAt: number | null) => {
      const event = { type: 'rate_limit', status, rateLimitType: 'five_hour', resetsAt, fiveHourUtilization: null, sevenDayUtilization: null } as AgentEvent
      for (const sink of sinks) sink(sessionId, event)
    }
    emit('mine', 'allowed', 1)
    emit('mine', 'allowed', 1)
    emit('other', 'rejected', 2)
    emit('mine', 'rejected', 2)
    for (const sink of sinks) sink('mine', { type: 'busy' } as unknown as AgentEvent)
    off()
    emit('mine', 'allowed', 3)
    expect(seen).toEqual([
      { status: 'allowed', window: 'five_hour', resetsAt: 1 },
      { status: 'rejected', window: 'five_hour', resetsAt: 2 },
    ])
  })
})

describe('wallTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes by the wall clock: after a sleep that moved the clock past the time it fires within WALL_TICK_MS', () => {
    vi.useFakeTimers()
    let now = 0
    const fired: number[] = []
    wallTimer(() => now)(3 * 3_600_000, () => fired.push(now))
    vi.advanceTimersByTime(2 * WALL_TICK_MS)
    expect(fired).toEqual([])
    // The Mac slept: the wall clock is past the time, the process's timers are not.
    now = 3 * 3_600_000 + 5_000
    vi.advanceTimersByTime(WALL_TICK_MS)
    expect(fired).toEqual([now])
    vi.advanceTimersByTime(10 * WALL_TICK_MS)
    expect(fired).toHaveLength(1)
  })

  it('fires once when the wall clock reaches the time, and not at all once cancelled', async () => {
    let now = 0
    const schedule = wallTimer(() => now)
    const fired: string[] = []
    schedule(40, () => fired.push('first'))
    const cancel = schedule(40, () => fired.push('cancelled'))
    cancel()
    await tick(10)
    expect(fired).toEqual([])
    now = 40
    await tick(120)
    expect(fired).toEqual(['first'])
  })
})

describe('the waiting state on autopilot.changed', () => {
  const waiting: AutopilotState = { projectId: 'p', epic: 'e', status: 'waiting', wave: 2, backgroundTasks: 0, resumesAt: RESET_MS + RESUME_MARGIN_MS, reason: null, message: null, resumable: [], stopping: false, ticketsInWork: 0, harnessBehind: null, revision: 4 }

  it('sends the state and its resume time, without keys outside the contract', () => {
    const sent: unknown[] = []
    const target = { send: (_channel: string, payload: unknown) => sent.push(payload) }
    emit(target, autopilotChanged, { ...waiting, timer: 7 } as AutopilotState)
    expect(sent).toEqual([waiting])
    expect(autopilotStatusLine(waiting, { timeZone: 'Europe/Berlin' })).toBe('waiting for limits · resumes 09:12')
    expect(autopilotStatusLine({ ...waiting, resumesAt: null })).toBe('waiting for limits')
  })

  it('refuses a resume time of the wrong type and an unknown status', () => {
    const target = { send: () => undefined }
    for (const bad of [{ resumesAt: '07:12' }, { resumesAt: -1 }, { resumesAt: 1.5 }, { status: 'sleeping' }]) {
      expect(() => emit(target, autopilotChanged, { ...waiting, ...bad } as unknown as AutopilotState), JSON.stringify(bad)).toThrow('invalid event payload')
    }
    expect(autopilotStateSchema.safeParse({ ...waiting, resumesAt: undefined }).success).toBe(false)
  })
})

describe('LimitsWait', () => {
  function wait() {
    let now = START_MS
    const cancelled: number[] = []
    const subject = new LimitsWait({
      state: () => ({ windows: {} }),
      observeSession: () => () => undefined,
      send: () => undefined,
      now: () => now,
      schedule: (at) => () => cancelled.push(at),
    })
    return { subject, cancelled, at: (ms: number) => (now = ms) }
  }

  it('counts the wait from its first refusal until a turn goes through, then starts over', () => {
    const w = wait()
    const hit = { window: null, resetsAt: null }
    expect(w.subject.plan(hit)).toMatchObject({ kind: 'recheck' })
    w.at(START_MS + MAX_WAIT_MS)
    expect(w.subject.plan(hit)).toMatchObject({ kind: 'give-up' })
    w.subject.passed()
    expect(w.subject.plan(hit)).toEqual({ kind: 'recheck', at: START_MS + MAX_WAIT_MS + RECHECK_MS })
  })

  it('a turn that goes through during the wait cancels its timer', () => {
    const w = wait()
    w.subject.wait(START_MS + 1000, () => undefined)
    expect(w.subject.until).toBe(START_MS + 1000)
    w.subject.passed()
    expect(w.cancelled).toEqual([START_MS + 1000])
    expect(w.subject.until).toBeNull()
  })

  it('takes a `rejected` for a refusal only when it came during the turn; from before, only with an error text about the Limits', () => {
    let listener: ((status: SessionLimitsStatus) => void) | null = null
    const subject = new LimitsWait({
      state: () => ({ windows: {} }),
      observeSession: (_isSession, each) => {
        listener = each
        return () => undefined
      },
      send: () => undefined,
    })
    subject.watch(() => true)
    const rejected: SessionLimitsStatus = { status: 'rejected', window: 'seven_day_opus', resetsAt: RESET_S }
    const serverError = { isError: true, interrupted: false, message: 'API Error: 500' }
    const limitsError = { isError: true, interrupted: false, message: "You've hit your limit · resets 3pm" }

    subject.turnStarted()
    listener!(rejected)
    expect(subject.hitOf(serverError)).toEqual({ window: 'seven_day_opus', resetsAt: RESET_S })
    subject.turnStarted()
    expect(subject.hitOf(serverError)).toBeNull()
    expect(subject.hitOf(limitsError)).toEqual({ window: 'seven_day_opus', resetsAt: RESET_S })
    listener!({ status: 'allowed', window: 'five_hour', resetsAt: RESET_S })
    expect(subject.hitOf(serverError)).toBeNull()
    expect(subject.hitOf(limitsError)).toEqual({ window: null, resetsAt: null })
  })

  it('knows only its last wait as current, and none once it is cancelled or resumed', () => {
    const w = wait()
    const first = w.subject.wait(START_MS + 1000, () => undefined)
    expect(w.subject.isCurrent(first)).toBe(true)
    const second = w.subject.wait(START_MS + 2000, () => undefined)
    expect(w.subject.isCurrent(first)).toBe(false)
    expect(w.subject.isCurrent(second)).toBe(true)
    w.subject.resume()
    expect(w.subject.isCurrent(second)).toBe(false)
    const third = w.subject.wait(START_MS + 3000, () => undefined)
    w.subject.cancel()
    expect(w.subject.isCurrent(third)).toBe(false)
  })

  it('takes a turn for refused only when it ended with an error, not interrupted', () => {
    const w = wait()
    expect(w.subject.hitOf({ isError: true, interrupted: false, message: "You've hit your limit · resets 3pm" })).toEqual({ window: null, resetsAt: null })
    expect(w.subject.hitOf({ isError: true, interrupted: true, message: "You've hit your limit · resets 3pm" })).toBeNull()
    expect(w.subject.hitOf({ isError: false, interrupted: false, message: null })).toBeNull()
    expect(w.subject.hitOf({ isError: true, interrupted: false, message: 'Not logged in · Please run /login' })).toBeNull()
  })
})

describe('LimitsTracker and a refusal without a reset time', () => {
  const rejected = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day' } }
  const allowed = (resetsAt: number) => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', resetsAt } })

  it('keeps the window\'s known reset time while it is ahead, and drops it once it has passed', () => {
    const tracker = new LimitsTracker({ dataDir: join(scratch, 'tracker'), now: () => clock })
    tracker.recordSdkMessage(allowed(S(START_MS + 3_600_000)))
    clock += 1000
    tracker.recordSdkMessage(rejected)
    expect(tracker.snapshot().windows.seven_day).toMatchObject({ status: 'rejected', resetsAt: S(START_MS + 3_600_000) })

    clock = START_MS + 2 * 3_600_000
    tracker.recordSdkMessage(allowed(S(START_MS + 3_600_000)))
    clock += 1000
    tracker.recordSdkMessage(rejected)
    expect(tracker.snapshot().windows.seven_day).toMatchObject({ status: 'rejected', resetsAt: null })
  })
})
