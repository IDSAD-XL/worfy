// Autopilot waits for the Limits with the Auto-continue switch (worfy-retry ticket 05) on the fake
// agent: the real Session registry, Orchestrators, launcher, run journal, cycle and LimitsTracker over
// a copy of an Epic in a temporary folder, as in autopilot-limits.test.ts. The plans differ in their
// windows: test/fixtures/agent-scripts/autopilot-limits-weekly.jsonl is the owner's top plan — the
// 7-day window refused, its reset 3 days after the run's start, no `five_hour` anywhere;
// autopilot-limits-no-window.jsonl is a refusal with no window and no reset time. Auto-continue is the
// test's switch (AutopilotDeps.retry.enabled), the clock is fixed and every timer is the test's.
// keep-awake is a fake that records its calls; nothing calls the model.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
import { LimitsTracker, observeSessionLimits } from '../../src/main/agent/limits'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { CONTINUE_TEXT, continueText } from '../../src/main/autopilot/limits-wait'
import { Autopilot } from '../../src/main/autopilot/run'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { MAX_WAIT_MS, RECHECK_MS, RESUME_MARGIN_MS } from '../../src/shared/autopilot/resume-at'
import { autopilotStateSchema, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const WEEKLY = 'autopilot-limits-weekly'
const NO_WINDOW = 'autopilot-limits-no-window'
const PROJECT = 'demo-000000c5'
const EPIC = 'demo'
const WAVE_1 = '/epic-wave Ticket-ы 01, 02 эпика demo'
/** 2026-10-05T06:10:00Z: the run's start; the times of the test go from it. */
const START_MS = 1791180600 * 1000
/** The reset of the refused 7-day window in the weekly fixture: 2026-10-08T07:10:00Z, 3 days and an hour after the start. */
const WEEKLY_RESET_MS = 1791443400 * 1000
const H = 3_600_000

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

function writeTicket(num: number, status: string): void {
  const { blocked } = TICKETS.find((each) => each.num === num)!
  writeFileSync(ticketPath(num), [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blocked}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n'))
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

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-autopilot-limits-switch-')))
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

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 3000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

const tick = (wait = 50): Promise<void> => new Promise((done) => setTimeout(done, wait))

/** The lines of a fixture script, as objects. */
const scriptLines = (script: string): Record<string, unknown>[] =>
  readFileSync(join(fixtures, `${script}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

/** The weekly fixture with the refused window's reset moved to `resetS` (Unix seconds). */
function weeklyResetAt(resetS: number): Record<string, unknown>[] {
  return scriptLines(WEEKLY).map((line) => {
    const info = line.rate_limit_info as { status?: string } | undefined
    return line.type === 'rate_limit_event' && info?.status === 'rejected' ? { ...line, rate_limit_info: { ...info, resetsAt: resetS } } : line
  })
}

/** Only the refused turn of a fixture: every try is refused again. */
function refusedOnly(script: string): Record<string, unknown>[] {
  const all = scriptLines(script)
  return all.slice(0, all.findIndex((line, i) => i > 0 && line.fake === 'wait_message'))
}

interface Timer {
  at: number
  fire: () => void
  cancelled: boolean
}

interface HarnessOptions {
  /** The fixture the run's Orchestrator plays (test/fixtures/agent-scripts). */
  script: string
  /** A variant of the script: its lines, written to a scripts folder of the test. */
  lines?: Record<string, unknown>[]
  /** Auto-continue for the Project at the start. */
  on: boolean
}

function harness(options: HarnessOptions) {
  const dataRoot = join(scratch, 'data-root')
  mkdirSync(dataRoot, { recursive: true })
  let scriptsDir = fixtures
  if (options.lines !== undefined) {
    scriptsDir = join(scratch, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(scriptsDir, `${options.script}.jsonl`), options.lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
    writeFileSync(join(scriptsDir, 'autopilot-waves.jsonl'), readFileSync(join(fixtures, 'autopilot-waves.jsonl'), 'utf8'))
  }
  // The Limits are a stub: the tracker on the test's clock, fed only by the fake agent's events.
  const tracker = new LimitsTracker({ dataDir: dataRoot, now: () => clock })
  const calls: FakeCall[] = []
  /** keep-awake's calls so far at each message to the run's Orchestrator, in the order of the messages. */
  const powerAtMessage: string[][] = []
  const power: string[] = []
  const releases = new FakeReleases()
  const scriptOf = (request: QueryRequest): string => (request.unattended === true ? options.script : 'autopilot-waves')
  const registry = new SessionRegistry(
    tracker.observe((request) =>
      fakeQueryFactory({
        scriptsDir,
        script: scriptOf(request),
        releases,
        record: (call) => {
          if (request.unattended !== true) return
          calls.push(call)
          if (call.kind === 'message') powerAtMessage.push([...power])
        },
      })(request),
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
  const workflow = async (root: string) => (await readWorkflow({ root, claudeHome: join(scratch, 'claude-home'), env: () => Promise.resolve(process.env) }, runner)).model
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
  // The agent marks the Wave's Tickets done when its "Run wave" arrives.
  registry.observe((_sessionId, event) => {
    if (event.type === 'prompt' && event.text === WAVE_1) for (const num of [1, 2]) writeTicket(num, 'done — 2026-10-06')
  })
  const env = { WORFY_DATA_DIR: dataRoot }
  const timers: Timer[] = []
  const states: AutopilotState[] = []
  let on = options.on
  const schedule = (at: number, fire: () => void): (() => void) => {
    const timer: Timer = { at, fire, cancelled: false }
    timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }
  const send = (sessionId: string, text: string): void => {
    registry.get(sessionId).send(text)
  }
  const autopilot = new Autopilot({
    projectRoot: () => repo,
    selfRefusal: () => Promise.resolve(null),
    workflow,
    watchWorkflow: () => Promise.resolve(() => undefined),
    orchestrators,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    harness: () => 'plugin',
    keepAwake: () => ({ start: () => power.push('start'), stop: () => power.push('stop') }),
    onChange: (state) => states.push(state),
    settleMs: 60_000,
    limits: {
      state: () => tracker.snapshot(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => registry.observe(sink), isSession, listener),
      send,
      now: () => clock,
      schedule,
    },
    retry: { enabled: () => on, send, now: () => clock, schedule, random: () => 0.5 },
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
  const continuations = () => messages().filter((text) => text.startsWith(CONTINUE_TEXT))
  const state = () => autopilot.state(PROJECT)
  const live = () => timers.filter((timer) => !timer.cancelled)
  const setOn = (value: boolean): void => {
    on = value
  }
  return { autopilot, orchestrators, registry, tracker, timers, live, states, power, powerAtMessage, journal, kinds, messages, continuations, state, setOn }
}

type Harness = ReturnType<typeof harness>

const iso = (at: number): string => new Date(at).toISOString()
const waitingFor = async (h: Harness): Promise<void> => until(() => h.state().status === 'waiting', 'the wait for the Limits')

// ── the runs ─────────────────────────────────────────────────────────────────

describe('Autopilot, the Limits and the Auto-continue switch (worfy-retry ticket 05)', () => {
  it('on, the 7-day window refused with no five_hour and its reset in 3 days: limits-hit, waiting-until the reset, keep-awake released until 24 h before it; at the test\'s timer one continuation and resumed', async () => {
    const h = harness({ script: WEEKLY, on: true })
    await h.autopilot.start(PROJECT, EPIC)
    await waitingFor(h)

    const resumesAt = WEEKLY_RESET_MS + RESUME_MARGIN_MS
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'limits', limitsWindow: 'seven_day', resumesAt, wave: 1, reason: null })
    expect(autopilotStateSchema.parse(h.state())).toEqual(h.state())
    const events = await h.journal()
    expect(events.find((event) => event.kind === 'limits-hit')).toMatchObject({ window: 'seven_day', resetsAt: iso(WEEKLY_RESET_MS) })
    expect(events.find((event) => event.kind === 'waiting-until')).toMatchObject({ until: iso(resumesAt) })
    // Nothing of the Limits names five_hour: the plan has none.
    expect(Object.keys(h.tracker.snapshot().windows)).toEqual(['seven_day'])
    // More than 24 h to the reset: keep-awake released, and a timer to take it again 24 h before.
    expect(h.power).toEqual(['start', 'stop'])
    expect(h.live().map((timer) => timer.at).sort((a, b) => a - b)).toEqual([resumesAt - MAX_WAIT_MS, resumesAt])
    await tick()
    expect(h.messages()).toEqual([WAVE_1])

    // 24 h before: keep-awake again, the wait goes on.
    clock = resumesAt - MAX_WAIT_MS
    h.live().find((timer) => timer.at === resumesAt - MAX_WAIT_MS)!.fire()
    await until(() => h.power.length === 3, 'keep-awake taken again')
    expect(h.power).toEqual(['start', 'stop', 'start'])
    expect(h.state()).toMatchObject({ status: 'waiting', resumesAt })
    expect(h.messages()).toEqual([WAVE_1])

    // The reset: the Orchestrator gets the continuation once, even if the timer fires twice.
    clock = resumesAt
    const timer = h.live().find((each) => each.at === resumesAt)!
    timer.fire()
    timer.fire()
    await until(() => h.continuations().length === 1 && h.state().status !== 'waiting', 'the continuation')
    await tick()
    expect(h.continuations()).toEqual([continueText(START_MS, resumesAt)])
    expect(h.messages().slice(0, 2)).toEqual([WAVE_1, continueText(START_MS, resumesAt)])

    await h.autopilot.forceStop(PROJECT)
    const kinds = await h.kinds()
    expect(kinds.slice(0, 5)).toEqual(['run-started', 'wave-started', 'limits-hit', 'waiting-until', 'resumed'])
    expect(kinds.filter((kind) => kind === 'resumed')).toHaveLength(1)
    expect(kinds).not.toContain('turn-retry')
    expect(h.power.at(-1)).toBe('stop')
  })

  it('off, the same refusal: the run stops with limits-timeout at once, as before the switch; keep-awake held until the stop', async () => {
    const h = harness({ script: WEEKLY, on: false })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.state().status === 'stopped', 'the run to give up')
    expect(h.state()).toMatchObject({ reason: 'limits-timeout', resumesAt: null })
    expect(h.state().message).toBe(`The Limits reset at ${iso(WEEKLY_RESET_MS)}, more than 24 h after the wait began`)
    const kinds = await h.kinds()
    expect(kinds.slice(0, 3)).toEqual(['run-started', 'wave-started', 'limits-hit'])
    expect(kinds).not.toContain('waiting-until')
    expect(h.messages()).toEqual([WAVE_1])
    expect(h.power).toEqual(['start', 'stop'])
  })

  it.each([
    { name: 'on', on: true },
    { name: 'off', on: false },
  ])('$name, the 7-day window refused with its reset in 20 h (no five_hour): waits for the seven_day reset, keep-awake held all along', async ({ on }) => {
    const reset = START_MS + 20 * H
    const h = harness({ script: WEEKLY, lines: weeklyResetAt(reset / 1000), on })
    await h.autopilot.start(PROJECT, EPIC)
    await waitingFor(h)
    expect(h.state()).toMatchObject({ waitingFor: 'limits', limitsWindow: 'seven_day', resumesAt: reset + RESUME_MARGIN_MS })
    expect(h.live().map((timer) => timer.at)).toEqual([reset + RESUME_MARGIN_MS])
    expect(h.power).toEqual(['start'])
    clock = reset + RESUME_MARGIN_MS
    h.live()[0]!.fire()
    await until(() => h.continuations().length === 1, 'the continuation')
    expect(h.continuations()).toEqual([continueText(START_MS, reset + RESUME_MARGIN_MS)])
    await h.autopilot.forceStop(PROJECT)
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('on, no window and no reset time: limitsWindow null, a try every 30 minutes, and past 24 h the run stops with limits-timeout', async () => {
    const h = harness({ script: NO_WINDOW, lines: refusedOnly(NO_WINDOW), on: true })
    await h.autopilot.start(PROJECT, EPIC)
    await waitingFor(h)
    expect(h.state()).toMatchObject({ waitingFor: 'limits', limitsWindow: null, resumesAt: START_MS + RECHECK_MS })
    expect(autopilotStateSchema.parse(h.state())).toEqual(h.state())
    expect(h.live().map((timer) => timer.at)).toEqual([START_MS + RECHECK_MS])
    expect(h.power).toEqual(['start'])

    clock = START_MS + RECHECK_MS
    h.live()[0]!.fire()
    await until(() => h.live().length === 1 && h.live()[0]!.at === START_MS + 2 * RECHECK_MS, 'the second try')
    expect(h.continuations()).toEqual([continueText(START_MS, START_MS + RECHECK_MS)])

    clock = START_MS + MAX_WAIT_MS
    h.live()[0]!.fire()
    await until(() => h.state().status === 'stopped', 'the run to give up')
    expect(h.state()).toMatchObject({ reason: 'limits-timeout' })
    expect(h.state().message).toContain('longer than 24 h')
    expect(h.power).toEqual(['start', 'stop'])
  })

  it('on, then turned off during a wait for a reset 3 days away: when keep-awake would be taken again, the run stops with limits-timeout and sends nothing', async () => {
    const h = harness({ script: WEEKLY, on: true })
    await h.autopilot.start(PROJECT, EPIC)
    await waitingFor(h)
    const resumesAt = WEEKLY_RESET_MS + RESUME_MARGIN_MS
    h.setOn(false)
    clock = resumesAt - MAX_WAIT_MS
    h.live().find((timer) => timer.at === resumesAt - MAX_WAIT_MS)!.fire()
    await until(() => h.state().status === 'stopped', 'the run to stop')
    expect(h.state()).toMatchObject({ reason: 'limits-timeout', resumesAt: null })
    expect(h.state().message).toContain('Auto-continue')
    expect(h.live()).toEqual([])
    expect(h.messages()).toEqual([WAVE_1])
    expect(h.power.at(-1)).toBe('stop')
    expect(h.power.filter((call) => call === 'start')).toHaveLength(1)
  })

  it('on: a Mac asleep through the reset fires the reset\'s timer first: keep-awake is taken again with the continuation', async () => {
    const h = harness({ script: WEEKLY, on: true })
    await h.autopilot.start(PROJECT, EPIC)
    await waitingFor(h)
    const resumesAt = WEEKLY_RESET_MS + RESUME_MARGIN_MS
    clock = resumesAt + H
    h.live().find((timer) => timer.at === resumesAt)!.fire()
    await until(() => h.continuations().length === 1, 'the continuation')
    expect(h.power).toEqual(['start', 'stop', 'start'])
    // Taken before the continuation went: the Mac stays awake through its turn.
    expect(h.powerAtMessage[1]).toEqual(['start', 'stop', 'start'])
    // The timer 24 h before, firing late, does nothing more.
    h.timers.find((timer) => timer.at === resumesAt - MAX_WAIT_MS)!.fire()
    await tick()
    expect(h.power).toEqual(['start', 'stop', 'start'])
    expect(h.state().status).not.toBe('stopped')
  })

  it('on: a person\'s turn that goes through during a far wait ends it, and keep-awake is held again', async () => {
    const h = harness({ script: WEEKLY, on: true })
    await h.autopilot.start(PROJECT, EPIC)
    await waitingFor(h)
    expect(h.power).toEqual(['start', 'stop'])
    // The Wave is not finished yet: the run settles after the person's turn, nothing else starts a wait.
    for (const num of [1, 2]) writeTicket(num, 'claimed — 2026-10-06')
    // The person writes in the Orchestrator's chat: the script's second turn goes through.
    h.registry.get(h.registry.list()[0]!.sessionId).send('how is it going?')
    await until(async () => (await h.kinds()).includes('resumed'), 'the wait to end with resumed')
    await until(() => h.power.length === 3, 'keep-awake taken again')
    expect(h.power).toEqual(['start', 'stop', 'start'])
    expect(h.live().filter((timer) => timer.at === WEEKLY_RESET_MS + RESUME_MARGIN_MS - MAX_WAIT_MS)).toEqual([])
  })
})
